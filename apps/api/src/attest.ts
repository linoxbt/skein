import { getAttestation, saveAttestation, type Db, type StoredAttestation } from "@skein/db";
import { ATTESTATION_SCHEME, attestationMessage, type Attestation } from "@skein/engine";
import { verifyMessage } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { verdictObject, type VerdictObject } from "./views";

/** A served attestation: the stored signature, and when and how it was made. */
export type ServedAttestation = Attestation & { signedAt: string; atSeal: boolean };

const served = (a: StoredAttestation): ServedAttestation => ({
  scheme: a.scheme as typeof ATTESTATION_SCHEME,
  signer: a.signer,
  message: a.message,
  signature: a.signature,
  signedAt: a.signedAt.toISOString(),
  atSeal: a.atSeal,
});

/**
 * The attester signs each verdict once, when it is sealed, and the signature is
 * stored (verdict_attestations, append-only). Reads serve the stored one, so a
 * row edited later no longer matches what was signed. A verdict sealed before
 * signatures were stored is signed on its first read and stored then, marked
 * atSeal: false with that later signedAt: it vouches for the row as it was at
 * that moment, not at sealing.
 */
export class Attester {
  private readonly account: PrivateKeyAccount | null;

  constructor(
    private readonly db: Db,
    key?: `0x${string}`,
  ) {
    this.account = key ? privateKeyToAccount(key) : null;
  }

  get address(): string | null {
    return this.account?.address ?? null;
  }

  private async sign(v: VerdictObject, atSeal: boolean): Promise<ServedAttestation | null> {
    if (!this.account) return null;
    const message = attestationMessage(v);
    const signature = await this.account.signMessage({ message });
    return served(await saveAttestation(this.db, { verdictId: v.id, scheme: ATTESTATION_SCHEME, signer: this.account.address, message, signature, atSeal }));
  }

  /** Signs a verdict as it is sealed. Never throws: a verdict without a stored signature is signed on first read. */
  async seal(id: string): Promise<void> {
    if (!this.account) return;
    try {
      const v = await verdictObject(this.db, id);
      if (v) await this.sign(v, true);
    } catch (e) {
      console.error(JSON.stringify({ level: "error", msg: "attestation not stored at seal", id, error: (e as Error).message }));
    }
  }

  /** The stored attestation for a served verdict, signing (and storing) it once if it has none. */
  async forVerdict(v: VerdictObject): Promise<ServedAttestation | null> {
    const stored = await getAttestation(this.db, v.id);
    if (stored) return served(stored);
    return this.sign(v, false);
  }

  /**
   * What /v1/verify reports about a verdict's stored signature: whether it
   * recovers to its signer, whether that signer is the published attester, and
   * whether the signed message is the one the verdict as stored now produces.
   */
  async check(v: VerdictObject): Promise<{ attestation: ServedAttestation; signatureValid: boolean; signerIsAttester: boolean | null; messageMatches: boolean } | null> {
    const a = await this.forVerdict(v);
    if (!a) return null;
    const signatureValid = await verifyMessage({ address: a.signer as `0x${string}`, message: a.message, signature: a.signature as `0x${string}` }).catch(() => false);
    return {
      attestation: a,
      signatureValid,
      signerIsAttester: this.account ? a.signer.toLowerCase() === this.account.address.toLowerCase() : null,
      messageMatches: a.message === attestationMessage(v),
    };
  }
}
