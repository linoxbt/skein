import { decide, policyChecks, type Finding, type Policy, type Verdict } from "@skein/engine";
import type { Case } from "./cases";

/** What one system answered for one case, with what it cost and how long it took. */
export interface Answer {
  caseId: string;
  verdict: Verdict;
  costUusdc: number;
  latencyMs: number;
  coverage: number;
}

/** A stored run of one case: the CLI's verdict record (pipeline output). */
export interface Run {
  caseId: string;
  policy: Policy;
  findings: Finding[];
  verdict: Verdict;
  coverageBps: number;
  purchases: { check: string; amountUusdc: number; durationMs: number }[];
  wallMs: number;
}

/**
 * The spec's baselines (section 14), recomputed from the same paid findings,
 * so they cost nothing extra and differ from Skein only in the rule:
 *  - single_best: the contract audit alone, with its own pass/fail;
 *  - weighted_avg: the same inputs, no blockers, no contradiction rules, no abstain;
 *  - cheapest: required checks only, through Skein's own rules.
 * The fourth baseline (direct APIs, outside Telegraph) needs its own data
 * source and is not computed here.
 */
export const SYSTEMS = ["skein", "single_best", "weighted_avg", "cheapest"] as const;
export type System = (typeof SYSTEMS)[number];

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function answerFor(system: System, run: Run): Answer {
  const base = { caseId: run.caseId, latencyMs: run.wallMs };
  const all = sum(run.purchases.map((p) => p.amountUusdc));
  switch (system) {
    case "skein":
      return { ...base, verdict: run.verdict, costUusdc: all, coverage: run.coverageBps / 10_000 };
    case "single_best": {
      const audit = run.findings.filter((f) => f.check === "contract_audit");
      const worst = audit.find((f) => f.status === "FAIL") ?? audit.find((f) => f.status === "WARN") ?? audit.find((f) => f.status === "PASS");
      const verdict: Verdict = !worst ? "ABSTAIN" : worst.status === "FAIL" ? "REJECT" : worst.status === "WARN" ? "ESCALATE" : "APPROVE";
      const cost = sum(run.purchases.filter((p) => p.check === "contract_audit").map((p) => p.amountUusdc));
      return { ...base, verdict, costUusdc: cost, coverage: worst ? 1 : 0 };
    }
    case "weighted_avg": {
      const policy: Policy = {
        ...run.policy,
        blockers: [],
        conflicts: [],
        decision: { ...run.policy.decision, abstain_on_missing_required: false, required_fail_blocks_approve: false, conflict_escalates: false, min_coverage: 0, min_confidence: 0 },
      };
      const { decision } = decide(policy, run.findings);
      // No abstain: below the approve threshold approves, at or above reject rejects, the rest escalates.
      const verdict: Verdict = decision.riskBps < policy.decision.approve_below_risk_bps ? "APPROVE" : decision.riskBps >= policy.decision.reject_above_risk_bps ? "REJECT" : "ESCALATE";
      return { ...base, verdict, costUusdc: all, coverage: decision.coverageBps / 10_000 };
    }
    case "cheapest": {
      const required = new Set(run.policy.required);
      const policy: Policy = { ...run.policy, optional: [], weights: Object.fromEntries(Object.entries(run.policy.weights).filter(([c]) => required.has(c as never))) };
      const { decision } = decide(policy, run.findings.filter((f) => required.has(f.check)));
      const cost = sum(run.purchases.filter((p) => required.has(p.check as never)).map((p) => p.amountUusdc));
      return { ...base, verdict: decision.verdict, costUusdc: cost, coverage: decision.coverageBps / 10_000 };
    }
  }
}

export interface Metrics {
  n: number;
  /** Cases labelled bad, and how many of them were answered APPROVE and REJECT (for exact intervals). */
  bad: number;
  badApproved: number;
  badRejected: number;
  /** Of every case, the share answered APPROVE. A false-APPROVE rate of 0 means little when this is 0 too. */
  approveRate: number;
  /** Of tokens labelled good, the share answered APPROVE (null when the sample has no good tokens). */
  goodApproveRate: number | null;
  /** Of tokens labelled bad, the share answered APPROVE: the number that matters most. */
  falseApproveRate: number | null;
  rejectPrecision: number | null;
  rejectRecall: number | null;
  escalateRate: number;
  abstainRate: number;
  costPerVerdictUsdc: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  meanCoverage: number;
}

const ratio = (num: number, den: number) => (den === 0 ? null : num / den);
function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
}

export function metrics(cases: readonly Case[], answers: readonly Answer[]): Metrics {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const rows = answers.map((a) => ({ a, label: byId.get(a.caseId)!.label }));
  const bad = rows.filter((r) => r.label === "bad");
  const good = rows.filter((r) => r.label === "good");
  const rejected = rows.filter((r) => r.a.verdict === "REJECT");
  return {
    n: rows.length,
    bad: bad.length,
    badApproved: bad.filter((r) => r.a.verdict === "APPROVE").length,
    badRejected: bad.filter((r) => r.a.verdict === "REJECT").length,
    approveRate: ratio(rows.filter((r) => r.a.verdict === "APPROVE").length, rows.length) ?? 0,
    goodApproveRate: ratio(good.filter((r) => r.a.verdict === "APPROVE").length, good.length),
    falseApproveRate: ratio(bad.filter((r) => r.a.verdict === "APPROVE").length, bad.length),
    rejectPrecision: ratio(rejected.filter((r) => r.label === "bad").length, rejected.length),
    rejectRecall: ratio(bad.filter((r) => r.a.verdict === "REJECT").length, bad.length),
    escalateRate: ratio(rows.filter((r) => r.a.verdict === "ESCALATE").length, rows.length) ?? 0,
    abstainRate: ratio(rows.filter((r) => r.a.verdict === "ABSTAIN").length, rows.length) ?? 0,
    costPerVerdictUsdc: rows.length ? sum(rows.map((r) => r.a.costUusdc)) / rows.length / 1e6 : 0,
    p50LatencyMs: quantile(rows.map((r) => r.a.latencyMs), 0.5),
    p95LatencyMs: quantile(rows.map((r) => r.a.latencyMs), 0.95),
    meanCoverage: rows.length ? sum(rows.map((r) => r.a.coverage)) / rows.length : 0,
  };
}

/**
 * 95% Wilson score interval for k successes in n trials. Unlike a percentile
 * bootstrap it stays honest at the edges: 0 of 7 gives 0%-35.4%, not 0%-0%.
 */
export function wilson(k: number, n: number, z = 1.959964): [number, number] | null {
  if (n === 0) return null;
  const p = k / n;
  const z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z / (1 + z2 / n)) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** A seeded generator, so a report's intervals are reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** 95% percentile-bootstrap interval of a metric over cases (spec: say plainly the sample is small). */
export function bootstrap(cases: readonly Case[], answers: readonly Answer[], pick: (m: Metrics) => number | null, resamples = 2000, seed = 7): [number, number] | null {
  if (answers.length === 0) return null;
  const r = rng(seed);
  const values: number[] = [];
  for (let i = 0; i < resamples; i++) {
    const sample = answers.map(() => answers[Math.floor(r() * answers.length)]!);
    const v = pick(metrics(cases, sample));
    if (v !== null) values.push(v);
  }
  if (values.length === 0) return null;
  return [quantile(values, 0.025), quantile(values, 0.975)];
}

export function checksOf(policy: Policy): string[] {
  return policyChecks(policy);
}
