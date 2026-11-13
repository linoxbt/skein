import { describe, expect, it } from "vitest";
import type { Quote } from "../lib/api";
import { checkBudget } from "../lib/budget";

const quote: Quote = {
  subject: { chainId: 8453, token: "0x" },
  policy: "dex-list@0.1.0",
  priceUsdc: 0.25,
  ok: true,
  upstreamUsdc: 0.05,
  checks: [
    { check: "contract_audit", intent: "SMART_CONTRACT_AUDIT_GENERAL", quoteUsdc: 0.01 },
    { check: "sanctions", intent: "SANCTIONS_SCREENING_MATCH_GENERAL", quoteUsdc: 0.01 },
    { check: "wash_trading", intent: "WASH_TRADING_DETECTION_GENERAL", quoteUsdc: 0.03 },
  ],
};
const required = ["contract_audit", "sanctions"];

describe("console budget", () => {
  it("is optional", () => {
    expect(checkBudget("", quote, required)).toEqual({ ok: true });
    expect(checkBudget("  ", null, required)).toEqual({ ok: true });
  });

  it("refuses what is not a positive amount of at most 10 USDC", () => {
    for (const bad of ["abc", "-1", "0", "0.", "1e3", "0x10", "1,5"]) expect(checkBudget(bad, null, required).ok, bad).toBe(false);
    expect(checkBudget("10.5", null, required)).toMatchObject({ ok: false, error: expect.stringMatching(/at most 10/) });
    expect(checkBudget(".2", null, required)).toEqual({ ok: true, value: 0.2 });
  });

  it("refuses locally a budget below what the required checks are quoted at", () => {
    expect(checkBudget("0.01", quote, required)).toMatchObject({ ok: false, error: expect.stringMatching(/BUDGET_TOO_LOW/) });
  });

  it("warns when optional checks will be dropped, and is quiet when the quote fits", () => {
    expect(checkBudget("0.02", quote, required)).toMatchObject({ ok: true, value: 0.02, warning: expect.stringMatching(/optional/) });
    expect(checkBudget("0.20", quote, required)).toEqual({ ok: true, value: 0.2 });
  });
});
