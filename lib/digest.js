const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-5";
const LOOKBACK_HOURS = 24;
const MAX_EMAILS = 20;

async function getGmailToken() {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Failed to get Gmail token: " + JSON.stringify(data));
  return data.access_token;
}

async function fetchEmails(token) {
  const since = Math.floor((Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000) / 1000);
  const q = `after:${since}`;
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${MAX_EMAILS}&q=${encodeURIComponent(q)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const listData = await listRes.json();
  if (!listData.messages) return [];
  const emails = await Promise.all(
    listData.messages.map(async (msg) => {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const msgData = await msgRes.json();
      const headers = msgData.payload?.headers ?? [];
      const get = (name) => headers.find((h) => h.name === name)?.value ?? "";
      return {
        id: msg.id,
        sender: get("From"),
        subject: get("Subject"),
        date: get("Date"),
        snippet: msgData.snippet ?? "",
      };
    })
  );
  return emails;
}

async function sendEmail(token, to, subject, htmlBody) {
  const message = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=utf-8",
    "",
    htmlBody,
  ].join("\n");
  const encoded = Buffer.from(message).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: encoded }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gmail send failed (${res.status}): ${err}`);
  }
}

export async function runDigest(apiKey, toEmail) {
  const token = await getGmailToken();
  const rawEmails = await fetchEmails(token);
  if (rawEmails.length === 0) {
    return { sent: false, count: 0, digest: "No emails in the last 24 hours." };
  }
  const emailList = rawEmails
    .map((e, i) => `[${i + 1}] From: ${e.sender}\nSubject: ${e.subject}\nSnippet: ${e.snippet}\nDate: ${e.date}`)
    .join("\n\n");
  const summaryRes = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
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
  const htmlBody = buildDigestEmail(emails);
  const subject = `Your morning digest — ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}`;
  await sendEmail(token, toEmail, subject, htmlBody);
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
