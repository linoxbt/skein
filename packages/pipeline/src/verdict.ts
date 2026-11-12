import {
  adapterFor,
  decide,
  evaluate,
  isReceiptHash,
  MAX_PURCHASES_PER_VERDICT,
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
  type VerdictMode,
} from "@skein/engine";
import { CHECK_INTENTS, SERVED_INTENTS, type AskOutcome, type AskRequest, type SignalStatus, type TelegraphClient } from "@skein/telegraph";
import { availability, candidates, groupOf, quotes, type BuyFrom, type Catalogue } from "./catalogue";
import { screenAddresses, sdnFinding } from "./ofac";
import type { PoolResolver } from "./pool";
import { buildRequest, forCandidate, withDepthMarker, type VerdictContext } from "./requests";

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
  /** From that receipt: when the node issued it (unix seconds), who paid, and the settlement tx when there is one. */
  receiptTimestamp?: number;
  payer?: string;
  txHash?: string;
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
  /** One deadline for the whole verdict, in ms (default 90 s), passed through every upstream call. */
  deadlineMs?: number;
  onEvent?: (e: PipelineEvent) => void;
  /** Operational problems that must not stop the verdict (a spend settlement that failed). Default: a JSON line on stderr. */
  log?: (msg: string, detail: Record<string, unknown>) => void;
  now?: () => Date;
}

export interface VerdictInput {
  policy: Policy;
  /** The policy file's published sha256; sealed into the verdict hash. */
  policySha256?: string;
  subject: Subject;
  context?: VerdictContext;
  budgetUusdc?: number;
  /** Sealed into the verdict hash (engine 0.4.0). Omitted means live; a run against a fake node says "simulated". */
  mode?: VerdictMode;
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

/** A signed signal hash is 32 bytes of hex; anything else is no record of the answer on the network. */
const SIGNAL_HASH = /^0x[0-9a-fA-F]{64}$/;
/** The longest a signal lookup may hold up one check (it is on the path: it decides whether the answer is evidence). */
const SIGNAL_TIMEOUT_MS = 5_000;

const defaultLog = (msg: string, detail: Record<string, unknown>) => console.error(JSON.stringify({ level: "error", msg, ...detail }));

export async function runVerdict(input: VerdictInput, deps: VerdictDeps): Promise<VerdictRun> {
  const { policy, subject } = input;
  const pinned = deps.pinned ?? true;
  const now = deps.now ?? (() => new Date());
  const emit = deps.onEvent ?? (() => {});
  const log = deps.log ?? defaultLog;
  const self = new Set(deps.excludeMinerIds ?? []);
  const routedOk = new Set(deps.allowRouted ?? []);
  // Availability counts only the miners Skein would buy from (audit H8).
  const buyFrom: BuyFrom = { pinned, ...(deps.allowRouted ? { allowRouted: deps.allowRouted } : {}), ...(deps.excludeMinerIds ? { excludeMinerIds: deps.excludeMinerIds } : {}) };

  const p = makePlan({
    policy,
    checkIntents: CHECK_INTENTS,
    availability: availability(deps.catalogue, buyFrom),
    quotesUusdc: quotes(deps.catalogue, CHECK_INTENTS, pinned, deps.excludeMinerIds),
    servedIntents: SERVED_INTENTS,
    priceUusdc: deps.priceUusdc,
    ...(input.budgetUusdc !== undefined ? { callerBudgetUusdc: input.budgetUusdc } : {}),
  });
  emit({ type: "plan", plan: p });
  if (!p.ok) return { ok: false, plan: p };

  const started = Date.now();
  const deadline = started + (deps.deadlineMs ?? 90_000);
  const ctx: VerdictContext = { ...input.context };
  const unpurchased: Finding[] = p.dropped.map((d) => ({ ...unavailable(d.check), notes: [`dropped_${d.reason.toLowerCase()}`] }));

  // OFAC SDN address screen, before anything is bought: an exact match on the
  // token, the deployer or a treasury address is a certain sanctions FAIL, so
  // the paid name screen is not bought for it.
  const sdn = screenAddresses({
    token: subject.token,
    deployer: ctx.deployer,
    ...Object.fromEntries((ctx.treasuryAddresses ?? []).map((a, i) => [`treasury[${i}]`, a])),
  });
  if (sdn.length) {
    const i = unpurchased.findIndex((f) => f.check === "sanctions");
    if (i >= 0) unpurchased.splice(i, 1);
    unpurchased.push(sdnFinding(sdn));
  }
  const planned = sdn.length ? p.purchases.filter((x) => x.check !== "sanctions") : p.purchases;

  // Every request is built, and the pool resolved, before the first payment:
  // a required check that cannot be bought makes the verdict an ABSTAIN
  // whatever else is bought, so nothing is (spec section 5, audit H8).
  if (!ctx.pool && planned.some((x) => x.check === "liquidity_depth") && deps.resolver) {
    const pool = await deps.resolver.resolve(subject.chainId, subject.token);
    if (pool) ctx.pool = pool;
  }
  type Planned = (typeof p.purchases)[number];
  type Cand = ReturnType<typeof candidates>[number];
  interface Ready { pp: Planned; built: AskRequest; cands: readonly Cand[]; routed: boolean }
  const ready: Ready[] = [];
  const unbuyable: { pp: Planned; note: string }[] = [];
  for (const pp of planned) {
    const built = buildRequest(pp.check, pp.intent, subject, ctx);
    if (!built.ok) {
      unbuyable.push({ pp, note: built.note });
      continue;
    }
    const cands = pinned ? candidates(deps.catalogue, pp.check, pp.intent, self) : [];
    const routed = !pinned || (cands.length === 0 && routedOk.has(pp.check));
    if (cands.length === 0 && !routed) unbuyable.push({ pp, note: "no_allowlisted_miner" });
    else ready.push({ pp, built: built.req, cands, routed });
  }
  const requiredMissing = unbuyable.filter((u) => u.pp.required);
  // An address already on the SDN list is a REJECT whatever is missing: that verdict is still worth sealing.
  const alreadyRejected = sdn.length > 0 && decide(policy, unpurchased).decision.reasons.some((r) => r.code.startsWith("BLOCKER_"));
  if (requiredMissing.length > 0 && !alreadyRejected) {
    return {
      ok: false,
      plan: {
        ok: false,
        refusal: {
          code: "UPSTREAM_UNAVAILABLE",
          detail: `required checks cannot be bought: ${requiredMissing.map((u) => `${u.pp.check} (${u.note})`).join(", ")}`,
          checks: requiredMissing.map((u) => u.pp.check),
        },
        dropped: p.dropped,
      },
    };
  }
  for (const f of unpurchased) if (f.check === "sanctions" && sdn.length) emit({ type: "finding", finding: f });

  const purchases: PurchaseRecord[] = [];
  // Each purchase gets its share of the verdict's cap, in proportion to its
  // quote; together they never exceed the cap, whatever the 402s ask.
  const allotment = (quote: number) => Math.max(quote, Math.floor((p.capUusdc * quote) / Math.max(1, p.estimateUusdc)));

  const skip = (check: Check, note: string) => {
    const f = { ...unavailable(check), notes: [note] };
    unpurchased.push(f);
    emit({ type: "finding", finding: f });
  };
  for (const u of unbuyable) skip(u.pp.check, u.note);

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
        if (deadline - Date.now() < 500) {
          out = out ?? { ok: false, kind: "timeout", error: "verdict deadline reached", durationMs: 0, attempts: 0, paidUusdc: 0, billing: "none" };
          break;
        }
        miner = cand;
        const req = withDepthMarker(cand ? forCandidate(built, cand) : built);
        // The verdict's deadline bounds the whole ask: probe, payment, retry and identity lookups.
        out = await deps.client.ask(req, { timeoutMs: pp.timeoutMs, deadline, maxUusdc: budget, ...(cand ? { minerId: cand.minerId } : {}) });
        const paidNow = out.ok ? out.amountUusdc : out.paidUusdc;
        spent += paidNow;
        budget -= paidNow;
        // Anything that failed before payment (a refusal, a 503 "try again later",
        // an unpaid timeout) cost nothing: try the next allowlisted miner. Once a
        // payment was sent, or may have been, stop: the attempt is on the record.
        if (out.ok || paidNow > 0 || out.billing !== "none" || out.kind === "preseason") break;
        if (cand) skipped.push(cand.minerId);
      }
    } catch (e) {
      // An exception (a signer fault, a bug) must not lose the purchase record.
      out = { ok: false, kind: "client_error", error: `exception: ${(e as Error).message}`, durationMs: 0, attempts: 0, paidUusdc: 0, billing: "none" };
    } finally {
      // A failed settlement must not lose the record of a payment that was made
      // (audit M3): the hold stays as it was (the API's holds expire with the day)
      // and the purchase is still recorded below.
      try {
        await hold?.settle(spent);
      } catch (e) {
        log("spend settlement failed; the purchase is still recorded", { check: pp.check, spentUusdc: spent, error: String((e as Error)?.message ?? e).slice(0, 300) });
      }
    }
    out ??= { ok: false, kind: "incompatible", error: "no candidate accepted the request", durationMs: 0, attempts: 0, paidUusdc: 0, billing: "none" };
    // A retry that bought nothing leaves no record: the first answer stands.
    if (!opts.recordFailure && !out.ok && spent === 0) return { next: cands.length, finding: null, spent };

    const adapter = adapterFor(pp.check);
    const minerId = out.ok ? out.response.miner_id : miner?.minerId;
    const receiptOk = out.ok && out.receiptProblems.length === 0 && !!out.receipt && isReceiptHash(out.receipt.receipt_hash);
    const signalHash = out.ok ? out.response.signal_hash : undefined;
    const signalStatus =
      out.ok && deps.client.verifySignal
        ? await deps.client.verifySignal(signalHash, { ...(minerId ? { minerId } : {}), deadline, timeoutMs: SIGNAL_TIMEOUT_MS }).catch(() => "unchecked" as const)
        : undefined;
    // The network's record of the answer decides whether it is evidence (audit M1): an
    // answer the node attributes to another miner, or one with no signal hash at all,
    // adapts to ERROR. A 404 ("missing") is kept with its status: the payment's receipt
    // checks out on its own, and the node may not have indexed the signal yet.
    const signalError = !out.ok
      ? undefined
      : !signalHash || !SIGNAL_HASH.test(signalHash)
        ? "no_signal_hash: the answer carries no signal hash"
        : signalStatus === "mismatch"
          ? `signal_mismatch: the node records signal ${signalHash} for another miner`
          : undefined;
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
      // A pinned ask is grouped by the miner Skein chose, not the id the node
      // reports, so a node cannot split one operator into several groups (audit L7).
      sourceGroup: groupOf(deps.catalogue, miner?.minerId ?? minerId),
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
            ...(receiptOk
              ? {
                  receiptHash: out.receipt!.receipt_hash,
                  receiptTimestamp: out.receipt!.timestamp,
                  payer: out.receipt!.payer,
                  ...(out.receipt!.tx_hash ? { txHash: out.receipt!.tx_hash } : {}),
                  ...(signalError ? { error: signalError } : {}),
                }
              : { error: `unverified_receipt: ${out.receiptProblems.join("; ") || "receipt_hash not 32 bytes"}` }),
          }
        : { error: `${out.kind}: ${out.error}`, ...(out.httpStatus !== undefined ? { httpStatus: out.httpStatus } : {}) }),
    };
    purchases.push(rec);
    await deps.onPurchase?.(rec);
    emit({ type: "purchase", purchase: rec });
    const finding = adapter.adapt(rec.rawResult, { ...toStoredPurchase(rec), subject });
    emit({ type: "finding", finding });
    return { next: i + 1, finding: out.ok && receiptOk && !signalError ? finding : null, spent };
  };

  const buyOne = async (r: Ready): Promise<void> => {
    const res = await attempt(r.pp, r.built, r.cands, 0, r.routed, allotment(r.pp.quoteUusdc), { recordFailure: true });
    // A paid, receipted answer the adapter could not read (a null count, no
    // activity in the window): the next allowlisted miner may still answer.
    if (!r.routed && res.finding?.status === "UNKNOWN" && res.next < r.cands.length) retries.push({ pp: r.pp, built: r.built, cands: r.cands, next: res.next });
  };

  const settled = await Promise.allSettled(ready.map(buyOne));
  for (const [i, r] of settled.entries()) {
    // buyOne records its own failures; a rejection here is a bug or a failed
    // onPurchase write. Keep the check visible as an ERROR rather than lose the verdict.
    if (r.status === "rejected" && !purchases.some((x) => x.check === ready[i]!.pp.check)) {
      skip(ready[i]!.pp.check, "internal_error");
    }
  }

  // Second round, in plan order: retries share what the cap has left once
  // every first answer is in, so they can never take another check's share,
  // and never take the verdict past MAX_PURCHASES_PER_VERDICT paid asks (audit L1).
  const paidAsks = () => purchases.filter((x) => x.billing !== "none" || x.amountUusdc > 0).length;
  let spare = p.capUusdc - purchases.reduce((n, x) => n + x.amountUusdc, 0);
  const order = (r: Retry) => p.purchases.indexOf(r.pp);
  for (const r of [...retries].sort((a, b) => order(a) - order(b))) {
    const grant = Math.min(spare, allotment(r.pp.quoteUusdc));
    if (grant < r.pp.quoteUusdc || deadline - Date.now() < 500 || paidAsks() >= MAX_PURCHASES_PER_VERDICT) break;
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
  const verdict = evaluate(policy, subject, findings, receipts, {
    ...(input.policySha256 ? { policySha256: input.policySha256 } : {}),
    ...(input.mode ? { mode: input.mode } : {}),
  });
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
      ...(input.mode ? { mode: input.mode } : {}),
    },
  };
}
