import { describe, expect, it } from "vitest";
import { labelOutcome, splitFor } from "../src/label";

const at = { priceAtCheck: 1e-6, liquidityAtCheck: 50_000 };

describe("prospective labels", () => {
  it("marks a rug: the market is gone, liquidity was pulled, or the price collapsed", () => {
    expect(labelOutcome({ ...at, priceNow: null, liquidityNow: null }).label).toBe("bad");
    expect(labelOutcome({ ...at, priceNow: 1e-6, liquidityNow: 900 }).label).toBe("bad");
    expect(labelOutcome({ ...at, priceNow: 1e-6, liquidityNow: 4_000 })).toMatchObject({ label: "bad", why: expect.stringMatching(/tenth/) });
    expect(labelOutcome({ ...at, priceNow: 1e-7, liquidityNow: 30_000 })).toMatchObject({ label: "bad", why: expect.stringMatching(/90%/) });
  });

  it("calls a survivor ambiguous, never good", () => {
    expect(labelOutcome({ ...at, priceNow: 5e-7, liquidityNow: 20_000 }).label).toBe("ambiguous");
    // Without the liquidity at the check (older sniper records), only the absolute floor and the price apply.
    expect(labelOutcome({ priceAtCheck: 1e-6, liquidityAtCheck: null, priceNow: 8e-7, liquidityNow: 2_000 }).label).toBe("ambiguous");
  });
});

describe("splits", () => {
  it("are fixed by the id alone, about a third holdout", () => {
    expect(splitFor("good-chainlink-eth")).toBe(splitFor("good-chainlink-eth"));
    const ids = Array.from({ length: 900 }, (_, i) => `case-${i}`);
    const holdout = ids.filter((i) => splitFor(i) === "holdout").length / ids.length;
    expect(holdout).toBeGreaterThan(0.28);
    expect(holdout).toBeLessThan(0.39);
  });
});
