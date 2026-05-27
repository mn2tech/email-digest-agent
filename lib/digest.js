const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const GMAIL_MCP = "https://gmailmcp.googleapis.com/mcp/v1";
const MODEL = "claude-sonnet-4-5";
const LOOKBACK_HOURS = 24;
const MAX_EMAILS = 20;

export async function runDigest(apiKey, toEmail) {
  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };

  // Step 1: Fetch emails via Gmail MCP
  const fetchRes = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      mcp_servers: [{ type: "url", url: GMAIL_MCP, name: "gmail" }],
      system: `You are an email fetching assistant. Use Gmail MCP tools to fetch recent emails.
Return ONLY a valid JSON array, no markdown, no backticks.
Each element: {"id":"...","sender":"Full Name","subject":"...","snippet":"...","date":"..."}
Fetch up to ${MAX_EMAILS} emails received after ${since}.`,
      messages: [{ role: "user", content: `Fetch up to ${MAX_EMAILS} emails received after ${since}. Return only the JSON array.` }],
    }),
  });

  if (!fetchRes.ok) {
    const err = await fetchRes.text();
    throw new Error(`Gmail fetch failed (${fetchRes.status}): ${err}`);
  }

  const fetchData = await fetchRes.json();
  const rawText = fetchData.content?.find((b) => b.type === "text")?.text ?? "[]";
  const rawEmails = safeParseJSON(rawText, []);

  if (rawEmails.length === 0) {
    return { sent: false, count: 0, digest: "No emails in the last 24 hours." };
  }

  // Step 2: Summarize & prioritize
  const emailList = rawEmails
    .map((e, i) => `[${i + 1}] From: ${e.sender}\nSubject: ${e.subject}\nSnippet: ${e.snippet}\nDate: ${e.date}`)
    .join("\n\n");

  const summaryRes = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 3000,
      system: `You are an email digest assistant. Return ONLY a JSON array, no markdown, no backticks.
Each item: {"sender":"...","subject":"...","time":"...","summary":"1-2 sentences","priority":"high|medium|low","action":"short action or null"}
Priority: high=urgent/action needed today, medium=needs attention soon, low=newsletters/automated.
Sort: high first, then medium, then low.`,
      messages: [{ role: "user", content: `Summarize these emails:\n\n${emailList}` }],
    }),
  });

  if (!summaryRes.ok) {
    const err = await summaryRes.text();
    throw new Error(`Summary failed (${summaryRes.status}): ${err}`);
  }

  const summaryData = await summaryRes.json();
  const summaryRaw = summaryData.content?.find((b) => b.type === "text")?.text ?? "[]";
  const emails = safeParseJSON(summaryRaw, []);

  // Step 3: Build & send HTML email
  const htmlBody = buildDigestEmail(emails);

  const sendRes = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      mcp_servers: [{ type: "url", url: GMAIL_MCP, name: "gmail" }],
      system: "You are an email sending assistant. Use Gmail MCP to send the email specified. Reply with only: {\"sent\": true}",
      messages: [{
        role: "user",
        content: `Send an email:
To: ${toEmail}
Subject: Your morning digest — ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
Body (HTML): ${htmlBody}
Send it now and reply with {"sent": true}.`,
      }],
    }),
  });

  if (!sendRes.ok) {
    const err = await sendRes.text();
    throw new Error(`Send failed (${sendRes.status}): ${err}`);
  }

  return { sent: true, count: emails.length, digest: htmlBody };
}

function safeParseJSON(text, fallback) {
  try { return JSON.parse(text.replace(/```json|```/g, "").trim()); }
  catch { return fallback; }
}

function buildDigestEmail(emails) {
  const date = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const high = emails.filter((e) => e.priority === "high");
  const rest = emails.filter((e) => e.priority !== "high");
  const actions = emails.filter((e) => e.action).length;

  const badgeStyle = (p) => ({
    high: "background:#fdf0ef;color:#c0392b;border:1px solid #f5c6c6",
    medium: "background:#fdf4e7;color:#b7600a;border:1px solid #f5dfa8",
    low: "background:#f5f5f5;color:#888;border:1px solid #ddd",
  }[p] ?? "background:#f5f5f5;color:#888");

  const emailRow = (e) => `
    <tr><td style="padding:14px 0;border-bottom:1px solid #eee;vertical-align:top">
      <div style="margin-bottom:3px">
        <span style="font-weight:600;font-size:14px;color:#1a1a18">${esc(e.sender)}</span>
        <span style="font-size:11px;padding:2px 7px;border-radius:3px;margin-left:8px;${badgeStyle(e.priority)}">${e.priority}</span>
        <span style="float:right;font-size:12px;color:#999">${esc(e.time ?? "")}</span>
      </div>
      <div style="font-size:13px;color:#666;margin-bottom:5px">${esc(e.subject)}</div>
      <div style="font-size:14px;color:#333;line-height:1.55">${esc(e.summary)}</div>
      ${e.action ? `<div style="margin-top:7px;font-size:12px;color:#b7600a;background:#fdf4e7;padding:5px 10px;border-left:3px solid #b7600a">&rarr; ${esc(e.action)}</div>` : ""}
    </td></tr>`;

  const section = (label, rows) => rows.length === 0 ? "" : `
    <tr><td style="padding:20px 0 8px">
      <div style="font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#999;border-bottom:1px solid #eee;padding-bottom:6px">${label}</div>
    </td></tr>${rows.map(emailRow).join("")}`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f3ee;font-family:Georgia,serif">
<div style="max-width:600px;margin:32px auto;background:#fff;border:1px solid #ddd;border-radius:4px;overflow:hidden">
  <div style="background:#1a1a18;padding:24px 32px">
    <div style="font-size:26px;color:#f5f3ee;letter-spacing:-0.5px">The Daily Digest</div>
    <div style="font-size:12px;color:#999;margin-top:4px">${date}</div>
  </div>
  <div style="background:#f5f3ee;padding:12px 32px;border-bottom:1px solid #ddd;font-size:12px;color:#666">
    <span style="margin-right:20px">&#128235; <strong>${emails.length}</strong> emails</span>
    <span style="margin-right:20px;color:#c0392b">&#128308; <strong>${high.length}</strong> high priority</span>
    <span style="color:#b7600a">&#9889; <strong>${actions}</strong> action items</span>
  </div>
  <div style="padding:8px 32px 32px">
    <table style="width:100%;border-collapse:collapse">
      ${section("Needs attention", high)}
      ${section(high.length > 0 ? "Everything else" : "All emails", rest)}
    </table>
  </div>
  <div style="padding:16px 32px;border-top:1px solid #eee;font-size:11px;color:#bbb;text-align:center">
    Sent by your email digest agent &middot; every day at 8:00 AM
  </div>
</div>
</body></html>`;
}

function esc(str) {
  return String(str ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
