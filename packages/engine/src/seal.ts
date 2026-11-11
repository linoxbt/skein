import { decide, summarise } from "./decide";
import { canonicalJson, keccakHex, merkleRoot, uniqueReceipts } from "./hash";
import type { Policy } from "./policy";
import type { Decision, Finding, Subject } from "./types";

/**
 * Bump on any change that can alter a decision, its reasons or its hashes for
 * the same findings and policy, and freeze the previous version under
 * src/frozen/ so the verdicts it sealed still replay (see engines.ts).
 *
 * 0.2.0: domain-separated Merkle tree over 32-byte receipts; the policy file's
 * sha256 in the verdict hash; a check's independence group is that of its
 * worst finding and its confidence the best answer's; blockers need
 * minConfidence; only answers are graded by thresholds.
 */
export const ENGINE_VERSION = "0.3.0";

export interface PolicyRef {
  id: string;
  version: string;
  /** SHA-256 of the policy file's bytes, as published in policies.lock.json. */
  sha256?: string;
}

export interface SealedVerdict {
  engineVersion: string;
  policy: PolicyRef;
  subject: Subject;
  decision: Decision;
  summary: string;
  findings: Finding[];
  verdictHash: string;
  bom: { root: string; items: number };
}

/** Findings in a canonical order, with undefined members stripped. */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  return findings
    .map((f) => JSON.parse(canonicalJson(f)) as Finding)
    .sort((a, b) => {
      const x = canonicalJson(a);
      const y = canonicalJson(b);
      return x < y ? -1 : x > y ? 1 : 0;
    });
}

export function verdictHash(input: {
  engineVersion: string;
  policy: PolicyRef;
  subject: Subject;
  findings: readonly Finding[];
  decision: Decision;
}): string {
  return keccakHex(
    canonicalJson({
      engine_version: input.engineVersion,
      policy_id: input.policy.id,
      policy_version: input.policy.version,
      // The content, not just the name: an edited file can't pass for the published one.
      policy_sha256: input.policy.sha256 ?? null,
      subject: { chainId: input.subject.chainId, token: input.subject.token.toLowerCase() },
      findings_sorted: sortFindings(input.findings),
      decision: input.decision,
    }),
  );
}

export function receiptsOf(findings: readonly Finding[]): string[] {
  return findings.map((f) => f.evidence?.receiptHash).filter((r): r is string => !!r);
}

/**
 * Runs the engine and seals the result. `receipts` defaults to the receipt
 * hashes carried by the findings; pass the purchase log's receipts when some
 * paid answers produced no finding.
 */
export function evaluate(
  policy: Policy,
  subject: Subject,
  findings: readonly Finding[],
  receipts: readonly string[] = receiptsOf(findings),
  opts: { policySha256?: string } = {},
): SealedVerdict {
  const { decision } = decide(policy, findings);
  const ref: PolicyRef = { id: policy.id, version: policy.version, ...(opts.policySha256 ? { sha256: opts.policySha256 } : {}) };
  const sorted = sortFindings(findings);
  return {
    engineVersion: ENGINE_VERSION,
    policy: ref,
    subject: { chainId: subject.chainId, token: subject.token.toLowerCase() },
    decision,
    summary: summarise(decision),
    findings: sorted,
    verdictHash: verdictHash({ engineVersion: ENGINE_VERSION, policy: ref, subject, findings: sorted, decision }),
    bom: { root: merkleRoot(receipts), items: uniqueReceipts(receipts).length },
  };
}
