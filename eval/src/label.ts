// The labelling rules, kept apart from the CLI so they can be tested.
import { createHash } from "node:crypto";

/** Holdout is decided once, from the id alone: about a third of cases, never chosen by looking at results. */
export const splitFor = (id: string): "tune" | "holdout" => (createHash("sha256").update(id).digest()[0]! % 3 === 0 ? "holdout" : "tune");

/** When the sniper's verdicts started to come from the fixed pipeline and agent-pretrade@0.2.0 (DECISIONS L24, L26). */
export const PROSPECTIVE_SINCE = "2026-11-07T20:20:00Z";
export const OUTCOME_HOURS = 72;

export interface Outcome {
  priceAtCheck: number | null;
  priceNow: number | null;
  liquidityAtCheck: number | null;
  liquidityNow: number | null;
}

/**
 * The prospective label, from public market data at least 72 hours after the
 * verdict. bad: the market is gone (no pair, or under $1,000 of liquidity),
 * liquidity fell under a tenth of what it was at the check, or the price fell
 * by 90% or more. Anything else survived the window: ambiguous, not good (good
 * means listed on major exchanges, which no launch is after three days).
 */
export function labelOutcome(o: Outcome): { label: "bad" | "ambiguous"; why: string } {
  if (o.liquidityNow === null || o.liquidityNow < 1000) return { label: "bad", why: "market gone (no pair, or under $1,000 of liquidity)" };
  if (o.liquidityAtCheck && o.liquidityNow < o.liquidityAtCheck / 10) return { label: "bad", why: "liquidity fell under a tenth of its level at the check" };
  if (o.priceAtCheck && o.priceNow !== null && o.priceNow <= o.priceAtCheck / 10) return { label: "bad", why: "price fell 90% or more" };
  return { label: "ambiguous", why: "survived the window" };
}

