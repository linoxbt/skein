/**
 * Checks a Skein webhook delivery. Skein signs each delivery's timestamp and
 * raw body:
 *   X-Skein-Timestamp: <unix seconds>
 *   X-Skein-Signature: sha256=<hex HMAC-SHA256 of `${timestamp}.${body}` with your secret>
 * A delivery more than five minutes from your clock is refused, so a captured
 * delivery cannot be replayed later. Uses Web Crypto, so it runs in Node 18+,
 * Deno, Bun, workers and browsers.
 *
 *   const ok = await verifyWebhook(rawBody, req.headers, process.env.SKEIN_WEBHOOK_SECRET);
 *
 * Pass the body exactly as received (before JSON.parse): re-serialising it
 * changes the bytes and the signature no longer matches. Deliveries are
 * at-least-once: dedupe on the payload's runId.
 */
export interface VerifyWebhookOptions {
  /** X-Skein-Timestamp, when the second argument is the signature header alone. */
  timestamp?: string | number | null;
  /** How far the timestamp may be from now, in seconds. Default 300. */
  toleranceSec?: number;
  /** The clock, in milliseconds. Default Date.now(). */
  now?: number;
  /**
   * Also accept the older format, an HMAC of the body alone with no
   * timestamp, which can be replayed. Off unless you opt in, for deliveries
   * from an API that predates timestamps.
   */
  allowLegacyBodyOnly?: boolean;
}

type HeaderBag = Headers | Record<string, string | string[] | undefined>;

function header(h: HeaderBag, name: string): string | undefined {
  if (typeof (h as Headers).get === "function") return (h as Headers).get(name) ?? undefined;
  const bag = h as Record<string, string | string[] | undefined>;
  const key = Object.keys(bag).find((k) => k.toLowerCase() === name);
  const v = key === undefined ? undefined : bag[key];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * true when the delivery was signed with `secret` within the tolerance.
 * The second argument is the request's headers (a Headers object or Node's
 * req.headers), or the X-Skein-Signature value with opts.timestamp set.
 */
export async function verifyWebhook(
  rawBody: string | Uint8Array,
  headersOrSignature: HeaderBag | string | null | undefined,
  secret: string,
  opts: VerifyWebhookOptions = {},
): Promise<boolean> {
  const bag = headersOrSignature !== null && typeof headersOrSignature === "object" ? headersOrSignature : undefined;
  const signature = bag ? header(bag, "x-skein-signature") : (headersOrSignature as string | null | undefined);
  const ts = opts.timestamp ?? (bag ? header(bag, "x-skein-timestamp") : undefined);
  const m = /^sha256=([0-9a-f]{64})$/i.exec((signature ?? "").trim());
  if (!m || !secret) return false;
  const want = hexToBytes(m[1]!.toLowerCase());
  const enc = new TextEncoder();
  const body = typeof rawBody === "string" ? enc.encode(rawBody) : rawBody;

  if (ts === undefined || ts === null || ts === "") {
    return opts.allowLegacyBodyOnly === true && equal(await hmac(secret, body), want);
  }
  const t = String(ts).trim();
  if (!/^\d{1,13}$/.test(t)) return false;
  // Unix seconds; a 13-digit value is read as milliseconds. The signed text is the header as sent.
  const sentSec = t.length === 13 ? Number(t) / 1000 : Number(t);
  if (Math.abs((opts.now ?? Date.now()) / 1000 - sentSec) > (opts.toleranceSec ?? 300)) return false;
  const prefix = enc.encode(`${t}.`);
  const signed = new Uint8Array(prefix.length + body.length);
  signed.set(prefix);
  signed.set(body, prefix.length);
  return equal(await hmac(secret, signed), want);
}

/** A parsed delivery: the event name and its JSON payload. */
export interface WebhookEvent {
  /** verdict.completed when a verdict is sealed; verdict.refused when the request was refused. */
  event: "verdict.completed" | "verdict.refused" | (string & {});
  runId: string;
  [k: string]: unknown;
}

async function hmac(secret: string, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, data as Uint8Array<ArrayBuffer>));
}

/** Constant-time comparison: never returns early on the first differing byte. */
function equal(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.min(a.length, b.length); i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
