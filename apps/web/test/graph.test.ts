import { describe, expect, it } from "vitest";
import { conflictsFor, EMPTY, graphFromVerdict, liveReduce, type LiveEvent } from "../lib/graph";
import type { PolicyDoc, VerdictObject } from "../lib/types";

const policy = {
  ref: "dex-list@0.1.0",
  sha256: "x",
  yaml: "",
  policy: {
    id: "dex-list",
    version: "0.1.0",
    required: ["contract_audit", "sanctions"],
    optional: ["wash_trading"],
    weights: { contract_audit: 0.35, wash_trading: 0.15 },
    conflicts: [{ code: "MARKET_INTEGRITY_CONFLICT", detail: "", when: [{ check: "contract_audit", status: "PASS" }, { check: "wash_trading", status: "FAIL" }] }],
  },
} as PolicyDoc;

const ev = (e: LiveEvent) => e;

describe("live graph reducer", () => {
  it("plans pending threads, fills them as purchases and findings land, and ties the knot", () => {
    let g = liveReduce(EMPTY, ev({ type: "plan", payload: { ok: true, purchases: [{ check: "contract_audit", required: true, quoteUusdc: 10_000 }, { check: "wash_trading", required: false, quoteUusdc: 10_000 }], dropped: [{ check: "sanctions", reason: "UNAVAILABLE" }] } }), policy);
    expect(g.nodes.map((n) => [n.check, n.status, n.required])).toEqual([
      ["contract_audit", "PENDING", true],
      ["sanctions", "UNAVAILABLE", true],
      ["wash_trading", "PENDING", false],
    ]);
    g = liveReduce(g, ev({ type: "purchase", payload: { check: "wash_trading", minerId: "7378", amountUusdc: 10_000, receiptHash: "0xabc", durationMs: 900 } }), policy);
    g = liveReduce(g, ev({ type: "finding", payload: { check: "wash_trading", status: "FAIL", severity: 2, confidence: 0.6, sourceGroup: "g", notes: [] } }), policy);
    expect(g.costUsdc).toBeCloseTo(0.01);
    expect(g.nodes.find((n) => n.check === "wash_trading")).toMatchObject({ status: "FAIL", receiptHash: "0xabc", minerId: "7378" });
    // A later, milder answer for the same check never hides the worse one.
    g = liveReduce(g, ev({ type: "finding", payload: { check: "wash_trading", status: "PASS", severity: 0, confidence: 0.6, sourceGroup: "h", notes: [] } }), policy);
    expect(g.nodes.find((n) => n.check === "wash_trading")?.status).toBe("FAIL");
    g = liveReduce(g, ev({ type: "decision", payload: { verdictHash: "0x1", decision: { verdict: "ESCALATE", riskBps: 900, confidenceBps: 5000, coverageBps: 10_000, conflicts: ["MARKET_INTEGRITY_CONFLICT"] } } }), policy);
    expect(g.verdict?.verdict).toBe("ESCALATE");
    expect(g.conflicts).toEqual([{ code: "MARKET_INTEGRITY_CONFLICT", checks: ["contract_audit", "wash_trading"] }]);
  });

  it("maps conflict codes to the two checks the policy names, and ignores unknown codes", () => {
    expect(conflictsFor(["NOPE"], policy, [])).toEqual([]);
    expect(conflictsFor(["MARKET_INTEGRITY_CONFLICT"], null, [])).toEqual([]);
  });

  it("builds a finished verdict's graph in policy order, worst finding per check", () => {
    const v = {
      verdict: "ESCALATE", riskBps: 1, confidenceBps: 1, coverage: 1, summary: "", conflicts: [],
      cost: { upstreamUsdc: 0.02 },
      findings: [
        { check: "wash_trading", status: "PASS", severity: 0, confidence: 1, sourceGroup: "a", notes: [] },
        { check: "wash_trading", status: "WARN", severity: 1, confidence: 1, sourceGroup: "b", notes: [] },
        { check: "contract_audit", status: "PASS", severity: 0, confidence: 1, sourceGroup: "c", notes: [] },
      ],
    } as unknown as VerdictObject;
    const g = graphFromVerdict(v, null, policy);
    expect(g.nodes.map((n) => [n.check, n.status])).toEqual([["contract_audit", "PASS"], ["sanctions", "UNAVAILABLE"], ["wash_trading", "WARN"]]);
  });
});
