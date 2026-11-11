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
  /** Only buy a verdict for a token a sniper could actually trade: this much liquidity. */
  minLiquidityUsd: number;
  /** Paid verdicts per UTC day, and per tick, whatever the launch rate. */
  dailyChecks: number;
  checksPerTick: number;
  /** The paper position taken on APPROVE, in USD. */
  ticketUsd: number;
  /** Refresh the price of checked tokens this often, for this long after the check. */
  priceRefreshMin: number;
  trackHours: number;
}

export const DEFAULTS: SniperConfig = {
  policy: "agent-pretrade@0.3.0",
  minAgeMin: 5,
  maxAgeMin: 360,
  minLiquidityUsd: 10_000,
  dailyChecks: 40,
  checksPerTick: 2,
  ticketUsd: 100,
  priceRefreshMin: 10,
  trackHours: 72,
};

export interface AgentDeps {
  store: Store;
  market: MarketSource;
  skein: Skein;
  /** Polls the chain for new pools; omitted in tests that feed launches directly. */
  watch?: () => Promise<Launch[]>;
  /** Checks a verdict's Skein signature; null when no attester is pinned. */
  verify?: (v: VerdictResult) => Promise<boolean | null>;
  now?: () => Date;
  log?: (msg: string) => void;
  config?: Partial<SniperConfig>;
}

const minutes = (a: Date, b: string) => (a.getTime() - Date.parse(b)) / 60_000;
const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * The rug-proof sniper. Each tick: record new launches; look at the ones old
 * enough; buy one Skein verdict for each token that reached tradeable
 * liquidity; take a paper position only on APPROVE; and keep pricing every
 * checked token, so the record shows what the gate avoided.
 */
export class Sniper {
  readonly cfg: SniperConfig;
  private lastPriceRefresh = 0;
  private busy = false;
  constructor(private readonly d: AgentDeps) {
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
      await this.screen();
      await this.refreshPrices();
    } finally {
      this.busy = false;
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
    if (!ready.length) return;
    const used = (await this.d.store.stats(startOfUtcDay(now))).checked;
    const room = Math.max(0, Math.min(this.cfg.checksPerTick, this.cfg.dailyChecks - used));
    // Deepest first: the tokens a sniper is most likely to actually trade.
    for (const r of ready.sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0)).slice(0, room)) await this.check(r);
  }

  /** One paid verdict, one decision. */
  async check(r: TokenRecord): Promise<TokenRecord> {
    const started = this.now();
    await this.d.store.save({ ...r, status: "checking" });
    try {
      const v = await this.d.skein.verdict({
        subject: { chainId: 8453, token: r.token },
        policy: this.cfg.policy,
        ...(r.pool ? { context: { pool: r.pool } } : {}),
        idempotencyKey: `sniper-${r.token}`,
      });
      const buy = v.verdict === "APPROVE";
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
        paidUsdc: v.cached || v.replayed ? 0 : v.payment.rail === "telegraph" ? v.payment.amountUsdc : 0,
        upstreamUsdc: v.cost.upstreamUsdc,
        receipts: v.bom.items,
        rail: v.payment.rail,
        receiptHash: v.payment.rail === "telegraph" ? v.payment.receiptHash : null,
        verdictHash: v.verdictHash,
        signatureOk: this.d.verify ? await this.d.verify(v).catch(() => false) : null,
        latencyMs: this.now().getTime() - started.getTime(),
        priceAtCheck: r.priceNow ?? null,
        liquidityAtCheck: r.liquidityUsd ?? null,
        priceAt: started.toISOString(),
      };
      await this.d.store.save(done);
      this.log(`${buy ? "BUY (paper)" : "SKIP"} ${r.symbol ?? r.token}: ${v.verdict} ${v.riskBps} bps`);
      return done;
    } catch (e) {
      const why = e instanceof SkeinError ? `${e.code}: ${e.message}` : (e as Error).message;
      const failed: TokenRecord = {
        ...r,
        status: "error",
        checkedAt: started.toISOString(),
        action: "skip",
        note: why,
        // Money that moved without a verdict still counts.
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
