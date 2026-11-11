import { schema } from "@skein/db";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
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
const calls: { path: string; body: { paymentPayload: unknown; paymentRequirements: PaymentRequirements } }[] = [];
const facilitator = { verify: true as boolean, settle: true as boolean, tx: 0 };

const fakeFacilitator: typeof fetch = async (input, init) => {
  const path = String(input).split("/").pop()!;
  const body = JSON.parse(String(init?.body));
  calls.push({ path, body });
  if (path === "verify") return Response.json(facilitator.verify ? { isValid: true, payer: payer.address } : { isValid: false, invalidReason: "insufficient_funds" });
  if (path === "settle") {
    if (!facilitator.settle) return Response.json({ success: false, errorReason: "unexpected_settle_error" }, { status: 400 });
    facilitator.tx += 1;
    return Response.json({ success: true, transaction: `0x${facilitator.tx.toString(16).padStart(64, "0")}`, network: "base-sepolia", payer: payer.address });
  }
  return new Response("not found", { status: 404 });
};

beforeAll(async () => {
  api = await simulatedApi({ fast: true, env: {} });
  const x402 = x402FromEnv({ X402_PAY_TO: PAY_TO })!;
  app = createApp(new VerdictService({ ...api.service.deps, config: { ...api.config, x402 }, facilitatorFetch: fakeFacilitator }));
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

const ask = (token: string, payment?: string, extra: Record<string, unknown> = {}) =>
  app.request("/v1/verdicts", {
    method: "POST",
    headers: { "content-type": "application/json", ...(payment ? { "x-payment": payment } : {}) },
    body: JSON.stringify({ subject: { chainId: 8453, token }, ...extra }),
  });

async function terms(): Promise<PaymentRequirements> {
  const res = await ask("0x00000000000000000000000000000000000ab402");
  expect(res.status).toBe(402);
  const body = (await res.json()) as { x402Version: number; accepts: PaymentRequirements[] };
  return body.accepts[0]!;
}

const settled = async () => (await api.db.select().from(schema.spendLedger).where(eq(schema.spendLedger.kind, "revenue_settled"))).length;

describe("x402 on POST /v1/verdicts", () => {
  it("answers an unpaid request with the standard 402 terms", async () => {
    const res = await ask("0x00000000000000000000000000000000000ab402");
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
    });
    expect(body.accepts[0]!.resource).toMatch(/\/v1\/verdicts$/);
  });

  it("refuses a bad signature, an underpayment and a wrong payee before calling the facilitator", async () => {
    const t = await terms();
    const before = calls.length;
    for (const [payment, reason] of [
      [await pay(t, { signValue: "1" }), /signature/],
      [await pay(t, { value: "1000" }), /below the price/],
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
    facilitator.verify = false;
    const charges = api.node.charges.length;
    const res = await ask("0x00000000000000000000000000000000000ab404", await pay(t));
    facilitator.verify = true;
    expect(res.status).toBe(402);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/insufficient_funds/);
    expect(api.node.charges.length).toBe(charges);
  });

  it("serves a paid verdict, settles it once, and a retry with the same payment replays it without settling again", async () => {
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

    const settles = calls.filter((x) => x.path === "settle").length;
    const again = await ask("0x00000000000000000000000000000000000ab405", payment);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { id: string }).id).toBe(v.id);
    expect(JSON.parse(Buffer.from(again.headers.get("x-payment-response")!, "base64").toString()).transaction).toBe(receipt.transaction);
    expect(calls.filter((x) => x.path === "settle").length).toBe(settles);
    expect(await settled()).toBe(before + 1);
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

  it("never settles an ABSTAIN: the caller gets the answer and pays nothing", async () => {
    const t = await terms();
    const payment = await pay(t);
    const before = await settled();
    const settles = calls.filter((x) => x.path === "settle").length;
    // A deployer ending in "e" makes the simulated sanctions miner hang: a required check is missing.
    const res = await ask("0x00000000000000000000000000000000000ab40a", payment, { context: { deployer: `0x${"3".repeat(39)}e` } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { verdict: string }).verdict).toBe("ABSTAIN");
    expect(res.headers.get("x-payment-response")).toBeNull();
    expect(res.headers.get("x-skein-payment")).toMatch(/not-settled/);
    expect(calls.filter((x) => x.path === "settle").length).toBe(settles);
    expect(await settled()).toBe(before);

    // A replay of the same request is not settled either.
    const again = await ask("0x00000000000000000000000000000000000ab40a", payment, { context: { deployer: `0x${"3".repeat(39)}e` } });
    expect(again.status).toBe(200);
    expect(calls.filter((x) => x.path === "settle").length).toBe(settles);
    expect(await settled()).toBe(before);
  }, 30_000);

  it("withholds the verdict when settlement fails, and delivers it on a retry once settlement works", async () => {
    const t = await terms();
    const payment = await pay(t);
    facilitator.settle = false;
    const res = await ask("0x00000000000000000000000000000000000ab407", payment);
    facilitator.settle = true;
    expect(res.status).toBe(402);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/could not be settled/);
    const charges = api.node.charges.length;
    const retry = await ask("0x00000000000000000000000000000000000ab407", payment);
    expect(retry.status).toBe(200);
    expect(retry.headers.get("x-payment-response")).toBeTruthy();
    expect(api.node.charges.length).toBe(charges); // the verdict was already bought
  });

  it("is sync only, and leaves partner keys as they were", async () => {
    const t = await terms();
    const res = await ask("0x00000000000000000000000000000000000ab408", await pay(t), { mode: "async" });
    expect(res.status).toBe(400);
    const keyed = await app.request("/v1/verdicts", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${api.key}`, "idempotency-key": "x402-keyed" },
      body: JSON.stringify({ subject: { chainId: 8453, token: "0x00000000000000000000000000000000000ab409" } }),
    });
    expect(keyed.status).toBe(200);
    expect(keyed.headers.get("x-payment-response")).toBeNull();
  });

  it("is off without X402_PAY_TO", async () => {
    expect(x402FromEnv({})).toBeUndefined();
    const res = await api.app.request("/v1/verdicts", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(402);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/not enabled/);
    expect(() => x402FromEnv({ X402_PAY_TO: "nope" })).toThrow();
  });
});
