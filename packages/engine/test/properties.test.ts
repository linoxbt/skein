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

/** One finding for each of a random subset of checks. */
const findings = fc
  .subarray(CHECKS)
  .chain((checks) => fc.tuple(...checks.map(finding)))
  .map((xs) => xs as Finding[]);

describe("engine properties", () => {
  it("the order of findings never changes the verdict or its hash", () => {
    fc.assert(
      fc.property(findings, fc.integer(), (fs, seed) => {
        const shuffled = [...fs].sort((a, b) => ((a.check.length * 31 + seed) % 7) - ((b.check.length * 31 + seed) % 7));
        const x = evaluate(policy, subject, fs);
        const y = evaluate(policy, subject, shuffled.reverse());
        expect(y.verdictHash).toBe(x.verdictHash);
        expect(y.decision).toEqual(x.decision);
      }),
    );
  });

  it("the same input always gives the same hash", () => {
    fc.assert(
      fc.property(findings, (fs) => {
        expect(evaluate(policy, subject, fs).verdictHash).toBe(evaluate(policy, subject, structuredClone(fs)).verdictHash);
      }),
    );
  });

  it("adding an independent PASS for an unanswered check never raises risk", () => {
    fc.assert(
      fc.property(findings, fc.constantFrom(...CHECKS), (fs, check) => {
        const others = fs.filter((x) => x.check !== check);
        const before = decide(policy, others).decision.riskBps;
        const pass: Finding = { check, status: "PASS", severity: 0, confidence: 1, sourceGroup: "independent", notes: [] };
        expect(decide(policy, [...others, pass]).decision.riskBps).toBeLessThanOrEqual(before);
      }),
    );
  });

  it("adding a PASS when every source is distinct never raises risk", () => {
    fc.assert(
      fc.property(findings, fc.constantFrom(...CHECKS), (fs, check) => {
        const distinct = fs.filter((x) => x.check !== check).map((x) => ({ ...x, sourceGroup: `own-${x.check}` }));
        const before = decide(policy, distinct).decision.riskBps;
        const pass: Finding = { check, status: "PASS", severity: 0, confidence: 1, sourceGroup: `own-${check}`, notes: [] };
        expect(decide(policy, [...distinct, pass]).decision.riskBps).toBeLessThanOrEqual(before);
      }),
    );
  });

  it("removing a required finding never raises confidence", () => {
    fc.assert(
      fc.property(findings, fc.constantFrom(...policy.required), (fs, check) => {
        const before = decide(policy, fs).decision.confidenceBps;
        const after = decide(policy, fs.filter((x) => x.check !== check)).decision.confidenceBps;
        expect(after).toBeLessThanOrEqual(before);
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
