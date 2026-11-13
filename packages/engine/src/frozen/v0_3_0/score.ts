// FROZEN: engine 0.3.0, kept byte-for-byte in behaviour so verdicts it sealed replay
// exactly. Never edit; a change belongs in a new engine version.
import { policyChecks, type Policy, type Threshold } from "../../policy";
import { ANSWERED, type Check, type Finding, type FindingStatus, type Severity } from "../../types";

const RANK: Record<"PASS" | "WARN" | "FAIL", number> = { PASS: 0, WARN: 1, FAIL: 2 };
/** Which non-answer to report when a check has several (worst first). */
const MISSING_ORDER: FindingStatus[] = ["ERROR", "UNAVAILABLE", "UNKNOWN"];

export interface ThresholdResult {
  status: "PASS" | "WARN" | "FAIL";
  severity: Severity;
  detail: string;
}

export function applyThreshold(t: Threshold, value: number): ThresholdResult {
  const higherIsWorse = t.fail > t.warn;
  const worse = (limit: number) => (higherIsWorse ? value > limit : value < limit);
  const op = higherIsWorse ? ">" : "<";
  if (worse(t.fail)) return { status: "FAIL", severity: 2, detail: `${t.field}=${value} ${op} ${t.fail}` };
  if (worse(t.warn)) return { status: "WARN", severity: 1, detail: `${t.field}=${value} ${op} ${t.warn}` };
  return { status: "PASS", severity: 0, detail: `${t.field}=${value}` };
}

/** A finding after the policy's threshold has been applied to it. */
export interface ScoredFinding extends Finding {
  thresholdDetail?: string;
}

/**
 * Applies the policy threshold to a finding that reports the threshold's
 * metric. The stricter of the adapter's status and the threshold's wins, so a
 * miner can never talk its way past the policy.
 */
export function normaliseFinding(policy: Policy, f: Finding): ScoredFinding {
  const confidence = Number.isFinite(f.confidence) ? Math.min(1, Math.max(0, f.confidence)) : 0;
  const out: ScoredFinding = { ...f, confidence };
  const t = policy.thresholds[f.check];
  if (!t || f.metric !== t.field || typeof f.value !== "number" || !Number.isFinite(f.value)) return out;
  // Only an answer is graded: a non-answer stays a non-answer even if it carries a number.
  if (!ANSWERED.has(f.status)) return out;
  const r = applyThreshold(t, f.value);
  const own = f.status as "PASS" | "WARN" | "FAIL";
  out.status = RANK[r.status] >= RANK[own] ? r.status : own;
  out.severity = Math.max(f.severity, r.severity) as Severity;
  out.thresholdDetail = r.detail;
  return out;
}

export interface CheckState {
  check: Check;
  required: boolean;
  weight: number;
  answered: boolean;
  /** Worst answered status, or the reported non-answer. */
  status: FindingStatus;
  severity: Severity;
  /** 0..1 risk of the worst answered finding. */
  risk: number;
  /** The best answered finding's confidence: more answers never make a check less certain. */
  confidence: number;
  /** The provider family of the finding that sets the check's risk. */
  sourceGroup?: string;
  effectiveWeight: number;
  /** Answered findings for this check include both PASS and FAIL. */
  disagreement: boolean;
  findings: ScoredFinding[];
}

function findingRisk(policy: Policy, f: ScoredFinding): number {
  if (!ANSWERED.has(f.status)) return 0;
  const base = policy.scoring.status_risk[f.status as "PASS" | "WARN" | "FAIL"];
  return base * policy.scoring.severity_multiplier[f.severity];
}

export function checkStates(policy: Policy, findings: readonly Finding[]): CheckState[] {
  const required = new Set(policy.required);
  const states = policyChecks(policy).map((check): CheckState => {
    const all = findings.filter((f) => f.check === check).map((f) => normaliseFinding(policy, f));
    const answered = all.filter((f) => ANSWERED.has(f.status));
    const weight = policy.weights[check] ?? 0;
    if (answered.length === 0) {
      const status = MISSING_ORDER.find((s) => all.some((f) => f.status === s)) ?? "UNAVAILABLE";
      return {
        check, required: required.has(check), weight, answered: false, status, severity: 0,
        risk: 0, confidence: 0, effectiveWeight: 0, disagreement: false, findings: all,
      };
    }
    // The deciding answer: worst status, then highest risk, then highest
    // severity, then the lowest provider group. A total order, so the input's
    // order can never change which answer decides (or the verdict hash).
    const key = (f: ScoredFinding): [number, number, number, string] => [RANK[f.status as "PASS"], findingRisk(policy, f), f.severity, f.sourceGroup];
    const worse = (a: ScoredFinding, b: ScoredFinding) => {
      const [x, y] = [key(a), key(b)];
      return x[0] !== y[0] ? x[0] > y[0] : x[1] !== y[1] ? x[1] > y[1] : x[2] !== y[2] ? x[2] > y[2] : x[3] < y[3];
    };
    let worst = answered[0]!;
    for (const f of answered.slice(1)) if (worse(f, worst)) worst = f;
    const worstRisk = findingRisk(policy, worst);
    const statuses = new Set(answered.map((f) => f.status));
    return {
      check,
      required: required.has(check),
      weight,
      answered: true,
      status: worst.status,
      severity: worst.severity,
      risk: worstRisk,
      confidence: Math.max(...answered.map((f) => f.confidence)),
      // The worst finding decides the check's risk, so its provider decides the
      // check's independence group: a further PASS can never move the check.
      sourceGroup: worst.sourceGroup,
      effectiveWeight: 0,
      disagreement: statuses.has("PASS") && statuses.has("FAIL"),
      findings: all,
    };
  });
  applyIndependence(states);
  return states;
}

/**
 * Independence groups: answered checks whose findings come from the same
 * upstream provider family share one weight (the largest of theirs), split in
 * proportion to their own weights. Five answers from one API are one opinion.
 */
function applyIndependence(states: CheckState[]): void {
  const groups = new Map<string, CheckState[]>();
  for (const s of states) {
    if (!s.answered || s.weight <= 0) continue;
    const g = groups.get(s.sourceGroup!) ?? [];
    g.push(s);
    groups.set(s.sourceGroup!, g);
  }
  for (const members of groups.values()) {
    const sum = members.reduce((a, s) => a + s.weight, 0);
    const max = Math.max(...members.map((s) => s.weight));
    for (const s of members) s.effectiveWeight = (s.weight * max) / sum;
  }
}

export interface Score {
  riskBps: number;
  coverageBps: number;
  /** Weighted mean confidence of answered checks, 0..1. */
  meanConfidence: number;
  /**
   * The share of the evidence the decision rests on that came back: required
   * checks always count, optional ones only when they answered. An optional
   * miner that fails to answer is neutral (engine 0.3.0), so it cannot flip a
   * verdict between APPROVE and ESCALATE run to run.
   */
  decisionCoverage: number;
}

export function score(states: readonly CheckState[]): Score {
  const answered = states.filter((s) => s.answered && s.effectiveWeight > 0);
  const eff = answered.reduce((a, s) => a + s.effectiveWeight, 0);
  const risk = eff > 0 ? answered.reduce((a, s) => a + s.effectiveWeight * s.risk, 0) / eff : 0;
  const meanConfidence =
    eff > 0 ? answered.reduce((a, s) => a + s.effectiveWeight * s.confidence, 0) / eff : 0;
  const total = states.reduce((a, s) => a + s.weight, 0);
  const covered = states.filter((s) => s.answered).reduce((a, s) => a + s.weight, 0);
  const coverage = total > 0 ? covered / total : 1;
  const counted = states.filter((s) => s.required || s.answered).reduce((a, s) => a + s.weight, 0);
  return {
    riskBps: Math.round(risk * 10_000),
    coverageBps: Math.round(coverage * 10_000),
    meanConfidence,
    decisionCoverage: counted > 0 ? covered / counted : 1,
  };
}
