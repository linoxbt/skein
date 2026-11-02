import { adapterFor, type AdapterContext } from "./adapters";
import { canonicalJson } from "./hash";
import type { Policy } from "./policy";
import { evaluateWith } from "./engines";
import { normaliseReceipt } from "./hash";
import { sortFindings, type PolicyRef } from "./seal";
import type { Check, Finding, Subject } from "./types";

export interface StoredPurchase extends AdapterContext {
  check: Check;
  adapterVersion: string;
  rawResult: unknown;
}

export interface StoredVerdict {
  engineVersion: string;
  policy: PolicyRef;
  subject: Subject;
  findings: Finding[];
  /** Upstream attempts, including failures. When present, adapters are re-run on them. */
  purchases?: StoredPurchase[];
  /** Findings for checks that were never bought (UNAVAILABLE). */
  unpurchased?: Finding[];
  receipts?: string[];
  verdictHash: string;
  bomRoot: string;
  /** The decision as served (the stored verdict columns). Compared with the recomputed one. */
  decision?: { verdict: string; riskBps: number; confidenceBps: number };
}

export interface ReproReport {
  ok: boolean;
  verdictHash: string;
  bomRoot: string;
  problems: string[];
}

/**
 * Replays a stored verdict with the engine version that sealed it:
 * re-derives findings from the raw upstream answers with the recorded adapter
 * versions, checks the policy file is the published one, checks the BOM's
 * receipts are exactly the purchases' receipts, reruns the engine, and
 * compares the verdict hash, the BOM root and the decision that was served.
 * Signal lookups against the network are the API's job (/v1/verify); this
 * function stays offline.
 */
export function reproduce(stored: StoredVerdict, policy: Policy, opts: { policySha256?: string } = {}): ReproReport {
  const problems: string[] = [];
  if (policy.id !== stored.policy.id || policy.version !== stored.policy.version) {
    problems.push(`policy ${policy.id}@${policy.version} is not the stored ${stored.policy.id}@${stored.policy.version}`);
  }
  if (stored.policy.sha256 && opts.policySha256 && stored.policy.sha256 !== opts.policySha256) {
    problems.push("policy file differs from the one the verdict was sealed with");
  }

  let findings = stored.findings;
  if (stored.purchases) {
    try {
      const rederived = [
        ...stored.purchases.map((p) => adapterFor(p.check, p.adapterVersion).adapt(p.rawResult, { ...p, subject: p.subject ?? stored.subject })),
        ...(stored.unpurchased ?? []),
      ];
      if (canonicalJson(sortFindings(rederived)) !== canonicalJson(sortFindings(stored.findings))) {
        problems.push("findings re-derived from raw answers differ from the stored findings");
      }
      findings = rederived;
    } catch (e) {
      problems.push(`adapter replay failed: ${(e as Error).message}`);
    }
    if (stored.receipts) {
      const fromPurchases = new Set(stored.purchases.map((p) => p.receiptHash).filter((r): r is string => !!r).map(normaliseReceipt));
      const inBom = new Set(stored.receipts.map(normaliseReceipt));
      const extra = [...inBom].filter((r) => !fromPurchases.has(r));
      const missing = [...fromPurchases].filter((r) => !inBom.has(r));
      if (extra.length) problems.push(`${extra.length} BOM receipt(s) belong to no purchase`);
      if (missing.length) problems.push(`${missing.length} purchase receipt(s) missing from the BOM`);
    }
  }

  let sealed;
  try {
    sealed = evaluateWith(stored.engineVersion, policy, stored.subject, findings, stored.receipts, {
      ...(stored.policy.sha256 ? { policySha256: stored.policy.sha256 } : {}),
    });
  } catch (e) {
    problems.push((e as Error).message);
    return { ok: false, verdictHash: "", bomRoot: "", problems };
  }
  if (sealed.verdictHash !== stored.verdictHash) problems.push("verdict hash mismatch");
  if (sealed.bom.root !== stored.bomRoot) problems.push("bom root mismatch");
  if (stored.decision) {
    const d = sealed.decision;
    if (d.verdict !== stored.decision.verdict) problems.push(`served verdict ${stored.decision.verdict}, recomputed ${d.verdict}`);
    if (d.riskBps !== stored.decision.riskBps) problems.push(`served risk ${stored.decision.riskBps}, recomputed ${d.riskBps}`);
    if (d.confidenceBps !== stored.decision.confidenceBps) problems.push(`served confidence ${stored.decision.confidenceBps}, recomputed ${d.confidenceBps}`);
  }
  return { ok: problems.length === 0, verdictHash: sealed.verdictHash, bomRoot: sealed.bom.root, problems };
}
