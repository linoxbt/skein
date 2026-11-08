import { getAddress, isAddress, verifyTypedData, type Address, type Hex } from "viem";

/**
 * x402 (v1, scheme "exact") on the direct API: a caller with no partner key
 * pays per verdict with a signed USDC transfer authorization (EIP-3009) in the
 * X-PAYMENT header. Skein checks the signature locally, has the facilitator
 * verify it before anything is bought, and settles only once a verdict is
 * sealed. Refusals and failures are never settled: the authorization lapses.
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
  maxTimeoutSeconds: number;
}

const NETWORKS: Record<X402Network, { chainId: number; usdc: Address; name: string; version: string }> = {
  "base-sepolia": { chainId: 84532, usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", name: "USDC", version: "2" },
  base: { chainId: 8453, usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", name: "USD Coin", version: "2" },
};

/** x402 settings from the environment, or undefined (x402 off) when X402_PAY_TO is unset. */
export function x402FromEnv(env: Record<string, string | undefined>): X402Config | undefined {
  const payTo = env.X402_PAY_TO?.trim();
  if (!payTo) return undefined;
  if (!isAddress(payTo, { strict: false })) throw new Error("X402_PAY_TO must be an EVM address");
  const network = (env.X402_NETWORK?.trim() || "base-sepolia") as X402Network;
  if (!(network in NETWORKS)) throw new Error("X402_NETWORK must be base-sepolia or base");
  const asset = env.X402_ASSET?.trim() || NETWORKS[network].usdc;
  if (!isAddress(asset, { strict: false })) throw new Error("X402_ASSET must be an EVM address");
  const price = Number(env.X402_PRICE_USDC ?? "0.25");
  if (!Number.isFinite(price) || price <= 0) throw new Error("X402_PRICE_USDC must be a positive number");
  const cap = Number(env.X402_DAILY_CAP_USDC ?? "5");
  return {
    payTo: getAddress(payTo),
    network,
    asset: getAddress(asset),
    priceUusdc: Math.round(price * 1_000_000),
    facilitatorUrl: (env.X402_FACILITATOR_URL?.trim() || "https://x402.org/facilitator").replace(/\/+$/, ""),
    dailyCapUusdc: Math.round((Number.isFinite(cap) && cap >= 0 ? cap : 5) * 1_000_000),
    maxTimeoutSeconds: 300,
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

export function requirements(cfg: X402Config, resource: string): PaymentRequirements {
  const net = NETWORKS[cfg.network];
  const sameAsset = cfg.asset.toLowerCase() === net.usdc.toLowerCase();
  return {
    scheme: "exact",
    network: cfg.network,
    maxAmountRequired: String(cfg.priceUusdc),
    resource,
    description: "One Skein listing verdict: signed, with its bill of materials",
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

/** Decodes and checks an X-PAYMENT header against the terms. Throws PaymentError with a reason. */
export async function checkPayment(header: string, req: PaymentRequirements, nowSec: number): Promise<PaymentPayload> {
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
  if (getAddress(a.to) !== getAddress(req.payTo)) throw new PaymentError("payment is not addressed to Skein's payTo");
  if (BigInt(a.value) < BigInt(req.maxAmountRequired)) throw new PaymentError(`payment is below the price (${req.maxAmountRequired} base units)`);
  if (BigInt(a.validAfter) > BigInt(nowSec)) throw new PaymentError("authorization is not valid yet");
  // Enough time left to buy the verdict and settle it afterwards.
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
  if (!ok) throw new PaymentError("payment signature does not match the authorization");
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
