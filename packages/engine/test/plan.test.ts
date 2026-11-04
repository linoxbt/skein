import { describe, expect, it } from "vitest";
import { intentFamily, isSelfRouting, plan, type PlanInput } from "../src";
import { cex, loadPolicy } from "./helpers";

const INTENTS = {
  contract_audit: "SMART_CONTRACT_AUDIT_GENERAL",
  sanctions: "SANCTIONS_SCREENING_MATCH_GENERAL",
  holder_concentration: "TOP10_HOLDER_SHARE_GENERAL",
  holder_count: "TOKEN_HOLDER_COUNT_GENERAL",
  liquidity_depth: "LIQUIDITY_DEPTH_VERIFY_GENERAL",
  wash_trading: "WASH_TRADING_DETECTION_GENERAL",
  social_bots: "SOCIAL_BOT_DETECTION_GENERAL",
  code_review: "CODE_REVIEW_GENERAL",
} as const;

function input(over: Partial<PlanInput> = {}): PlanInput {
  const availability = Object.fromEntries(Object.values(INTENTS).map((i) => [i, { exists: true, minerCount: 3 }]));
  const quotesUusdc = Object.fromEntries(Object.values(INTENTS).map((i) => [i, 10_000]));
  return {
    policy: cex(),
    checkIntents: INTENTS,
    availability,
    quotesUusdc,
    servedIntents: ["FRAUD_RISK_TOKEN_LISTING"],
    priceUusdc: 250_000,
    ...over,
  };
}

describe("planner", () => {
  it("buys every check when everything is live and affordable", () => {
    const p = plan(input());
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.purchases).toHaveLength(8);
    expect(p.estimateUusdc).toBe(80_000);
    expect(p.purchases.find((x) => x.check === "contract_audit")?.timeoutMs).toBe(16_000);
    expect(p.purchases.find((x) => x.check === "sanctions")?.timeoutMs).toBe(4000);
  });

  it("refuses with UPSTREAM_UNAVAILABLE when a required check has no live intent", () => {
    const p = plan(input({ checkIntents: { ...INTENTS, holder_concentration: null } }));
    expect(p.ok).toBe(false);
    if (p.ok) return;
    expect(p.refusal).toMatchObject({ code: "UPSTREAM_UNAVAILABLE", checks: ["holder_concentration"] });
  });

  it("drops an optional check whose intent has no miners", () => {
    const p = plan(input({ availability: { ...input().availability, [INTENTS.code_review]: { exists: true, minerCount: 0 } } }));
    expect(p.ok && p.dropped).toEqual([{ check: "code_review", intent: INTENTS.code_review, reason: "UNAVAILABLE" }]);
  });

  it("drops optional checks, lowest weight first, to fit the caller's budget", () => {
    const p = plan(input({ callerBudgetUusdc: 55_000 }));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.estimateUusdc).toBe(50_000);
    expect(p.dropped.map((d) => [d.check, d.reason])).toEqual([
      ["code_review", "BUDGET"],
      ["holder_count", "BUDGET"],
      ["social_bots", "BUDGET"],
    ]);
  });

  it("refuses BUDGET_TOO_LOW with the quote when required checks alone exceed the budget", () => {
    const p = plan(input({ callerBudgetUusdc: 40_000 }));
    expect(p.ok).toBe(false);
    if (p.ok) return;
    expect(p.refusal).toMatchObject({ code: "BUDGET_TOO_LOW", quoteUusdc: 50_000 });
  });

  it("margin guard: drops optional checks, then refuses rather than sell at a loss", () => {
    // 80% of (0.0625 - 2%) = 49,000 uUSDC
    const tight = plan(input({ priceUusdc: 62_500 }));
    expect(tight.ok).toBe(false);
    if (tight.ok) return;
    expect(tight.refusal.code).toBe("MARGIN_GUARD");
    const fits = plan(input({ priceUusdc: 70_000 }));
    expect(fits.ok && fits.dropped.every((d) => d.reason === "MARGIN_GUARD")).toBe(true);
    expect(fits.ok && fits.estimateUusdc).toBe(50_000);
  });

  it("never buys an intent Skein serves or its family", () => {
    expect(intentFamily("FRAUD_RISK_TOKEN_LISTING")).toBe("FRAUD_RISK");
    expect(intentFamily("FRAUD_RISK_GENERAL")).toBe("FRAUD_RISK");
    expect(isSelfRouting("FRAUD_RISK_GENERAL", ["FRAUD_RISK_TOKEN_LISTING"])).toBe(true);
    expect(isSelfRouting("FRAUD_DETECTION_GENERAL", ["FRAUD_RISK_TOKEN_LISTING"])).toBe(false);
    const p = plan(input({ checkIntents: { ...INTENTS, contract_audit: "FRAUD_RISK_GENERAL" } }));
    expect(!p.ok && p.refusal.code).toBe("SELF_ROUTING");
  });

  it("enforces the purchase ceiling on optional checks", () => {
    const p = plan(input({ maxPurchases: 6 }));
    expect(p.ok && p.purchases).toHaveLength(6);
    expect(p.ok && p.dropped.map((d) => d.reason)).toEqual(["PURCHASE_CEILING", "PURCHASE_CEILING"]);
  });

  it("dex-list is plannable on intents that are live today", () => {
    const p = plan(input({ policy: loadPolicy("dex-list@0.1.0"), checkIntents: { ...INTENTS, holder_concentration: null } }));
    expect(p.ok).toBe(true);
  });
});
