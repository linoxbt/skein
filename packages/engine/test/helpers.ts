import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { parsePolicy, type Check, type Finding, type FindingStatus, type Policy, type PolicyInput, type Severity } from "../src";

const dir = fileURLToPath(new URL("../../policies/policies/", import.meta.url));

export function loadPolicy(ref: string): Policy {
  return parsePolicy(parse(readFileSync(`${dir}${ref}.yaml`, "utf8")));
}

export const cex = () => loadPolicy("cex-standard@0.1.0");

let n = 0;
export function f(
  check: Check,
  status: FindingStatus,
  opts: Partial<Omit<Finding, "check" | "status">> & { severity?: Severity } = {},
): Finding {
  n++;
  const answered = status === "PASS" || status === "WARN" || status === "FAIL";
  return {
    check,
    status,
    severity: opts.severity ?? (status === "FAIL" ? 2 : status === "WARN" ? 1 : 0),
    confidence: opts.confidence ?? (answered ? 0.8 : 0),
    sourceGroup: opts.sourceGroup ?? `src-${check}`,
    notes: opts.notes ?? [],
    ...(answered ? { evidence: { receiptHash: `0x${n.toString(16).padStart(64, "0")}`, minerId: `m-${check}` } } : {}),
    ...opts,
  };
}

/** Every cex-standard check answered PASS, with in-range metrics. */
export function cleanCex(overrides: Partial<Record<Check, Finding | null>> = {}): Finding[] {
  const base: Record<string, Finding> = {
    contract_audit: f("contract_audit", "PASS"),
    sanctions: f("sanctions", "PASS"),
    holder_concentration: f("holder_concentration", "PASS", { metric: "top10_holders_pct", value: 0.2 }),
    liquidity_depth: f("liquidity_depth", "PASS", { metric: "liquidity_usd", value: 25_000_000 }),
    wash_trading: f("wash_trading", "PASS", { metric: "wash_volume_pct", value: 3 }),
    holder_count: f("holder_count", "PASS", { metric: "holders_count", value: 50_000 }),
    social_bots: f("social_bots", "PASS"),
    code_review: f("code_review", "PASS"),
  };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) delete base[k];
    else base[k] = v;
  }
  return Object.values(base);
}

export function customPolicy(over: Partial<PolicyInput>): Policy {
  const base: PolicyInput = {
    id: "test",
    version: "0.0.1",
    required: ["contract_audit"],
    optional: [],
    weights: { contract_audit: 1 },
    decision: { approve_below_risk_bps: 2500, reject_above_risk_bps: 6500, min_coverage: 0.8, min_confidence: 0.6 },
    budget: { max_usdc: 0.2, per_check_timeout_ms: { default: 4000 } },
  };
  return parsePolicy({ ...base, ...over });
}
