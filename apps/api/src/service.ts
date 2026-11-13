import { createHash } from "node:crypto";
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
import { and, desc, eq, gte, lt, ne, sql } from "drizzle-orm";
import { Attester } from "./attest";
import type { ApiConfig } from "./config";
import { acquireFlight, releaseFlight } from "./limits";
import { pinnedFetch, resolveSafeUrl, type Lookup } from "./safeurl";
import { openSecret, webhookEvent, webhookHeaders } from "./webhooks";

export interface ServiceDeps {
  db: Db;
  /** The database role runtime queries use (db.ts connectForRuntime); shown at /v1/status. */
  dbRole?: string;
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
  /** Error tracking (@skein/errors, Sentry): unhandled errors are reported here with their request id. */
  errors?: { capture(error: unknown, context?: Record<string, string | number | boolean | null | undefined>): Promise<boolean> };
  /** Reaches the x402 facilitator (x402.ts); tests pass a fake. */
  facilitatorFetch?: typeof fetch;
  /** Reads a subject's bytecode for the "not a contract" check; tests pass a fake. */
  getCode?: (chainId: number, address: string) => Promise<string | null>;
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
  /** The channel whose daily cap this run's spend counts against (a refresh job counts against Telegraph's). */
  capChannel?: "telegraph" | "api" | "job" | "cli";
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

/**
 * A miner's raw answer is public in the event stream; past this size it is
 * replaced by its size and hash (the full answer stays in the purchase record
 * and in /v1/verify's inputs).
 */
export const MAX_EVENT_RAW_BYTES = 8 * 1024;

/** The pricing rule a verdict was sold under (verdicts.pricing_rule). */
export function pricingFor(channel: StartRequest["channel"], verdict: string, upstreamUusdc: number, priceUusdc: number): { priceUusdc: number; rule: string } {
  // Spec §6. Through Telegraph the network bills every answer, ABSTAIN included, at the floor.
  if (channel === "telegraph") return { priceUusdc, rule: "telegraph_floor" };
  // On the direct API, ABSTAIN is charged at upstream cost only: a refusal to guess is not sold at the full price.
  if (verdict === "ABSTAIN") return { priceUusdc: upstreamUusdc, rule: "abstain_upstream_only" };
  return { priceUusdc, rule: "standard" };
}

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

/** One in-progress verdict per token, policy and context, across replicas (the flights lease). */
export const flightKey = (subject: Subject, policyRef: string, ctxHash: string) => `${subject.chainId}:${subject.token}:${policyRef}:${ctxHash}`;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** A purchase as the public event stream shows it: raw answers over MAX_EVENT_RAW_BYTES are summarised. */
export function publicPurchase<T extends { rawResult?: unknown }>(p: T): T | (Omit<T, "rawResult"> & { rawResult: { truncated: true; bytes: number; sha256: string } }) {
  if (p.rawResult === undefined) return p;
  const raw = JSON.stringify(p.rawResult) ?? "";
  if (raw.length <= MAX_EVENT_RAW_BYTES) return p;
  return { ...p, rawResult: { truncated: true, bytes: Buffer.byteLength(raw), sha256: sha256(raw) } };
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
  /** Webhook deliveries in flight; shutdown waits for them (bounded). */
  readonly deliveries = new Set<Promise<void>>();
  /** Background refreshes in flight, by cache key (D5). */
  private readonly refreshing = new Set<string>();
  readonly attester: Attester;
  catalogue: Catalogue;
  private readonly now: () => Date;
  private draining = false;

  constructor(readonly deps: ServiceDeps) {
    this.catalogue = deps.catalogue ?? { fetchedAt: new Date(0).toISOString(), minersByIntent: {} };
    this.now = deps.now ?? (() => new Date());
    this.bus.setMaxListeners(1000);
    this.attester = new Attester(deps.db, deps.config.attestationKey);
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
   * Keeps an error in error_log (30 days) and reports it to error tracking, so
   * /v1/status's errorsLastHour and Sentry see it. Never throws.
   */
  async logError(err: unknown, route: string, requestId?: string): Promise<void> {
    const e = err instanceof Error ? err : new Error(String(err));
    void this.deps.errors?.capture(e, { route, ...(requestId ? { requestId } : {}) });
    const message = `${e.name}: ${e.message}`.slice(0, 1000);
    const fingerprint = sha256(`${e.name}:${(e.message.split("\n")[0] ?? "").replace(/[0-9a-f]{8,}|\d+/gi, "#")}:${route.replace(/\/(vrd|run)_[\w-]+|\/0x[0-9a-fA-F]+/g, "/:id")}`).slice(0, 16);
    await this.db
      .insert(schema.errorLog)
      .values({ service: "skein-api", fingerprint, message, route, requestId: requestId ?? null, stack: e.stack?.slice(0, 8000) ?? null })
      .catch(() => {});
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
        const capChannel = req.capChannel ?? req.channel;
        const spend = spendGate(this.db, {
          runId: req.id,
          channel: capChannel,
          ...(req.consumer ? { consumerId: req.consumer.id } : {}),
          caps: {
            dailyUusdc: config.stopAtUusdc,
            ...(req.consumer ? { consumerDailyUusdc: req.consumer.dailyCapUusdc } : {}),
            // Uncached Telegraph requests (spot checks and the refreshes they start) have their own day budget (D5).
            ...(capChannel === "telegraph" ? { channelDailyUusdc: config.spotcheckDailyCapUusdc } : {}),
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
            // Sealed into the hash (engine 0.4.0): a verdict bought from the local fake node says so.
            ...(config.networkLabel === "simulated" ? { mode: "simulated" as const } : {}),
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
            // Problems that must not stop the verdict (a spend settlement that failed) reach error_log and Sentry.
            log: (msg, detail) => {
              console.error(JSON.stringify({ level: "error", msg, runId: req.id, ...detail }));
              void this.logError(new Error(`${msg}: ${JSON.stringify(detail)}`.slice(0, 900)), `run ${req.channel}`, req.id);
            },
            now: this.now,
            onEvent: (e: PipelineEvent) => {
              const payload = e.type === "plan" ? e.plan : e.type === "purchase" ? publicPurchase(e.purchase) : e.type === "finding" ? e.finding : { verdictHash: e.verdict.verdictHash, decision: e.verdict.decision };
              void this.record(req.id, e.type, payload);
            },
          },
        );
        if (!run.ok) {
          await finishRun(this.db, req.id, { status: "refused", outcome: run.plan.refusal, at: this.now() });
          await this.record(req.id, "refused", run.plan.refusal);
          this.track(this.notify(req, { status: "refused", refusal: run.plan.refusal }));
          return { kind: "refused", refusal: run.plan.refusal };
        }
        const upstream = run.purchases.reduce((a, x) => a + x.amountUusdc, 0);
        const pricing = pricingFor(req.channel, run.verdict.decision.verdict, upstream, config.priceUusdc);
        await saveVerdictRun(this.db, run, {
          id: req.id,
          channel: req.channel,
          network: config.networkLabel ?? config.network.caip2,
          priceUusdc: pricing.priceUusdc,
          pricingRule: pricing.rule,
          contextHash: req.contextHash,
          purchasesStored: true,
          durationMs: this.now().getTime() - started,
          createdAt: this.now(),
          ...(req.consumer ? { consumerId: req.consumer.id } : {}),
          // The idempotency key lives on the run (verdict_runs), where it can expire; the sealed verdict does not carry it.
          ...(req.requestHash ? { requestHash: req.requestHash } : {}),
        });
        // Signed as it is sealed, and stored: what /v1/verify checks later is this signature.
        await this.attester.seal(req.id);
        // Revenue is recorded where it is earned: per answered Telegraph call (/miner/verdict) and per settled x402 payment.
        const ledger = run.purchases.filter((x) => x.amountUusdc > 0).map((x) => ({ kind: "purchase" as const, amountUusdc: x.amountUusdc, ref: x.receiptHash ?? `${req.id}:${x.check}` }));
        if (ledger.length > 0) await this.db.insert(schema.spendLedger).values(ledger);
        await finishRun(this.db, req.id, { status: "done", verdictId: req.id, at: this.now() });
        await this.record(req.id, "done", { id: req.id });
        this.track(this.notify(req, { status: "done", id: req.id, verdict: run.verdict.decision.verdict, verdictHash: run.verdict.verdictHash }));
        return { kind: "done", id: req.id };
      } catch (e) {
        console.error(`verdict ${req.id} failed:`, e);
        await this.logError(e, `run ${req.channel}`, req.id);
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

  private track(p: Promise<void>): void {
    const q = p.catch((e: Error) => console.error(JSON.stringify({ level: "error", msg: "webhook delivery failed", error: e.message })));
    this.deliveries.add(q);
    void q.finally(() => this.deliveries.delete(q));
  }

  /**
   * D5: a cache hit older than CACHE_REFRESH_MIN_AGE_SEC starts one
   * background refresh (never two for the same key, on any replica: the
   * flights lease), spending from the Telegraph channel's day budget, so spot
   * checks keep seeing fresh verdicts without each one buying.
   */
  maybeRefresh(req: Omit<StartRequest, "id" | "channel">, cachedAt: Date, policyRef: string): boolean {
    const age = (this.now().getTime() - cachedAt.getTime()) / 1000;
    const key = flightKey(req.subject, policyRef, req.contextHash);
    if (age < this.deps.config.cacheRefreshMinAgeSec || this.refreshing.has(key) || this.draining) return false;
    this.refreshing.add(key);
    const id = newVerdictId(this.now().getTime());
    void (async () => {
      try {
        // Another replica (or a live request) is already buying this one.
        if (await acquireFlight(this.db, key, id, this.deps.config.verdictDeadlineMs + 60_000)) return;
        try {
          await this.start({ ...req, id, channel: "job", capChannel: "telegraph" });
        } finally {
          await releaseFlight(this.db, key, id).catch(() => {});
        }
      } catch (e) {
        console.error(JSON.stringify({ level: "error", msg: "background refresh failed", key, error: (e as Error).message }));
      } finally {
        this.refreshing.delete(key);
      }
    })();
    return true;
  }

  /**
   * Signed webhook to the consumer's registered URL; three tries, never blocks
   * the run. Headers and body: webhooks.ts.
   */
  private async notify(req: StartRequest, body: Record<string, unknown>): Promise<void> {
    if (!req.consumer || req.channel !== "api") return;
    const hooks = await this.db
      .select()
      .from(schema.webhooks)
      .where(and(eq(schema.webhooks.consumerId, req.consumer.id), eq(schema.webhooks.active, true)))
      .catch(() => []);
    const event = webhookEvent(String(body.status));
    const payload = JSON.stringify({ event, legacyEvent: `verdict.${body.status}`, runId: req.id, ...body });
    for (const h of hooks) {
      const secret = openSecret(h.secret, h.secretHash, this.deps.config.webhookSecretKey);
      if (!secret) {
        console.error(JSON.stringify({ level: "error", msg: "webhook not delivered: its secret cannot be read (WEBHOOK_SECRET_KEY missing or changed)", consumer: req.consumer.id }));
        continue;
      }
      // DNS can change after registration: check the address again before sending,
      // and connect to exactly the address checked (no second lookup to rebind).
      const safe = await resolveSafeUrl(h.url, this.deps.lookup);
      if (!safe.ok) {
        console.warn(JSON.stringify({ level: "warn", msg: "webhook not delivered", reason: safe.reason, consumer: req.consumer.id }));
        continue;
      }
      const send = this.deps.fetch ?? pinnedFetch(safe.address, safe.family);
      for (let attempt = 0; attempt < 3; attempt++) {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 5_000);
        try {
          // Signed per attempt: the timestamp is the moment of sending, so a retry is fresh too.
          const res = await send(h.url, {
            method: "POST",
            headers: webhookHeaders(secret, payload, Math.floor(this.now().getTime() / 1000), event),
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
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * 4 ** attempt).unref());
      }
    }
  }

  /**
   * Marks runs that never finished (a crash or redeploy) as lost, and records
   * the x402 refund a lost paid run is owed (a retry with the same payment
   * re-runs it and cancels the refund).
   */
  async sweep(): Promise<number> {
    const n = await sweepLostRuns(this.db, new Date(this.now().getTime() - this.deps.config.verdictDeadlineMs - 60_000));
    if (n > 0) {
      await this.db.execute(sql`
        UPDATE x402_payments p SET refund_uusdc = p.amount_uusdc, refund_reason = 'LOST: the run stopped before it finished', updated_at = now()
        FROM verdict_runs r
        WHERE r.id = p.run_id AND r.status = 'lost' AND p.status = 'settled' AND p.refunded_at IS NULL AND p.refund_uusdc = 0`);
    }
    return n;
  }

  /** Drops SSE event rows past retention; they back the stream, they are not evidence. */
  async pruneEvents(): Promise<void> {
    const cutoff = new Date(this.now().getTime() - this.deps.config.eventRetentionDays * 86_400_000);
    await this.db.delete(schema.events).where(lt(schema.events.ts, cutoff));
  }

  /**
   * Stops new runs and waits (up to timeoutMs in all) for running ones to
   * store their result, then for the webhook deliveries they started.
   */
  async drain(timeoutMs: number): Promise<void> {
    this.draining = true;
    const until = Date.now() + timeoutMs;
    const wait = (ps: Promise<unknown>[]) => Promise.race([Promise.allSettled(ps), new Promise((r) => setTimeout(r, Math.max(0, until - Date.now())).unref())]);
    await wait([...this.running.values()]);
    await wait([...this.deliveries]);
  }
}
