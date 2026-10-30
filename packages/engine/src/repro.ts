import { adapterFor, type AdapterContext } from "./adapters";
import { canonicalJson } from "./hash";
import type { Policy } from "./policy";
import { ENGINE_VERSION, evaluate, sortFindings } from "./seal";
import type { Check, Finding, Subject } from "./types";

export interface StoredPurchase extends AdapterContext {
  check: Check;
  adapterVersion: string;
  rawResult: unknown;
}

export interface StoredVerdict {
  engineVersion: string;
  policy: { id: string; version: string };
  subject: Subject;
  findings: Finding[];
  /** Upstream attempts, including failures. When present, adapters are re-run on them. */
  purchases?: StoredPurchase[];
  /** Findings for checks that were never bought (UNAVAILABLE). */
  unpurchased?: Finding[];
  receipts?: string[];
  verdictHash: string;
  bomRoot: string;
}

export interface ReproReport {
  ok: boolean;
  verdictHash: string;
  bomRoot: string;
  problems: string[];
}

/**
 * Replays a stored verdict: re-derives findings from the raw upstream answers
 * with the recorded adapter versions, reruns the engine, and compares the
 * verdict hash and BOM root. Signal-hash re-derivation against the network is
 * the API's job (/v1/verify); this function stays offline.
 */
export function reproduce(stored: StoredVerdict, policy: Policy): ReproReport {
  const problems: string[] = [];
  if (stored.engineVersion !== ENGINE_VERSION) {
    problems.push(`engine version ${stored.engineVersion} differs from ${ENGINE_VERSION}; replay with that version`);
  }
  if (policy.id !== stored.policy.id || policy.version !== stored.policy.version) {
    problems.push(`policy ${policy.id}@${policy.version} is not the stored ${stored.policy.id}@${stored.policy.version}`);
  }

  let findings = stored.findings;
  if (stored.purchases) {
    try {
      const rederived = [
        ...stored.purchases.map((p) => adapterFor(p.check, p.adapterVersion).adapt(p.rawResult, p)),
        ...(stored.unpurchased ?? []),
      ];
      if (canonicalJson(sortFindings(rederived)) !== canonicalJson(sortFindings(stored.findings))) {
        problems.push("findings re-derived from raw answers differ from the stored findings");
      }
      findings = rederived;
    } catch (e) {
      problems.push(`adapter replay failed: ${(e as Error).message}`);
    }
  }

  const sealed = evaluate(policy, stored.subject, findings, stored.receipts);
  if (sealed.verdictHash !== stored.verdictHash) problems.push("verdict hash mismatch");
  if (sealed.bom.root !== stored.bomRoot) problems.push("bom root mismatch");
  return { ok: problems.length === 0, verdictHash: sealed.verdictHash, bomRoot: sealed.bom.root, problems };
}
