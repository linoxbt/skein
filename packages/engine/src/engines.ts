import { parsePolicyV1 } from "./frozen/policy_v1";
import { evaluate as evaluate0_1_0 } from "./frozen/v0_1_0/seal";
import { evaluate as evaluate0_2_0 } from "./frozen/v0_2_0/seal";
import { evaluate as evaluate0_3_0 } from "./frozen/v0_3_0/seal";
import { parsePolicy, type Policy } from "./policy";
import { ENGINE_VERSION, evaluate, receiptsOf, type SealedVerdict, type VerdictMode } from "./seal";
import type { Finding, Subject } from "./types";

export interface ReplayOptions {
  policySha256?: string;
  /** Sealed into the hash from engine 0.4.0; earlier engines ignore it. */
  mode?: VerdictMode;
  /**
   * The policy file as written (its YAML parsed, before the schema). When
   * given, each engine parses it with the schema it was sealed under, so a
   * later change to the live schema's defaults cannot change a replay.
   */
  policySource?: unknown;
}

interface Engine {
  /** The policy schema this engine decided with (its defaults are part of the decision). */
  parsePolicy(source: unknown): Policy;
  evaluate(policy: Policy, subject: Subject, findings: readonly Finding[], receipts: readonly string[], opts: ReplayOptions): SealedVerdict;
}

/**
 * Every engine version that ever sealed a verdict, so a stored verdict is
 * replayed by the engine that made it. Older versions are frozen copies
 * (src/frozen/) and are never edited; so is the policy schema they parse with.
 */
export const ENGINES: Readonly<Record<string, Engine>> = {
  "0.1.0": { parsePolicy: parsePolicyV1, evaluate: (policy, subject, findings, receipts) => evaluate0_1_0(policy, subject, findings, receipts) as SealedVerdict },
  "0.2.0": { parsePolicy: parsePolicyV1, evaluate: (policy, subject, findings, receipts, opts) => evaluate0_2_0(policy, subject, findings, receipts, pick(opts)) as SealedVerdict },
  "0.3.0": { parsePolicy: parsePolicyV1, evaluate: (policy, subject, findings, receipts, opts) => evaluate0_3_0(policy, subject, findings, receipts, pick(opts)) as SealedVerdict },
  [ENGINE_VERSION]: {
    parsePolicy,
    evaluate: (policy, subject, findings, receipts, opts) =>
      evaluate(policy, subject, findings, receipts, { ...pick(opts), ...(opts.mode ? { mode: opts.mode } : {}) }),
  },
};

const pick = (opts: ReplayOptions) => (opts.policySha256 ? { policySha256: opts.policySha256 } : {});

export function evaluateWith(
  engineVersion: string,
  policy: Policy,
  subject: Subject,
  findings: readonly Finding[],
  receipts: readonly string[] = receiptsOf(findings),
  opts: ReplayOptions = {},
): SealedVerdict {
  const engine = Object.hasOwn(ENGINES, engineVersion) ? ENGINES[engineVersion] : undefined;
  if (!engine) throw new Error(`no engine ${engineVersion}; known: ${Object.keys(ENGINES).join(", ")}`);
  const p = opts.policySource !== undefined ? engine.parsePolicy(opts.policySource) : policy;
  return engine.evaluate(p, subject, findings, receipts, opts);
}
