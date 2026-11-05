/**
 * The message Skein signs for every verdict (EIP-191 personal_sign, the same
 * scheme Telegraph uses for escrow payments). It names everything a reader
 * relies on (the subject, the outcome, the policy and engine, the verdict hash
 * and the receipts' Merkle root, the cost) in plain lines, so a signature can
 * travel with a listing memo or a payment and be checked by anyone who knows
 * Skein's published attester address. Nothing secret, no dependencies: the API
 * signs it and @skeinlabs/sdk/attest rebuilds it to verify.
 */
export interface AttestedVerdict {
  id: string;
  subject: { chainId: number; token: string };
  verdict: string;
  riskBps: number;
  confidenceBps: number;
  policy: { id: string; version: string };
  engineVersion: string;
  verdictHash: string;
  bom: { root: string };
  cost: { priceUsdc: number; upstreamUsdc: number };
  network: string;
  createdAt: string;
}

export const ATTESTATION_SCHEME = "eip191";
export const ATTESTATION_TITLE = "Skein verdict attestation v1";

export function attestationMessage(v: AttestedVerdict): string {
  return [
    ATTESTATION_TITLE,
    `id: ${v.id}`,
    `subject: eip155:${v.subject.chainId}:${v.subject.token.toLowerCase()}`,
    `verdict: ${v.verdict}`,
    `risk_bps: ${v.riskBps}`,
    `confidence_bps: ${v.confidenceBps}`,
    `policy: ${v.policy.id}@${v.policy.version}`,
    `engine: ${v.engineVersion}`,
    `verdict_hash: ${v.verdictHash}`,
    `bom_root: ${v.bom.root}`,
    `price_usdc: ${v.cost.priceUsdc}`,
    `upstream_usdc: ${v.cost.upstreamUsdc}`,
    `network: ${v.network}`,
    `created_at: ${v.createdAt}`,
  ].join("\n");
}

export interface Attestation {
  scheme: typeof ATTESTATION_SCHEME;
  signer: string;
  message: string;
  signature: string;
}
