/**
 * x402 on the direct API: pay for one verdict with a signed USDC transfer
 * authorization (EIP-3009 TransferWithAuthorization, EIP-712), no Skein
 * account and no Telegraph escrow. No runtime dependencies: the account signs
 * (a viem LocalAccount from privateKeyToAccount, or anything with the same
 * signTypedData), and this file only checks the 402 terms against what the
 * caller pinned and builds the X-PAYMENT header.
 *
 * Nothing is signed unless the challenge names the network, asset and payTo
 * the caller pinned, at a price no higher than the caller's cap. The signed
 * authorization can only move that amount, to that address, in that token.
 */

export type X402Network = "base-sepolia" | "base";

/** The networks Skein's API offers x402 on, with Circle's USDC on each. */
export const X402_NETWORKS: Readonly<Record<X402Network, { chainId: number; usdc: `0x${string}` }>> = {
  "base-sepolia": { chainId: 84532, usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" },
  base: { chainId: 8453, usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
};

/** What the account signs: an EIP-712 TransferWithAuthorization. */
export interface X402TypedData {
  domain: { name: string; version: string; chainId: number; verifyingContract: `0x${string}` };
  types: { TransferWithAuthorization: { name: string; type: string }[] };
  primaryType: "TransferWithAuthorization";
  message: { from: `0x${string}`; to: `0x${string}`; value: bigint; validAfter: bigint; validBefore: bigint; nonce: `0x${string}` };
}

/** A signing account: viem's privateKeyToAccount(key) fits. Use a burner holding only what it may spend. */
export interface X402Account {
  address: `0x${string}`;
  signTypedData(typedData: X402TypedData): Promise<`0x${string}`>;
}

/** The terms of a 402 challenge (x402 v1, scheme "exact"), as the API sends them in `accepts`. */
export interface X402Requirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource?: string;
  description?: string;
  mimeType?: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  asset: string;
  extra?: { name?: string; version?: string; [k: string]: unknown };
}

/** What the caller pins: anything else in a challenge is refused before signing. */
export interface X402Expectations {
  network: X402Network;
  /** Skein's x402 payTo address. Pin it: a challenge naming another address is refused. */
  payTo: string;
  /** The token; default Circle's USDC on the network. */
  asset?: string;
  /** The most one verdict may cost, in micro-USDC. */
  maxUusdc: number;
}

/** A 402 challenge that does not match the caller's pinned terms. Nothing was signed. */
export class X402MismatchError extends Error {
  readonly code = "X402_CHALLENGE_MISMATCH";
  constructor(message: string) {
    super(message);
    this.name = "X402MismatchError";
  }
}

const same = (a: string | undefined, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();
const isAddress = (a: unknown): a is `0x${string}` => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);

/**
 * Picks the terms to pay from a 402's `accepts` and checks them against the
 * caller's pins. Throws X402MismatchError, before any signature, when none fits.
 */
export function chooseRequirements(accepts: unknown, expect: X402Expectations): X402Requirements {
  if (!Array.isArray(accepts) || accepts.length === 0) throw new X402MismatchError("the 402 offered no payment terms");
  const asset = expect.asset ?? X402_NETWORKS[expect.network].usdc;
  const problems: string[] = [];
  for (const r of accepts as X402Requirements[]) {
    const why: string[] = [];
    if (r?.scheme !== "exact") why.push(`scheme ${r?.scheme}`);
    if (r?.network !== expect.network) why.push(`network ${r?.network}, pinned ${expect.network}`);
    if (!isAddress(r?.payTo) || !same(r.payTo, expect.payTo)) why.push(`payTo ${r?.payTo}, pinned ${expect.payTo}`);
    if (!isAddress(r?.asset) || !same(r.asset, asset)) why.push(`asset ${r?.asset}, pinned ${asset}`);
    if (typeof r?.maxAmountRequired !== "string" || !/^\d{1,30}$/.test(r.maxAmountRequired)) why.push("no integer amount");
    else if (BigInt(r.maxAmountRequired) > BigInt(Math.floor(expect.maxUusdc))) why.push(`price ${r.maxAmountRequired} above the cap of ${Math.floor(expect.maxUusdc)} micro-USDC`);
    else if (BigInt(r.maxAmountRequired) <= 0n) why.push("a zero amount");
    if (typeof r?.extra?.name !== "string" || typeof r?.extra?.version !== "string") why.push("no EIP-712 token name and version in extra");
    if (why.length === 0) return r;
    problems.push(why.join(", "));
  }
  throw new X402MismatchError(`no acceptable x402 terms: ${problems.join("; ")}`);
}

/** The X-PAYMENT header for one authorization, and what it pays. */
export interface X402Payment {
  header: string;
  from: `0x${string}`;
  amountUusdc: number;
  nonce: `0x${string}`;
  validBefore: number;
}

const toHex = (bytes: Uint8Array) => `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}` as `0x${string}`;

/**
 * Signs one EIP-3009 authorization for terms chooseRequirements accepted. The
 * window opens 10 minutes back (clock skew) and closes after the terms'
 * maxTimeoutSeconds (at most 10 minutes); the nonce is 32 random bytes.
 */
export async function signX402Payment(
  r: X402Requirements,
  account: X402Account,
  opts: { nowSec?: number; nonce?: `0x${string}` } = {},
): Promise<X402Payment> {
  const network = r.network as X402Network;
  const net = X402_NETWORKS[network];
  if (!net) throw new X402MismatchError(`unknown network ${r.network}`);
  if (!isAddress(r.payTo) || !isAddress(r.asset)) throw new X402MismatchError("payTo and asset must be addresses");
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const window = Math.min(Math.max(Number(r.maxTimeoutSeconds) || 300, 90), 600);
  const nonce = opts.nonce ?? toHex(crypto.getRandomValues(new Uint8Array(32)));
  const authorization = {
    from: account.address,
    to: r.payTo,
    value: r.maxAmountRequired,
    validAfter: String(now - 600),
    validBefore: String(now + window),
    nonce,
  };
  const signature = await account.signTypedData({
    domain: { name: r.extra!.name!, version: r.extra!.version!, chainId: net.chainId, verifyingContract: r.asset },
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
    message: {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce,
    },
  });
  // ASCII JSON, so btoa (Node 16+, browsers, Deno, workers) encodes it exactly as the API decodes it.
  const header = btoa(JSON.stringify({ x402Version: 1, scheme: "exact", network, payload: { signature, authorization } }));
  return { header, from: account.address, amountUusdc: Number(r.maxAmountRequired), nonce, validBefore: now + window };
}

/** The decoded X-PAYMENT-RESPONSE header: the settlement transaction. */
export function readPaymentResponse(header: string | null): { transaction?: string; network?: string; payer?: string } | null {
  if (!header) return null;
  try {
    const v = JSON.parse(atob(header)) as { transaction?: unknown; network?: unknown; payer?: unknown };
    return {
      ...(typeof v.transaction === "string" ? { transaction: v.transaction } : {}),
      ...(typeof v.network === "string" ? { network: v.network } : {}),
      ...(typeof v.payer === "string" ? { payer: v.payer } : {}),
    };
  } catch {
    return null;
  }
}
