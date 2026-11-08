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

  // Risk before rounding to whole bps, as score() computes it. The properties
  // compare this, within 1e-9: two mathematically equal risks can round to bps
  // one apart at a .5 boundary through floating-point error (CI found 687 vs 688).
  const exactRisk = (fs: Finding[]) => {
    const answeredStates = decide(policy, fs).states.filter((s) => s.answered && s.effectiveWeight > 0);
    const eff = answeredStates.reduce((a, s) => a + s.effectiveWeight, 0);
    return eff > 0 ? answeredStates.reduce((a, s) => a + s.effectiveWeight * s.risk, 0) / eff : 0;
  };

  // Spec: "adding a PASS never raises risk". Exact for a PASS that joins the
  // check's deciding provider group, or answers an unanswered check from a new
  // provider group or from a group whose heaviest answered check weighs at
  // least as much (the group's shared weight then stays fixed, and the risky
  // members' shares shrink). A heavier check joining an existing group lifts
  // the group's shared weight, which can raise a WARN member's share more than
  // the larger total offsets (found by this test with 20,000 runs: 136 -> 143
  // bps), and a corroborating PASS from another family can re-balance groups;
  // neither case is claimed (docs/DECISIONS.md, D8 and L28).
  it("adding a PASS never raises risk: to an unanswered check, from a new group or one at least as heavy", () => {
    fc.assert(
      fc.property(findings, fc.constantFrom(...CHECKS), fc.constantFrom("g1", "g2", "g3", "g4", "fresh"), fc.double({ min: 0, max: 1, noNaN: true }), (fs, check, sourceGroup, confidence) => {
        const others = fs.filter((x) => x.check !== check || !answered(x.status));
        const { states } = decide(policy, others);
        if (states.find((s) => s.check === check)?.answered) return;
        const group = states.filter((s) => s.answered && s.weight > 0 && s.sourceGroup === sourceGroup);
        const w = policy.weights[check] ?? 0;
        if (group.length > 0 && Math.max(...group.map((s) => s.weight)) < w) return; // not claimed: see above
        const before = exactRisk(others);
        const pass: Finding = { check, status: "PASS", severity: 0, confidence, sourceGroup, notes: [] };
        expect(exactRisk([...others, pass])).toBeLessThanOrEqual(before + 1e-9);
      }),
    );
  });

  it("regression: CI's 687 -> 688 bps case is rounding, the exact risk does not rise", () => {
    const mk = (check: Check, status: FindingStatus, severity: Severity, sourceGroup: string): Finding => ({ check, status, severity, confidence: 0, sourceGroup, notes: [] });
    const others = [mk("holder_concentration", "PASS", 0, "g4"), mk("liquidity_depth", "PASS", 0, "g2"), mk("holder_count", "WARN", 3, "g1"), mk("code_review", "FAIL", 0, "g1")];
    expect(exactRisk([...others, mk("social_bots", "PASS", 0, "g4")])).toBeLessThanOrEqual(exactRisk(others) + 1e-9);
  });

  it("adding a PASS never raises risk: to an answered check, from its deciding provider group", () => {
    fc.assert(
      fc.property(findings, fc.nat(), fc.double({ min: 0, max: 1, noNaN: true }), (fs, at, confidence) => {
        const { states, decision } = decide(policy, fs);
        const answeredStates = states.filter((s) => s.answered);
        if (answeredStates.length === 0) return;
        const st = answeredStates[at % answeredStates.length]!;
        const pass: Finding = { check: st.check, status: "PASS", severity: 0, confidence, sourceGroup: st.sourceGroup!, notes: [] };
        expect(exactRisk([...fs, pass])).toBeLessThanOrEqual(exactRisk(fs) + 1e-9);
        // And in whole bps, as reported: at most the one-bp rounding step.
        expect(decide(policy, [...fs, pass]).decision.riskBps).toBeLessThanOrEqual(decision.riskBps + 1);
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
