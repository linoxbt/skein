import type { Skein, VerdictResult } from "@skeinlabs/sdk";
import { SkeinError } from "@skeinlabs/sdk";
import type { MarketSource } from "./market";
import type { Store, TokenRecord } from "./store";
import type { Launch } from "./watch";

export interface SniperConfig {
  /** Skein policy the gate trades under: no APPROVE, no trade. */
  policy: string;
  /** Wait this long after a launch before the first market look (the first minutes are noise). */
  minAgeMin: number;
  /** Give up on a token that never reaches minLiquidityUsd within this many minutes. */
  maxAgeMin: number;
  /**
   * Only buy a verdict for a token a sniper could actually trade: this much
   * liquidity. Never below the policy's liquidity_depth FAIL threshold (see
   * liquidityFloor): under it the verdict is a guaranteed REJECT, a paid slot for nothing.
   */
  minLiquidityUsd: number;
  /** Paid verdicts per UTC day (failed and in-flight checks included), and per tick, whatever the launch rate. */
  dailyChecks: number;
  checksPerTick: number;
  /** USDC that may move per UTC day: what was paid, plus maxUsdcPerCall for each check in flight. */
  dailyUsdc: number;
  /** The most one verdict may cost; what a Telegraph check in flight reserves against dailyUsdc. */
  maxUsdcPerCall: number;
  /** A check still "checking" this long after its claim was interrupted (a restart, a dead replica). */
  staleCheckMin: number;
  /** The paper position taken on APPROVE, in USD. */
  ticketUsd: number;
  /** Refresh the price of checked tokens this often, for this long after the check. */
  priceRefreshMin: number;
  trackHours: number;
}

/** agent-pretrade@0.3.0's liquidity_depth FAIL threshold, a blocker: the floor when the policy cannot be read. */
export const BLOCKER_LIQUIDITY_USD = 50_000;

export const DEFAULTS: SniperConfig = {
  policy: "agent-pretrade@0.3.0",
  minAgeMin: 5,
  maxAgeMin: 360,
  minLiquidityUsd: BLOCKER_LIQUIDITY_USD,
  dailyChecks: 40,
  checksPerTick: 2,
  dailyUsdc: 12,
  maxUsdcPerCall: 0.3,
  staleCheckMin: 15,
  ticketUsd: 100,
  priceRefreshMin: 10,
  trackHours: 72,
};

/** Base mainnet: the only chain the sniper trades on. */
export const CHAIN_ID = 8453;

/**
 * The liquidity a token needs before a verdict is worth buying: the configured
 * floor, raised to the policy's liquidity_depth FAIL threshold (a policy as
 * GET /v1/policies/{ref} returns it, or its `policy` field). Below that
 * threshold the check FAILs, so the verdict cannot APPROVE. Without a readable
 * threshold the floor is at least BLOCKER_LIQUIDITY_USD.
 */
export function liquidityFloor(policy: unknown, configured: number): { floor: number; source: string } {
  const p = (policy as { policy?: unknown })?.policy ?? policy;
  const fail = (p as { thresholds?: { liquidity_depth?: { fail?: unknown } } })?.thresholds?.liquidity_depth?.fail;
  if (typeof fail === "number" && Number.isFinite(fail) && fail >= 0) {
    return fail > configured ? { floor: fail, source: `the policy's liquidity_depth FAIL threshold ($${fail})` } : { floor: configured, source: "configured" };
  }
  return configured >= BLOCKER_LIQUIDITY_USD
    ? { floor: configured, source: "configured" }
    : { floor: BLOCKER_LIQUIDITY_USD, source: `the default blocker floor ($${BLOCKER_LIQUIDITY_USD}): the policy's threshold could not be read` };
}

export interface AgentDeps {
  store: Store;
  market: MarketSource;
  skein: Skein;
  /** How verdicts are paid: a Telegraph check interrupted mid-flight may have been billed, so it is never asked again. */
  rail: "apiKey" | "telegraph";
  /** Polls the chain for new pools; omitted in tests that feed launches directly. */
  watch?: () => Promise<Launch[]>;
  /** Checks a verdict's Skein signature against the pinned attester. Required: no verified signature, no trade. */
  verify: (v: VerdictResult) => Promise<boolean>;
  now?: () => Date;
  log?: (msg: string) => void;
  config?: Partial<SniperConfig>;
}

const minutes = (a: Date, b: string) => (a.getTime() - Date.parse(b)) / 60_000;
const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Why a verdict is not about this token on Base under the sniper's policy; empty when it is. */
export function subjectProblems(v: Pick<VerdictResult, "subject" | "policy">, token: string, policy: string): string[] {
  const problems: string[] = [];
  if (v.subject?.chainId !== CHAIN_ID || String(v.subject?.token ?? "").toLowerCase() !== token.toLowerCase()) {
    problems.push(`the verdict is for ${v.subject?.chainId}:${v.subject?.token}, not ${CHAIN_ID}:${token}`);
  }
  const [id, version] = policy.split("@");
  if (v.policy?.id !== id || (version !== undefined && v.policy?.version !== version)) problems.push(`the verdict is under ${v.policy?.id}@${v.policy?.version}, not ${policy}`);
  return problems;
}

/**
 * The rug-proof sniper. Each tick: record new launches; look at the ones old
 * enough; buy one Skein verdict for each token that reached tradeable
 * liquidity; take a paper position only on a signed APPROVE about that very
 * token; and keep pricing every checked token, so the record shows what the
 * gate avoided.
 */
export class Sniper {
  readonly cfg: SniperConfig;
  private lastPriceRefresh = 0;
  private busy = false;
  constructor(private readonly d: AgentDeps) {
    if (typeof d.verify !== "function") throw new Error("the sniper needs a signature check (a pinned attester): no verified signature, no trade");
    this.cfg = { ...DEFAULTS, ...d.config };
  }

  private now() {
    return this.d.now?.() ?? new Date();
  }
  private log(m: string) {
    this.d.log?.(m);
  }

  async tick(): Promise<void> {
    if (this.busy) return; // a slow verdict must not overlap the next tick
    this.busy = true;
    try {
      if (this.d.watch) {
        const launches = await this.d.watch().catch((e) => (this.log(`watch: ${(e as Error).message}`), [] as Launch[]));
        for (const l of launches) if (await this.d.store.add(l, this.now())) this.log(`launch ${l.dex} ${l.token}`);
      }
      await this.recoverStale();
      await this.screen();
      await this.refreshPrices();
    } finally {
      this.busy = false;
    }
  }

  /**
   * A check left "checking" past staleCheckMin was interrupted (a restart, or a
   * replica that died). On the Telegraph rail the ask may already have been
   * paid and there is no idempotency key, so it is never asked again: it
   * becomes an error that counts the most it could have cost. On the
   * partner-key rail the token's idempotency key returns the original verdict
   * uncharged, so it goes back to watching.
   */
  private async recoverStale(): Promise<void> {
    const cutoff = this.now().getTime() - this.cfg.staleCheckMin * 60_000;
    for (const r of await this.d.store.byStatus("checking", 100)) {
      if (!r.checkedAt || Date.parse(r.checkedAt) > cutoff) continue;
      if (r.rail === "telegraph") {
        await this.d.store.save({
          ...r,
          status: "error",
          action: "skip",
          paidUsdc: this.cfg.maxUsdcPerCall,
          note: `interrupted mid-check (restart): the Telegraph ask may have been paid (billing unknown, counted at up to ${this.cfg.maxUsdcPerCall} USDC); not asked again`,
        });
        this.log(`STALE ${r.token}: Telegraph check interrupted, counted as paid, not re-asked`);
      } else {
        await this.d.store.save({ ...r, status: "watching", checkedAt: null });
        this.log(`STALE ${r.token}: partner-key check interrupted, requeued (its idempotency key prevents a second charge)`);
      }
    }
  }

  /** Market look for watched tokens; a paid verdict for the ones worth one. */
  private async screen(): Promise<void> {
    const now = this.now();
    const watching = await this.d.store.byStatus("watching", 300);
    const due: TokenRecord[] = [];
    for (const r of watching) {
      const age = minutes(now, r.seenAt);
      if (age > this.cfg.maxAgeMin) {
        await this.d.store.save({ ...r, status: "expired", note: `never reached $${this.cfg.minLiquidityUsd.toLocaleString("en-US")} liquidity within ${Math.round(this.cfg.maxAgeMin / 60)} h: no verdict bought` });
      } else if (age >= this.cfg.minAgeMin) {
        due.push(r);
      }
    }
    if (!due.length) return;
    const market = await this.d.market.get(due.map((r) => r.token)).catch((e) => (this.log(`market: ${(e as Error).message}`), new Map()));
    const ready: TokenRecord[] = [];
    for (const r of due) {
      const m = market.get(r.token);
      if (!m) continue;
      const next = { ...r, symbol: m.symbol, name: m.name, marketUrl: m.url, liquidityUsd: m.liquidityUsd, pool: m.pair ?? r.pool, priceNow: m.priceUsd };
      if (m.liquidityUsd >= this.cfg.minLiquidityUsd) ready.push(next);
      else await this.d.store.save(next);
    }
    // Deepest first: the tokens a sniper is most likely to actually trade.
    let done = 0;
    for (const r of ready.sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))) {
      if (done >= this.cfg.checksPerTick) break;
      const out = await this.check(r);
      if (out === "cap") break;
      if (out !== "taken") done++;
    }
  }

  /**
   * One paid verdict, one decision. The check is claimed first, atomically
   * against the daily caps (checks and USDC, across replicas): "cap" when the
   * day is used up, "taken" when another tick or replica has the token.
   */
  async check(r: TokenRecord): Promise<TokenRecord | "cap" | "taken"> {
    const started = this.now();
    const claimed = await this.d.store.claim(
      { ...r, status: "checking", checkedAt: started.toISOString(), rail: this.d.rail },
      { since: startOfUtcDay(started), maxChecks: this.cfg.dailyChecks, maxUsdc: this.cfg.dailyUsdc, reserveUsdc: this.d.rail === "telegraph" ? this.cfg.maxUsdcPerCall : 0 },
    );
    if (claimed !== "claimed") return claimed;
    try {
      const v = await this.d.skein.verdict({
        subject: { chainId: CHAIN_ID, token: r.token },
        policy: this.cfg.policy,
        // The Telegraph rail sends only the subject and the policy.
        ...(r.pool && this.d.rail === "apiKey" ? { context: { pool: r.pool } } : {}),
        idempotencyKey: `sniper-${r.token}`,
      });
      const subject = subjectProblems(v, r.token, this.cfg.policy);
      const signatureOk = subject.length === 0 ? await this.d.verify(v).catch(() => false) : false;
      // No trade on an unsigned verdict, or on one about another token or policy.
      const buy = v.verdict === "APPROVE" && signatureOk === true && subject.length === 0;
      const why = v.verdict !== "APPROVE" ? null : subject.length ? `APPROVE not acted on: ${subject.join("; ")}` : !signatureOk ? "APPROVE not acted on: Skein's signature did not verify against the pinned attester" : null;
      const done: TokenRecord = {
        ...r,
        status: "decided",
        checkedAt: started.toISOString(),
        ageAtCheckMin: Math.round(minutes(started, r.seenAt)),
        verdict: v.verdict,
        verdictId: v.id,
        action: buy ? "buy" : "skip",
        summary: v.summary,
        reasons: [...v.reasons.map((x) => x.detail), ...v.openRisks.map((x) => `open: ${x}`)].slice(0, 8),
        riskBps: v.riskBps,
        priceUsdc: v.cost.priceUsdc,
        // A paid Telegraph ask cost what it cost, cached verdict or not; a partner key pays nothing.
        paidUsdc: v.payment.rail === "telegraph" ? v.payment.amountUsdc : 0,
        upstreamUsdc: v.cost.upstreamUsdc,
        receipts: v.bom.items,
        rail: v.payment.rail,
        receiptHash: v.payment.rail === "telegraph" ? v.payment.receiptHash : null,
        verdictHash: v.verdictHash,
        signatureOk,
        subjectOk: subject.length === 0,
        latencyMs: this.now().getTime() - started.getTime(),
        priceAtCheck: r.priceNow ?? null,
        liquidityAtCheck: r.liquidityUsd ?? null,
        priceAt: started.toISOString(),
        note: why,
      };
      await this.d.store.save(done);
      this.log(`${buy ? "BUY (paper)" : "SKIP"} ${r.symbol ?? r.token}: ${v.verdict} ${v.riskBps} bps${why ? ` (${why})` : ""}`);
      return done;
    } catch (e) {
      const why = e instanceof SkeinError ? `${e.code}: ${e.message}` : (e as Error).message;
      const failed: TokenRecord = {
        ...r,
        status: "error",
        checkedAt: started.toISOString(),
        rail: this.d.rail,
        action: "skip",
        note: why,
        // Money that moved (or may have) without a usable verdict still counts.
        paidUsdc: e instanceof SkeinError && e.payment ? e.payment.amountUsdc : 0,
      };
      await this.d.store.save(failed);
      this.log(`ERROR ${r.token}: ${why}`);
      return failed;
    }
  }

  /** The paper record: where every checked token's price went after the check. */
  private async refreshPrices(): Promise<void> {
    const now = this.now();
    if (now.getTime() - this.lastPriceRefresh < this.cfg.priceRefreshMin * 60_000) return;
    this.lastPriceRefresh = now.getTime();
    const since = new Date(now.getTime() - this.cfg.trackHours * 3_600_000);
    const tracked = (await this.d.store.checkedSince(since, 300)).filter((r) => r.status === "decided");
    if (!tracked.length) return;
    const market = await this.d.market.get(tracked.map((r) => r.token)).catch(() => new Map());
    for (const r of tracked) {
      const m = market.get(r.token);
      // A token that vanished from every DEX has no price: say so rather than keep a stale one.
      await this.d.store.save({ ...r, priceNow: m?.priceUsd ?? null, liquidityUsd: m?.liquidityUsd ?? 0, priceAt: now.toISOString() });
    }
  }
}

/** The change since the check, as a fraction; null without both prices. */
export const changeSinceCheck = (r: TokenRecord): number | null =>
  r.priceAtCheck && r.priceNow !== null && r.priceNow !== undefined ? r.priceNow / r.priceAtCheck - 1 : r.priceAtCheck && r.priceNow === null ? -1 : null;
