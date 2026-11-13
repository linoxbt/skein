import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decide, evaluate, type Check, type Finding, type FindingStatus, type Severity } from "../src";
import { decide as decide030 } from "../src/frozen/v0_3_0/decide";
import { cex, loadPolicy } from "./helpers";

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

/**
 * Engine 0.4.0 (audit H7): adding a strictly worse answer never lowers the
 * verdict on APPROVE < ESCALATE < REJECT. "Worse" is the engine's own order:
 * a higher status, or the same status at a higher severity, than the check's
 * deciding answer. The new answer joins that answer's provider group and is no
 * more confident than the check already is: a more confident answer, or one
 * from another family that re-balances the independence groups, is more (or
 * different) evidence, not worse evidence (D8). ABSTAIN is off the scale: a
 * worse answer leaves the answered checks as they were, so an ABSTAIN stays
 * ABSTAIN or becomes a blocker REJECT, and no other verdict becomes ABSTAIN.
 */
describe("monotonicity (engine 0.4.0)", () => {
  const SEVERITY: Record<string, number> = { APPROVE: 0, ESCALATE: 1, REJECT: 2 };
  const RANK: Record<string, number> = { PASS: 0, WARN: 1, FAIL: 2 };
  const worseThan = (s: { status: string; severity: number }) =>
    (["PASS", "WARN", "FAIL"] as const).flatMap((st) => ([0, 1, 2, 3] as const).filter((sev) => RANK[st]! > RANK[s.status]! || (st === s.status && sev > s.severity)).map((sev) => ({ status: st, severity: sev })));

  const scenario = (p: ReturnType<typeof loadPolicy>) => {
    const checks: Check[] = [...p.required, ...p.optional];
    const pool = fc
      .subarray(checks)
      .chain((cs) => fc.tuple(...cs.map((c) => fc.array(finding(c), { minLength: 1, maxLength: 3 }))))
      .map((xs) => xs.flat() as Finding[]);
    return fc.tuple(pool, fc.nat(), fc.nat(), fc.double({ min: 0, max: 1, noNaN: true }));
  };

  /**
   * Runs one case; false where the property is broken. "add" puts the worse
   * answer beside the check's deciding one (no more confident than the check);
   * "replace" puts it in the deciding answer's place, at that answer's
   * confidence: one miner's answer turning worse, as in the audit's repro.
   */
  const holds = (how: "add" | "replace", decideFn: typeof decide, p: ReturnType<typeof loadPolicy>, [fs, at, pickWorse, conf]: [Finding[], number, number, number]): boolean => {
    const { states, decision: before } = decideFn(p, fs);
    const answeredStates = states.filter((s) => s.answered);
    if (answeredStates.length === 0) return true;
    const st = answeredStates[at % answeredStates.length]!;
    const options = worseThan(st);
    if (options.length === 0) return true;
    const w = options[pickWorse % options.length]!;
    const deciding = fs.find((x) => x.check === st.check && x.status === st.status && x.severity === st.severity && x.sourceGroup === st.sourceGroup)!;
    const x: Finding = { check: st.check, status: w.status, severity: w.severity as Severity, confidence: how === "add" ? conf * st.confidence : deciding.confidence, sourceGroup: st.sourceGroup!, notes: [] };
    const next = how === "add" ? [...fs, x] : [...fs.filter((y) => y !== deciding), x];
    const after = decideFn(p, next).decision;
    if (before.verdict === "ABSTAIN") return after.verdict === "ABSTAIN" || after.verdict === "REJECT";
    return after.verdict !== "ABSTAIN" && SEVERITY[after.verdict]! >= SEVERITY[before.verdict]!;
  };

  for (const ref of ["cex-standard@0.1.0", "dex-list@0.2.0", "agent-pretrade@0.3.0"]) {
    for (const how of ["add", "replace"] as const) {
      it(`${how === "add" ? "adding" : "turning an answer into"} a strictly worse finding never lowers the verdict (${ref})`, () => {
        const p = loadPolicy(ref);
        fc.assert(fc.property(scenario(p), (c) => holds(how, decide, p, c)));
      });
    }
  }

  it("engine 0.3.0 broke it (frozen as it was): a worse audit answer could soften the verdict", () => {
    const p = loadPolicy("agent-pretrade@0.3.0");
    expect(fc.check(fc.property(scenario(p), (c) => holds("replace", decide030, p, c)), { numRuns: 5000, seed: 7 }).failed).toBe(true);
  });
});
