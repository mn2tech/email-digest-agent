import { runDigest } from "../../../lib/digest.js";

export const maxDuration = 60;

export async function POST(request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const toEmail = process.env.DIGEST_EMAIL;
  if (!apiKey || !toEmail) {
    return Response.json({ error: "Missing ANTHROPIC_API_KEY or DIGEST_EMAIL env vars" }, { status: 500 });
  }
  try {
    const result = await runDigest(apiKey, toEmail);
    return Response.json({ success: true, ...result });
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}
