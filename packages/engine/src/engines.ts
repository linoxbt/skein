import type { Policy } from "./policy";
import { evaluate as evaluate0_1_0 } from "./frozen/v0_1_0/seal";
import { evaluate as evaluate0_2_0 } from "./frozen/v0_2_0/seal";
import { ENGINE_VERSION, evaluate, receiptsOf, type SealedVerdict } from "./seal";
import type { Finding, Subject } from "./types";

type Evaluate = (policy: Policy, subject: Subject, findings: readonly Finding[], receipts: readonly string[], opts: { policySha256?: string }) => SealedVerdict;

/**
 * Every engine version that ever sealed a verdict, so a stored verdict is
 * replayed by the engine that made it. Older versions are frozen copies
 * (src/frozen/) and are never edited.
 */
export const ENGINES: Readonly<Record<string, Evaluate>> = {
  "0.1.0": (policy, subject, findings, receipts) => evaluate0_1_0(policy, subject, findings, receipts) as SealedVerdict,
  "0.2.0": (policy, subject, findings, receipts, opts) => evaluate0_2_0(policy, subject, findings, receipts, opts) as SealedVerdict,
  [ENGINE_VERSION]: (policy, subject, findings, receipts, opts) => evaluate(policy, subject, findings, receipts, opts),
};

export function evaluateWith(
  engineVersion: string,
  policy: Policy,
  subject: Subject,
  findings: readonly Finding[],
  receipts: readonly string[] = receiptsOf(findings),
  opts: { policySha256?: string } = {},
): SealedVerdict {
  const run = ENGINES[engineVersion];
  if (!run) throw new Error(`no engine ${engineVersion}; known: ${Object.keys(ENGINES).join(", ")}`);
  return run(policy, subject, findings, receipts, opts);
}
