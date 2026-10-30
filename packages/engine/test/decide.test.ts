import { describe, expect, it } from "vitest";
import { applyThreshold, decide, VERDICT_CODES } from "../src";
import { cex, cleanCex, customPolicy, f } from "./helpers";

const codes = (r: { reasons: { code: string }[] }) => r.reasons.map((x) => x.code);

describe("decision table (cex-standard)", () => {
  it("all checks PASS -> APPROVE with full coverage", () => {
    const { decision } = decide(cex(), cleanCex());
    expect(decision.verdict).toBe("APPROVE");
    expect(decision.riskBps).toBe(0);
    expect(decision.coverageBps).toBe(10_000);
    expect(decision.confidenceBps).toBe(8000);
    expect(decision.openRisks).toEqual([]);
  });

  it("row 1: sanctions FAIL is a blocker -> REJECT", () => {
    const { decision } = decide(cex(), cleanCex({ sanctions: f("sanctions", "FAIL", { severity: 3 }) }));
    expect(decision.verdict).toBe("REJECT");
    expect(codes(decision)[0]).toBe("BLOCKER_SANCTIONS_FAIL");
  });

  it("row 1: a critical audit FAIL is a blocker, a high one is not", () => {
    const critical = decide(cex(), cleanCex({ contract_audit: f("contract_audit", "FAIL", { severity: 3 }) }));
    expect(critical.decision.verdict).toBe("REJECT");
    expect(codes(critical.decision)[0]).toBe("BLOCKER_CONTRACT_AUDIT_FAIL");
    const high = decide(cex(), cleanCex({ contract_audit: f("contract_audit", "FAIL", { severity: 2 }) }));
    expect(codes(high.decision)).not.toContain("BLOCKER_CONTRACT_AUDIT_FAIL");
  });

  it("blockers win even when other required checks are missing", () => {
    const { decision } = decide(
      cex(),
      cleanCex({ sanctions: f("sanctions", "FAIL", { severity: 3 }), contract_audit: f("contract_audit", "ERROR") }),
    );
    expect(decision.verdict).toBe("REJECT");
  });

  it("row 4 before row 5: high risk with a conflict -> REJECT, conflict still reported", () => {
    const { decision } = decide(
      cex(),
      cleanCex({
        wash_trading: f("wash_trading", "FAIL", { metric: "wash_volume_pct", value: 80 }),
        holder_concentration: f("holder_concentration", "FAIL", { metric: "top10_holders_pct", value: 0.9 }),
        liquidity_depth: f("liquidity_depth", "FAIL", { metric: "liquidity_usd", value: 500_000 }),
        social_bots: f("social_bots", "FAIL"),
        code_review: f("code_review", "FAIL"),
        holder_count: f("holder_count", "FAIL", { metric: "holders_count", value: 20 }),
      }),
    );
    expect(decision.riskBps).toBeGreaterThanOrEqual(6500);
    expect(decision.verdict).toBe("REJECT");
    expect(codes(decision)[0]).toBe("RISK_ABOVE_REJECT_THRESHOLD");
    expect(decision.conflicts).toContain("MARKET_INTEGRITY_CONFLICT");
  });

  it("row 5: audit PASS but wash trading FAIL -> ESCALATE MARKET_INTEGRITY_CONFLICT", () => {
    const { decision } = decide(
      cex(),
      cleanCex({ wash_trading: f("wash_trading", "FAIL", { metric: "wash_volume_pct", value: 70 }) }),
    );
    // A plain weighted average would have approved this token.
    expect(decision.riskBps).toBeLessThan(2500);
    expect(decision.verdict).toBe("ESCALATE");
    expect(codes(decision)[0]).toBe("MARKET_INTEGRITY_CONFLICT");
  });

  it("row 5: deep liquidity held by insiders -> ESCALATE LIQUIDITY_CONTROLLED_BY_INSIDERS", () => {
    const { decision } = decide(
      cex(),
      cleanCex({ holder_concentration: f("holder_concentration", "PASS", { metric: "top10_holders_pct", value: 0.75 }) }),
    );
    expect(decision.verdict).toBe("ESCALATE");
    expect(decision.conflicts).toEqual(["LIQUIDITY_CONTROLLED_BY_INSIDERS"]);
  });

  it("row 5: two answers for one check disagree -> SOURCE_DISAGREEMENT", () => {
    const findings = [
      ...cleanCex(),
      f("social_bots", "FAIL", { sourceGroup: "other-provider" }),
    ];
    const { decision } = decide(cex(), findings);
    expect(decision.verdict).toBe("ESCALATE");
    expect(decision.conflicts).toEqual(["SOURCE_DISAGREEMENT"]);
  });

  it("row 8: risk in the review band -> ESCALATE RISK_IN_REVIEW_BAND", () => {
    const { decision } = decide(
      cex(),
      cleanCex({
        contract_audit: f("contract_audit", "WARN", { severity: 2 }),
        wash_trading: f("wash_trading", "WARN", { metric: "wash_volume_pct", value: 30 }),
        social_bots: f("social_bots", "FAIL"),
      }),
    );
    expect(decision.riskBps).toBeGreaterThanOrEqual(2500);
    expect(decision.riskBps).toBeLessThan(6500);
    expect(decision.verdict).toBe("ESCALATE");
    expect(codes(decision)[0]).toBe("RISK_IN_REVIEW_BAND");
  });

  it("row 8: low confidence -> ESCALATE LOW_CONFIDENCE", () => {
    const low = cleanCex().map((x) => ({ ...x, confidence: 0.3 }));
    const { decision } = decide(cex(), low);
    expect(decision.verdict).toBe("ESCALATE");
    expect(codes(decision)[0]).toBe("LOW_CONFIDENCE");
  });

  it("row 3: coverage below min_coverage -> ABSTAIN LOW_COVERAGE", () => {
    const p = customPolicy({
      required: ["contract_audit"],
      optional: ["social_bots"],
      weights: { contract_audit: 0.5, social_bots: 0.5 },
    });
    const { decision } = decide(p, [f("contract_audit", "PASS"), f("social_bots", "ERROR")]);
    expect(decision.verdict).toBe("ABSTAIN");
    expect(codes(decision)[0]).toBe("LOW_COVERAGE");
  });
});

describe("fixes to the spec's scoring (docs/DECISIONS.md)", () => {
  it("D1: a sanctions timeout forces ABSTAIN even though sanctions has no weight", () => {
    const { decision } = decide(cex(), cleanCex({ sanctions: f("sanctions", "ERROR") }));
    expect(decision.coverageBps).toBe(10_000); // the old coverage rule would not have noticed
    expect(decision.verdict).toBe("ABSTAIN");
    expect(decision.reasons[0]).toMatchObject({ code: "MISSING_REQUIRED_CHECK", check: "sanctions" });
    expect(decision.openRisks).toEqual(["sanctions ERROR"]);
    expect(decision.confidenceBps).toBe(0);
  });

  it("D2: a missing required check forces ABSTAIN even when coverage clears the minimum", () => {
    const { decision } = decide(cex(), cleanCex({ liquidity_depth: null }));
    expect(decision.coverageBps).toBeGreaterThanOrEqual(8000);
    expect(decision.verdict).toBe("ABSTAIN");
    expect(decision.reasons[0]).toMatchObject({ code: "MISSING_REQUIRED_CHECK", check: "liquidity_depth" });
  });

  it("D3: a required FAIL can never be approved, even at low risk", () => {
    const { decision } = decide(
      cex(),
      cleanCex({ liquidity_depth: f("liquidity_depth", "PASS", { metric: "liquidity_usd", value: 1_000_000 }) }),
    );
    expect(decision.riskBps).toBeLessThan(2500);
    expect(decision.verdict).toBe("ESCALATE");
    expect(decision.reasons[0]).toMatchObject({ code: "REQUIRED_CHECK_FAILED", check: "liquidity_depth" });
  });

  it("D3: severity scaling is explicit in the policy", () => {
    const p = cex();
    expect(p.scoring.severity_multiplier).toEqual([0.6, 0.8, 1, 1]);
    const { decision } = decide(p, cleanCex({ contract_audit: f("contract_audit", "FAIL", { severity: 1 }) }));
    // 1.0 (FAIL) x 0.8 (severity 1) x 0.30 / 1.05 total weight
    expect(decision.riskBps).toBe(Math.round(((1 * 0.8 * 0.3) / 1.05) * 10_000));
    expect(decision.verdict).toBe("ESCALATE");
  });

  it("D8: the spec's example verdict now has a consistent coverage", () => {
    const { decision } = decide(
      cex(),
      cleanCex({
        holder_concentration: f("holder_concentration", "PASS", { metric: "top10_holders_pct", value: 0.61 }),
        wash_trading: f("wash_trading", "FAIL", { metric: "wash_volume_pct", value: 65 }),
        liquidity_depth: f("liquidity_depth", "WARN", { metric: "liquidity_usd", value: 4_000_000 }),
        code_review: f("code_review", "UNAVAILABLE"),
      }),
    );
    expect(decision.verdict).toBe("ESCALATE");
    expect(decision.openRisks).toEqual(["code_review UNAVAILABLE"]);
    expect(decision.coverageBps).toBe(Math.round((1.0 / 1.05) * 10_000)); // 9524, not 0.92
    expect(codes(decision)).toEqual(
      expect.arrayContaining(["MARKET_INTEGRITY_CONFLICT", "HOLDER_CONCENTRATION_FAIL", "WASH_TRADING_FAIL"]),
    );
    expect(decision.reasons.find((r) => r.code === "HOLDER_CONCENTRATION_FAIL")?.detail).toBe(
      "top10_holders_pct=0.61 > 0.6",
    );
  });
});

describe("thresholds", () => {
  const holders = { warn: 0.4, fail: 0.6, field: "top10_holders_pct" };
  const liq = { warn: 10_000_000, fail: 2_000_000, field: "liquidity_usd" };

  it("higher-is-worse edges are strict", () => {
    expect(applyThreshold(holders, 0.4).status).toBe("PASS");
    expect(applyThreshold(holders, 0.41).status).toBe("WARN");
    expect(applyThreshold(holders, 0.6).status).toBe("WARN");
    expect(applyThreshold(holders, 0.6000001).status).toBe("FAIL");
  });

  it("lower-is-worse edges are strict", () => {
    expect(applyThreshold(liq, 10_000_000).status).toBe("PASS");
    expect(applyThreshold(liq, 9_999_999).status).toBe("WARN");
    expect(applyThreshold(liq, 2_000_000).status).toBe("WARN");
    expect(applyThreshold(liq, 1_999_999).status).toBe("FAIL");
  });

  it("the stricter of miner status and threshold wins", () => {
    const { states } = decide(
      cex(),
      cleanCex({ liquidity_depth: f("liquidity_depth", "FAIL", { metric: "liquidity_usd", value: 50_000_000 }) }),
    );
    expect(states.find((s) => s.check === "liquidity_depth")?.status).toBe("FAIL");
  });

  it("a threshold only applies to its own metric", () => {
    const { states } = decide(
      cex(),
      cleanCex({ liquidity_depth: f("liquidity_depth", "PASS", { metric: "depth_2pct_usd", value: 1 }) }),
    );
    expect(states.find((s) => s.check === "liquidity_depth")?.status).toBe("PASS");
  });
});

describe("independence groups", () => {
  it("checks from one provider family share the largest weight between them", () => {
    const p = customPolicy({
      required: ["contract_audit", "wash_trading", "liquidity_depth"],
      weights: { contract_audit: 0.5, wash_trading: 0.25, liquidity_depth: 0.25 },
      decision: { approve_below_risk_bps: 2500, reject_above_risk_bps: 9000, min_coverage: 0.5, min_confidence: 0 },
    });
    const independent = decide(p, [
      f("contract_audit", "PASS", { sourceGroup: "a" }),
      f("wash_trading", "FAIL", { sourceGroup: "b" }),
      f("liquidity_depth", "FAIL", { sourceGroup: "c" }),
    ]);
    const shared = decide(p, [
      f("contract_audit", "PASS", { sourceGroup: "a" }),
      f("wash_trading", "FAIL", { sourceGroup: "b" }),
      f("liquidity_depth", "FAIL", { sourceGroup: "b" }),
    ]);
    expect(independent.decision.riskBps).toBe(5000); // 0.5 of 1.0
    expect(shared.decision.riskBps).toBe(3333); // one opinion of 0.25 against 0.5
    expect(shared.states.find((s) => s.check === "wash_trading")?.effectiveWeight).toBeCloseTo(0.125);
  });
});

describe("verdict codes", () => {
  it("zero means ABSTAIN so a default on-chain value never reads as APPROVE", () => {
    expect(VERDICT_CODES).toEqual({ ABSTAIN: 0, APPROVE: 1, ESCALATE: 2, REJECT: 3 });
  });
});
