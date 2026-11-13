import { z } from "zod";
import { policySchemaV1 } from "./frozen/policy_v1";
import type { Check } from "./types";

/**
 * The live policy schema: the frozen v1 schema (its fields and defaults are
 * what every engine so far decided with), plus one rule added with engine
 * 0.4.0: the scoring tables must rank answers the way the engine does. The
 * engine picks a check's deciding answer by status first (FAIL over WARN over
 * PASS), then severity, and matches blockers and contradictions at a status
 * or worse; a table that scored a WARN above a FAIL, or a lower severity
 * above a higher one, would let a worse answer lower the risk. Every
 * published policy uses the default tables, which satisfy it.
 *
 * Changing a default is a new schema version, never an edit here or in
 * frozen/policy_v1.ts: engines.ts names the schema each engine parses with.
 */
export const policySchema = policySchemaV1.superRefine((p, ctx) => {
  const r = p.scoring.status_risk;
  const m = p.scoring.severity_multiplier;
  const sorted = (xs: readonly number[]) => xs.every((x, i) => i === 0 || xs[i - 1]! <= x);
  if (!sorted([r.PASS, r.WARN, r.FAIL])) {
    ctx.addIssue({ code: "custom", message: "scoring.status_risk must not decrease from PASS to WARN to FAIL" });
  }
  if (!sorted(m)) ctx.addIssue({ code: "custom", message: "scoring.severity_multiplier must not decrease with severity" });
  // The least risky FAIL must weigh at least the riskiest WARN (and WARN against PASS).
  if (r.FAIL * m[0] < r.WARN * m[3] || r.WARN * m[0] < r.PASS * m[3]) {
    ctx.addIssue({ code: "custom", message: "scoring: every FAIL must score at least every WARN, and every WARN at least every PASS" });
  }
});

export type Policy = z.output<typeof policySchema>;
export type PolicyInput = z.input<typeof policySchema>;
export type Threshold = Policy["thresholds"][Check] & {};

export function parsePolicy(input: unknown): Policy {
  return policySchema.parse(input);
}

export function policyChecks(p: Pick<Policy, "required" | "optional">): Check[] {
  return [...p.required, ...p.optional];
}
