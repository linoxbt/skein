import type { Quote } from "./api";

/** The most a caller may set (the API's budgetUsdcMax limit). */
export const MAX_BUDGET_USDC = 10;

export type BudgetCheck = { ok: true; value?: number; warning?: string } | { ok: false; error: string };

/**
 * The console's budget field, checked before anything is sent. The budget
 * caps upstream spend: the required checks must fit in it (or the API
 * refuses with BUDGET_TOO_LOW), and optional checks that do not fit are
 * dropped. With a quote in hand, a budget below the required checks is
 * refused here, before a request is made.
 */
export function checkBudget(input: string, quote: Quote | null, required: readonly string[]): BudgetCheck {
  const text = input.trim();
  if (!text) return { ok: true };
  if (!/^\d*\.?\d+$/.test(text)) return { ok: false, error: "The budget is a number of USDC, like 0.20." };
  const value = Number(text);
  if (!(value > 0)) return { ok: false, error: "The budget must be above zero." };
  if (value > MAX_BUDGET_USDC) return { ok: false, error: `The budget is at most ${MAX_BUDGET_USDC} USDC.` };
  if (!quote?.ok || !quote.checks) return { ok: true, value };
  const req = new Set(required);
  const requiredCost = quote.checks.filter((c) => req.has(c.check)).reduce((a, c) => a + c.quoteUsdc, 0);
  if (value + 1e-9 < requiredCost) {
    return { ok: false, error: `A budget of $${value.toFixed(2)} is below the $${requiredCost.toFixed(3)} the required checks are quoted at. Skein would refuse it (BUDGET_TOO_LOW) before buying anything.` };
  }
  if (quote.upstreamUsdc !== undefined && value + 1e-9 < quote.upstreamUsdc) {
    return { ok: true, value, warning: `Under the $${quote.upstreamUsdc.toFixed(3)} quote: optional checks that do not fit are dropped.` };
  }
  return { ok: true, value };
}
