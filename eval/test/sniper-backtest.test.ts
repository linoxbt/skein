import { describe, expect, it } from "vitest";
import { backtest } from "../src/sniper-backtest";

describe("sniper backtest (106 answered verdicts, eval/sniper/backtest-2026-11-11.json)", () => {
  it("agent-pretrade@0.3.0 approves nothing that later fell by half, and rejects the audit-WARN rugs", () => {
    const r = backtest("agent-pretrade@0.3.0");
    expect(r.APPROVE?.fellHalf ?? 0).toBe(0);
    expect(r.REJECT!.wentToZero).toBeGreaterThanOrEqual(34);
  });

  it("documents why 0.3.0 exists: on engine 0.3.0, 0.2.0 would approve four launches that all fell by half", () => {
    const r = backtest("agent-pretrade@0.2.0");
    expect(r.APPROVE).toMatchObject({ n: 4, fellHalf: 4 });
  });
});
