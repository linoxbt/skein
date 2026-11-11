import { describe, expect, it } from "vitest";
import { decodeSymbol, labelOutcome, prospectiveId, splitFor } from "../src/label";

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

describe("symbol()", () => {
  it("reads an ABI string and an old-style bytes32", () => {
    const abi = "0x" + "20".padStart(64, "0") + "4".padStart(64, "0") + Buffer.from("BALD").toString("hex").padEnd(64, "0");
    expect(decodeSymbol(abi)).toBe("BALD");
    expect(decodeSymbol("0x" + Buffer.from("MKR").toString("hex").padEnd(64, "0"))).toBe("MKR");
    expect(decodeSymbol("0x")).toBeNull();
  });
});

describe("prospective case ids", () => {
  it("tell vanity launches with a shared prefix apart, and fit the case id format", () => {
    const a = prospectiveId("0xB20000000000000000000000000000000000aBcD");
    const b = prospectiveId("0xb200000000000000000000000000000000001234");
    expect(a).not.toBe(b);
    expect(a).toBe("pro-b20000000000000000000000000000000000abcd");
    expect(a).toMatch(/^[a-z0-9-]{3,64}$/);
  });
});
