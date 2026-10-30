import { decide, summarise } from "./decide";
import { canonicalJson, keccakHex, merkleRoot, uniqueReceipts } from "./hash";
import type { Policy } from "./policy";
import type { Decision, Finding, Subject } from "./types";

/**
 * Bump on any change that can alter a decision or its reasons for the same
 * findings and policy. The version is part of the verdict hash, so stored
 * verdicts are replayed against the engine version that made them.
 */
export const ENGINE_VERSION = "0.1.0";

export interface SealedVerdict {
  engineVersion: string;
  policy: { id: string; version: string };
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
  policy: { id: string; version: string };
  subject: Subject;
  findings: readonly Finding[];
  decision: Decision;
}): string {
  return keccakHex(
    canonicalJson({
      engine_version: input.engineVersion,
      policy_id: input.policy.id,
      policy_version: input.policy.version,
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
): SealedVerdict {
  const { decision } = decide(policy, findings);
  const ref = { id: policy.id, version: policy.version };
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
