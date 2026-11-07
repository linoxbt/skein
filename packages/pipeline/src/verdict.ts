import {
  adapterFor,
  evaluate,
  isReceiptHash,
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
import { CHECK_INTENTS, SERVED_INTENTS, type AskOutcome, type AskRequest, type SignalStatus, type TelegraphClient } from "@skein/telegraph";
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
  /** Set only for a receipt that checks out against the signed payment: the BOM's evidence. */
  receiptHash?: string;
  signalHash?: string;
  /** The node's own record of the answer (GET /engine/v1/signal/{hash}). */
  signalStatus?: SignalStatus;
  /** What was spent: the signed amount when billed or possibly billed. */
  amountUusdc: number;
  /** paid: answered with a valid receipt; unknown: sent X-PAYMENT, outcome unknown; none: nothing signed. */
  billing: "paid" | "unknown" | "none";
  epochId?: number;
  durationMs: number;
  attempts: number;
  resultShape?: string;
  rawResult?: unknown;
  error?: string;
  sourceGroup: string;
  adapterVersion: string;
  /** The pool asked about (liquidity), so replay can check the answer named it. */
  pool?: string;
  createdAt: string;
}

export type PipelineEvent =
  | { type: "plan"; plan: Plan }
  | { type: "purchase"; purchase: PurchaseRecord }
  | { type: "finding"; finding: Finding }
  | { type: "decision"; verdict: SealedVerdict };

/**
 * Atomically holds daily spend before a payment is signed (the API backs it
 * with Postgres). reserve() returns null when the cap would be exceeded;
 * settle() records what was actually spent and frees the rest.
 */
export interface SpendGate {
  reserve(uusdc: number): Promise<{ settle(spentUusdc: number): Promise<void> } | null>;
}

export interface VerdictDeps {
  client: Pick<TelegraphClient, "ask"> & Partial<Pick<TelegraphClient, "verifySignal">>;
  catalogue: Catalogue;
  /** What Skein is paid for this verdict, gross, in micro-USDC. */
  priceUusdc: number;
  resolver?: PoolResolver;
  /**
   * Buy from the allowlist with /ask/{minerId} (default). A check with no live
   * allowlisted miner is UNAVAILABLE, not routed: routed asks buy irrelevant
   * answers (docs/DECISIONS.md, L4), unless the check is in allowRouted.
   * pinned: false routes every check.
   */
  pinned?: boolean;
  allowRouted?: readonly Check[];
  /** Skein's own miner registration ids: never bought from (spec section 9). */
  excludeMinerIds?: readonly string[];
  /** Daily spend reservation, held before each payment. */
  spend?: SpendGate;
  /** Persists each purchase the moment it is settled, before the verdict is sealed. */
  onPurchase?: (p: PurchaseRecord) => Promise<void>;
  /** One deadline for the whole verdict, in ms (default 90 s). */
  deadlineMs?: number;
  onEvent?: (e: PipelineEvent) => void;
  now?: () => Date;
}

export interface VerdictInput {
  policy: Policy;
  /** The policy file's published sha256; sealed into the verdict hash. */
  policySha256?: string;
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
    ...(p.pool ? { pool: p.pool } : {}),
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
  const started = Date.now();
  const deadline = started + (deps.deadlineMs ?? 90_000);
  const routedOk = new Set(deps.allowRouted ?? []);
  // Each purchase gets its share of the verdict's cap, in proportion to its
  // quote; together they never exceed the cap, whatever the 402s ask.
  const allotment = (quote: number) => Math.max(quote, Math.floor((p.capUusdc * quote) / Math.max(1, p.estimateUusdc)));

  const skip = (check: Check, note: string) => {
    const f = { ...unavailable(check), notes: [note] };
    unpurchased.push(f);
    emit({ type: "finding", finding: f });
  };

  type Planned = (typeof p.purchases)[number];
  type Cand = ReturnType<typeof candidates>[number];
  /** A check whose paid answer could not be used, and the miners still untried for it. */
  interface Retry { pp: Planned; built: AskRequest; cands: readonly Cand[]; next: number }
  const retries: Retry[] = [];

  /**
   * Asks cands[from..] in order until one gives an outcome other than a free
   * refusal (incompatible), and records that purchase. Returns the index after
   * the miner that answered, and the answer's finding.
   */
  const attempt = async (
    pp: Planned,
    built: AskRequest,
    cands: readonly Cand[],
    from: number,
    routed: boolean,
    budgetUusdc: number,
    opts: { recordFailure: boolean },
  ): Promise<{ next: number; finding: Finding | null; spent: number }> => {
    let budget = budgetUusdc;
    const hold = deps.spend ? await deps.spend.reserve(budget) : null;
    if (deps.spend && !hold) {
      if (opts.recordFailure) skip(pp.check, "daily_cap_reached");
      return { next: cands.length, finding: null, spent: 0 };
    }

    // Try allowlisted miners in order; one that refuses before payment
    // (incompatible) costs nothing, so fall through to the next.
    const skipped: string[] = [];
    let miner: Cand | null = null;
    let out: AskOutcome | null = null;
    let spent = 0;
    let i = from;
    try {
      const attempts: readonly (Cand | null)[] = routed ? [null] : cands;
      for (; i < attempts.length; i++) {
        const cand = attempts[i]!;
        const left = deadline - Date.now();
        if (left < 500) {
          out = out ?? { ok: false, kind: "timeout", error: "verdict deadline reached", durationMs: 0, attempts: 0, paidUusdc: 0, billing: "none" };
          break;
        }
        miner = cand;
        const req = cand ? forCandidate(built, cand) : built;
        out = await deps.client.ask(req, { timeoutMs: Math.min(pp.timeoutMs, left), maxUusdc: budget, ...(cand ? { minerId: cand.minerId } : {}) });
        const paidNow = out.ok ? out.amountUusdc : out.paidUusdc;
        spent += paidNow;
        budget -= paidNow;
        if (out.ok || out.kind !== "incompatible") break;
        if (cand) skipped.push(cand.minerId);
      }
    } catch (e) {
      // An exception (a signer fault, a bug) must not lose the purchase record.
      out = { ok: false, kind: "client_error", error: `exception: ${(e as Error).message}`, durationMs: 0, attempts: 0, paidUusdc: 0, billing: "none" };
    } finally {
      await hold?.settle(spent);
    }
    out ??= { ok: false, kind: "incompatible", error: "no candidate accepted the request", durationMs: 0, attempts: 0, paidUusdc: 0, billing: "none" };
    // A retry that bought nothing leaves no record: the first answer stands.
    if (!opts.recordFailure && !out.ok && spent === 0) return { next: cands.length, finding: null, spent };

    const adapter = adapterFor(pp.check);
    const minerId = out.ok ? out.response.miner_id : miner?.minerId;
    const receiptOk = out.ok && out.receiptProblems.length === 0 && !!out.receipt && isReceiptHash(out.receipt.receipt_hash);
    const signalStatus = out.ok && deps.client.verifySignal ? await deps.client.verifySignal(out.response.signal_hash, minerId ? { minerId } : {}).catch(() => "unchecked" as const) : undefined;
    const rec: PurchaseRecord = {
      check: pp.check,
      intent: pp.intent,
      pinned: !!miner,
      ...(skipped.length ? { skipped } : {}),
      rail: "escrow",
      amountUusdc: spent,
      billing: out.ok ? "paid" : out.billing === "unknown" ? "unknown" : "none",
      durationMs: out.durationMs,
      attempts: out.attempts,
      sourceGroup: groupOf(deps.catalogue, minerId),
      adapterVersion: adapter.version,
      createdAt: now().toISOString(),
      ...(minerId ? { minerId } : {}),
      ...(pp.check === "liquidity_depth" && ctx.pool ? { pool: ctx.pool } : {}),
      ...(out.ok
        ? {
            minerName: out.response.miner_name,
            httpStatus: out.httpStatus,
            signalHash: out.response.signal_hash,
            epochId: out.receipt?.epoch_id,
            resultShape: out.response.result_shape,
            rawResult: out.response.result,
            ...(signalStatus ? { signalStatus } : {}),
            // A paid answer without a receipt that checks out is not evidence: it adapts to ERROR.
            ...(receiptOk ? { receiptHash: out.receipt!.receipt_hash } : { error: `unverified_receipt: ${out.receiptProblems.join("; ") || "receipt_hash not 32 bytes"}` }),
          }
        : { error: `${out.kind}: ${out.error}`, ...(out.httpStatus !== undefined ? { httpStatus: out.httpStatus } : {}) }),
    };
    purchases.push(rec);
    await deps.onPurchase?.(rec);
    emit({ type: "purchase", purchase: rec });
    const finding = adapter.adapt(rec.rawResult, { ...toStoredPurchase(rec), subject });
    emit({ type: "finding", finding });
    return { next: i + 1, finding: out.ok && receiptOk ? finding : null, spent };
  };

  const buyOne = async (pp: Planned): Promise<void> => {
    const built = buildRequest(pp.check, pp.intent, subject, ctx);
    if (!built.ok) return skip(pp.check, built.note);
    const self = new Set(deps.excludeMinerIds ?? []);
    const cands = pinned ? candidates(deps.catalogue, pp.check, pp.intent).filter((c) => !self.has(c.minerId)) : [];
    const routed = !pinned || (cands.length === 0 && routedOk.has(pp.check));
    if (cands.length === 0 && !routed) return skip(pp.check, "no_allowlisted_miner");
    const r = await attempt(pp, built.req, cands, 0, routed, allotment(pp.quoteUusdc), { recordFailure: true });
    // A paid, receipted answer the adapter could not read (a null count, no
    // activity in the window): the next allowlisted miner may still answer.
    if (!routed && r.finding?.status === "UNKNOWN" && r.next < cands.length) retries.push({ pp, built: built.req, cands, next: r.next });
  };

  const settled = await Promise.allSettled(p.purchases.map(buyOne));
  for (const [i, r] of settled.entries()) {
    // buyOne records its own failures; a rejection here is a bug or a failed
    // onPurchase write. Keep the check visible as an ERROR rather than lose the verdict.
    if (r.status === "rejected" && !purchases.some((x) => x.check === p.purchases[i]!.check)) {
      skip(p.purchases[i]!.check, "internal_error");
    }
  }

  // Second round, in plan order: retries share what the cap has left once
  // every first answer is in, so they can never take another check's share.
  let spare = p.capUusdc - purchases.reduce((n, x) => n + x.amountUusdc, 0);
  const order = (r: Retry) => p.purchases.indexOf(r.pp);
  for (const r of [...retries].sort((a, b) => order(a) - order(b))) {
    const grant = Math.min(spare, allotment(r.pp.quoteUusdc));
    if (grant < r.pp.quoteUusdc || deadline - Date.now() < 500) break;
    try {
      const out = await attempt(r.pp, r.built, r.cands, r.next, false, grant, { recordFailure: false });
      spare -= out.spent;
    } catch {
      // A failed onPurchase write on a retry: the first answer stands.
    }
  }

  purchases.sort((a, b) => a.check.localeCompare(b.check));
  const stored = purchases.map(toStoredPurchase);
  const findings = [...stored.map((s) => adapterFor(s.check, s.adapterVersion).adapt(s.rawResult, { ...s, subject })), ...unpurchased];
  const receipts = purchases.map((x) => x.receiptHash).filter((r): r is string => !!r);
  const verdict = evaluate(policy, subject, findings, receipts, input.policySha256 ? { policySha256: input.policySha256 } : {});
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
