import { createHmac } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  claimRun,
  finishRun,
  newVerdictId,
  savePurchase,
  saveVerdictRun,
  schema,
  spendGate,
  spentToday,
  sweepLostRuns,
  type Db,
} from "@skein/db";
import { canonicalJson, type Policy, type Subject } from "@skein/engine";
import { loadCatalogue, runVerdict, type Catalogue, type PipelineEvent, type PoolResolver, type VerdictContext, type VerdictRun } from "@skein/pipeline";
import { CHECK_INTENTS, type TelegraphClient } from "@skein/telegraph";
import { and, desc, eq, gte, lt, ne } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { ApiConfig } from "./config";
import { pinnedFetch, resolveSafeUrl, type Lookup } from "./safeurl";

export interface ServiceDeps {
  db: Db;
  config: ApiConfig;
  client: Pick<TelegraphClient, "ask" | "listMiners"> & Partial<Pick<TelegraphClient, "verifySignal">>;
  catalogue?: Catalogue;
  resolver?: PoolResolver;
  now?: () => Date;
  /** The purchaser wallet's address (never its key), for /v1/status. */
  payerAddress?: string;
  /** Webhook delivery; replaced in tests. */
  fetch?: typeof fetch;
  /** DNS for the webhook address check (safeurl.ts); replaced in tests. */
  lookup?: Lookup;
  /** Operational alerts (alerts.ts): unhandled errors are raised here. */
  alerts?: { raise(key: string, message: string): Promise<boolean> };
}

export interface Consumer {
  id: string;
  dailyCapUusdc: number;
}

export interface StartRequest {
  id: string;
  policy: Policy;
  policySha256: string;
  subject: Subject;
  context: VerdictContext;
  contextHash: string;
  budgetUusdc?: number;
  channel: "telegraph" | "api" | "job" | "cli";
  consumer?: Consumer;
  idempotencyKey?: string;
  requestHash?: string;
  /** The caller already claimed the run row (the API does, for idempotency). */
  claimed?: boolean;
}

export type Refusal = Extract<VerdictRun, { ok: false }>["plan"]["refusal"];

export type RunOutcome =
  | { kind: "done"; id: string }
  | { kind: "refused"; refusal: Refusal }
  | { kind: "failed"; message: string };

const INTENTS = Object.values(CHECK_INTENTS).filter((i): i is string => !!i);

export interface VerdictEvent {
  seq: number;
  type: string;
  payload: unknown;
  ts: string;
}

const TERMINAL = new Set(["done", "refused", "error"]);
/** What a caller is told when a run fails: no internals (they go to the log). */
export const FAILED_MESSAGE = "the verdict could not be completed; any upstream spend is recorded";

/** The context, normalised, so equal requests hash equally and the cache never serves another context's verdict. */
export function normaliseContext(c: VerdictContext): VerdictContext {
  const lower = (s?: string) => s?.toLowerCase();
  return JSON.parse(
    canonicalJson({
      deployer: lower(c.deployer),
      pool: lower(c.pool),
      repoUrl: c.repoUrl?.replace(/\/+$/, ""),
      socialHandle: c.socialHandle?.replace(/^@/, "").toLowerCase(),
      treasuryAddresses: c.treasuryAddresses?.map((a) => a.toLowerCase()).sort(),
    }),
  ) as VerdictContext;
}

export function contextHash(c: VerdictContext): string {
  return createHash("sha256").update(canonicalJson(normaliseContext(c))).digest("hex");
}

export class VerdictService {
  readonly bus = new EventEmitter();
  /**
   * Every event of a running (or just finished) verdict, in order. SSE reads
   * this rather than the table while a run is live, so no event is lost to
   * the gap between emitting it and its insert landing.
   */
  readonly buffers = new Map<string, VerdictEvent[]>();
  readonly running = new Map<string, Promise<RunOutcome>>();
  /** Background refreshes in flight, by cache key (D5). */
  private readonly refreshing = new Set<string>();
  catalogue: Catalogue;
  private readonly now: () => Date;
  private draining = false;

  constructor(readonly deps: ServiceDeps) {
    this.catalogue = deps.catalogue ?? { fetchedAt: new Date(0).toISOString(), minersByIntent: {} };
    this.now = deps.now ?? (() => new Date());
    this.bus.setMaxListeners(1000);
  }

  get db(): Db {
    return this.deps.db;
  }

  get accepting(): boolean {
    return !this.draining;
  }

  /** Re-reads the live catalogue; keeps the old one if the node is unreachable. */
  async refreshCatalogue(): Promise<void> {
    const next = await loadCatalogue(this.deps.client, INTENTS);
    if (Object.values(next.minersByIntent).some((m) => m.length > 0)) this.catalogue = next;
  }

  /**
   * A verdict for the same token, policy version and request context younger
   * than the cache TTL. ABSTAIN is never served from cache: it is usually a
   * transient upstream failure, and a retry deserves a fresh attempt.
   */
  async findCached(subject: Subject, policy: Policy, ctxHash: string): Promise<{ id: string; createdAt: Date } | null> {
    const since = new Date(this.now().getTime() - this.deps.config.cacheTtlSec * 1000);
    const [row] = await this.db
      .select({ id: schema.verdicts.id, createdAt: schema.verdicts.createdAt })
      .from(schema.verdicts)
      .where(
        and(
          eq(schema.verdicts.subjectChainId, subject.chainId),
          eq(schema.verdicts.subjectToken, subject.token),
          eq(schema.verdicts.policyId, policy.id),
          eq(schema.verdicts.policyVersion, policy.version),
          eq(schema.verdicts.contextHash, ctxHash),
          ne(schema.verdicts.verdict, "ABSTAIN"),
          gte(schema.verdicts.createdAt, since),
        ),
      )
      .orderBy(desc(schema.verdicts.createdAt))
      .limit(1);
    return row ?? null;
  }

  /** Upstream spend today (UTC), held or settled, across all callers or one channel. */
  spentTodayUusdc(where: { channel?: string; consumerId?: string } = {}): Promise<number> {
    return spentToday(this.db, this.now(), where);
  }

  private async record(id: string, type: string, payload: unknown): Promise<void> {
    const buf = this.buffers.get(id) ?? [];
    this.buffers.set(id, buf);
    const event: VerdictEvent = { seq: buf.length, type, payload, ts: this.now().toISOString() };
    buf.push(event);
    this.bus.emit(id, event);
    if (TERMINAL.has(type)) setTimeout(() => this.buffers.delete(id), 60_000).unref();
    await this.db
      .insert(schema.events)
      .values({ verdictId: id, seq: event.seq, type, payload: payload as object })
      .catch((e: Error) => console.error(`event ${id}#${event.seq} not stored: ${e.message}`));
  }

  /**
   * Starts a verdict in the background; the promise settles when it is stored
   * or refused. Every purchase is written as it is paid and every payment
   * holds daily spend first, so a crash loses neither receipts nor the count.
   */
  start(req: StartRequest): Promise<RunOutcome> {
    if (this.draining) return Promise.resolve({ kind: "failed", message: "shutting down" });
    const started = this.now().getTime();
    const { config } = this.deps;
    this.buffers.set(req.id, []);
    const p = (async (): Promise<RunOutcome> => {
      try {
        if (!req.claimed) {
          await claimRun(this.db, {
            id: req.id, channel: req.channel, subjectChainId: req.subject.chainId, subjectToken: req.subject.token,
            policyId: req.policy.id, policyVersion: req.policy.version, contextHash: req.contextHash,
            ...(req.consumer ? { consumerId: req.consumer.id } : {}),
          });
        }
        const spend = spendGate(this.db, {
          runId: req.id,
          channel: req.channel,
          ...(req.consumer ? { consumerId: req.consumer.id } : {}),
          caps: {
            dailyUusdc: config.dailyCapUusdc,
            ...(req.consumer ? { consumerDailyUusdc: req.consumer.dailyCapUusdc } : {}),
            // Uncached Telegraph requests (spot checks among them) have their own day budget (D5).
            ...(req.channel === "telegraph" ? { channelDailyUusdc: config.spotcheckDailyCapUusdc } : {}),
          },
          now: this.now,
        });
        const run = await runVerdict(
          {
            policy: req.policy,
            policySha256: req.policySha256,
            subject: req.subject,
            context: req.context,
            budgetUusdc: Math.min(req.budgetUusdc ?? Infinity, config.perVerdictCapUusdc),
          },
          {
            client: this.deps.client,
            catalogue: this.catalogue,
            priceUusdc: config.priceUusdc,
            ...(this.deps.resolver ? { resolver: this.deps.resolver } : {}),
            spend,
            excludeMinerIds: config.selfRegistrationIds,
            onPurchase: (purchase) => savePurchase(this.db, req.id, purchase),
            deadlineMs: config.verdictDeadlineMs,
            now: this.now,
            onEvent: (e: PipelineEvent) => {
              const payload = e.type === "plan" ? e.plan : e.type === "purchase" ? e.purchase : e.type === "finding" ? e.finding : { verdictHash: e.verdict.verdictHash, decision: e.verdict.decision };
              void this.record(req.id, e.type, payload);
            },
          },
        );
        if (!run.ok) {
          await finishRun(this.db, req.id, { status: "refused", outcome: run.plan.refusal, at: this.now() });
          await this.record(req.id, "refused", run.plan.refusal);
          void this.notify(req, { status: "refused", refusal: run.plan.refusal });
          return { kind: "refused", refusal: run.plan.refusal };
        }
        const upstream = run.purchases.reduce((a, x) => a + x.amountUusdc, 0);
        // ABSTAIN is charged at upstream cost only: a refusal to guess is not sold at the full price.
        const abstain = run.verdict.decision.verdict === "ABSTAIN";
        const priceUusdc = abstain ? upstream : config.priceUusdc;
        await saveVerdictRun(this.db, run, {
          id: req.id,
          channel: req.channel,
          network: config.networkLabel ?? config.network.caip2,
          priceUusdc,
          pricingRule: abstain ? "abstain_upstream_only" : "standard",
          contextHash: req.contextHash,
          purchasesStored: true,
          durationMs: this.now().getTime() - started,
          createdAt: this.now(),
          ...(req.consumer ? { consumerId: req.consumer.id } : {}),
          ...(req.idempotencyKey ? { idempotencyKey: req.idempotencyKey } : {}),
          ...(req.requestHash ? { requestHash: req.requestHash } : {}),
        });
        const ledger = [
          ...run.purchases.filter((x) => x.amountUusdc > 0).map((x) => ({ kind: "purchase" as const, amountUusdc: x.amountUusdc, ref: x.receiptHash ?? `${req.id}:${x.check}` })),
          // Telegraph settles what callers pay through the network; partner keys are free during the hackathon.
          ...(req.channel === "telegraph" && priceUusdc > 0 ? [{ kind: "revenue_owed" as const, amountUusdc: priceUusdc, ref: req.id }] : []),
        ];
        if (ledger.length > 0) await this.db.insert(schema.spendLedger).values(ledger);
        await finishRun(this.db, req.id, { status: "done", verdictId: req.id, at: this.now() });
        await this.record(req.id, "done", { id: req.id });
        void this.notify(req, { status: "done", id: req.id, verdict: run.verdict.decision.verdict, verdictHash: run.verdict.verdictHash });
        return { kind: "done", id: req.id };
      } catch (e) {
        console.error(`verdict ${req.id} failed:`, e);
        await finishRun(this.db, req.id, { status: "failed", outcome: { code: "VERDICT_FAILED", message: FAILED_MESSAGE }, at: this.now() }).catch(() => {});
        await this.record(req.id, "error", { message: FAILED_MESSAGE });
        return { kind: "failed", message: FAILED_MESSAGE };
      } finally {
        this.running.delete(req.id);
      }
    })();
    this.running.set(req.id, p);
    return p;
  }

  /**
   * D5: a cache hit older than CACHE_REFRESH_MIN_AGE_SEC starts one
   * background refresh (never two for the same key), spending from the same
   * capped budgets, so spot checks keep seeing fresh verdicts without each
   * one buying.
   */
  maybeRefresh(req: Omit<StartRequest, "id" | "channel">, cachedAt: Date): boolean {
    const age = (this.now().getTime() - cachedAt.getTime()) / 1000;
    const key = `${req.subject.chainId}:${req.subject.token}:${req.policy.id}@${req.policy.version}:${req.contextHash}`;
    if (age < this.deps.config.cacheRefreshMinAgeSec || this.refreshing.has(key) || this.draining) return false;
    this.refreshing.add(key);
    void this.start({ ...req, id: newVerdictId(), channel: "job" }).finally(() => this.refreshing.delete(key));
    return true;
  }

  /** Signed webhook to the consumer's registered URL; three tries, never blocks the run. */
  private async notify(req: StartRequest, body: Record<string, unknown>): Promise<void> {
    if (!req.consumer || req.channel !== "api") return;
    const hooks = await this.db
      .select()
      .from(schema.webhooks)
      .where(and(eq(schema.webhooks.consumerId, req.consumer.id), eq(schema.webhooks.active, true)))
      .catch(() => []);
    const payload = JSON.stringify({ event: `verdict.${body.status}`, runId: req.id, ...body });
    for (const h of hooks) {
      // DNS can change after registration: check the address again before sending,
      // and connect to exactly the address checked (no second lookup to rebind).
      const safe = await resolveSafeUrl(h.url, this.deps.lookup);
      if (!safe.ok) {
        console.warn(JSON.stringify({ level: "warn", msg: "webhook not delivered", reason: safe.reason, consumer: req.consumer.id }));
        continue;
      }
      const send = this.deps.fetch ?? pinnedFetch(safe.address, safe.family);
      const sig = createHmac("sha256", h.secret).update(payload).digest("hex");
      for (let attempt = 0; attempt < 3; attempt++) {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 5_000);
        try {
          const res = await send(h.url, {
            method: "POST",
            headers: { "content-type": "application/json", "x-skein-signature": `sha256=${sig}`, "x-skein-event": `verdict.${body.status}` },
            body: payload,
            signal: ctl.signal,
            // A redirect could point anywhere, including inward: never follow one.
            redirect: "manual",
          });
          if (res.ok) break;
          if (res.status >= 300 && res.status < 400) break;
        } catch {
          // retried below
        } finally {
          clearTimeout(t);
        }
        await new Promise((r) => setTimeout(r, 1000 * 4 ** attempt).unref());
      }
    }
  }

  /** Marks runs that never finished (a crash or redeploy) as lost. */
  sweep(): Promise<number> {
    return sweepLostRuns(this.db, new Date(this.now().getTime() - this.deps.config.verdictDeadlineMs - 60_000));
  }

  /** Drops SSE event rows past retention; they back the stream, they are not evidence. */
  async pruneEvents(): Promise<void> {
    const cutoff = new Date(this.now().getTime() - this.deps.config.eventRetentionDays * 86_400_000);
    await this.db.delete(schema.events).where(lt(schema.events.ts, cutoff));
  }

  /** Stops new runs and waits (up to timeoutMs) for running ones to store their result. */
  async drain(timeoutMs: number): Promise<void> {
    this.draining = true;
    const all = Promise.allSettled([...this.running.values()]);
    await Promise.race([all, new Promise((r) => setTimeout(r, timeoutMs).unref())]);
  }
}
