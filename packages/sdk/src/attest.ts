/**
 * Check a Skein verdict's signature yourself (needs viem). Import from
 * "@skeinlabs/sdk/attest".
 *
 *   import { verifyAttestation } from "@skeinlabs/sdk/attest";
 *   const r = await verifyAttestation(v, { signer: SKEIN_ATTESTER });   // the address at /v1/status
 *   if (!r.ok) throw new Error(r.problems.join("; "));
 *
 * It rebuilds the signed message from the verdict's own fields, so a verdict
 * whose outcome, hash, cost or subject was edited after signing fails, even
 * when the attached message and signature are left untouched.
 */
import { verifyMessage } from "viem";
import { attestationMessage, type AttestedVerdict } from "@skein/engine/attest";
import type { Attestation } from "./types";

export { attestationMessage, type AttestedVerdict };

export interface AttestationCheck {
  ok: boolean;
  /** Who signed it, as the verdict claims. */
  signer: string | null;
  problems: string[];
}

export async function verifyAttestation(v: AttestedVerdict & { attestation?: Attestation | null }, opts: { signer: string }): Promise<AttestationCheck> {
  const a = v.attestation;
  if (!a) return { ok: false, signer: null, problems: ["the verdict carries no attestation (the API has no attestation key set)"] };
  const problems: string[] = [];
  if (a.scheme !== "eip191") problems.push(`unknown scheme ${a.scheme}`);
  if (a.signer.toLowerCase() !== opts.signer.toLowerCase()) problems.push(`signed by ${a.signer}, not the expected ${opts.signer}`);
  const rebuilt = attestationMessage(v);
  if (rebuilt !== a.message) problems.push("the signed message does not match the verdict's fields");
  let valid = false;
  try {
    valid = await verifyMessage({ address: opts.signer as `0x${string}`, message: rebuilt, signature: a.signature as `0x${string}` });
  } catch {
    valid = false;
  }
  if (!valid) problems.push("the signature does not recover to the expected signer for this verdict");
  return { ok: problems.length === 0, signer: a.signer, problems };
}
