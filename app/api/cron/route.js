import { runDigest } from "../../../lib/digest.js";

export const maxDuration = 60;

export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const toEmail = process.env.DIGEST_EMAIL;
  if (!apiKey || !toEmail) {
    return Response.json({ error: "Missing ANTHROPIC_API_KEY or DIGEST_EMAIL env vars" }, { status: 500 });
  }
  try {
    const result = await runDigest(apiKey, toEmail);
    console.log(`[digest-cron] Done — ${result.count} emails, sent: ${result.sent}`);
    return Response.json({ success: true, ...result });
  } catch (err) {
    console.error("[digest-cron] Error:", err.message);
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}
