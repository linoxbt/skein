import { simulatedApi } from "@skein/api/simulated";
import { privateKeyToAccount } from "viem/accounts";
import { verifyTypedData } from "viem";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chooseRequirements, Skein, signX402Payment, X402_NETWORKS, X402MismatchError, type X402Requirements } from "../src";

const PAY_TO = "0x00000000000000000000000000000000000d0402";
const USDC = X402_NETWORKS["base-sepolia"].usdc;
const account = privateKeyToAccount(`0x${"77".repeat(32)}`);
let n = 0;
const tok = () => `0x${(++n).toString(16).padStart(38, "0")}5a`;

/** The facilitator the API calls: verifies anything, settles once per nonce. */
const facilitator = { verify: 0, settle: 0, failNextSettle: false, nonces: new Set<string>() };
const fakeFacilitator: typeof fetch = async (input, init) => {
  const body = JSON.parse(String(init?.body)) as { paymentPayload: { payload: { authorization: { nonce: string } } } };
  if (String(input).endsWith("/verify")) {
    facilitator.verify++;
    return Response.json({ isValid: true });
  }
  facilitator.settle++;
  if (facilitator.failNextSettle) {
    facilitator.failNextSettle = false;
    return Response.json({ success: false, errorReason: "rpc down" });
  }
  const nonce = body.paymentPayload.payload.authorization.nonce;
  if (facilitator.nonces.has(nonce)) return Response.json({ success: false, errorReason: "nonce used" });
  facilitator.nonces.add(nonce);
  return Response.json({ success: true, transaction: `0x${"ee".repeat(32)}`, network: "base-sepolia", payer: account.address });
};

let api: Awaited<ReturnType<typeof simulatedApi>>;
beforeAll(async () => {
  // The API's facilitator client takes the global fetch when it is built (apps/api only exports
  // the simulated API): swap it in for the construction, then put the real one back.
  vi.stubGlobal("fetch", fakeFacilitator);
  try {
    api = await simulatedApi({
      fast: true,
      env: {},
      config: {
        x402: { payTo: PAY_TO, network: "base-sepolia", asset: USDC, priceUusdc: 250_000, facilitatorUrl: "https://facilitator.test", dailyCapUusdc: 100_000_000, maxTimeoutSeconds: 300 },
      },
    });
  } finally {
    vi.unstubAllGlobals();
  }
});
afterAll(() => vi.unstubAllGlobals());

const posts: { payment: string | null }[] = [];
const inProcess = (wrap?: (res: Response, call: number) => Response | Promise<Response>): typeof fetch => {
  let call = 0;
  return async (input, init) => {
    const req = new Request(String(input), init);
    if (req.method === "POST") posts.push({ payment: req.headers.get("x-payment") });
    const res = await api.app.fetch(req);
    return wrap ? wrap(res, ++call) : res;
  };
};
const skein = (fetchImpl: typeof globalThis.fetch = inProcess(), payer: Partial<{ payTo: string; maxUsdc: number; network: "base" | "base-sepolia" }> = {}) =>
  new Skein({ apiUrl: "http://skein.test", fetch: fetchImpl, payer: { kind: "x402", account, network: "base-sepolia", payTo: PAY_TO, maxUsdc: 0.3, ...payer } });

describe("x402 payer", () => {
  it("pays one verdict: reads the 402, signs one authorization, receives the settled verdict", async () => {
    posts.length = 0;
    const before = facilitator.settle;
    const token = tok();
    const v = await skein().verdict({ subject: { chainId: 8453, token } });
    expect(v.verdict).toBe("APPROVE");
    expect(v.subject.token.toLowerCase()).toBe(token);
    expect(v.payment).toEqual({ rail: "x402", amountUsdc: 0.25, settled: true, network: "base-sepolia", payer: account.address, transaction: `0x${"ee".repeat(32)}` });
    expect(posts.map((p) => p.payment === null)).toEqual([true, false]);
    expect(facilitator.settle).toBe(before + 1);
  });

  it("retries a lost response with the same X-PAYMENT, and is not charged twice", async () => {
    posts.length = 0;
    const before = facilitator.settle;
    // The paid response is lost on the wire (after the API settled it).
    const lossy = inProcess(async (res, call) => {
      if (call === 2) throw new TypeError("socket hang up");
      return res;
    });
    const v = await skein(lossy).verdict({ subject: { chainId: 8453, token: tok() } });
    expect(v.verdict).toBe("APPROVE");
    expect(posts).toHaveLength(3);
    expect(posts[2]!.payment).toBe(posts[1]!.payment);
    // One settlement: the replay finds the first.
    expect(facilitator.settle).toBe(before + 1);
    expect(v.payment).toMatchObject({ rail: "x402", settled: true });
  });

  it("resends the same X-PAYMENT when settlement failed after the verdict was sealed", async () => {
    posts.length = 0;
    facilitator.failNextSettle = true;
    const v = await skein().verdict({ subject: { chainId: 8453, token: tok() } });
    expect(v.payment).toMatchObject({ rail: "x402", settled: true, amountUsdc: 0.25 });
    expect(posts).toHaveLength(3);
    expect(posts[2]!.payment).toBe(posts[1]!.payment);
  });

  it("signs nothing for terms the caller did not pin", async () => {
    for (const payer of [{ payTo: "0x000000000000000000000000000000000000dead" }, { maxUsdc: 0.2 }, { network: "base" as const }]) {
      posts.length = 0;
      const err = await skein(inProcess(), payer).verdict({ subject: { chainId: 8453, token: tok() } }).catch((e) => e);
      expect(err).toMatchObject({ code: "X402_CHALLENGE_MISMATCH", payment: undefined });
      expect(posts.every((p) => p.payment === null)).toBe(true);
    }
    const uncapped = new Skein({ apiUrl: "http://skein.test", fetch: inProcess(), payer: { kind: "x402", account, network: "base-sepolia", payTo: PAY_TO } });
    await expect(uncapped.verdict({ subject: { chainId: 8453, token: tok() } })).rejects.toMatchObject({ code: "NO_PRICE_CAP" });
  });
});

describe("x402 signing", () => {
  const terms: X402Requirements = {
    scheme: "exact",
    network: "base-sepolia",
    maxAmountRequired: "250000",
    payTo: PAY_TO,
    asset: USDC,
    maxTimeoutSeconds: 300,
    extra: { name: "USDC", version: "2" },
  };

  it("signs an EIP-3009 authorization that recovers to the payer over the token's domain", async () => {
    const nonce = `0x${"12".repeat(32)}` as const;
    const p = await signX402Payment(terms, account, { nowSec: 1_800_000_000, nonce });
    const decoded = JSON.parse(atob(p.header));
    expect(decoded).toMatchObject({ x402Version: 1, scheme: "exact", network: "base-sepolia" });
    const a = decoded.payload.authorization;
    expect(a).toEqual({ from: account.address, to: PAY_TO, value: "250000", validAfter: "1799999400", validBefore: "1800000300", nonce });
    const ok = await verifyTypedData({
      address: account.address,
      domain: { name: "USDC", version: "2", chainId: 84532, verifyingContract: USDC },
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
      message: { from: account.address, to: PAY_TO, value: 250000n, validAfter: 1799999400n, validBefore: 1800000300n, nonce },
      signature: decoded.payload.signature,
    });
    expect(ok).toBe(true);
    // A fresh random nonce each time.
    const [x, y] = await Promise.all([signX402Payment(terms, account), signX402Payment(terms, account)]);
    expect(x.nonce).not.toBe(y.nonce);
  });

  it("checks every term against the pins", () => {
    const pins = { network: "base-sepolia" as const, payTo: PAY_TO, maxUusdc: 300_000 };
    expect(chooseRequirements([terms], pins)).toBe(terms);
    expect(chooseRequirements([{ ...terms, payTo: PAY_TO.toUpperCase().replace("0X", "0x") }], pins)).toBeTruthy();
    for (const bad of [
      { ...terms, scheme: "upto" },
      { ...terms, network: "base" },
      { ...terms, asset: "0x0000000000000000000000000000000000000001" },
      { ...terms, maxAmountRequired: "300001" },
      { ...terms, maxAmountRequired: "0" },
      { ...terms, maxAmountRequired: "1e6" },
      { ...terms, extra: {} },
    ]) {
      expect(() => chooseRequirements([bad], pins)).toThrow(X402MismatchError);
    }
    expect(() => chooseRequirements([], pins)).toThrow(X402MismatchError);
  });
});
