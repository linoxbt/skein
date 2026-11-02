import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decide, evaluate, type Check, type Finding, type FindingStatus, type Severity } from "../src";
import { cex } from "./helpers";

fc.configureGlobal({ numRuns: Number(process.env.FC_RUNS ?? 200) });

const policy = cex();
const CHECKS: Check[] = [...policy.required, ...policy.optional];
const subject = { chainId: 1, token: `0x${"12".repeat(20)}` };

const status = fc.constantFrom<FindingStatus>("PASS", "WARN", "FAIL", "UNKNOWN", "UNAVAILABLE", "ERROR");
const severity = fc.constantFrom<Severity>(0, 1, 2, 3);

const finding = (check: Check) =>
  fc.record({
    check: fc.constant(check),
    status,
    severity,
    confidence: fc.double({ min: 0, max: 1, noNaN: true }),
    sourceGroup: fc.constantFrom("g1", "g2", "g3", "g4"),
    notes: fc.constant([] as string[]),
    evidence: fc.record({ receiptHash: fc.string({ unit: fc.constantFrom(..."0123456789abcdef"), minLength: 64, maxLength: 64 }).map((h) => `0x${h}`) }),
  }) as fc.Arbitrary<Finding>;

/** Up to three findings for each of a random subset of checks, from a small shared pool of provider groups. */
const findings = fc
  .subarray(CHECKS)
  .chain((checks) => fc.tuple(...checks.map((c) => fc.array(finding(c), { minLength: 1, maxLength: 3 }))))
  .map((xs) => xs.flat() as Finding[]);

const answered = (s: FindingStatus) => s === "PASS" || s === "WARN" || s === "FAIL";

describe("engine properties (spec section 14)", () => {
  it("the order of findings never changes the verdict or its hash", () => {
    fc.assert(
      fc.property(
        findings.chain((fs) => fc.tuple(fc.constant(fs), fc.shuffledSubarray(fs, { minLength: fs.length, maxLength: fs.length }))),
        ([fs, shuffled]) => {
          const x = evaluate(policy, subject, fs);
          const y = evaluate(policy, subject, shuffled);
          expect(y.verdictHash).toBe(x.verdictHash);
          expect(y.decision).toEqual(x.decision);
        },
      ),
    );
  });

  it("the same input always gives the same hash", () => {
    fc.assert(
      fc.property(findings, (fs) => {
        expect(evaluate(policy, subject, fs).verdictHash).toBe(evaluate(policy, subject, structuredClone(fs)).verdictHash);
      }),
    );
  });

  // Spec: "adding a PASS never raises risk". Exact for a PASS that joins the
  // check's deciding provider group, or answers an unanswered check from any
  // group. A corroborating PASS from another family can re-balance the
  // independence groups (docs/DECISIONS.md, D8), so that case is not claimed.
  it("adding a PASS never raises risk: to an unanswered check, from any provider group", () => {
    fc.assert(
      fc.property(findings, fc.constantFrom(...CHECKS), fc.constantFrom("g1", "g2", "g3", "g4", "fresh"), fc.double({ min: 0, max: 1, noNaN: true }), (fs, check, sourceGroup, confidence) => {
        const others = fs.filter((x) => x.check !== check || !answered(x.status));
        if (decide(policy, others).states.find((s) => s.check === check)?.answered) return;
        const before = decide(policy, others).decision.riskBps;
        const pass: Finding = { check, status: "PASS", severity: 0, confidence, sourceGroup, notes: [] };
        expect(decide(policy, [...others, pass]).decision.riskBps).toBeLessThanOrEqual(before);
      }),
    );
  });

  it("adding a PASS never raises risk: to an answered check, from its deciding provider group", () => {
    fc.assert(
      fc.property(findings, fc.nat(), fc.double({ min: 0, max: 1, noNaN: true }), (fs, at, confidence) => {
        const { states, decision } = decide(policy, fs);
        const answeredStates = states.filter((s) => s.answered);
        if (answeredStates.length === 0) return;
        const st = answeredStates[at % answeredStates.length]!;
        const pass: Finding = { check: st.check, status: "PASS", severity: 0, confidence, sourceGroup: st.sourceGroup!, notes: [] };
        expect(decide(policy, [...fs, pass]).decision.riskBps).toBeLessThanOrEqual(decision.riskBps);
      }),
    );
  });

  it("removing a required check's evidence never raises confidence", () => {
    fc.assert(
      fc.property(findings, fc.constantFrom(...policy.required), (fs, check) => {
        const before = decide(policy, fs).decision.confidenceBps;
        const after = decide(policy, fs.filter((x) => x.check !== check)).decision.confidenceBps;
        expect(after).toBeLessThanOrEqual(before);
      }),
    );
  });

  // The reviewer's case: dropping a low-confidence duplicate used to raise
  // confidence (it was a mean). A check's confidence is now its best answer's.
  // Dropping a *dissenting* answer lifts a disagreement penalty by design, so
  // only agreeing duplicates are claimed here.
  it("removing an agreeing duplicate answer never raises confidence", () => {
    fc.assert(
      fc.property(findings, fc.nat(), (fs, at) => {
        const { states, decision } = decide(policy, fs);
        const candidates = fs.filter((x) => {
          const st = states.find((s) => s.check === x.check);
          if (!st || !answered(x.status) || x.status !== st.status) return false;
          const same = fs.filter((y) => y.check === x.check && y.status === st.status);
          // Keep the deciding group and the best confidence in place: the drop is a pure duplicate.
          return same.length > 1 && x.sourceGroup !== st.sourceGroup && x.confidence < st.confidence;
        });
        if (candidates.length === 0) return;
        const drop = candidates[at % candidates.length]!;
        expect(decide(policy, fs.filter((x) => x !== drop)).decision.confidenceBps).toBeLessThanOrEqual(decision.confidenceBps);
      }),
    );
  });

  it("a required check at FAIL is never approved", () => {
    fc.assert(
      fc.property(findings, (fs) => {
        const { decision, states } = decide(policy, fs);
        if (states.some((s) => s.required && s.status === "FAIL")) expect(decision.verdict).not.toBe("APPROVE");
      }),
    );
  });

  it("a required check without a real answer always gives ABSTAIN or a blocker REJECT", () => {
    fc.assert(
      fc.property(findings, (fs) => {
        const { decision, states } = decide(policy, fs);
        if (states.some((s) => s.required && !s.answered)) {
          expect(["ABSTAIN", "REJECT"]).toContain(decision.verdict);
          if (decision.verdict === "REJECT") expect(decision.reasons[0]!.code).toMatch(/^BLOCKER_/);
        }
      }),
    );
  });

  it("scores stay in range", () => {
    fc.assert(
      fc.property(findings, (fs) => {
        const { decision } = decide(policy, fs);
        for (const v of [decision.riskBps, decision.confidenceBps, decision.coverageBps]) {
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(10_000);
        }
      }),
    );
  });
});
