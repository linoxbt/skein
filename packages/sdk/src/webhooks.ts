/**
 * Checks a Skein webhook delivery. Skein signs each delivery's raw body:
 * X-Skein-Signature: sha256=<hex HMAC-SHA256 of the body with your secret>.
 * Uses Web Crypto, so it runs in Node 18+, Deno, Bun, workers and browsers.
 *
 *   const ok = await verifyWebhook(rawBody, req.headers["x-skein-signature"], process.env.SKEIN_WEBHOOK_SECRET);
 *
 * Pass the body exactly as received (before JSON.parse): re-serialising it
 * changes the bytes and the signature no longer matches.
 */
export async function verifyWebhook(rawBody: string | Uint8Array, signatureHeader: string | null | undefined, secret: string): Promise<boolean> {
  const m = /^sha256=([0-9a-f]{64})$/i.exec((signatureHeader ?? "").trim());
  if (!m || !secret) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const body = typeof rawBody === "string" ? enc.encode(rawBody) : rawBody;
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, body as Uint8Array<ArrayBuffer>));
  const want = hexToBytes(m[1]!.toLowerCase());
  // Constant-time comparison: never return early on the first differing byte.
  let diff = mac.length ^ want.length;
  for (let i = 0; i < Math.min(mac.length, want.length); i++) diff |= mac[i]! ^ want[i]!;
  return diff === 0;
}

/** A parsed delivery: the event name and its JSON payload. */
export interface WebhookEvent {
  event: "verdict.done" | "verdict.refused" | string;
  runId: string;
  [k: string]: unknown;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
