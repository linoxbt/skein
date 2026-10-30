import { z } from "zod";
import { CHECKS, STATUSES, type Check } from "./types";

const check = z.enum(CHECKS);
const status = z.enum(STATUSES);
const severity = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const fraction = z.number().min(0).max(1);

const blocker = z
  .object({ check, status, minSeverity: severity.optional() })
  .strict();

/**
 * A threshold on one numeric field. Direction is inferred: fail > warn means
 * higher is worse, fail < warn means lower is worse. Comparisons are strict,
 * so a value exactly on a threshold stays on the better side.
 */
const threshold = z
  .object({ warn: z.number(), fail: z.number(), field: z.string().min(1) })
  .strict()
  .refine((t) => t.warn !== t.fail, "warn and fail must differ");

const conflict = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    detail: z.string().min(1),
    when: z.array(z.object({ check, status }).strict()).min(2),
  })
  .strict();

const decision = z
  .object({
    approve_below_risk_bps: z.number().int().min(0).max(10_000),
    reject_above_risk_bps: z.number().int().min(0).max(10_000),
    /** Share of the policy's total weight that has a real answer. */
    min_coverage: fraction,
    min_confidence: fraction,
    conflict_escalates: z.boolean().default(true),
    /** Any required check without a real answer forces ABSTAIN, whatever its weight. */
    abstain_on_missing_required: z.boolean().default(true),
    /** Any required check at FAIL rules out APPROVE (the verdict becomes at least ESCALATE). */
    required_fail_blocks_approve: z.boolean().default(true),
    /** Confidence is multiplied by (1 - penalty x contradictions), floored at 0. */
    agreement_penalty: fraction.default(0.25),
  })
  .strict();

const scoring = z
  .object({
    status_risk: z
      .object({ PASS: fraction, WARN: fraction, FAIL: fraction })
      .strict()
      .default({ PASS: 0, WARN: 0.5, FAIL: 1 }),
    /** Multiplier on status risk, indexed by severity 0..3. */
    severity_multiplier: z.tuple([fraction, fraction, fraction, fraction]).default([0.6, 0.8, 1, 1]),
  })
  .strict()
  .default({});

const budget = z
  .object({
    max_usdc: z.number().positive(),
    per_check_timeout_ms: z
      .object({ default: z.number().int().positive() })
      .catchall(z.number().int().positive()),
  })
  .strict();

export const policySchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    description: z.string().optional(),
    blockers: z.array(blocker).default([]),
    required: z.array(check).min(1),
    optional: z.array(check).default([]),
    thresholds: z.record(check, threshold).default({}),
    weights: z.record(check, z.number().min(0)),
    conflicts: z.array(conflict).default([]),
    decision,
    scoring,
    budget,
  })
  .strict()
  .superRefine((p, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    const inPolicy = new Set<Check>([...p.required, ...p.optional]);
    if (inPolicy.size !== p.required.length + p.optional.length) {
      issue("a check is listed twice across required and optional");
    }
    const blockerChecks = new Set(p.blockers.map((b) => b.check));
    for (const c of p.required) {
      if (p.weights[c] === undefined && !blockerChecks.has(c)) {
        issue(`required check ${c} has neither a weight nor a blocker, so it could never affect a verdict`);
      }
    }
    for (const c of Object.keys(p.weights) as Check[]) {
      if (!inPolicy.has(c)) issue(`weight for ${c}, which is not in required or optional`);
    }
    for (const c of Object.keys(p.thresholds) as Check[]) {
      if (!inPolicy.has(c)) issue(`threshold for ${c}, which is not in required or optional`);
    }
    for (const b of p.blockers) {
      if (!inPolicy.has(b.check)) issue(`blocker on ${b.check}, which is not in required or optional`);
    }
    for (const k of p.conflicts) {
      for (const w of k.when) {
        if (!inPolicy.has(w.check)) issue(`conflict ${k.code} uses ${w.check}, which is not in the policy`);
      }
    }
    if (p.decision.approve_below_risk_bps > p.decision.reject_above_risk_bps) {
      issue("approve_below_risk_bps must not exceed reject_above_risk_bps");
    }
  });

export type Policy = z.output<typeof policySchema>;
export type PolicyInput = z.input<typeof policySchema>;
export type Threshold = z.output<typeof threshold>;

export function parsePolicy(input: unknown): Policy {
  return policySchema.parse(input);
}

export function policyRef(p: Pick<Policy, "id" | "version">): string {
  return `${p.id}@${p.version}`;
}

export function policyChecks(p: Policy): Check[] {
  return [...p.required, ...p.optional];
}
