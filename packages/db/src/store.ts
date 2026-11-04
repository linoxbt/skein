import { canonicalJson, type Finding, type StoredPurchase, type StoredVerdict } from "@skein/engine";
import { and, asc, eq, lt, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** The parts of a pipeline run the store needs (structural, so this package does not depend on the pipeline). */
export interface RunToStore {
  verdict: {
    engineVersion: string;
    policy: { id: string; version: string; sha256?: string };
    subject: { chainId: number; token: string };
    decision: {
      verdict: "APPROVE" | "REJECT" | "ESCALATE" | "ABSTAIN";
      verdictCode: number;
      riskBps: number;
      confidenceBps: number;
      coverageBps: number;
      reasons: unknown[];
      openRisks: string[];
      conflicts: string[];
    };
    summary: string;
    findings: Finding[];
    verdictHash: string;
    bom: { root: string; items: number };
  };
  purchases: (Omit<StoredPurchase, "rawResult"> & {
    rawResult?: unknown;
    intent: string;
    minerName?: string;
    pinned: boolean;
    skipped?: string[];
    rail: string;
    amountUusdc: number;
    epochId?: number;
    durationMs: number;
    attempts: number;
    resultShape?: string;
    billing?: string;
    signalStatus?: string;
    pool?: string;
    createdAt: string;
  })[];
  stored: Pick<StoredVerdict, "unpurchased">;
}

export type PurchaseToStore = RunToStore["purchases"][number];

export interface VerdictMeta {
  channel: "telegraph" | "api" | "job" | "cli";
  network: string;
  priceUusdc: number;
  durationMs: number;
  consumerId?: string;
  idempotencyKey?: string;
  requestHash?: string;
  id?: string;
  /** Defaults to the database clock; pass the caller's clock to keep one time source. */
  createdAt?: Date;
  /** Purchases were written one by one as they were paid (savePurchase); don't write them again. */
  purchasesStored?: boolean;
  pricingRule?: string;
  contextHash?: string;
}

/** Time-sortable verdict id. */
export function newVerdictId(now = Date.now()): string {
  const rand = crypto.getRandomValues(new Uint8Array(8));
  return `vrd_${now.toString(36)}${[...rand].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 12)}`;
}

function purchaseRow(runId: string, p: PurchaseToStore) {
  return {
    verdictId: runId,
    check: p.check,
    intent: p.intent,
    minerId: p.minerId ?? null,
    minerName: p.minerName ?? null,
    pinned: p.pinned,
    skipped: p.skipped ?? null,
    rail: p.rail,
    httpStatus: p.httpStatus ?? null,
    receiptHash: p.receiptHash ?? null,
    signalHash: p.signalHash ?? null,
    amountUusdc: p.amountUusdc,
    epochId: p.epochId ?? null,
    durationMs: p.durationMs,
    attempts: p.attempts,
    resultShape: p.resultShape ?? null,
    rawResult: p.rawResult === undefined ? null : (p.rawResult as object),
    error: p.error ?? null,
    sourceGroup: p.sourceGroup,
    adapterVersion: p.adapterVersion,
    billing: p.billing ?? "paid",
    signalStatus: p.signalStatus ?? null,
    pool: p.pool ?? null,
    createdAt: new Date(p.createdAt),
  };
}

/**
 * Writes one upstream attempt the moment it settles, under its run. A crash
 * after this point cannot lose the receipt (or the spend) of a paid answer.
 */
export async function savePurchase(db: Db, runId: string, p: PurchaseToStore): Promise<void> {
  await db.insert(schema.purchases).values(purchaseRow(runId, p));
}

export type RunRow = typeof schema.verdictRuns.$inferSelect;
export type NewRun = Omit<typeof schema.verdictRuns.$inferInsert, "status">;

/**
 * Claims a run before anything is bought. With an idempotency key, the claim
 * is atomic: a second request with the same key gets the existing run back
 * instead of buying another verdict, whatever the timing.
 */
export async function claimRun(db: Db, run: NewRun): Promise<{ claimed: true } | { claimed: false; existing: RunRow }> {
  const inserted = await db
    .insert(schema.verdictRuns)
    .values({ ...run, status: "running" })
    .onConflictDoNothing({ target: [schema.verdictRuns.consumerId, schema.verdictRuns.idempotencyKey] })
    .returning({ id: schema.verdictRuns.id });
  if (inserted.length > 0) return { claimed: true };
  const [existing] = await db
    .select()
    .from(schema.verdictRuns)
    .where(and(eq(schema.verdictRuns.consumerId, run.consumerId!), eq(schema.verdictRuns.idempotencyKey, run.idempotencyKey!)));
  if (!existing) throw new Error("run claim lost and no existing run found");
  return { claimed: false, existing };
}

export async function finishRun(db: Db, id: string, end: { status: "done" | "refused" | "failed"; verdictId?: string; outcome?: unknown; at?: Date }): Promise<void> {
  await db
    .update(schema.verdictRuns)
    .set({
      status: end.status,
      finishedAt: end.at ?? new Date(),
      ...(end.verdictId ? { verdictId: end.verdictId } : {}),
      ...(end.outcome !== undefined ? { outcome: end.outcome as object } : {}),
    })
    .where(and(eq(schema.verdictRuns.id, id), eq(schema.verdictRuns.status, "running")));
}

export async function getRun(db: Db, id: string): Promise<RunRow | null> {
  const [r] = await db.select().from(schema.verdictRuns).where(eq(schema.verdictRuns.id, id));
  return r ?? null;
}

/** Marks runs still "running" since before `olderThan` as lost (a crash or redeploy). */
export async function sweepLostRuns(db: Db, olderThan: Date): Promise<number> {
  const rows = await db
    .update(schema.verdictRuns)
    .set({ status: "lost", finishedAt: new Date(), outcome: { code: "LOST", message: "the run stopped before it finished; any spend is recorded" } })
    .where(and(eq(schema.verdictRuns.status, "running"), lt(schema.verdictRuns.startedAt, olderThan)))
    .returning({ id: schema.verdictRuns.id });
  return rows.length;
}

export interface SpendCaps {
  /** Across every channel and caller. */
  dailyUusdc: number;
  /** This consumer's own daily cap. */
  consumerDailyUusdc?: number;
  /** This channel's daily cap (e.g. uncached Telegraph requests). */
  channelDailyUusdc?: number;
}

/** A UTC day key, so every replica agrees on which day a hold belongs to. */
export const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Holds daily spend before each payment, atomically: an advisory lock
 * serialises every reservation, so concurrent verdicts cannot pass a cap
 * together. A hold counts at its reservation until settled with what was
 * spent; a hold from a crashed run stays counted. Matches the pipeline's
 * SpendGate (structurally).
 */
export function spendGate(db: Db, args: { runId: string; channel: string; consumerId?: string; caps: SpendCaps; now?: () => Date }) {
  const now = args.now ?? (() => new Date());
  return {
    async reserve(uusdc: number): Promise<{ settle(spentUusdc: number): Promise<void> } | null> {
      const day = utcDay(now());
      const holdId = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(7_405_301)`);
        const used = sql<string>`coalesce(sum(coalesce(${schema.spendHolds.spentUusdc}, ${schema.spendHolds.reservedUusdc})), 0)`;
        const [all] = await tx.select({ s: used }).from(schema.spendHolds).where(eq(schema.spendHolds.day, day));
        if (Number(all?.s ?? 0) + uusdc > args.caps.dailyUusdc) return null;
        if (args.consumerId && args.caps.consumerDailyUusdc !== undefined) {
          const [mine] = await tx.select({ s: used }).from(schema.spendHolds).where(and(eq(schema.spendHolds.day, day), eq(schema.spendHolds.consumerId, args.consumerId)));
          if (Number(mine?.s ?? 0) + uusdc > args.caps.consumerDailyUusdc) return null;
        }
        if (args.caps.channelDailyUusdc !== undefined) {
          const [ch] = await tx.select({ s: used }).from(schema.spendHolds).where(and(eq(schema.spendHolds.day, day), eq(schema.spendHolds.channel, args.channel)));
          if (Number(ch?.s ?? 0) + uusdc > args.caps.channelDailyUusdc) return null;
        }
        const [row] = await tx
          .insert(schema.spendHolds)
          .values({ day, runId: args.runId, channel: args.channel, ...(args.consumerId ? { consumerId: args.consumerId } : {}), reservedUusdc: uusdc })
          .returning({ id: schema.spendHolds.id });
        return row!.id;
      });
      if (!holdId) return null;
      return {
        async settle(spentUusdc: number) {
          await db.update(schema.spendHolds).set({ spentUusdc, settledAt: now() }).where(eq(schema.spendHolds.id, holdId));
        },
      };
    },
  };
}

/** Today's held and spent total (UTC), optionally for one channel or consumer. */
export async function spentToday(db: Db, now: Date, where: { channel?: string; consumerId?: string } = {}): Promise<number> {
  const [r] = await db
    .select({ s: sql<string>`coalesce(sum(coalesce(${schema.spendHolds.spentUusdc}, ${schema.spendHolds.reservedUusdc})), 0)` })
    .from(schema.spendHolds)
    .where(
      and(
        eq(schema.spendHolds.day, utcDay(now)),
        ...(where.channel ? [eq(schema.spendHolds.channel, where.channel)] : []),
        ...(where.consumerId ? [eq(schema.spendHolds.consumerId, where.consumerId)] : []),
      ),
    );
  return Number(r?.s ?? 0);
}

/** Writes a verdict, every upstream attempt and every finding in one transaction. */
export async function saveVerdictRun(db: Db, run: RunToStore, meta: VerdictMeta): Promise<string> {
  const id = meta.id ?? newVerdictId();
  const v = run.verdict;
  const unpurchased = new Set((run.stored.unpurchased ?? []).map((f) => canonicalJson(f)));
  await db.transaction(async (tx) => {
    // Callers that never claimed a run (the CLI, tests) get one here, finished.
    await tx
      .insert(schema.verdictRuns)
      .values({
        id, channel: meta.channel, subjectChainId: v.subject.chainId, subjectToken: v.subject.token,
        policyId: v.policy.id, policyVersion: v.policy.version, contextHash: meta.contextHash ?? "none",
        status: "done", verdictId: id, finishedAt: meta.createdAt ?? new Date(),
        ...(meta.consumerId ? { consumerId: meta.consumerId } : {}),
        ...(meta.idempotencyKey ? { idempotencyKey: meta.idempotencyKey } : {}),
        ...(meta.requestHash ? { requestHash: meta.requestHash } : {}),
      })
      .onConflictDoNothing({ target: schema.verdictRuns.id });
    await tx.insert(schema.verdicts).values({
      id,
      subjectChainId: v.subject.chainId,
      subjectToken: v.subject.token,
      policyId: v.policy.id,
      policyVersion: v.policy.version,
      ...(v.policy.sha256 ? { policySha256: v.policy.sha256 } : {}),
      engineVersion: v.engineVersion,
      verdict: v.decision.verdict,
      verdictCode: v.decision.verdictCode,
      riskBps: v.decision.riskBps,
      confidenceBps: v.decision.confidenceBps,
      coverageBps: v.decision.coverageBps,
      summary: v.summary,
      reasons: v.decision.reasons,
      openRisks: v.decision.openRisks,
      conflicts: v.decision.conflicts,
      verdictHash: v.verdictHash,
      bomRoot: v.bom.root,
      bomItems: v.bom.items,
      priceUusdc: meta.priceUusdc,
      ...(meta.pricingRule ? { pricingRule: meta.pricingRule } : {}),
      ...(meta.contextHash ? { contextHash: meta.contextHash } : {}),
      upstreamUusdc: run.purchases.reduce((a, p) => a + p.amountUusdc, 0),
      channel: meta.channel,
      network: meta.network,
      durationMs: meta.durationMs,
      ...(meta.consumerId ? { consumerId: meta.consumerId } : {}),
      ...(meta.idempotencyKey ? { idempotencyKey: meta.idempotencyKey } : {}),
      ...(meta.requestHash ? { requestHash: meta.requestHash } : {}),
      ...(meta.createdAt ? { createdAt: meta.createdAt } : {}),
    });
    if (run.purchases.length > 0 && !meta.purchasesStored) {
      await tx.insert(schema.purchases).values(run.purchases.map((p) => purchaseRow(id, p)));
    }
    if (v.findings.length > 0) {
      await tx.insert(schema.findings).values(
        v.findings.map((f, ordinal) => ({
          verdictId: id,
          ordinal,
          check: f.check,
          status: f.status,
          severity: f.severity,
          metric: f.metric ?? null,
          value: f.value ?? null,
          unit: f.unit ?? null,
          confidence: f.confidence,
          sourceGroup: f.sourceGroup,
          evidence: f.evidence ?? null,
          notes: f.notes,
          adapterVersion: f.adapterVersion ?? null,
          unpurchased: unpurchased.has(canonicalJson(f)),
        })),
      );
    }
  });
  return id;
}

function stripNulls<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)) as T;
}

/** Reads a verdict back as the engine's StoredVerdict, ready for reproduce(). */
export async function loadStoredVerdict(db: Db, id: string): Promise<StoredVerdict | null> {
  const [v] = await db.select().from(schema.verdicts).where(eq(schema.verdicts.id, id));
  if (!v) return null;
  const ps = await db.select().from(schema.purchases).where(eq(schema.purchases.verdictId, id)).orderBy(asc(schema.purchases.check));
  const fs = await db.select().from(schema.findings).where(eq(schema.findings.verdictId, id)).orderBy(asc(schema.findings.ordinal));
  const toFinding = (r: (typeof fs)[number]): Finding =>
    stripNulls({
      check: r.check, status: r.status, severity: r.severity, metric: r.metric, value: r.value, unit: r.unit,
      confidence: r.confidence, sourceGroup: r.sourceGroup, evidence: r.evidence, notes: r.notes, adapterVersion: r.adapterVersion,
    }) as unknown as Finding;
  return {
    engineVersion: v.engineVersion,
    policy: { id: v.policyId, version: v.policyVersion, ...(v.policySha256 ? { sha256: v.policySha256 } : {}) },
    subject: { chainId: v.subjectChainId, token: v.subjectToken },
    findings: fs.map(toFinding),
    purchases: ps.map(
      (p) =>
        stripNulls({
          check: p.check, adapterVersion: p.adapterVersion, rawResult: p.rawResult ?? undefined, sourceGroup: p.sourceGroup,
          minerId: p.minerId, receiptHash: p.receiptHash, signalHash: p.signalHash, httpStatus: p.httpStatus, error: p.error, pool: p.pool,
        }) as unknown as StoredPurchase,
    ),
    unpurchased: fs.filter((f) => f.unpurchased).map(toFinding),
    receipts: ps.map((p) => p.receiptHash).filter((r): r is string => !!r),
    verdictHash: v.verdictHash,
    bomRoot: v.bomRoot,
    decision: { verdict: v.verdict, riskBps: v.riskBps, confidenceBps: v.confidenceBps },
  };
}
