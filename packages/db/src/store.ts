import { canonicalJson, type Finding, type StoredPurchase, type StoredVerdict } from "@skein/engine";
import { asc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** The parts of a pipeline run the store needs (structural, so this package does not depend on the pipeline). */
export interface RunToStore {
  verdict: {
    engineVersion: string;
    policy: { id: string; version: string };
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
    createdAt: string;
  })[];
  stored: Pick<StoredVerdict, "unpurchased">;
}

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
}

/** Time-sortable verdict id. */
export function newVerdictId(now = Date.now()): string {
  const rand = crypto.getRandomValues(new Uint8Array(8));
  return `vrd_${now.toString(36)}${[...rand].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 12)}`;
}

/** Writes a verdict, every upstream attempt and every finding in one transaction. */
export async function saveVerdictRun(db: Db, run: RunToStore, meta: VerdictMeta): Promise<string> {
  const id = meta.id ?? newVerdictId();
  const v = run.verdict;
  const unpurchased = new Set((run.stored.unpurchased ?? []).map((f) => canonicalJson(f)));
  await db.transaction(async (tx) => {
    await tx.insert(schema.verdicts).values({
      id,
      subjectChainId: v.subject.chainId,
      subjectToken: v.subject.token,
      policyId: v.policy.id,
      policyVersion: v.policy.version,
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
      upstreamUusdc: run.purchases.reduce((a, p) => a + p.amountUusdc, 0),
      channel: meta.channel,
      network: meta.network,
      durationMs: meta.durationMs,
      ...(meta.consumerId ? { consumerId: meta.consumerId } : {}),
      ...(meta.idempotencyKey ? { idempotencyKey: meta.idempotencyKey } : {}),
      ...(meta.requestHash ? { requestHash: meta.requestHash } : {}),
      ...(meta.createdAt ? { createdAt: meta.createdAt } : {}),
    });
    if (run.purchases.length > 0) {
      await tx.insert(schema.purchases).values(
        run.purchases.map((p) => ({
          verdictId: id,
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
          createdAt: new Date(p.createdAt),
        })),
      );
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
    policy: { id: v.policyId, version: v.policyVersion },
    subject: { chainId: v.subjectChainId, token: v.subjectToken },
    findings: fs.map(toFinding),
    purchases: ps.map(
      (p) =>
        stripNulls({
          check: p.check, adapterVersion: p.adapterVersion, rawResult: p.rawResult ?? undefined, sourceGroup: p.sourceGroup,
          minerId: p.minerId, receiptHash: p.receiptHash, signalHash: p.signalHash, httpStatus: p.httpStatus, error: p.error,
        }) as unknown as StoredPurchase,
    ),
    unpurchased: fs.filter((f) => f.unpurchased).map(toFinding),
    receipts: ps.map((p) => p.receiptHash).filter((r): r is string => !!r),
    verdictHash: v.verdictHash,
    bomRoot: v.bomRoot,
  };
}
