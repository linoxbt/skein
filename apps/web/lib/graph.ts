import type { Bom, Finding, PolicyDoc, Status, VerdictObject } from "./types";

/** One thread of the Exploded View. */
export interface GraphNode {
  check: string;
  required: boolean;
  weight: number;
  status: Status | "PENDING" | "SKIPPED";
  miner?: string;
  minerId?: string;
  priceUsdc?: number;
  receiptHash?: string;
  signalHash?: string;
  durationMs?: number;
  metric?: string;
  value?: number;
  unit?: string;
  confidence?: number;
  sourceGroup?: string;
  notes?: string[];
  error?: string;
}

export interface GraphConflict {
  code: string;
  checks: [string, string];
}

export interface GraphState {
  nodes: GraphNode[];
  conflicts: GraphConflict[];
  verdict?: { verdict: VerdictObject["verdict"]; riskBps: number; confidenceBps: number; coverage: number; summary?: string };
  costUsdc: number;
}

const ORDER: Record<string, number> = { FAIL: 5, WARN: 4, PASS: 3, ERROR: 2, UNKNOWN: 1, UNAVAILABLE: 0 };

/** Conflicts are named by code; the policy says which two checks each joins. */
export function conflictsFor(codes: string[], policy: PolicyDoc | null, findings: Finding[]): GraphConflict[] {
  const out: GraphConflict[] = [];
  for (const code of codes) {
    const def = policy?.policy.conflicts.find((c) => c.code === code);
    if (def && def.when.length >= 2) out.push({ code, checks: [def.when[0]!.check, def.when[1]!.check] });
    else if (code === "SOURCE_DISAGREEMENT") {
      const dup = findings.find((f, i) => findings.findIndex((g) => g.check === f.check) !== i);
      if (dup) out.push({ code, checks: [dup.check, dup.check] });
    }
  }
  return out;
}

/** The graph for a finished verdict, from its object, BOM and policy. */
export function graphFromVerdict(v: VerdictObject, bom: Bom | null, policy: PolicyDoc | null): GraphState {
  const required = new Set(policy?.policy.required ?? []);
  const checks = policy ? [...policy.policy.required, ...policy.policy.optional] : [...new Set(v.findings.map((f) => f.check))];
  const nodes = checks.map((check): GraphNode => {
    const fs = v.findings.filter((f) => f.check === check);
    const f = fs.sort((a, b) => (ORDER[b.status] ?? 0) - (ORDER[a.status] ?? 0))[0];
    const line = bom?.lines.find((l) => l.check === check);
    return {
      check,
      required: required.has(check),
      weight: policy?.policy.weights[check] ?? 0.1,
      status: f?.status ?? "UNAVAILABLE",
      ...(line?.minerName || line?.minerId ? { miner: line.minerName ?? `miner ${line.minerId}`, minerId: line.minerId ?? undefined } : {}),
      ...(line ? { priceUsdc: line.amountUsdc, durationMs: line.durationMs } : {}),
      ...(line?.receiptHash ? { receiptHash: line.receiptHash } : {}),
      ...(line?.signalHash ? { signalHash: line.signalHash } : {}),
      ...(line?.error ? { error: line.error } : {}),
      ...(f
        ? { metric: f.metric, value: f.value, unit: f.unit, confidence: f.confidence, sourceGroup: f.sourceGroup, notes: f.notes }
        : {}),
    };
  });
  return {
    nodes,
    conflicts: conflictsFor(v.conflicts, policy, v.findings),
    verdict: { verdict: v.verdict, riskBps: v.riskBps, confidenceBps: v.confidenceBps, coverage: v.coverage, summary: v.summary },
    costUsdc: v.cost.upstreamUsdc,
  };
}

/** Live: folds SSE events into graph state as they arrive. */
export type LiveEvent =
  | { type: "plan"; payload: { ok: boolean; purchases?: { check: string; required: boolean; quoteUusdc: number }[]; dropped?: { check: string; reason: string }[] } }
  | { type: "purchase"; payload: { check: string; minerId?: string; minerName?: string; amountUusdc: number; receiptHash?: string; signalHash?: string; durationMs: number; error?: string } }
  | { type: "finding"; payload: Finding }
  | { type: "decision"; payload: { verdictHash: string; decision: { verdict: VerdictObject["verdict"]; riskBps: number; confidenceBps: number; coverageBps: number; conflicts: string[] } } }
  | { type: "done"; payload: { id: string } }
  | { type: "refused"; payload: { code: string; detail: string; checks?: string[] } }
  | { type: "error"; payload: { message: string } };

export function liveReduce(state: GraphState, e: LiveEvent, policy: PolicyDoc | null): GraphState {
  const set = (check: string, patch: Partial<GraphNode>) => ({
    ...state,
    nodes: state.nodes.map((n) => (n.check === check ? { ...n, ...patch } : n)),
  });
  switch (e.type) {
    case "plan": {
      const planned = new Set((e.payload.purchases ?? []).map((p) => p.check));
      const all = policy ? [...policy.policy.required, ...policy.policy.optional] : [...planned];
      const required = new Set(policy?.policy.required ?? []);
      return {
        ...state,
        nodes: all.map((check) => ({
          check,
          required: required.has(check),
          weight: policy?.policy.weights[check] ?? 0.1,
          status: planned.has(check) ? "PENDING" : "UNAVAILABLE",
        })),
      };
    }
    case "purchase": {
      const p = e.payload;
      const next = set(p.check, {
        ...(p.minerName || p.minerId ? { miner: p.minerName ?? `miner ${p.minerId}`, minerId: p.minerId } : {}),
        priceUsdc: p.amountUusdc / 1e6,
        durationMs: p.durationMs,
        ...(p.receiptHash ? { receiptHash: p.receiptHash } : {}),
        ...(p.signalHash ? { signalHash: p.signalHash } : {}),
        ...(p.error ? { error: p.error } : {}),
      });
      return { ...next, costUsdc: state.costUsdc + p.amountUusdc / 1e6 };
    }
    case "finding": {
      const f = e.payload;
      const cur = state.nodes.find((n) => n.check === f.check);
      // Keep the worst answer when a check has several.
      if (cur && cur.status !== "PENDING" && (ORDER[cur.status] ?? 0) > (ORDER[f.status] ?? 0)) return state;
      return set(f.check, { status: f.status, metric: f.metric, value: f.value, unit: f.unit, confidence: f.confidence, sourceGroup: f.sourceGroup, notes: f.notes });
    }
    case "decision": {
      const d = e.payload.decision;
      return {
        ...state,
        conflicts: conflictsFor(d.conflicts, policy, []),
        verdict: { verdict: d.verdict, riskBps: d.riskBps, confidenceBps: d.confidenceBps, coverage: d.coverageBps / 10_000 },
      };
    }
    default:
      return state;
  }
}

export const EMPTY: GraphState = { nodes: [], conflicts: [], costUsdc: 0 };
