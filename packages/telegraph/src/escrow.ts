/**
 * The escrow payment rail, as documented on "Pay from Escrow" (2026-10-30):
 * read the 402's escrow entry, fill its message template, sign it with
 * EIP-191 personal_sign, and resend with an X-PAYMENT header.
 */

export interface EscrowAccept {
  scheme: "escrow";
  network: string;
  payTo: string;
  price?: string;
  amount?: string;
  extra: { message: string; resource?: string; signWith?: string };
}

export interface Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

/** The standard Telegraph receipt (X-PAYMENT-RESPONSE, or X-TELEGRAPH-RECEIPT on x402). */
export interface Receipt {
  receipt_hash: string;
  rail: string;
  payer: string;
  miner: string;
  intent?: string;
  amount_uusdc: string;
  epoch_id?: number;
  settlement?: string;
  chain?: string;
  timestamp: number;
  tx_hash?: string;
}

export interface MessageSigner {
  address: string;
  signMessage(message: string): Promise<string>;
}

/** The validity window may be at most 2 minutes; stay well inside it. */
export const MAX_WINDOW_SEC = 120;
const WINDOW_BEFORE = 5;
const WINDOW_AFTER = 100;

function b64decode(s: string): string {
  return Buffer.from(s, "base64").toString("utf8");
}

function b64encode(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}

/**
 * Finds the escrow entry in a 402. The full challenge is in the
 * PAYMENT-REQUIRED header (base64 JSON); the body carries a summary that, for
 * escrow, still includes the message template. Header first, then body.
 */
export function findEscrowAccept(headerValue: string | null, body: unknown): EscrowAccept | null {
  const candidates: unknown[] = [];
  if (headerValue) {
    try {
      candidates.push(JSON.parse(b64decode(headerValue)));
    } catch {
      // fall through to the body
    }
  }
  candidates.push(body);
  for (const c of candidates) {
    const accepts = (c as { accepts?: unknown })?.accepts;
    if (!Array.isArray(accepts)) continue;
    const hit = accepts.find(
      (a) => a?.scheme === "escrow" && typeof a?.extra?.message === "string" && typeof a?.payTo === "string",
    );
    if (hit) return hit as EscrowAccept;
  }
  return null;
}

/** The amount to authorise, read from the template's "Amount: N uUSDC" line. */
export function amountFromTemplate(template: string): string | null {
  return template.match(/Amount:\s*(\d+)\s*uUSDC/)?.[1] ?? null;
}

export function fillTemplate(template: string, auth: Authorization): string {
  return template
    .replace("{from}", auth.from)
    .replace("{nonce}", auth.nonce)
    .replace("{validAfter}", auth.validAfter)
    .replace("{validBefore}", auth.validBefore);
}

export function buildAuthorization(args: {
  from: string;
  to: string;
  value: string;
  nowSec: number;
  nonce: string;
}): Authorization {
  return {
    // The node lowercases the wallet before checking the signature.
    from: args.from.toLowerCase(),
    to: args.to,
    value: args.value,
    validAfter: String(args.nowSec - WINDOW_BEFORE),
    validBefore: String(args.nowSec + WINDOW_AFTER),
    nonce: args.nonce,
  };
}

export class ChallengeMismatchError extends Error {
  readonly code = "CHALLENGE_MISMATCH";
}

/**
 * Signs one escrow payment. The challenge is checked against the configured
 * network and Diamond first, so a node that asks Skein to pay somewhere
 * unexpected is refused rather than paid.
 */
export async function signEscrowPayment(args: {
  accept: EscrowAccept;
  signer: MessageSigner;
  expected: { caip2: string; diamond: string; maxUusdc: number };
  nowSec: number;
  nonce: string;
}): Promise<{ header: string; authorization: Authorization; amountUusdc: number }> {
  const { accept, expected } = args;
  if (accept.network !== expected.caip2) {
    throw new ChallengeMismatchError(`challenge network ${accept.network}, expected ${expected.caip2}`);
  }
  if (accept.payTo.toLowerCase() !== expected.diamond.toLowerCase()) {
    throw new ChallengeMismatchError(`challenge pays ${accept.payTo}, expected the Diamond ${expected.diamond}`);
  }
  const value = amountFromTemplate(accept.extra.message);
  if (!value) throw new ChallengeMismatchError("challenge template has no Amount line");
  const amountUusdc = Number(value);
  if (!(amountUusdc <= expected.maxUusdc)) {
    throw new ChallengeMismatchError(`challenge asks ${amountUusdc} uUSDC, cap ${expected.maxUusdc}`);
  }
  const authorization = buildAuthorization({
    from: args.signer.address,
    to: accept.payTo,
    value,
    nowSec: args.nowSec,
    nonce: args.nonce,
  });
  const signature = await args.signer.signMessage(fillTemplate(accept.extra.message, authorization));
  const header = b64encode(
    JSON.stringify({ x402Version: 2, scheme: "escrow", network: accept.network, payload: { signature, authorization } }),
  );
  return { header, authorization, amountUusdc };
}

export function decodeReceipt(headerValue: string | null): Receipt | null {
  if (!headerValue) return null;
  try {
    const r = JSON.parse(b64decode(headerValue)) as Receipt;
    return typeof r?.receipt_hash === "string" ? r : null;
  } catch {
    return null;
  }
}
