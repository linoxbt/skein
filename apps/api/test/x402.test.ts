import { schema } from "@skein/db";
import { and, eq, like } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createApp } from "../src/app";
import { VerdictService } from "../src/service";
import { simulatedApi } from "../src/simulated";
import { x402FromEnv, type PaymentRequirements } from "../src/x402";

const PAY_TO = "0x000000000000000000000000000000000000a402";
const payer = privateKeyToAccount(`0x${"7".repeat(64)}`);

let api: Awaited<ReturnType<typeof simulatedApi>>;
let app: ReturnType<typeof createApp>;
const calls: { path: string; body: { paymentPayload: { payload: { authorization: { from: string; nonce: string; value: string } } }; paymentRequirements: PaymentRequirements } }[] = [];

/**
 * A facilitator that behaves like the real one: a used nonce is refused by
 * verify and by settle, and the payer's balance is checked by verify and
 * spent by settle (so several authorizations against one balance all verify,
 * and only the first settles).
 */
const facilitator = { up: true, settleUp: true, tx: 0, balance: Number.MAX_SAFE_INTEGER, used: new Set<string>() };
const fakeFacilitator: typeof fetch = async (input, init) => {
  const path = String(input).split("/").pop()!;
  const body = JSON.parse(String(init?.body));
  calls.push({ path, body });
  const a = body.paymentPayload.payload.authorization as { from: string; nonce: string; value: string };
  const nonce = `${a.from.toLowerCase()}:${a.nonce.toLowerCase()}`;
  if (path === "verify") {
    if (!facilitator.up) return Response.json({ isValid: false, invalidReason: "insufficient_funds" });
    if (facilitator.used.has(nonce)) return Response.json({ isValid: false, invalidReason: "invalid_exact_evm_payload_authorization_nonce_used" });
    if (facilitator.balance < Number(a.value)) return Response.json({ isValid: false, invalidReason: "insufficient_funds" });
    return Response.json({ isValid: true, payer: payer.address });
  }
  if (path === "settle") {
    if (!facilitator.settleUp) return Response.json({ success: false, errorReason: "unexpected_settle_error" }, { status: 400 });
    if (facilitator.used.has(nonce)) return Response.json({ success: false, errorReason: "invalid_exact_evm_payload_authorization_nonce_used" }, { status: 400 });
    if (facilitator.balance < Number(a.value)) return Response.json({ success: false, errorReason: "insufficient_funds" }, { status: 400 });
    // The chain takes a moment: concurrent settlements overlap here.
    await new Promise((r) => setTimeout(r, 20));
    if (facilitator.balance < Number(a.value)) return Response.json({ success: false, errorReason: "insufficient_funds" }, { status: 400 });
    facilitator.balance -= Number(a.value);
    facilitator.used.add(nonce);
    facilitator.tx += 1;
    return Response.json({ success: true, transaction: `0x${facilitator.tx.toString(16).padStart(64, "0")}`, network: "base-sepolia", payer: payer.address });
  }
  return new Response("not found", { status: 404 });
};

beforeAll(async () => {
  api = await simulatedApi({ fast: true, env: {} });
  // One payer address signs every payment here: lift its per-minute and per-day limits (tested below).
  const x402 = x402FromEnv({ X402_PAY_TO: PAY_TO, X402_PAYER_PER_MINUTE: "1000", X402_PAYER_DAILY_MAX: "1000" })!;
  app = createApp(new VerdictService({ ...api.service.deps, config: { ...api.config, x402 }, facilitatorFetch: fakeFacilitator }));
});
beforeEach(() => {
  Object.assign(facilitator, { up: true, settleUp: true, balance: Number.MAX_SAFE_INTEGER });
});

let nonceSeq = 1;
async function pay(terms: PaymentRequirements, over: { value?: string; to?: `0x${string}`; signValue?: string; validBefore?: number } = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  const authorization = {
    from: payer.address,
    to: over.to ?? terms.payTo,
    value: over.value ?? terms.maxAmountRequired,
    validAfter: String(nowSec - 10),
    validBefore: String(over.validBefore ?? nowSec + 300),
    nonce: `0x${(nonceSeq++).toString(16).padStart(64, "0")}` as `0x${string}`,
  };
  const signature = await payer.signTypedData({
    domain: { name: terms.extra.name, version: terms.extra.version, chainId: 84532, verifyingContract: terms.asset },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: { ...authorization, value: BigInt(over.signValue ?? authorization.value), validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore) },
  });
  return Buffer.from(JSON.stringify({ x402Version: 1, scheme: "exact", network: "base-sepolia", payload: { signature, authorization } })).toString("base64");
}

let ip = 1;
const ask = (token: string, payment?: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  app.request("/v1/verdicts", {
    method: "POST",
    // A fresh client address per request: the per-IP limit is not under test here.
    headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${ip++ % 250}`, ...(payment ? { "x-payment": payment } : {}), ...headers },
    body: JSON.stringify({ subject: { chainId: 8453, token }, ...extra }),
  });

async function terms(): Promise<PaymentRequirements> {
  const res = await ask("0x00000000000000000000000000000000000ab402");
  expect(res.status).toBe(402);
  const body = (await res.json()) as { x402Version: number; accepts: PaymentRequirements[] };
  return body.accepts[0]!;
}

const settled = async () => (await api.db.select().from(schema.spendLedger).where(eq(schema.spendLedger.kind, "revenue_settled"))).length;
const count = (path: string) => calls.filter((x) => x.path === path).length;
const keyOf = (payment: string) => {
  const a = JSON.parse(Buffer.from(payment, "base64").toString()).payload.authorization as { from: string; nonce: string };
  return `x402:${a.from.toLowerCase()}:${a.nonce.toLowerCase()}`;
};
const paymentRow = async (payment: string) => (await api.db.select().from(schema.x402Payments).where(eq(schema.x402Payments.key, keyOf(payment))))[0];

describe("x402 on POST /v1/verdicts", () => {
  it("answers an unpaid request with the standard 402 terms, naming the configured resource whatever the Host header says", async () => {
    const res = await ask("0x00000000000000000000000000000000000ab402", undefined, {}, { host: "evil.example.com", "x-forwarded-proto": "http" });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { x402Version: number; accepts: PaymentRequirements[]; error: { code: string } };
    expect(body.x402Version).toBe(1);
    expect(body.error.code).toBe("PAYMENT_REQUIRED");
    expect(body.accepts[0]).toMatchObject({
      scheme: "exact",
      network: "base-sepolia",
      maxAmountRequired: "250000",
      payTo: getAddress(PAY_TO),
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      extra: { name: "USDC", version: "2" },
      mimeType: "application/json",
      resource: "https://api.skeinlabs.site/v1/verdicts",
    });
  });

  it("refuses a bad signature, an underpayment, an overpayment and a wrong payee before calling the facilitator", async () => {
    const t = await terms();
    const before = calls.length;
    for (const [payment, reason] of [
      [await pay(t, { signValue: "1" }), /signature/],
      [await pay(t, { value: "1000" }), /below the price/],
      [await pay(t, { value: "300000" }), /above the price/],
      [await pay(t, { to: "0x000000000000000000000000000000000000dEaD" }), /payTo/],
      [await pay(t, { validBefore: Math.floor(Date.now() / 1000) + 5 }), /expires too soon/],
      ["not-base64-json", /base64/],
    ] as const) {
      const res = await ask("0x00000000000000000000000000000000000ab403", payment);
      expect(res.status).toBe(402);
      expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(reason);
    }
    expect(calls.length).toBe(before);
  });

  it("buys nothing when the facilitator refuses the payment", async () => {
    const t = await terms();
    facilitator.up = false;
    const charges = api.node.charges.length;
    const res = await ask("0x00000000000000000000000000000000000ab404", await pay(t));
    expect(res.status).toBe(402);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/insufficient_funds/);
    expect(api.node.charges.length).toBe(charges);
  });

  it("settles before buying, and a retry with the same payment replays the verdict without verifying or settling again (H2)", async () => {
    const t = await terms();
    const payment = await pay(t);
    const before = await settled();
    const res = await ask("0x00000000000000000000000000000000000ab405", payment);
    expect(res.status).toBe(200);
    const v = (await res.json()) as { id: string };
    const receipt = JSON.parse(Buffer.from(res.headers.get("x-payment-response")!, "base64").toString()) as { success: boolean; transaction: string; payer: string };
    expect(receipt.success).toBe(true);
    expect(receipt.transaction).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await settled()).toBe(before + 1);
    // The settlement happened before the first purchase.
    const pay1 = await paymentRow(payment);
    const [firstBuy] = await api.db.select().from(schema.purchases).where(eq(schema.purchases.verdictId, v.id)).orderBy(schema.purchases.createdAt).limit(1);
    expect(pay1!.settledAt!.getTime()).toBeLessThanOrEqual(firstBuy!.createdAt.getTime());

    // The nonce is now spent: the facilitator would refuse it. A client that lost the answer still gets it.
    const verifies = count("verify");
    const settles = count("settle");
    const again = await ask("0x00000000000000000000000000000000000ab405", payment);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { id: string }).id).toBe(v.id);
    expect(JSON.parse(Buffer.from(again.headers.get("x-payment-response")!, "base64").toString()).transaction).toBe(receipt.transaction);
    expect(count("verify")).toBe(verifies);
    expect(count("settle")).toBe(settles);
    expect(await settled()).toBe(before + 1);
  });

  it("settles a payment once however many copies of it arrive together, and they all get the one verdict", async () => {
    const t = await terms();
    const payment = await pay(t);
    const settles = count("settle");
    const charges = api.node.charges.length;
    const res = await Promise.all(Array.from({ length: 4 }, () => ask("0x00000000000000000000000000000000000ab4b1", payment)));
    expect(count("settle")).toBe(settles + 1);
    const ok = res.filter((r) => r.status === 200 || r.status === 202);
    expect(ok.length + res.filter((r) => r.status === 503).length).toBe(4); // 503 PAYMENT_PENDING only while the settlement is in flight
    const ids = new Set((await Promise.all(ok.map((r) => r.json()))).map((b) => (b as { id: string }).id));
    expect(ids.size).toBe(1);
    expect((await api.db.select().from(schema.verdicts).where(eq(schema.verdicts.subjectToken, "0x00000000000000000000000000000000000ab4b1"))).length).toBe(1);
    expect(api.node.charges.length).toBeGreaterThan(charges);
  });

  it("one balance cannot buy more verdicts than it pays for, however many authorizations it signs (H1)", async () => {
    const t = await terms();
    facilitator.balance = 250_000; // exactly one verdict's worth
    const tokens = ["0x00000000000000000000000000000000000ab4a1", "0x00000000000000000000000000000000000ab4a2", "0x00000000000000000000000000000000000ab4a3", "0x00000000000000000000000000000000000ab4a4"];
    const payments = await Promise.all(tokens.map(() => pay(t)));
    const runsBefore = (await api.db.select().from(schema.verdicts)).length;
    const res = await Promise.all(tokens.map((tok, i) => ask(tok, payments[i])));
    const statuses = res.map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 402)).toHaveLength(3);
    // Exactly one verdict was bought, and every one served is paid for.
    expect((await api.db.select().from(schema.verdicts)).length).toBe(runsBefore + 1);
    for (const r of res.filter((x) => x.status === 402)) expect(((await r.json()) as { error: { message: string } }).error.message).toMatch(/could not be settled.*nothing was bought/);
  });

  it("settles a cache hit too: a second payer for the same token pays for the cached verdict", async () => {
    const t = await terms();
    const first = (await (await ask("0x00000000000000000000000000000000000ab406", await pay(t))).json()) as { id: string };
    const before = await settled();
    const res = await ask("0x00000000000000000000000000000000000ab406", await pay(t));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-skein-cache")).toBe("hit");
    expect(((await res.json()) as { servedFrom: string }).servedFrom).toBe(first.id);
    expect(res.headers.get("x-payment-response")).toBeTruthy();
    expect(await settled()).toBe(before + 1);
  });

  it("charges an ABSTAIN its upstream cost only: settled, with the rest recorded as owed back", async () => {
    const t = await terms();
    const payment = await pay(t);
    const before = await settled();
    // A deployer ending in "e" makes the simulated sanctions miner hang: a required check is missing.
    const res = await ask("0x00000000000000000000000000000000000ab40a", payment, { context: { deployer: `0x${"3".repeat(39)}e` } });
    expect(res.status).toBe(200);
    const v = (await res.json()) as { verdict: string; cost: { upstreamUsdc: number } };
    expect(v.verdict).toBe("ABSTAIN");
    expect(await settled()).toBe(before + 1);
    const owed = Math.round((0.25 - v.cost.upstreamUsdc) * 1e6);
    expect(owed).toBeGreaterThan(0);
    expect(res.headers.get("x-skein-payment")).toBe(`settled; refund owed ${owed / 1e6} USDC`);
    expect(await paymentRow(payment)).toMatchObject({ status: "settled", refundUusdc: owed, refundReason: expect.stringMatching(/^ABSTAIN/) });

    // A replay is not settled again, and does not change what is owed.
    const settles = count("settle");
    const again = await ask("0x00000000000000000000000000000000000ab40a", payment, { context: { deployer: `0x${"3".repeat(39)}e` } });
    expect(again.status).toBe(200);
    expect(count("settle")).toBe(settles);
    expect((await paymentRow(payment))!.refundUusdc).toBe(owed);

    const ledger = (await (await app.request("/v1/ledger")).json()) as { revenueSettledUsdc: number; refundsOwedUsdc: number };
    expect(ledger.revenueSettledUsdc).toBeGreaterThan(0);
    expect(ledger.refundsOwedUsdc).toBeGreaterThanOrEqual(owed / 1e6);
  }, 30_000);

  it("refuses before taking money what can be refused before buying", async () => {
    const t = await terms();
    const settles = count("settle");
    const res = await ask("0x00000000000000000000000000000000000ab40b", await pay(t), { budgetUsdcMax: 0.001 });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/nothing was charged/);
    expect(count("settle")).toBe(settles);
  });

  it("buys nothing when settlement fails, and buys on a retry once settlement works", async () => {
    const t = await terms();
    const payment = await pay(t);
    facilitator.settleUp = false;
    const charges = api.node.charges.length;
    const res = await ask("0x00000000000000000000000000000000000ab407", payment);
    facilitator.settleUp = true;
    expect(res.status).toBe(402);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/could not be settled.*nothing was bought/);
    expect(api.node.charges.length).toBe(charges);
    expect((await paymentRow(payment))!.status).toBe("failed");
    const retry = await ask("0x00000000000000000000000000000000000ab407", payment);
    expect(retry.status).toBe(200);
    expect(retry.headers.get("x-payment-response")).toBeTruthy();
    expect(api.node.charges.length).toBeGreaterThan(charges);
  });

  it("a paid run lost to a crash is owed back, and a retry with the same payment runs it again and cancels the refund", async () => {
    const t = await terms();
    const payment = await pay(t);
    const token = "0x00000000000000000000000000000000000ab40c";
    const first = await ask(token, payment);
    expect(first.status).toBe(200);
    const key = keyOf(payment);
    // Simulate the crash: the run never finished (its verdict row aside), and the sweep finds it.
    const [run] = await api.db.select().from(schema.verdictRuns).where(eq(schema.verdictRuns.idempotencyKey, key));
    await api.db.update(schema.verdictRuns).set({ idempotencyKey: `${key}#crashed` }).where(eq(schema.verdictRuns.id, run!.id));
    await api.db.insert(schema.verdictRuns).values({ ...run!, id: `${run!.id}x`, idempotencyKey: key, status: "running", verdictId: null, outcome: null, finishedAt: null, startedAt: new Date("2026-01-01") });
    await api.db.update(schema.x402Payments).set({ runId: `${run!.id}x` }).where(eq(schema.x402Payments.key, key));
    expect(await api.service.sweep()).toBeGreaterThanOrEqual(1);
    expect(await paymentRow(payment)).toMatchObject({ refundUusdc: 250_000, refundReason: expect.stringMatching(/^LOST/) });

    const settles = count("settle");
    const retry = await ask(token, payment);
    expect(retry.status).toBe(200);
    expect(count("settle")).toBe(settles);
    expect((await paymentRow(payment))!.refundUusdc).toBe(0);
    const runs = await api.db.select().from(schema.verdictRuns).where(and(eq(schema.verdictRuns.consumerId, "00000000-0000-4000-8000-000000000402"), like(schema.verdictRuns.idempotencyKey, `${key}%`)));
    expect(runs.map((r) => r.status).sort()).toEqual(["done", "done", "lost"]);
  }, 30_000);

  it("takes async mode (it is settled first), and leaves partner keys as they were", async () => {
    const t = await terms();
    const res = await ask("0x00000000000000000000000000000000000ab408", await pay(t), { mode: "async" });
    expect(res.status).toBe(202);
    expect(res.headers.get("x-payment-response")).toBeTruthy();
    const keyed = await app.request("/v1/verdicts", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${api.key}`, "idempotency-key": "x402-keyed" },
      body: JSON.stringify({ subject: { chainId: 8453, token: "0x00000000000000000000000000000000000ab409" } }),
    });
    expect(keyed.status).toBe(200);
    expect(keyed.headers.get("x-payment-response")).toBeNull();
  });

  it("caps the verdicts one payer may buy in a day, so one address cannot use up the shared x402 budget", async () => {
    const capped = createApp(new VerdictService({ ...api.service.deps, config: { ...api.config, x402: x402FromEnv({ X402_PAY_TO: PAY_TO, X402_PAYER_PER_MINUTE: "1000", X402_PAYER_DAILY_MAX: "1" })! }, facilitatorFetch: fakeFacilitator }));
    const t = await terms();
    const post = async (token: string) =>
      capped.request("/v1/verdicts", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9", "x-payment": await pay(t) }, body: JSON.stringify({ subject: { chainId: 8453, token } }) });
    // This payer already bought verdicts today (above): the next is refused before any settlement.
    const settles = count("settle");
    const res = await post("0x00000000000000000000000000000000000ab40d");
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/most one address may/);
    expect(count("settle")).toBe(settles);
  });

  it("is off without X402_PAY_TO, and has one price", async () => {
    expect(x402FromEnv({})).toBeUndefined();
    const res = await api.app.request("/v1/verdicts", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(402);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/not enabled/);
    expect(() => x402FromEnv({ X402_PAY_TO: "nope" })).toThrow();
    expect(x402FromEnv({ X402_PAY_TO: PAY_TO, SKEIN_PRICE_USDC: "0.3" })!.priceUusdc).toBe(300_000);
    expect(() => x402FromEnv({ X402_PAY_TO: PAY_TO, SKEIN_PRICE_USDC: "0.3", X402_PRICE_USDC: "0.25" })).toThrow(/differs/);
  });
});
