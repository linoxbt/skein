import { getPolicy } from "@skein/policies";
import { describe, expect, it } from "vitest";
import { casesFileSchema, type Case } from "../src/cases";
import { answerFor, bootstrap, metrics, type Run } from "../src/metrics";

// Synthetic: these cases and findings exercise the arithmetic; they are not evaluation data.
const policy = getPolicy("dex-list@0.1.0").policy;
const f = (check: string, status: "PASS" | "WARN" | "FAIL", extra = {}) => ({ check, status, severity: status === "FAIL" ? 3 : 0, confidence: 0.8, sourceGroup: `g-${check}`, notes: [], ...extra }) as never;
const clean = [f("contract_audit", "PASS"), f("sanctions", "PASS"), f("liquidity_depth", "PASS", { metric: "liquidity_usd", value: 5e6 }), f("holder_count", "PASS", { metric: "holders_count", value: 9e4 })];
const honeypot = [f("contract_audit", "FAIL"), ...clean.slice(1)];
const washy = [...clean, f("wash_trading", "FAIL", { metric: "wash_volume_pct", value: 80 })];
const run = (caseId: string, findings: never[], verdict: Run["verdict"]): Run => ({
  caseId, policy, findings, verdict, coverageBps: 9000, wallMs: 4000,
  purchases: findings.map((x: { check: string }) => ({ check: x.check, amountUusdc: 10_000, durationMs: 900 })),
});
const c = (id: string, label: Case["label"]): Case => ({ id, chainId: 8453, token: `0x${"1".repeat(40)}`, label, basis: "current_state", labelSourceUrl: "https://example.com/source", asOfBlock: 1, split: "holdout", context: {} });

describe("eval harness", () => {
  const cases = [c("good-1", "good"), c("bad-1", "bad"), c("bad-2", "bad")];
  const runs = [run("good-1", clean, "APPROVE"), run("bad-1", honeypot, "REJECT"), run("bad-2", washy, "ESCALATE")];

  it("scores Skein and recomputes the baselines from the same findings", () => {
    const skein = metrics(cases, runs.map((r) => answerFor("skein", r)));
    expect(skein).toMatchObject({ n: 3, falseApproveRate: 0, rejectPrecision: 1, rejectRecall: 0.5 });
    // A single audit passes the wash-traded token: the false APPROVE Skein exists to prevent.
    const single = metrics(cases, runs.map((r) => answerFor("single_best", r)));
    expect(single.falseApproveRate).toBe(0.5);
    expect(answerFor("cheapest", runs[2]!).costUusdc).toBeLessThan(answerFor("skein", runs[2]!).costUusdc);
  });

  it("gives a reproducible bootstrap interval", () => {
    const answers = runs.map((r) => answerFor("skein", r));
    expect(bootstrap(cases, answers, (m) => m.rejectRecall)).toEqual(bootstrap(cases, answers, (m) => m.rejectRecall));
  });

  it("refuses cases without a public https source or with duplicate ids", () => {
    expect(() => casesFileSchema.parse({ kind: "labelled", cases: [{ ...c("x-1", "bad"), labelSourceUrl: "http://x" }] })).toThrow();
    expect(() => casesFileSchema.parse({ kind: "labelled", cases: [c("x-1", "bad"), c("x-1", "good")] })).toThrow(/duplicate/);
  });
});
