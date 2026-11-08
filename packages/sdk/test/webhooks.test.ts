import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhook } from "../src/webhooks";

const secret = "s3cr3t-from-setWebhook";
const body = JSON.stringify({ event: "verdict.done", runId: "vrd_abc123", verdict: "APPROVE" });
const sign = (b: string, k = secret) => `sha256=${createHmac("sha256", k).update(b).digest("hex")}`;

describe("verifyWebhook", () => {
  it("accepts a delivery signed the way the API signs it", async () => {
    expect(await verifyWebhook(body, sign(body), secret)).toBe(true);
    expect(await verifyWebhook(new TextEncoder().encode(body), sign(body), secret)).toBe(true);
  });
  it("refuses a changed body, another secret, and malformed or missing headers", async () => {
    expect(await verifyWebhook(body.replace("APPROVE", "REJECT"), sign(body), secret)).toBe(false);
    expect(await verifyWebhook(body, sign(body, "other"), secret)).toBe(false);
    expect(await verifyWebhook(body, "sha256=xyz", secret)).toBe(false);
    expect(await verifyWebhook(body, undefined, secret)).toBe(false);
    expect(await verifyWebhook(body, sign(body), "")).toBe(false);
  });
});
