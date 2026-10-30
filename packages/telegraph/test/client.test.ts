import { describe, expect, it } from "vitest";
import { amountFromTemplate, findEscrowAccept, TelegraphClient, TESTNET, viemSigner } from "../src";
import { FakeNode, type Behaviour } from "../src/testing/fake-node";

// A throwaway key used only in tests (Hardhat's first default account).
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const SEASON = Date.parse("2026-11-02T00:00:00Z");

function setup(respond: (minerId: string, body: Record<string, unknown>, n: number) => Behaviour, over: Partial<ConstructorParameters<typeof TelegraphClient>[0]> = {}) {
  const node = new FakeNode({ respond, nowSec: () => Math.floor(SEASON / 1000) });
  const client = new TelegraphClient({
    network: TESTNET,
    signer: viemSigner(KEY),
    fetch: node.fetch,
    maxUusdcPerCall: 50_000,
    now: () => SEASON,
    ...over,
  });
  return { node, client };
}

const ask = { intent: "TOKEN_HOLDER_COUNT_GENERAL", params: { token: "0x1", chain: "ethereum" } };

describe("escrow challenge parsing", () => {
  it("reads the amount from the template, not the dollar price", () => {
    expect(amountFromTemplate("Amount: 10000 uUSDC\nResource: /v1/ask")).toBe("10000");
    expect(amountFromTemplate("Price: $0.01")).toBeNull();
  });
  it("prefers the PAYMENT-REQUIRED header and falls back to the body", () => {
    const accept = { scheme: "escrow", network: "n", payTo: "0x1", extra: { message: "m" } };
    const header = Buffer.from(JSON.stringify({ accepts: [accept] })).toString("base64");
    expect(findEscrowAccept(header, null)).toEqual(accept);
    expect(findEscrowAccept("not-base64-json", { accepts: [{ scheme: "exact" }, accept] })).toEqual(accept);
    expect(findEscrowAccept(null, { accepts: [{ scheme: "exact" }] })).toBeNull();
  });
});

describe("TelegraphClient.ask on the escrow rail", () => {
  it("pays a 402 with a signature the node verifies, and returns the receipt", async () => {
    const { node, client } = setup(() => ({ kind: "answer", result: { holders_count: 812 } }));
    const out = await client.ask(ask, { minerId: "7302", timeoutMs: 1000 });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.response.result).toEqual({ holders_count: 812 });
    expect(out.receipt?.receipt_hash).toBe(node.charges[0]!.receiptHash);
    expect(out.receipt?.rail).toBe("escrow");
    expect(out.amountUusdc).toBe(10_000);
    expect(node.charges).toHaveLength(1);
    expect(node.refusals).toEqual([]);
  });

  it("retries a 5xx once with a fresh nonce; failed calls are not billed", async () => {
    const { node, client } = setup((_, __, n) => (n === 1 ? { kind: "status", status: 502 } : { kind: "answer", result: { ok: 1 } }));
    const out = await client.ask(ask, { minerId: "7302", timeoutMs: 1000 });
    expect(out.ok && out.attempts).toBe(2);
    expect(node.charges).toHaveLength(1);
    expect(node.refusals).toEqual([]); // the second attempt did not reuse the nonce
  });

  it("does not retry a 4xx", async () => {
    const { node, client } = setup(() => ({ kind: "status", status: 400, body: { error: "invalid request body" } }));
    const out = await client.ask(ask, { minerId: "7302", timeoutMs: 1000 });
    expect(out).toMatchObject({ ok: false, kind: "client_error", attempts: 1, httpStatus: 400 });
    expect(node.charges).toHaveLength(0);
  });

  it("times out, retries once, then reports a timeout", async () => {
    const { node, client } = setup(() => ({ kind: "hang" }), { now: () => SEASON });
    const out = await client.ask(ask, { minerId: "7302", timeoutMs: 30 });
    expect(out).toMatchObject({ ok: false, kind: "timeout", attempts: 2 });
    expect(node.charges).toHaveLength(0);
  });

  it("refuses a challenge that pays more than the per-call cap", async () => {
    const node = new FakeNode({ priceUusdc: 90_000, respond: () => ({ kind: "answer", result: {} }), nowSec: () => Math.floor(SEASON / 1000) });
    const client = new TelegraphClient({ network: TESTNET, signer: viemSigner(KEY), fetch: node.fetch, maxUusdcPerCall: 50_000, now: () => SEASON });
    expect(await client.ask(ask, { timeoutMs: 1000 })).toMatchObject({ ok: false, kind: "mismatch" });
    expect(node.charges).toHaveLength(0);
  });

  it("refuses a challenge that pays anywhere but the configured Diamond", async () => {
    const { client } = setup(() => ({ kind: "answer", result: {} }), {
      network: { ...TESTNET, diamond: "0x000000000000000000000000000000000000dEaD" },
    });
    const out = await client.ask(ask, { timeoutMs: 1000 });
    expect(out).toMatchObject({ ok: false, kind: "mismatch" });
    expect(!out.ok && out.error).toMatch(/expected the Diamond/);
  });

  it("refuses to pay before the season opens unless told otherwise", async () => {
    const pre = Date.parse("2026-10-30T12:00:00Z");
    const { node, client } = setup(() => ({ kind: "answer", result: {} }), { now: () => pre });
    expect(await client.ask(ask, { timeoutMs: 1000 })).toMatchObject({ ok: false, kind: "preseason" });
    expect(node.charges).toHaveLength(0);
  });
});

describe("refusals before payment", () => {
  it("a 503 no_compatible_miner is 'incompatible', not retried and not billed", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: "no_compatible_miner", message: "/query has no field for required param(s) name" }), { status: 503 });
    const client = new TelegraphClient({ network: TESTNET, signer: viemSigner(KEY), fetch: fetchImpl, maxUusdcPerCall: 50_000, now: () => SEASON });
    expect(await client.ask(ask, { minerId: "78021", timeoutMs: 1000 })).toMatchObject({ ok: false, kind: "incompatible", attempts: 1, httpStatus: 503 });
  });
});
