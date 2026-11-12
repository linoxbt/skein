import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { adapterFor, parsePolicy, type Check, type Finding, type FindingStatus, type Policy, type PolicyInput, type Severity, type StoredPurchase } from "../src";

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

/**
 * Every cex-standard check bought and answered clean through the current
 * adapters: the findings with the purchases (raw answers) they replay from.
 */
export function boughtCex(subject: { chainId: number; token: string }, over: Partial<Record<Check, unknown>> = {}): { findings: Finding[]; purchases: StoredPurchase[]; receipts: string[] } {
  const raw: Record<Check, unknown> = {
    contract_audit: { result: { [subject.token]: { is_honeypot: "0", is_open_source: "1", buy_tax: "0", sell_tax: "0" } } },
    sanctions: { matched: false },
    holder_concentration: { top10_holders_pct: 0.2 },
    liquidity_depth: { liquidity_usd: 25_000_000 },
    wash_trading: { verdict: "organic", wash_volume_pct: 3 },
    holder_count: { holders_count: 50_000 },
    social_bots: { verdict: "human" },
    code_review: { verdict: "Approve" },
    ...over,
  };
  const purchases = (Object.keys(raw) as Check[]).map((check, i): StoredPurchase => ({
    check, adapterVersion: adapterFor(check).version, rawResult: raw[check], sourceGroup: `src-${check}`,
    minerId: `m-${check}`, receiptHash: `0x${(1000 + i).toString(16).padStart(64, "0")}`, httpStatus: 200,
  }));
  const findings = purchases.map((p) => adapterFor(p.check, p.adapterVersion).adapt(p.rawResult, { ...p, subject }));
  return { findings, purchases, receipts: purchases.map((p) => p.receiptHash!) };
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
