import type { Policy } from "./policy";
import { checkStates, score, type CheckState } from "./score";
import { ANSWERED, VERDICT_CODES, type Decision, type Finding, type Reason, type Verdict } from "./types";

const upper = (s: string) => s.toUpperCase();

export interface Conflict {
  code: string;
  detail: string;
  checks: string[];
}

/** How bad an answer is, in the engine's own order: status first (FAIL over WARN over PASS), then severity. */
const RANK: Readonly<Record<string, number>> = { PASS: 0, WARN: 1, FAIL: 2 };

/**
 * Whether an answer is at a status or worse (engine 0.4.0). Rules name the
 * least bad answer they fire on: a FAIL meets a WARN rule, so a strictly
 * worse answer can never stop a blocker or a contradiction from firing.
 * minSeverity grades answers at the rule's own status only; every answer at
 * a worse status is already worse than all of those (it is how the engine
 * picks a check's deciding answer, and the policy's scoring tables must
 * agree: policy.ts).
 */
function atOrWorse(status: string, severity: number, rule: { status: string; minSeverity?: number }): boolean {
  const have = RANK[status];
  const want = RANK[rule.status];
  if (have === undefined || want === undefined) return false;
  return have > want || (have === want && severity >= (rule.minSeverity ?? 0));
}

/**
 * Contradictions are escalated, never averaged. A policy contradiction fires
 * when each of its checks is answered at its status or worse (0.4.0): "audit
 * PASS but wash trading FAIL" escalates, so "audit WARN and wash trading
 * FAIL" must too, or a worse audit would let the same token be approved.
 */
export function reconcile(policy: Policy, states: readonly CheckState[]): Conflict[] {
  const byCheck = new Map(states.map((s) => [s.check, s]));
  const out: Conflict[] = [];
  for (const k of policy.conflicts) {
    const hit = k.when.every((w) => {
      const s = byCheck.get(w.check);
      return !!s && s.answered && atOrWorse(s.status, s.severity, w);
    });
    if (!hit) continue;
    const worse = k.when.filter((w) => byCheck.get(w.check)!.status !== w.status).map((w) => `${w.check} ${byCheck.get(w.check)!.status}`);
    const detail = worse.length === 0 ? k.detail : `${k.detail}; met by a worse answer (${worse.join(", ")})`;
    out.push({ code: k.code, detail, checks: k.when.map((w) => w.check) });
  }
  for (const s of states) {
    if (s.disagreement) {
      out.push({
        code: "SOURCE_DISAGREEMENT",
        detail: `answers for ${s.check} disagree (PASS and FAIL)`,
        checks: [s.check],
      });
    }
  }
  return out;
}

interface BlockerHit extends Reason {
  /** Highest confidence among the findings that hit this blocker. */
  confidence: number;
}

function blockerHits(policy: Policy, states: readonly CheckState[]): BlockerHit[] {
  const out: BlockerHit[] = [];
  for (const b of policy.blockers) {
    const s = states.find((x) => x.check === b.check);
    const hits = (s?.findings ?? []).filter(
      (f) => ANSWERED.has(f.status) && atOrWorse(f.status, f.severity, b) && f.confidence >= b.minConfidence,
    );
    if (hits.length > 0) {
      const sev = b.minSeverity !== undefined ? ` (severity >= ${b.minSeverity})` : "";
      out.push({
        code: `BLOCKER_${upper(b.check)}_${b.status}`,
        check: b.check,
        detail: `${b.check} ${b.status}${sev} or worse is a hard blocker`,
        confidence: Math.max(...hits.map((f) => f.confidence)),
      });
    }
  }
  return out;
}

/** Informational reasons for every WARN or FAIL, in policy order. */
function findingReasons(states: readonly CheckState[]): Reason[] {
  const out: Reason[] = [];
  for (const s of states) {
    if (!s.answered || s.status === "PASS") continue;
    const f = s.findings.find((x) => x.status === s.status && x.severity === s.severity) ?? s.findings[0];
    const detail = f?.thresholdDetail ?? [s.check, s.status, ...(f?.notes ?? [])].join(" ");
    out.push({ code: `${upper(s.check)}_${s.status}`, check: s.check, detail });
  }
  return out;
}

export interface Evaluation {
  decision: Decision;
  states: CheckState[];
  conflicts: Conflict[];
}

/**
 * The decision table, evaluated in order:
 *  1. any blocker hit, at its status or worse            -> REJECT (confidence of the blocking finding)
 *  2. a required check has no real answer                -> ABSTAIN (names it; confidence 0)
 *  3. coverage below min_coverage                        -> ABSTAIN
 *  4. risk_bps >= reject threshold                       -> REJECT
 *  5. a contradiction fires, at its statuses or worse    -> ESCALATE
 *  6. a required check is at FAIL                        -> ESCALATE (never APPROVE)
 *  7. risk_bps < approve threshold, confidence >= min    -> APPROVE
 *  8. anything else                                      -> ESCALATE
 *
 * Monotone (0.4.0): adding an answer to an answered check that is worse than
 * its deciding answer, from the same provider group and no more confident,
 * never moves the verdict down APPROVE < ESCALATE < REJECT. Rows 1, 4, 5 and
 * 6 can only start to hold, row 7 can only stop holding, and rows 2 and 3 do
 * not move (the same checks are answered), so an ABSTAIN stays ABSTAIN or
 * becomes a blocker REJECT, and nothing else becomes ABSTAIN. A first answer
 * to an unanswered check is new evidence, not a worse answer: it can move an
 * ABSTAIN anywhere, which is the point of buying it.
 */
export function decide(policy: Policy, findings: readonly Finding[]): Evaluation {
  const d = policy.decision;
  const states = checkStates(policy, findings);
  const { riskBps, coverageBps, meanConfidence, decisionCoverage } = score(states);
  const conflicts = reconcile(policy, states);
  const agreement = Math.max(0, 1 - d.agreement_penalty * conflicts.length);
  const missingRequired = states.filter((s) => s.required && !s.answered);
  const openRisks = states.filter((s) => !s.answered).map((s) => `${s.check} ${s.status}`);

  let confidenceBps = Math.round(decisionCoverage * agreement * meanConfidence * 10_000);
  const primary: Reason[] = [];
  let verdict: Verdict;

  const blockers = blockerHits(policy, states);
  if (blockers.length > 0) {
    verdict = "REJECT";
    // A blocker decides on its own evidence, so it carries that evidence's confidence.
    confidenceBps = Math.round(Math.max(...blockers.map((b) => b.confidence)) * 10_000);
    primary.push(...blockers.map(({ code, check, detail }) => ({ code, check, detail })));
  } else if (d.abstain_on_missing_required && missingRequired.length > 0) {
    verdict = "ABSTAIN";
    confidenceBps = 0;
    for (const s of missingRequired) {
      primary.push({
        code: "MISSING_REQUIRED_CHECK",
        check: s.check,
        detail: `required check ${s.check} is ${s.status}`,
      });
    }
  } else if (coverageBps < Math.round(d.min_coverage * 10_000)) {
    verdict = "ABSTAIN";
    primary.push({
      code: "LOW_COVERAGE",
      detail: `coverage ${coverageBps / 10_000} < ${d.min_coverage}`,
    });
  } else if (riskBps >= d.reject_above_risk_bps) {
    verdict = "REJECT";
    primary.push({
      code: "RISK_ABOVE_REJECT_THRESHOLD",
      detail: `risk_bps=${riskBps} >= ${d.reject_above_risk_bps}`,
    });
  } else if (d.conflict_escalates && conflicts.length > 0) {
    verdict = "ESCALATE";
    for (const c of conflicts) primary.push({ code: c.code, detail: c.detail });
  } else if (d.required_fail_blocks_approve && states.some((s) => s.required && s.status === "FAIL")) {
    verdict = "ESCALATE";
    for (const s of states.filter((x) => x.required && x.status === "FAIL")) {
      primary.push({
        code: "REQUIRED_CHECK_FAILED",
        check: s.check,
        detail: `required check ${s.check} FAIL rules out APPROVE`,
      });
    }
  } else if (riskBps < d.approve_below_risk_bps && confidenceBps >= Math.round(d.min_confidence * 10_000)) {
    verdict = "APPROVE";
  } else {
    verdict = "ESCALATE";
    primary.push(
      riskBps >= d.approve_below_risk_bps
        ? { code: "RISK_IN_REVIEW_BAND", detail: `risk_bps=${riskBps} in [${d.approve_below_risk_bps}, ${d.reject_above_risk_bps})` }
        : { code: "LOW_CONFIDENCE", detail: `confidence ${confidenceBps / 10_000} < ${d.min_confidence}` },
    );
  }

  const decision: Decision = {
    verdict,
    verdictCode: VERDICT_CODES[verdict],
    riskBps,
    confidenceBps,
    coverageBps,
    reasons: [...primary, ...findingReasons(states)],
    openRisks,
    conflicts: conflicts.map((c) => c.code),
  };
  return { decision, states, conflicts };
}

const LEAD: Record<Verdict, string> = {
  APPROVE: "Approved",
  REJECT: "Rejected",
  ESCALATE: "Escalated to an analyst",
  ABSTAIN: "Abstained",
};

/** One templated sentence; built from structured reasons only. */
export function summarise(decision: Decision): string {
  const r = decision.reasons[0];
  const tail = r ? `: ${r.detail}` : `: risk_bps=${decision.riskBps}, all required checks answered`;
  const more = decision.reasons.length > 1 ? ` (+${decision.reasons.length - 1} more)` : "";
  return `${LEAD[decision.verdict]}${tail}${more}.`;
}
