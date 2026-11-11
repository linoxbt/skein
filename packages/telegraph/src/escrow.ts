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

/** The parts of a 402 that matter: the escrow entry, plus any asset the other entries declare. */
export interface Challenge {
  escrow: EscrowAccept;
  /** Assets named by the challenge's other entries on the escrow's chain (e.g. the x402 "exact" one). */
  assets: string[];
}

/**
 * Reads a 402. The full challenge is in the PAYMENT-REQUIRED header (base64
 * JSON); the body carries a summary that, for escrow, still includes the
 * message template. Header first, then body.
 */
export function readChallenge(headerValue: string | null, body: unknown): Challenge | null {
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
    if (hit) {
      // Only entries on the escrow's own chain describe what the escrow pays in.
      // The node also offers "exact" payments on other chains (Base Sepolia,
      // Solana devnet) with their own USDC; Skein never signs those, so their
      // assets say nothing about this payment.
      const assets = accepts
        .filter((a) => a?.network === (hit as EscrowAccept).network)
        .map((a) => a?.asset)
        .filter((x): x is string => typeof x === "string");
      return { escrow: hit as EscrowAccept, assets };
    }
  }
  return null;
}

export function findEscrowAccept(headerValue: string | null, body: unknown): EscrowAccept | null {
  return readChallenge(headerValue, body)?.escrow ?? null;
}

/** The template's fixed lines, in order, and the placeholder each signed field must carry. */
const TEMPLATE_HEADER = "Telegraph Escrow Payment";
const TEMPLATE_KEYS = ["Wallet", "Pay To", "Network", "Amount", "Resource", "Nonce", "Valid After", "Valid Before"] as const;
const PLACEHOLDERS: Partial<Record<(typeof TEMPLATE_KEYS)[number], string>> = {
  Wallet: "{from}",
  Nonce: "{nonce}",
  "Valid After": "{validAfter}",
  "Valid Before": "{validBefore}",
};

export interface ParsedTemplate {
  payTo: string;
  network: string;
  amountUusdc: string;
  resource: string;
}

/**
 * Parses an escrow message template strictly: the header, a blank line, then
 * exactly the eight documented "Key: value" lines, each once and in order.
 * The four signer-filled fields must be bare placeholders, and no other
 * placeholder may appear. Anything else is refused, because the signature
 * covers the whole text, not just the fields Skein checked.
 */
export function parseTemplate(template: string): ParsedTemplate {
  const lines = template.split("\n");
  if (lines[0] !== TEMPLATE_HEADER || lines[1] !== "" || lines.length !== 2 + TEMPLATE_KEYS.length) {
    throw new ChallengeMismatchError("escrow template does not have the documented layout");
  }
  const values: Record<string, string> = {};
  TEMPLATE_KEYS.forEach((key, i) => {
    const line = lines[2 + i]!;
    const prefix = `${key}: `;
    if (!line.startsWith(prefix)) throw new ChallengeMismatchError(`escrow template line ${3 + i} should be "${key}: …"`);
    values[key] = line.slice(prefix.length);
  });
  for (const [key, ph] of Object.entries(PLACEHOLDERS)) {
    if (values[key] !== ph) throw new ChallengeMismatchError(`escrow template ${key} must be ${ph}`);
  }
  const fixed = TEMPLATE_KEYS.filter((k) => !(k in PLACEHOLDERS)).map((k) => values[k]!);
  if (fixed.some((v) => /[{}]/.test(v))) throw new ChallengeMismatchError("escrow template has an unexpected placeholder");
  const amount = /^(\d{1,12}) uUSDC$/.exec(values.Amount!);
  if (!amount) throw new ChallengeMismatchError("escrow template Amount is not \"N uUSDC\"");
  if (!/^\/v1\/ask(\/[\w.-]+)?$/.test(values.Resource!)) throw new ChallengeMismatchError(`escrow template Resource ${values.Resource} is not an ask`);
  return { payTo: values["Pay To"]!, network: values.Network!, amountUusdc: amount[1]!, resource: values.Resource! };
}

/** The amount to authorise, read from a strictly parsed template. */
export function amountFromTemplate(template: string): string | null {
  try {
    return parseTemplate(template).amountUusdc;
  } catch {
    return null;
  }
}

/** Fills the four placeholders; parseTemplate has already proved each occurs exactly once. */
export function fillTemplate(template: string, auth: Authorization): string {
  return template
    .split("{from}").join(auth.from)
    .split("{nonce}").join(auth.nonce)
    .split("{validAfter}").join(auth.validAfter)
    .split("{validBefore}").join(auth.validBefore);
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
 * Signs one escrow payment. Every field the signature covers is checked
 * first: the template's Pay To, Network, Amount and Resource must agree with
 * the configuration, with the challenge's own JSON fields, and with the cap.
 * A node that asks Skein to pay somewhere, someone or something unexpected is
 * refused rather than paid.
 */
export async function signEscrowPayment(args: {
  accept: EscrowAccept;
  signer: MessageSigner;
  expected: { caip2: string; diamond: string; maxUusdc: number; usdc?: string; resource?: string };
  /** Assets the challenge's other entries declare; each must be the configured USDC. */
  assets?: readonly string[];
  nowSec: number;
  nonce: string;
}): Promise<{ header: string; authorization: Authorization; amountUusdc: number }> {
  const { accept, expected } = args;
  const t = parseTemplate(accept.extra.message);
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (accept.network !== expected.caip2 || t.network !== expected.caip2) {
    throw new ChallengeMismatchError(`challenge network ${accept.network} / template ${t.network}, expected ${expected.caip2}`);
  }
  if (!same(accept.payTo, expected.diamond) || !same(t.payTo, expected.diamond)) {
    throw new ChallengeMismatchError(`challenge pays ${accept.payTo} / template ${t.payTo}, expected the Diamond ${expected.diamond}`);
  }
  if (accept.amount !== undefined && accept.amount !== t.amountUusdc) {
    throw new ChallengeMismatchError(`challenge amount ${accept.amount} disagrees with the template's ${t.amountUusdc}`);
  }
  if (accept.extra.resource !== undefined && accept.extra.resource !== t.resource) {
    throw new ChallengeMismatchError(`challenge resource ${accept.extra.resource} disagrees with the template's ${t.resource}`);
  }
  if (expected.resource !== undefined && t.resource !== expected.resource) {
    throw new ChallengeMismatchError(`template resource ${t.resource}, expected ${expected.resource}`);
  }
  if (expected.usdc) {
    const wrong = (args.assets ?? []).find((a) => !same(a, expected.usdc!));
    if (wrong) throw new ChallengeMismatchError(`challenge names asset ${wrong}, expected USDC ${expected.usdc}`);
  }
  const amountUusdc = Number(t.amountUusdc);
  if (!(Number.isSafeInteger(amountUusdc) && amountUusdc <= expected.maxUusdc)) {
    throw new ChallengeMismatchError(`challenge asks ${t.amountUusdc} uUSDC, cap ${expected.maxUusdc}`);
  }
  const authorization = buildAuthorization({
    from: args.signer.address,
    to: expected.diamond,
    value: t.amountUusdc,
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

/**
 * Checks a receipt against the payment that was signed. A receipt for another
 * payer, amount, rail or miner is not evidence of this purchase.
 */
export function receiptProblems(r: Receipt | null, signed: { payer: string; amountUusdc: number; minerId?: string }): string[] {
  if (!r) return ["no receipt"];
  const out: string[] = [];
  if (!/^0x[0-9a-fA-F]{64}$/.test(r.receipt_hash)) out.push("receipt_hash is not 32 bytes of hex");
  if (r.rail !== "escrow") out.push(`receipt rail ${r.rail}, expected escrow`);
  if (typeof r.payer !== "string" || r.payer.toLowerCase() !== signed.payer.toLowerCase()) out.push(`receipt payer ${r.payer}, expected ${signed.payer}`);
  if (String(r.amount_uusdc) !== String(signed.amountUusdc)) out.push(`receipt amount ${r.amount_uusdc}, signed ${signed.amountUusdc}`);
  if (signed.minerId && r.miner !== undefined && String(r.miner) !== signed.minerId) out.push(`receipt miner ${r.miner}, pinned ${signed.minerId}`);
  return out;
}
