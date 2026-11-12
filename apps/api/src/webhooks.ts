import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Webhook signing and secret storage.
 *
 * Each delivery is a POST with these headers:
 *   X-Skein-Event:        verdict.completed
 *   X-Skein-Timestamp:    <unix seconds when the delivery was signed>
 *   X-Skein-Signature-V2: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>
 *   X-Skein-Signature:    sha256=<hex HMAC-SHA256(secret, <raw body>)>   (legacy)
 * A receiver should check V2 and refuse a timestamp more than 5 minutes from
 * its clock (spec §9): that is what stops a captured delivery from being
 * replayed. The legacy header signs the body alone, so it proves origin but
 * not freshness; it is kept for receivers on SDK <= 0.3 and will be dropped.
 *
 * The body's `event` is "verdict.completed" (the spec's name) for every
 * finished run, with `status` "done" or "refused". `legacyEvent` carries the
 * name sent before 2026-11-12 ("verdict.done" or "verdict.refused").
 */
export const WEBHOOK_TOLERANCE_SEC = 300;

export const signV1 = (secret: string, body: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
export const signV2 = (secret: string, timestamp: number, body: string) => `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;

export function webhookHeaders(secret: string, body: string, nowSec: number): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-skein-event": "verdict.completed",
    "x-skein-timestamp": String(nowSec),
    "x-skein-signature-v2": signV2(secret, nowSec, body),
    "x-skein-signature": signV1(secret, body),
  };
}

/** The receiver's check, as the SDK implements it (here for tests and for reference). */
export function verifyV2(secret: string, body: string, timestampHeader: string | null, signatureHeader: string | null, nowSec: number): boolean {
  const ts = Number(timestampHeader);
  if (!Number.isInteger(ts) || Math.abs(nowSec - ts) > WEBHOOK_TOLERANCE_SEC || !signatureHeader) return false;
  const want = Buffer.from(signV2(secret, ts, body));
  const got = Buffer.from(signatureHeader);
  return want.length === got.length && timingSafeEqual(want, got);
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** WEBHOOK_SECRET_KEY: 32 bytes, as 64 hex characters or base64. Undefined leaves secrets in plain text. */
export function secretKeyFromEnv(raw: string | undefined): Buffer | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  const key = /^[0-9a-fA-F]{64}$/.test(v) ? Buffer.from(v, "hex") : Buffer.from(v, "base64");
  if (key.length !== 32) throw new Error("WEBHOOK_SECRET_KEY must be 32 bytes (64 hex characters or base64)");
  return key;
}

/** The secret as stored: AES-256-GCM ("enc:v1:<iv>:<tag>:<ciphertext>", base64url) with a key, plain text without. */
export function sealSecret(secret: string, key: Buffer | undefined): string {
  if (!key) return secret;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(secret, "utf8"), c.final()]);
  return `enc:v1:${iv.toString("base64url")}:${c.getAuthTag().toString("base64url")}:${ct.toString("base64url")}`;
}

/**
 * The secret to sign with, from its stored form, checked against secret_hash.
 * Null when it cannot be recovered (encrypted and no key, or the wrong key),
 * so the delivery is skipped rather than signed with the wrong secret.
 */
export function openSecret(stored: string, secretHash: string, key: Buffer | undefined): string | null {
  let secret = stored;
  if (stored.startsWith("enc:v1:")) {
    if (!key) return null;
    const [iv, tag, ct] = stored.slice(7).split(":");
    try {
      const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv!, "base64url"));
      d.setAuthTag(Buffer.from(tag!, "base64url"));
      secret = Buffer.concat([d.update(Buffer.from(ct!, "base64url")), d.final()]).toString("utf8");
    } catch {
      return null;
    }
  }
  return sha256(secret) === secretHash ? secret : null;
}
