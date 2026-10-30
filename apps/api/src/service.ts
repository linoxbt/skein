import { EventEmitter } from "node:events";
import { schema, saveVerdictRun, type Db } from "@skein/db";
import type { Policy, Subject } from "@skein/engine";
import { loadCatalogue, runVerdict, type Catalogue, type PipelineEvent, type PoolResolver, type VerdictContext, type VerdictRun } from "@skein/pipeline";
import { CHECK_INTENTS, type TelegraphClient } from "@skein/telegraph";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { ApiConfig } from "./config";

export interface ServiceDeps {
  db: Db;
  config: ApiConfig;
  client: Pick<TelegraphClient, "ask" | "listMiners">;
  catalogue?: Catalogue;
  resolver?: PoolResolver;
  now?: () => Date;
  /** The purchaser wallet's address (never its key), for /v1/status. */
  payerAddress?: string;
}

export interface StartRequest {
  id: string;
  policy: Policy;
  subject: Subject;
  context: VerdictContext;
  budgetUusdc?: number;
  channel: "telegraph" | "api" | "job" | "cli";
  consumerId?: string;
  idempotencyKey?: string;
  requestHash?: string;
}

export type RunOutcome =
  | { kind: "done"; id: string }
  | { kind: "refused"; refusal: Extract<VerdictRun, { ok: false }>["plan"]["refusal"] }
  | { kind: "failed"; message: string };

const INTENTS = Object.values(CHECK_INTENTS).filter((i): i is string => !!i);

export interface VerdictEvent {
  seq: number;
  type: string;
  payload: unknown;
  ts: string;
}

const TERMINAL = new Set(["done", "refused", "error"]);

export class VerdictService {
  readonly bus = new EventEmitter();
  /**
   * Every event of a running (or just finished) verdict, in order. SSE reads
   * this rather than the table while a run is live, so no event is lost to
   * the gap between emitting it and its insert landing.
   */
  readonly buffers = new Map<string, VerdictEvent[]>();
  readonly running = new Map<string, Promise<RunOutcome>>();
  catalogue: Catalogue;
  private readonly now: () => Date;

  constructor(readonly deps: ServiceDeps) {
    this.catalogue = deps.catalogue ?? { fetchedAt: new Date(0).toISOString(), minersByIntent: {} };
    this.now = deps.now ?? (() => new Date());
    this.bus.setMaxListeners(1000);
  }

  get db(): Db {
    return this.deps.db;
  }

  /** Re-reads the live catalogue; keeps the old one if the node is unreachable. */
  async refreshCatalogue(): Promise<void> {
    const next = await loadCatalogue(this.deps.client, INTENTS);
    if (Object.values(next.minersByIntent).some((m) => m.length > 0)) this.catalogue = next;
  }

  /** A verdict for the same token and policy version younger than the cache TTL. */
  async findCached(subject: Subject, policy: Policy): Promise<string | null> {
    const since = new Date(this.now().getTime() - this.deps.config.cacheTtlSec * 1000);
    const [row] = await this.db
      .select({ id: schema.verdicts.id })
      .from(schema.verdicts)
      .where(
        and(
          eq(schema.verdicts.subjectChainId, subject.chainId),
          eq(schema.verdicts.subjectToken, subject.token),
          eq(schema.verdicts.policyId, policy.id),
          eq(schema.verdicts.policyVersion, policy.version),
          gte(schema.verdicts.createdAt, since),
        ),
      )
      .orderBy(desc(schema.verdicts.createdAt))
      .limit(1);
    return row?.id ?? null;
  }

  private startOfDay(): Date {
    const d = this.now();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  /** Upstream spend today (UTC), across all callers. */
  async spentTodayUusdc(): Promise<number> {
    const [r] = await this.db
      .select({ s: sql<string>`coalesce(sum(${schema.purchases.amountUusdc}), 0)` })
      .from(schema.purchases)
      .where(gte(schema.purchases.createdAt, this.startOfDay()));
    return Number(r?.s ?? 0);
  }

  async consumerSpentTodayUusdc(consumerId: string): Promise<number> {
    const [r] = await this.db
      .select({ s: sql<string>`coalesce(sum(${schema.verdicts.upstreamUusdc}), 0)` })
      .from(schema.verdicts)
      .where(and(eq(schema.verdicts.consumerId, consumerId), gte(schema.verdicts.createdAt, this.startOfDay())));
    return Number(r?.s ?? 0);
  }

  private async record(id: string, type: string, payload: unknown): Promise<void> {
    const buf = this.buffers.get(id) ?? [];
    this.buffers.set(id, buf);
    const event: VerdictEvent = { seq: buf.length, type, payload, ts: this.now().toISOString() };
    buf.push(event);
    this.bus.emit(id, event);
    if (TERMINAL.has(type)) setTimeout(() => this.buffers.delete(id), 60_000).unref();
    await this.db.insert(schema.events).values({ verdictId: id, type, payload: payload as object }).catch(() => {});
  }

  /** Starts a verdict in the background; the promise settles when it is stored or refused. */
  start(req: StartRequest): Promise<RunOutcome> {
    const started = this.now().getTime();
    this.buffers.set(req.id, []);
    const p = (async (): Promise<RunOutcome> => {
      try {
        const run = await runVerdict(
          { policy: req.policy, subject: req.subject, context: req.context, ...(req.budgetUusdc !== undefined ? { budgetUusdc: req.budgetUusdc } : {}) },
          {
            client: this.deps.client,
            catalogue: this.catalogue,
            priceUusdc: this.deps.config.priceUusdc,
            ...(this.deps.resolver ? { resolver: this.deps.resolver } : {}),
            now: this.now,
            onEvent: (e: PipelineEvent) => {
              const payload = e.type === "plan" ? e.plan : e.type === "purchase" ? e.purchase : e.type === "finding" ? e.finding : { verdictHash: e.verdict.verdictHash, decision: e.verdict.decision };
              void this.record(req.id, e.type, payload);
            },
          },
        );
        if (!run.ok) {
          await this.record(req.id, "refused", run.plan.refusal);
          return { kind: "refused", refusal: run.plan.refusal };
        }
        await saveVerdictRun(this.db, run, {
          id: req.id,
          channel: req.channel,
          network: this.deps.config.networkLabel ?? this.deps.config.network.caip2,
          priceUusdc: this.deps.config.priceUusdc,
          durationMs: this.now().getTime() - started,
          createdAt: this.now(),
          ...(req.consumerId ? { consumerId: req.consumerId } : {}),
          ...(req.idempotencyKey ? { idempotencyKey: req.idempotencyKey } : {}),
          ...(req.requestHash ? { requestHash: req.requestHash } : {}),
        });
        const paid = run.purchases.filter((x) => x.amountUusdc > 0);
        if (paid.length > 0) {
          await this.db.insert(schema.spendLedger).values(
            paid.map((x) => ({ kind: "purchase" as const, amountUusdc: x.amountUusdc, ref: x.receiptHash ?? req.id })),
          );
        }
        await this.record(req.id, "done", { id: req.id });
        return { kind: "done", id: req.id };
      } catch (e) {
        const message = (e as Error).message;
        await this.record(req.id, "error", { message });
        return { kind: "failed", message };
      } finally {
        this.running.delete(req.id);
      }
    })();
    this.running.set(req.id, p);
    return p;
  }
}
