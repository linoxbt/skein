import {
  adapterFor,
  evaluate,
  plan as makePlan,
  unavailable,
  type Check,
  type Finding,
  type Plan,
  type Policy,
  type SealedVerdict,
  type StoredPurchase,
  type StoredVerdict,
  type Subject,
} from "@skein/engine";
import { CHECK_INTENTS, SERVED_INTENTS, type AskOutcome, type TelegraphClient } from "@skein/telegraph";
import { availability, candidates, groupOf, quotes, type Catalogue } from "./catalogue";
import type { PoolResolver } from "./pool";
import { buildRequest, forCandidate, type VerdictContext } from "./requests";

/** One upstream attempt, success or failure: a bill-of-materials line. */
export interface PurchaseRecord {
  check: Check;
  intent: string;
  minerId?: string;
  minerName?: string;
  pinned: boolean;
  /** Allowlisted miners that refused the request before payment, in order. */
  skipped?: string[];
  rail: "escrow";
  httpStatus?: number;
  receiptHash?: string;
  signalHash?: string;
  amountUusdc: number;
  epochId?: number;
  durationMs: number;
  attempts: number;
  resultShape?: string;
  rawResult?: unknown;
  error?: string;
  sourceGroup: string;
  adapterVersion: string;
  createdAt: string;
}

export type PipelineEvent =
  | { type: "plan"; plan: Plan }
  | { type: "purchase"; purchase: PurchaseRecord }
  | { type: "finding"; finding: Finding }
  | { type: "decision"; verdict: SealedVerdict };

export interface VerdictDeps {
  client: Pick<TelegraphClient, "ask">;
  catalogue: Catalogue;
  /** What Skein is paid for this verdict, gross, in micro-USDC. */
  priceUusdc: number;
  resolver?: PoolResolver;
  /** Buy from the allowlist with /ask/{minerId}; routed when false or no candidate is live. */
  pinned?: boolean;
  onEvent?: (e: PipelineEvent) => void;
  now?: () => Date;
}

export interface VerdictInput {
  policy: Policy;
  subject: Subject;
  context?: VerdictContext;
  budgetUusdc?: number;
}

export type VerdictRun =
  | { ok: false; plan: Plan & { ok: false } }
  | { ok: true; plan: Plan & { ok: true }; purchases: PurchaseRecord[]; verdict: SealedVerdict; stored: StoredVerdict };

/** Turns a purchase into the adapter context it is replayed with. */
export function toStoredPurchase(p: PurchaseRecord): StoredPurchase {
  return {
    check: p.check,
    adapterVersion: p.adapterVersion,
    rawResult: p.rawResult,
    sourceGroup: p.sourceGroup,
    ...(p.minerId ? { minerId: p.minerId } : {}),
    ...(p.receiptHash ? { receiptHash: p.receiptHash } : {}),
    ...(p.signalHash ? { signalHash: p.signalHash } : {}),
    ...(p.httpStatus !== undefined ? { httpStatus: p.httpStatus } : {}),
    ...(p.error ? { error: p.error } : {}),
  };
}

export async function runVerdict(input: VerdictInput, deps: VerdictDeps): Promise<VerdictRun> {
  const { policy, subject } = input;
  const pinned = deps.pinned ?? true;
  const now = deps.now ?? (() => new Date());
  const emit = deps.onEvent ?? (() => {});

  const p = makePlan({
    policy,
    checkIntents: CHECK_INTENTS,
    availability: availability(deps.catalogue),
    quotesUusdc: quotes(deps.catalogue, CHECK_INTENTS, pinned),
    servedIntents: SERVED_INTENTS,
    priceUusdc: deps.priceUusdc,
    ...(input.budgetUusdc !== undefined ? { callerBudgetUusdc: input.budgetUusdc } : {}),
  });
  emit({ type: "plan", plan: p });
  if (!p.ok) return { ok: false, plan: p };

  const ctx: VerdictContext = { ...input.context };
  if (!ctx.pool && p.purchases.some((x) => x.check === "liquidity_depth") && deps.resolver) {
    const pool = await deps.resolver.resolve(subject.chainId, subject.token);
    if (pool) ctx.pool = pool;
  }

  const unpurchased: Finding[] = p.dropped.map((d) => ({ ...unavailable(d.check), notes: [`dropped_${d.reason.toLowerCase()}`] }));
  const purchases: PurchaseRecord[] = [];

  await Promise.all(
    p.purchases.map(async (pp) => {
      const built = buildRequest(pp.check, pp.intent, subject, ctx);
      if (!built.ok) {
        const f = { ...unavailable(pp.check), notes: [built.note] };
        unpurchased.push(f);
        emit({ type: "finding", finding: f });
        return;
      }
      // Try allowlisted miners in order; one that refuses before payment
      // (incompatible) costs nothing, so fall through to the next.
      const cands = pinned ? candidates(deps.catalogue, pp.check, pp.intent) : [];
      const skipped: string[] = [];
      let miner: (typeof cands)[number] | null = null;
      let out: AskOutcome | null = null;
      for (const cand of cands) {
        miner = cand;
        out = await deps.client.ask(forCandidate(built.req, cand), { timeoutMs: pp.timeoutMs, minerId: cand.minerId });
        if (out.ok || out.kind !== "incompatible") break;
        skipped.push(cand.minerId);
      }
      if (!out) out = await deps.client.ask(built.req, { timeoutMs: pp.timeoutMs });
      const adapter = adapterFor(pp.check);
      const minerId = out.ok ? out.response.miner_id : miner?.minerId;
      const rec: PurchaseRecord = {
        check: pp.check,
        intent: pp.intent,
        pinned: !!miner,
        ...(skipped.length ? { skipped } : {}),
        rail: "escrow",
        amountUusdc: out.ok ? out.amountUusdc : 0,
        durationMs: out.durationMs,
        attempts: out.attempts,
        sourceGroup: groupOf(deps.catalogue, minerId),
        adapterVersion: adapter.version,
        createdAt: now().toISOString(),
        ...(minerId ? { minerId } : {}),
        ...(out.ok
          ? {
              minerName: out.response.miner_name,
              httpStatus: out.httpStatus,
              receiptHash: out.receipt?.receipt_hash,
              signalHash: out.response.signal_hash,
              epochId: out.receipt?.epoch_id,
              resultShape: out.response.result_shape,
              rawResult: out.response.result,
            }
          : { error: `${out.kind}: ${out.error}`, ...(out.httpStatus !== undefined ? { httpStatus: out.httpStatus } : {}) }),
      };
      purchases.push(rec);
      emit({ type: "purchase", purchase: rec });
      const finding = adapter.adapt(rec.rawResult, toStoredPurchase(rec));
      emit({ type: "finding", finding });
    }),
  );

  purchases.sort((a, b) => a.check.localeCompare(b.check));
  const stored = purchases.map(toStoredPurchase);
  const findings = [...stored.map((s) => adapterFor(s.check, s.adapterVersion).adapt(s.rawResult, s)), ...unpurchased];
  const receipts = purchases.map((x) => x.receiptHash).filter((r): r is string => !!r);
  const verdict = evaluate(policy, subject, findings, receipts);
  emit({ type: "decision", verdict });

  return {
    ok: true,
    plan: p,
    purchases,
    verdict,
    stored: {
      engineVersion: verdict.engineVersion,
      policy: verdict.policy,
      subject: verdict.subject,
      findings: verdict.findings,
      purchases: stored,
      unpurchased,
      receipts,
      verdictHash: verdict.verdictHash,
      bomRoot: verdict.bom.root,
    },
  };
}
