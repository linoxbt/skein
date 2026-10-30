import { policyChecks, type Policy } from "./policy";
import type { Check } from "./types";

export const UUSDC = 1_000_000;
export const MAX_PURCHASES_PER_VERDICT = 10;

export interface IntentAvailability {
  exists: boolean;
  minerCount: number;
  onchainReady?: boolean;
}

export interface PlanInput {
  policy: Policy;
  /** Which Telegraph intent supplies each check; null when no live intent does. */
  checkIntents: Partial<Record<Check, string | null>>;
  availability: Readonly<Record<string, IntentAvailability>>;
  /** Live per-call quote for each intent, in micro-USDC. */
  quotesUusdc: Readonly<Record<string, number>>;
  /** Intents Skein itself serves; never bought, nor anything in their family. */
  servedIntents: readonly string[];
  /** What Skein is paid for this verdict, before the protocol fee, in micro-USDC. */
  priceUusdc: number;
  callerBudgetUusdc?: number;
  protocolFeeBps?: number;
  /** Upstream spend may not exceed this share of what Skein receives. */
  marginGuardBps?: number;
  maxPurchases?: number;
}

export interface PlannedPurchase {
  check: Check;
  intent: string;
  required: boolean;
  quoteUusdc: number;
  timeoutMs: number;
}

export type DropReason = "UNAVAILABLE" | "SELF_ROUTING" | "BUDGET" | "MARGIN_GUARD" | "PURCHASE_CEILING";

export interface Dropped {
  check: Check;
  reason: DropReason;
  intent?: string;
}

export type RefusalCode = "UPSTREAM_UNAVAILABLE" | "SELF_ROUTING" | "BUDGET_TOO_LOW" | "MARGIN_GUARD";

export type Plan =
  | { ok: true; purchases: PlannedPurchase[]; dropped: Dropped[]; estimateUusdc: number; capUusdc: number }
  | {
      ok: false;
      refusal: { code: RefusalCode; detail: string; checks: Check[]; quoteUusdc?: number };
      dropped: Dropped[];
    };

/**
 * An intent's family: its first two underscore-separated segments, with the
 * network's _GENERAL suffix ignored (FRAUD_RISK_TOKEN_LISTING and
 * FRAUD_RISK_GENERAL are both FRAUD_RISK).
 */
export function intentFamily(intent: string): string {
  return intent.replace(/_GENERAL$/, "").split("_").slice(0, 2).join("_");
}

export function isSelfRouting(intent: string, served: readonly string[]): boolean {
  return served.some((s) => s === intent || intentFamily(s) === intentFamily(intent));
}

const sum = (xs: readonly PlannedPurchase[]) => xs.reduce((a, p) => a + p.quoteUusdc, 0);

/** Decides what to buy. Pure: every live fact arrives in the input. */
export function plan(input: PlanInput): Plan {
  const { policy } = input;
  const required = new Set(policy.required);
  const dropped: Dropped[] = [];
  let purchases: PlannedPurchase[] = [];

  for (const check of policyChecks(policy)) {
    const intent = input.checkIntents[check] ?? null;
    const avail = intent ? input.availability[intent] : undefined;
    const quote = intent ? input.quotesUusdc[intent] : undefined;
    if (intent && isSelfRouting(intent, input.servedIntents)) {
      dropped.push({ check, intent, reason: "SELF_ROUTING" });
    } else if (!intent || !avail?.exists || avail.minerCount < 1 || quote === undefined || !(quote >= 0)) {
      dropped.push({ check, reason: "UNAVAILABLE", ...(intent ? { intent } : {}) });
    } else {
      const t = policy.budget.per_check_timeout_ms;
      purchases.push({
        check,
        intent,
        required: required.has(check),
        quoteUusdc: Math.ceil(quote),
        timeoutMs: t[check] ?? t.default,
      });
    }
  }

  const refuse = (code: RefusalCode, detail: string, checks: Check[], quoteUusdc?: number): Plan => ({
    ok: false,
    refusal: { code, detail, checks, ...(quoteUusdc !== undefined ? { quoteUusdc } : {}) },
    dropped,
  });

  const selfRequired = dropped.filter((d) => d.reason === "SELF_ROUTING" && required.has(d.check));
  if (selfRequired.length > 0) {
    return refuse("SELF_ROUTING", "a required check would buy an intent Skein serves", selfRequired.map((d) => d.check));
  }
  const missing = dropped.filter((d) => d.reason === "UNAVAILABLE" && required.has(d.check));
  if (missing.length > 0) {
    // Every verdict would be ABSTAIN; refuse before spending anything.
    return refuse("UPSTREAM_UNAVAILABLE", "required checks have no live intent or miner", missing.map((d) => d.check));
  }

  // Cheapest-to-lose first: lowest weight, then highest price, then name.
  const dropOrder = (a: PlannedPurchase, b: PlannedPurchase) =>
    (policy.weights[a.check] ?? 0) - (policy.weights[b.check] ?? 0) ||
    b.quoteUusdc - a.quoteUusdc ||
    a.check.localeCompare(b.check);
  const dropOptional = (limit: number, reason: DropReason) => {
    const optional = purchases.filter((p) => !p.required).sort(dropOrder);
    for (const p of optional) {
      if (sum(purchases) <= limit) break;
      purchases = purchases.filter((x) => x !== p);
      dropped.push({ check: p.check, intent: p.intent, reason });
    }
  };

  const ceiling = input.maxPurchases ?? MAX_PURCHASES_PER_VERDICT;
  if (purchases.filter((p) => p.required).length > ceiling) {
    return refuse("BUDGET_TOO_LOW", `more than ${ceiling} required purchases`, policy.required);
  }
  for (const p of purchases.filter((x) => !x.required).sort(dropOrder)) {
    if (purchases.length <= ceiling) break;
    purchases = purchases.filter((x) => x !== p);
    dropped.push({ check: p.check, intent: p.intent, reason: "PURCHASE_CEILING" });
  }

  const budget = Math.min(input.callerBudgetUusdc ?? Infinity, Math.round(policy.budget.max_usdc * UUSDC));
  const fee = input.protocolFeeBps ?? 200;
  const guard = input.marginGuardBps ?? 8000;
  const marginCap = Math.floor((input.priceUusdc * (10_000 - fee) * guard) / 100_000_000);

  const cap = Math.min(budget, marginCap);
  dropOptional(cap, budget <= marginCap ? "BUDGET" : "MARGIN_GUARD");
  const requiredCost = sum(purchases.filter((p) => p.required));
  if (requiredCost > budget) {
    return refuse("BUDGET_TOO_LOW", `required checks cost ${requiredCost} uUSDC, budget ${budget}`, policy.required, requiredCost);
  }
  if (requiredCost > marginCap) {
    // Selling at a loss is refused; the verdict is ABSTAIN with MARGIN_GUARD.
    return refuse("MARGIN_GUARD", `required checks cost ${requiredCost} uUSDC, margin cap ${marginCap}`, policy.required, requiredCost);
  }

  return {
    ok: true,
    purchases: [...purchases].sort((a, b) => a.check.localeCompare(b.check)),
    dropped,
    estimateUusdc: sum(purchases),
    capUusdc: cap,
  };
}
