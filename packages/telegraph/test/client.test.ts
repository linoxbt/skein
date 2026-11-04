import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { amountFromTemplate, ChallengeMismatchError, findEscrowAccept, parseTemplate, readChallenge, receiptProblems, signEscrowPayment, TelegraphClient, TESTNET, viemSigner } from "../src";
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

// The live node's 402, captured 2026-11-02 from /engine/v1/ask/7302 (unpaid, free).
const LIVE = JSON.parse(readFileSync(new URL("./fixtures/live-402-7302.json", import.meta.url), "utf8"));
const TEMPLATE: string = LIVE.body.accepts[1].extra.message;
const swap = (from: string, to: string) => TEMPLATE.replace(from, to);

describe("the live 402 (fixture)", () => {
  it("parses the header and body the node actually sends", () => {
    const header = Buffer.from(JSON.stringify(LIVE.paymentRequiredHeader)).toString("base64");
    const c = readChallenge(header, LIVE.body)!;
    expect(c.escrow.amount).toBe("10000");
    expect(c.assets).toEqual([TESTNET.usdc]);
    expect(parseTemplate(c.escrow.extra.message)).toEqual({ payTo: TESTNET.diamond.toLowerCase(), network: TESTNET.caip2, amountUusdc: "10000", resource: "/v1/ask/7302" });
  });

  it("signs it for exactly the template's amount, payee and resource", async () => {
    const c = readChallenge(Buffer.from(JSON.stringify(LIVE.paymentRequiredHeader)).toString("base64"), null)!;
    const signer = viemSigner(KEY);
    const out = await signEscrowPayment({
      accept: c.escrow, assets: c.assets, signer, nowSec: 1_793_000_000, nonce: "n-1",
      expected: { caip2: TESTNET.caip2, diamond: TESTNET.diamond, usdc: TESTNET.usdc, maxUusdc: 50_000, resource: "/v1/ask/7302" },
    });
    expect(out.amountUusdc).toBe(10_000);
    expect(out.authorization).toMatchObject({ from: signer.address.toLowerCase(), value: "10000", nonce: "n-1" });
    expect(Number(out.authorization.validBefore) - Number(out.authorization.validAfter)).toBeLessThanOrEqual(120);
  });
});

describe("a tampered escrow template is refused before signing", () => {
  const sign = (message: string, extra: { amount?: string; assets?: string[]; resource?: string } = {}) =>
    signEscrowPayment({
      accept: { scheme: "escrow", network: TESTNET.caip2, payTo: TESTNET.diamond, ...(extra.amount ? { amount: extra.amount } : {}), extra: { message } },
      assets: extra.assets ?? [], signer: viemSigner(KEY), nowSec: 1_793_000_000, nonce: "n",
      expected: { caip2: TESTNET.caip2, diamond: TESTNET.diamond, usdc: TESTNET.usdc, maxUusdc: 50_000, ...(extra.resource ? { resource: extra.resource } : {}) },
    });
  it.each([
    ["a second Amount line", swap("Resource: /v1/ask/7302", "Resource: /v1/ask/7302\nAmount: 5000000 uUSDC")],
    ["an Amount hidden in another line", swap("Resource: /v1/ask/7302", "Resource: Amount: 1 uUSDC")],
    ["another payee", swap("Pay To: 0x3624eb012b5e998bb57b6be6c9cfc9c4bc5eb99b", "Pay To: 0x000000000000000000000000000000000000dead")],
    ["another network", swap("Network: eip155:11155111", "Network: eip155:1")],
    ["an unknown placeholder", swap("Resource: /v1/ask/7302", "Resource: /v1/ask/{miner}")],
    ["a signer field that is not a bare placeholder", swap("Wallet: {from}", "Wallet: {from} and 0xabc")],
    ["an amount over the cap", swap("Amount: 10000 uUSDC", "Amount: 60000 uUSDC")],
  ])("refuses %s", async (_, message) => {
    await expect(sign(message)).rejects.toBeInstanceOf(ChallengeMismatchError);
  });
  it("refuses when the JSON amount, asset or resource disagrees", async () => {
    await expect(sign(TEMPLATE, { amount: "9000" })).rejects.toThrow(/disagrees/);
    await expect(sign(TEMPLATE, { assets: ["0x0000000000000000000000000000000000000001"] })).rejects.toThrow(/asset/);
    await expect(sign(TEMPLATE, { resource: "/v1/ask/7373" })).rejects.toThrow(/resource/);
    await expect(sign(TEMPLATE, { amount: "10000", assets: [TESTNET.usdc], resource: "/v1/ask/7302" })).resolves.toMatchObject({ amountUusdc: 10_000 });
  });
});

describe("receipts", () => {
  const good = { receipt_hash: `0x${"ab".repeat(32)}`, rail: "escrow", payer: "0xaa", miner: "7302", amount_uusdc: "10000", timestamp: 1 };
  it("accepts a receipt for the payment that was signed", () => {
    expect(receiptProblems(good, { payer: "0xAA", amountUusdc: 10_000, minerId: "7302" })).toEqual([]);
  });
  it("names every way a receipt can belong to another payment", () => {
    expect(receiptProblems(null, { payer: "0xaa", amountUusdc: 1 })).toEqual(["no receipt"]);
    const bad = receiptProblems({ ...good, rail: "x402", payer: "0xbb", amount_uusdc: "1", miner: "1", receipt_hash: "0x1" }, { payer: "0xaa", amountUusdc: 10_000, minerId: "7302" });
    expect(bad).toHaveLength(5);
  });
});

describe("escrow challenge parsing", () => {
  it("reads the amount from the template, not the dollar price", () => {
    expect(amountFromTemplate(TEMPLATE)).toBe("10000");
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

  it("never retries a paid call that failed: it may have been billed", async () => {
    const { node, client } = setup(() => ({ kind: "status", status: 502 }));
    const out = await client.ask(ask, { minerId: "7302", timeoutMs: 1000 });
    expect(out).toMatchObject({ ok: false, kind: "server_error", attempts: 1, paidUusdc: 10_000, billing: "unknown" });
    expect(node.charges).toHaveLength(0);
  });

  it("retries a failure before payment once, with a fresh challenge", async () => {
    let unpaid = 0;
    const node = new FakeNode({ respond: () => ({ kind: "answer", result: { ok: 1 } }), nowSec: () => Math.floor(SEASON / 1000) });
    const flaky: typeof fetch = (input, init) => {
      const paidCall = new Headers(init?.headers).has("x-payment");
      if (!paidCall && ++unpaid === 1) return Promise.resolve(new Response("bad gateway", { status: 502 }));
      return node.fetch(input, init);
    };
    const client = new TelegraphClient({ network: TESTNET, signer: viemSigner(KEY), fetch: flaky, maxUusdcPerCall: 50_000, now: () => SEASON });
    const out = await client.ask(ask, { minerId: "7302", timeoutMs: 1000 });
    expect(out.ok && out.attempts).toBe(2);
    expect(node.charges).toHaveLength(1);
  });

  it("reports a paid call the node answered after the client gave up as billing unknown", async () => {
    const { node, client } = setup(() => ({ kind: "answer", result: { ok: 1 }, delayMs: 80 }));
    const out = await client.ask(ask, { minerId: "7302", timeoutMs: 20 });
    expect(out).toMatchObject({ ok: false, kind: "timeout", attempts: 1, paidUusdc: 10_000, billing: "unknown" });
    await new Promise((r) => setTimeout(r, 120));
    expect(node.charges).toHaveLength(1); // the node billed it: exactly why it must not be retried
  });

  it("lowers the cap for one call with maxUusdc", async () => {
    const { node, client } = setup(() => ({ kind: "answer", result: {} }));
    expect(await client.ask(ask, { minerId: "7302", timeoutMs: 1000, maxUusdc: 9_999 })).toMatchObject({ ok: false, kind: "mismatch" });
    expect(node.charges).toHaveLength(0);
  });

  it("flags a receipt or answer from a miner other than the one pinned", async () => {
    const { client } = setup(() => ({ kind: "answer", result: {} }));
    const out = await client.ask(ask, { minerId: "7302", timeoutMs: 1000 });
    expect(out.ok && out.receiptProblems).toEqual([]);
  });

  it("does not retry a 4xx", async () => {
    const { node, client } = setup(() => ({ kind: "status", status: 400, body: { error: "invalid request body" } }));
    const out = await client.ask(ask, { minerId: "7302", timeoutMs: 1000 });
    expect(out).toMatchObject({ ok: false, kind: "client_error", attempts: 1, httpStatus: 400 });
    expect(node.charges).toHaveLength(0);
  });

  it("times out once on a paid call and does not retry", async () => {
    const { node, client } = setup(() => ({ kind: "hang" }), { now: () => SEASON });
    const out = await client.ask(ask, { minerId: "7302", timeoutMs: 30 });
    expect(out).toMatchObject({ ok: false, kind: "timeout", attempts: 1, billing: "unknown" });
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

describe("signal verification", () => {
  it("finds a paid answer's signal on the node, and nothing else", async () => {
    const { client } = setup(() => ({ kind: "answer", result: { holders_count: 1 } }));
    const out = await client.ask(ask, { minerId: "7302", timeoutMs: 1000 });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(await client.verifySignal(out.response.signal_hash, { minerId: "7302" })).toBe("verified");
    expect(await client.verifySignal(out.response.signal_hash, { minerId: "7373" })).toBe("mismatch");
    expect(await client.verifySignal(`0x${"cd".repeat(32)}`)).toBe("missing");
    expect(await client.verifySignal(undefined)).toBe("missing");
  });
});
