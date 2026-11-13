import { getAddress, isAddress, verifyTypedData, type Address, type Hex } from "viem";

/**
 * x402 (v1, scheme "exact") on the direct API: a caller with no partner key
 * pays per verdict with a signed USDC transfer authorization (EIP-3009) in the
 * X-PAYMENT header.
 *
 * Settle first, then buy. Skein checks the authorization locally, has the
 * facilitator verify it, refuses what it can before taking money (spend caps,
 * an empty purchaser wallet, a plan that cannot be bought), and then settles
 * the payment before anything is bought upstream. One settled payment buys
 * one verdict: the authorization (payer + nonce) is the run's idempotency key,
 * so a retry with the same X-PAYMENT replays that run without verifying or
 * settling again, and a payer who signs N authorizations pays N times. (Until
 * 2026-11-12 Skein bought first and settled after, so N authorizations backed
 * by one balance could buy N verdicts and settle one.)
 *
 * Pricing on this rail (spec §6: a failed verdict is not charged, ABSTAIN is
 * charged at the upstream cost only), with a fixed x402 price:
 *   - an answered verdict (APPROVE, REJECT, ESCALATE, or a cache hit) costs the price;
 *   - an ABSTAIN costs what this request spent upstream: the price less that is owed back;
 *   - a refusal or failure after settlement costs nothing: the whole price is owed back.
 * A failure that may clear (UPSTREAM_UNAVAILABLE, a lost run, the daily cap) can
 * instead be retried with the same X-PAYMENT, within 24 hours, at no extra cost;
 * a retry that then succeeds cancels the refund.
 *
 * Refunds: what is owed is recorded per payment (x402_payments.refund_uusdc,
 * with the reason) and totalled at /v1/ledger (refundsOwedUsdc). The API holds
 * no key for X402_PAY_TO, so nothing is sent back automatically: the operator
 * sends owed refunds from the payTo wallet and marks them refunded
 * (apps/api/bin/x402-refunds.ts). On testnet this is test USDC.
 *
 * Not supported: smart-contract wallets (ERC-1271 signatures); only EOA
 * signatures recover. Overpayment: the value must equal the price exactly.
 */

export type X402Network = "base-sepolia" | "base";

export interface X402Config {
  payTo: Address;
  network: X402Network;
  asset: Address;
  priceUusdc: number;
  facilitatorUrl: string;
  /** Upstream spend ceiling for all x402 callers together, per UTC day. */
  dailyCapUusdc: number;
  /** Verdicts one payer address may buy per UTC day, so one payer cannot use up the shared cap (default 20). */
  payerDailyMax?: number;
  /** Paid requests one payer address may make per minute (X402_PAYER_PER_MINUTE, default 10). */
  payerPerMinute?: number;
  maxTimeoutSeconds: number;
  /** The resource the terms name: from configuration, never from the request's Host header (default https://api.skeinlabs.site/v1/verdicts). */
  resource?: string;
}

const NETWORKS: Record<X402Network, { chainId: number; usdc: Address; name: string; version: string }> = {
  "base-sepolia": { chainId: 84532, usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", name: "USDC", version: "2" },
  base: { chainId: 8453, usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", name: "USD Coin", version: "2" },
};

const DEFAULT_API_URL = "https://api.skeinlabs.site";

/**
 * x402 settings from the environment, or undefined (x402 off) when X402_PAY_TO is unset.
 * The price is SKEIN_PRICE_USDC's (one price for every rail); X402_PRICE_USDC
 * is still read, and refused at startup if it disagrees.
 */
export function x402FromEnv(env: Record<string, string | undefined>): X402Config | undefined {
  const payTo = env.X402_PAY_TO?.trim();
  if (!payTo) return undefined;
  if (!isAddress(payTo, { strict: false })) throw new Error("X402_PAY_TO must be an EVM address");
  const network = (env.X402_NETWORK?.trim() || "base-sepolia") as X402Network;
  if (!(network in NETWORKS)) throw new Error("X402_NETWORK must be base-sepolia or base");
  const asset = env.X402_ASSET?.trim() || NETWORKS[network].usdc;
  if (!isAddress(asset, { strict: false })) throw new Error("X402_ASSET must be an EVM address");
  const skeinPrice = env.SKEIN_PRICE_USDC?.trim() ? Number(env.SKEIN_PRICE_USDC) : undefined;
  const x402Price = env.X402_PRICE_USDC?.trim() ? Number(env.X402_PRICE_USDC) : undefined;
  if (skeinPrice !== undefined && x402Price !== undefined && Math.round(skeinPrice * 1e6) !== Math.round(x402Price * 1e6)) {
    throw new Error(`X402_PRICE_USDC (${x402Price}) differs from SKEIN_PRICE_USDC (${skeinPrice}): one price per verdict; unset X402_PRICE_USDC`);
  }
  const price = skeinPrice ?? x402Price ?? 0.25;
  if (!Number.isFinite(price) || price <= 0) throw new Error("SKEIN_PRICE_USDC (or X402_PRICE_USDC) must be a positive number");
  const cap = Number(env.X402_DAILY_CAP_USDC ?? "5");
  const perPayer = Number(env.X402_PAYER_DAILY_MAX ?? "20");
  const base = (env.SKEIN_API_URL?.trim() || DEFAULT_API_URL).replace(/\/+$/, "");
  const resource = env.X402_RESOURCE_URL?.trim() || `${base}/v1/verdicts`;
  if (!/^https?:\/\//.test(resource)) throw new Error("X402_RESOURCE_URL (or SKEIN_API_URL) must be an http(s) URL");
  return {
    payTo: getAddress(payTo),
    network,
    asset: getAddress(asset),
    priceUusdc: Math.round(price * 1_000_000),
    facilitatorUrl: (env.X402_FACILITATOR_URL?.trim() || "https://x402.org/facilitator").replace(/\/+$/, ""),
    dailyCapUusdc: Math.round((Number.isFinite(cap) && cap >= 0 ? cap : 5) * 1_000_000),
    payerDailyMax: Number.isInteger(perPayer) && perPayer > 0 ? perPayer : 20,
    payerPerMinute: Number.isInteger(Number(env.X402_PAYER_PER_MINUTE)) && Number(env.X402_PAYER_PER_MINUTE) > 0 ? Number(env.X402_PAYER_PER_MINUTE) : 10,
    maxTimeoutSeconds: 300,
    resource,
  };
}

export interface PaymentRequirements {
  scheme: "exact";
  network: X402Network;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: Address;
  maxTimeoutSeconds: number;
  asset: Address;
  extra: { name: string; version: string };
}

export function requirements(cfg: X402Config): PaymentRequirements {
  const net = NETWORKS[cfg.network];
  const sameAsset = cfg.asset.toLowerCase() === net.usdc.toLowerCase();
  return {
    scheme: "exact",
    network: cfg.network,
    maxAmountRequired: String(cfg.priceUusdc),
    resource: cfg.resource ?? `${DEFAULT_API_URL}/v1/verdicts`,
    description: "One Skein listing verdict: signed, with its bill of materials. Settled before it is bought; a refusal is refunded, an ABSTAIN costs its upstream spend.",
    mimeType: "application/json",
    payTo: cfg.payTo,
    maxTimeoutSeconds: cfg.maxTimeoutSeconds,
    asset: cfg.asset,
    extra: sameAsset ? { name: net.name, version: net.version } : { name: "USDC", version: "2" },
  };
}

export interface Authorization {
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
}

export interface PaymentPayload {
  x402Version: 1;
  scheme: "exact";
  network: X402Network;
  payload: { signature: Hex; authorization: Authorization };
}

export class PaymentError extends Error {}

const hex = (v: unknown, bytes?: number): v is Hex =>
  typeof v === "string" && (bytes ? new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`) : /^0x[0-9a-fA-F]+$/).test(v);
const uint = (v: unknown): v is string => typeof v === "string" && /^\d{1,78}$/.test(v);

/**
 * Decodes an X-PAYMENT header and checks its shape and network, nothing more:
 * enough to find a payment already on record (payer and nonce) without
 * verifying it again. Throws PaymentError with a reason.
 */
export function decodePayment(header: string, req: Pick<PaymentRequirements, "network">): PaymentPayload {
  let p: PaymentPayload;
  try {
    p = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as PaymentPayload;
  } catch {
    throw new PaymentError("X-PAYMENT is not base64-encoded JSON");
  }
  const a = p?.payload?.authorization;
  if (p?.x402Version !== 1) throw new PaymentError("x402Version must be 1");
  if (p.scheme !== "exact") throw new PaymentError("only the exact scheme is accepted");
  if (p.network !== req.network) throw new PaymentError(`payment must be on ${req.network}`);
  if (!a || !hex(p.payload.signature) || !isAddress(String(a.from), { strict: false }) || !isAddress(String(a.to), { strict: false }) || !uint(a.value) || !uint(a.validAfter) || !uint(a.validBefore) || !hex(a.nonce, 32)) {
    throw new PaymentError("malformed payment authorization");
  }
  return p;
}

/** The payment's identity, and the idempotency key of the run it pays for. */
export const paymentKey = (p: PaymentPayload) => `x402:${p.payload.authorization.from.toLowerCase()}:${p.payload.authorization.nonce.toLowerCase()}`;

/**
 * Checks a decoded payment against the terms: payee, exact amount, validity
 * window, and an EOA signature over the EIP-3009 authorization. Throws
 * PaymentError with a reason.
 */
export async function checkPayment(p: PaymentPayload, req: PaymentRequirements, nowSec: number): Promise<PaymentPayload> {
  const a = p.payload.authorization;
  if (getAddress(a.to) !== getAddress(req.payTo)) throw new PaymentError("payment is not addressed to Skein's payTo");
  if (BigInt(a.value) < BigInt(req.maxAmountRequired)) throw new PaymentError(`payment is below the price (${req.maxAmountRequired} base units)`);
  // Exactly the price: an overpayment would be settled in full and owed back by hand.
  if (BigInt(a.value) > BigInt(req.maxAmountRequired)) throw new PaymentError(`payment is above the price: authorize exactly ${req.maxAmountRequired} base units`);
  if (BigInt(a.validAfter) > BigInt(nowSec)) throw new PaymentError("authorization is not valid yet");
  // Enough time left to verify and settle it.
  if (BigInt(a.validBefore) < BigInt(nowSec + 60)) throw new PaymentError("authorization expires too soon");
  const net = NETWORKS[req.network];
  const ok = await verifyTypedData({
    address: getAddress(a.from),
    domain: { name: req.extra.name, version: req.extra.version, chainId: net.chainId, verifyingContract: req.asset },
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
    message: { from: getAddress(a.from), to: getAddress(a.to), value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce },
    signature: p.payload.signature,
  }).catch(() => false);
  if (!ok) throw new PaymentError("payment signature does not match the authorization (smart-contract wallets, ERC-1271, are not supported: sign with an EOA)");
  return p;
}

export interface SettleResult {
  success: boolean;
  transaction?: string;
  network?: string;
  payer?: string;
  errorReason?: string;
}

/** The facilitator's /verify and /settle, with a timeout; network failures read as a refusal. */
export class Facilitator {
  constructor(
    private readonly url: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async post<T>(path: string, payment: PaymentPayload, req: PaymentRequirements, timeoutMs: number): Promise<T> {
    const res = await this.fetchImpl(`${this.url}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ x402Version: 1, paymentPayload: payment, paymentRequirements: req }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await res.json().catch(() => ({}))) as T;
    if (!res.ok && typeof body !== "object") throw new Error(`facilitator ${path} answered ${res.status}`);
    return body;
  }

  async verify(payment: PaymentPayload, req: PaymentRequirements): Promise<{ isValid: boolean; invalidReason?: string }> {
    try {
      const r = await this.post<{ isValid?: boolean; invalidReason?: string }>("verify", payment, req, 10_000);
      return { isValid: r.isValid === true, ...(r.invalidReason ? { invalidReason: r.invalidReason } : {}) };
    } catch (e) {
      return { isValid: false, invalidReason: `facilitator unavailable: ${(e as Error).message}` };
    }
  }

  async settle(payment: PaymentPayload, req: PaymentRequirements): Promise<SettleResult> {
    try {
      const r = await this.post<SettleResult>("settle", payment, req, 30_000);
      return { ...r, success: r.success === true };
    } catch (e) {
      return { success: false, errorReason: `facilitator unavailable: ${(e as Error).message}` };
    }
  }
}

/** The X-PAYMENT-RESPONSE header value. */
export const paymentResponse = (r: { transaction: string; network: string; payer: string }) =>
  Buffer.from(JSON.stringify({ success: true, transaction: r.transaction, network: r.network, payer: r.payer })).toString("base64");
