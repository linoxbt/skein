"use client";
import { GraphWithPanel } from "@/components/VerdictView";
import type { GraphState } from "@/lib/graph";

/** A worked example for the explainer. Labelled as one; never presented as a real verdict. */
const EXAMPLE: GraphState = {
  nodes: [
    { check: "contract_audit", required: true, weight: 0.35, status: "PASS", miner: "GoPlus Security", priceUsdc: 0.01, confidence: 0.7, sourceGroup: "gopluslabs.io", notes: [] },
    { check: "sanctions", required: true, weight: 0, status: "PASS", miner: "OFAC SDN Entity Screen", priceUsdc: 0.01, confidence: 0.8, sourceGroup: "13.237.89.59", notes: ["no_match"] },
    { check: "liquidity_depth", required: true, weight: 0.25, status: "PASS", miner: "VerifyWire Liquidity Depth", priceUsdc: 0.01, metric: "liquidity_usd", value: 4_200_000, unit: "USD", confidence: 0.7, sourceGroup: "margyn.workers.dev", notes: [] },
    { check: "holder_count", required: true, weight: 0.15, status: "PASS", miner: "ChainWire Token Holder Count", priceUsdc: 0.01, metric: "holders_count", value: 58_000, unit: "addresses", confidence: 0.7, sourceGroup: "margyn.workers.dev", notes: [] },
    { check: "wash_trading", required: false, weight: 0.15, status: "FAIL", miner: "VerifyWire Wash Trading Detection", priceUsdc: 0.01, metric: "wash_volume_pct", value: 71, unit: "percent", confidence: 0.6, sourceGroup: "margyn.workers.dev", notes: ["label_wash_trading"] },
    { check: "social_bots", required: false, weight: 0.1, status: "PASS", miner: "TradeWire Social Bot Detection", priceUsdc: 0.01, confidence: 0.6, sourceGroup: "margyn.workers.dev", notes: [] },
  ],
  conflicts: [{ code: "MARKET_INTEGRITY_CONFLICT", checks: ["contract_audit", "wash_trading"] }],
  verdict: { verdict: "ESCALATE", riskBps: 962, confidenceBps: 5100, coverage: 1 },
  costUsdc: 0.06,
};

export function ExampleGraph() {
  return <GraphWithPanel state={EXAMPLE} />;
}
