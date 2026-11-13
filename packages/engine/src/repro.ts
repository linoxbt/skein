import { adapterFor, type AdapterContext } from "./adapters";
import { evaluateWith } from "./engines";
import { canonicalJson, normaliseReceipt } from "./hash";
import type { Policy } from "./policy";
import { sortFindings, type PolicyRef, type VerdictMode } from "./seal";
import { ANSWERED, type Check, type Finding, type Subject } from "./types";

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
  /** Upstream attempts, including failures. Answered findings are re-derived from them. */
  purchases?: StoredPurchase[];
  /** Findings for checks that were never bought (UNAVAILABLE), or the local OFAC list screen. */
  unpurchased?: Finding[];
  receipts?: string[];
  verdictHash: string;
  bomRoot: string;
  /** The decision as served (the stored verdict columns). Compared with the recomputed one. */
  decision?: { verdict: string; riskBps: number; confidenceBps: number };
  /** Live unless the run was simulated; sealed into the hash from engine 0.4.0. */
  mode?: VerdictMode;
}

export interface ReproReport {
  ok: boolean;
  verdictHash: string;
  bomRoot: string;
  problems: string[];
}

export interface ReproOptions {
  policySha256?: string;
  /** The policy file's YAML as parsed, before the schema (PolicyRecord.source): each engine applies its own schema. */
  policySource?: unknown;
  /**
   * Address lists Skein screens locally, by name, with the sha256 of each
   * snapshot it ships (the pipeline's knownLists()). A list finding that names
   * another snapshot is refused. Without it the list finding's shape is still
   * checked, but not which snapshot it came from.
   */
  knownLists?: Readonly<Record<string, readonly string[]>>;
}

const LIST_ADAPTER = "ofac-sdn-1";

/**
 * Why a finding that no purchase stands behind may not be in the verdict, or
 * null if it may. Only two kinds may: a non-answer (a check that was not
 * bought adds no risk and no coverage), and a FAIL from a local list screen
 * (the OFAC SDN address match), which carries the snapshot it was read from.
 * Anything else would let a stored verdict claim an answer nobody bought.
 */
function unpurchasedProblem(f: Finding, knownLists: ReproOptions["knownLists"]): string | null {
  if (!ANSWERED.has(f.status)) {
    return f.evidence?.receiptHash ? `unpurchased ${f.check} ${f.status} carries a receipt` : null;
  }
  const e = f.evidence;
  const isList =
    f.check === "sanctions" && f.status === "FAIL" && f.adapterVersion === LIST_ADAPTER && !e?.receiptHash &&
    typeof e?.list === "string" && typeof e.listSha256 === "string" && /^[0-9a-f]{64}$/.test(e.listSha256) &&
    Array.isArray(e.matches) && e.matches.length > 0;
  if (!isList) return `unpurchased ${f.check} ${f.status}: only non-answers and a list screen may stand without a purchase`;
  if (knownLists && !(knownLists[e!.list!] ?? []).includes(e!.listSha256!)) {
    return `unpurchased ${f.check} ${f.status} cites list ${e!.list} snapshot ${e!.listSha256}, which is not one Skein ships`;
  }
  return null;
}

/**
 * Replays a stored verdict with the engine version that sealed it:
 * re-derives findings from the raw upstream answers with the recorded adapter
 * versions, checks that every finding without a purchase is a non-answer or
 * a known list screen, checks the policy file is the published one, checks
 * the BOM's receipts are exactly the purchases' receipts, reruns the engine,
 * and compares the verdict hash, the BOM root and the decision that was
 * served. Signal lookups against the network are the API's job (/v1/verify);
 * this function stays offline.
 */
export function reproduce(stored: StoredVerdict, policy: Policy, opts: ReproOptions = {}): ReproReport {
  const problems: string[] = [];
  if (policy.id !== stored.policy.id || policy.version !== stored.policy.version) {
    problems.push(`policy ${policy.id}@${policy.version} is not the stored ${stored.policy.id}@${stored.policy.version}`);
  }
  if (stored.policy.sha256 && opts.policySha256 && stored.policy.sha256 !== opts.policySha256) {
    problems.push("policy file differs from the one the verdict was sealed with");
  }

  let findings = stored.findings;
  // Without purchase records every finding stands on its own, so each must pass as unpurchased.
  const standalone = stored.purchases ? (stored.unpurchased ?? []) : stored.findings;
  for (const f of standalone) {
    const p = unpurchasedProblem(f, opts.knownLists);
    if (p) problems.push(p);
  }
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
      ...(stored.mode ? { mode: stored.mode } : {}),
      ...(opts.policySource !== undefined ? { policySource: opts.policySource } : {}),
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
