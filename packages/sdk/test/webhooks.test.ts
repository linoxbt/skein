import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhook } from "../src/webhooks";

const secret = "s3cr3t-from-setWebhook";
const body = JSON.stringify({ event: "verdict.completed", runId: "vrd_abc123", verdict: "APPROVE" });
const NOW = 1_800_000_000_000;
const ts = String(NOW / 1000);
/** The API's signature: HMAC-SHA256 over `${timestamp}.${body}`. */
const sign = (b: string, t = ts, k = secret) => `sha256=${createHmac("sha256", k).update(`${t}.${b}`).digest("hex")}`;
const legacy = (b: string, k = secret) => `sha256=${createHmac("sha256", k).update(b).digest("hex")}`;
const headers = (sig: string, t: string | undefined = ts) => ({ "X-Skein-Signature": sig, ...(t !== undefined ? { "X-Skein-Timestamp": t } : {}), "content-type": "application/json" });

describe("verifyWebhook", () => {
  it("accepts a delivery signed the way the API signs it, from headers or from the two values", async () => {
    expect(await verifyWebhook(body, headers(sign(body)), secret, { now: NOW })).toBe(true);
    expect(await verifyWebhook(body, new Headers(headers(sign(body))), secret, { now: NOW })).toBe(true);
    expect(await verifyWebhook(new TextEncoder().encode(body), sign(body), secret, { timestamp: ts, now: NOW })).toBe(true);
    // Node's req.headers: lower-case names.
    expect(await verifyWebhook(body, { "x-skein-signature": sign(body), "x-skein-timestamp": ts }, secret, { now: NOW + 299_000 })).toBe(true);
  });

  it("refuses a changed body, another secret, and malformed or missing headers", async () => {
    expect(await verifyWebhook(body.replace("APPROVE", "REJECT"), headers(sign(body)), secret, { now: NOW })).toBe(false);
    expect(await verifyWebhook(body, headers(sign(body, ts, "other")), secret, { now: NOW })).toBe(false);
    expect(await verifyWebhook(body, headers("sha256=xyz"), secret, { now: NOW })).toBe(false);
    expect(await verifyWebhook(body, undefined, secret, { now: NOW })).toBe(false);
    expect(await verifyWebhook(body, headers(sign(body)), "", { now: NOW })).toBe(false);
    expect(await verifyWebhook(body, headers(sign(body, "12x"), "12x"), secret, { now: NOW })).toBe(false);
  });

  it("refuses a replay: a delivery older (or newer) than five minutes, or with its timestamp changed", async () => {
    expect(await verifyWebhook(body, headers(sign(body)), secret, { now: NOW + 301_000 })).toBe(false);
    expect(await verifyWebhook(body, headers(sign(body)), secret, { now: NOW - 301_000 })).toBe(false);
    // Moving the timestamp forward to pass the window breaks the signature.
    const fresh = String(NOW / 1000 + 600);
    expect(await verifyWebhook(body, headers(sign(body), fresh), secret, { now: NOW + 600_000 })).toBe(false);
    expect(await verifyWebhook(body, headers(sign(body)), secret, { now: NOW + 3_600_000, toleranceSec: 7200 })).toBe(true);
  });

  it("accepts the old body-only signature only when asked to", async () => {
    expect(await verifyWebhook(body, headers(legacy(body), undefined), secret, { now: NOW })).toBe(false);
    expect(await verifyWebhook(body, legacy(body), secret, { now: NOW })).toBe(false);
    expect(await verifyWebhook(body, legacy(body), secret, { allowLegacyBodyOnly: true })).toBe(true);
    // Opting in does not let a timestamped delivery skip its window.
    expect(await verifyWebhook(body, headers(sign(body)), secret, { now: NOW + 301_000, allowLegacyBodyOnly: true })).toBe(false);
  });
});
