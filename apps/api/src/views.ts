import { schema, type Db } from "@skein/db";
import { asc, eq } from "drizzle-orm";

const usdc = (uusdc: number) => Math.round(uusdc) / 1_000_000;

/** The verdict object of the build spec (section 6). */
export async function verdictObject(db: Db, id: string) {
  const [v] = await db.select().from(schema.verdicts).where(eq(schema.verdicts.id, id));
  if (!v) return null;
  const fs = await db.select().from(schema.findings).where(eq(schema.findings.verdictId, id)).orderBy(asc(schema.findings.ordinal));
  return {
    id: v.id,
    verdict: v.verdict,
    verdictCode: v.verdictCode,
    riskBps: v.riskBps,
    confidenceBps: v.confidenceBps,
    coverage: v.coverageBps / 10_000,
    summary: v.summary,
    reasons: v.reasons,
    openRisks: v.openRisks,
    conflicts: v.conflicts,
    subject: { chainId: v.subjectChainId, token: v.subjectToken },
    findings: fs.map((f) => ({
      check: f.check,
      status: f.status,
      severity: f.severity,
      ...(f.metric ? { metric: f.metric, value: f.value, unit: f.unit } : {}),
      confidence: f.confidence,
      sourceGroup: f.sourceGroup,
      ...(f.evidence ? { evidence: f.evidence } : {}),
      notes: f.notes,
    })),
    cost: { upstreamUsdc: usdc(v.upstreamUusdc), priceUsdc: usdc(v.priceUusdc), currency: "USDC" },
    bom: { root: v.bomRoot, items: v.bomItems },
    policy: { id: v.policyId, version: v.policyVersion },
    engineVersion: v.engineVersion,
    verdictHash: v.verdictHash,
    channel: v.channel,
    network: v.network.startsWith("eip155:11155111") ? "testnet" : v.network,
    createdAt: v.createdAt.toISOString(),
    durationMs: v.durationMs,
    disclaimer: "Risk evidence, not investment advice.",
  };
}

export type VerdictObject = NonNullable<Awaited<ReturnType<typeof verdictObject>>>;

/** Every upstream attempt behind a verdict: the bill of materials. */
export async function bomObject(db: Db, id: string) {
  const [v] = await db
    .select({ root: schema.verdicts.bomRoot, items: schema.verdicts.bomItems, hash: schema.verdicts.verdictHash })
    .from(schema.verdicts)
    .where(eq(schema.verdicts.id, id));
  if (!v) return null;
  const ps = await db.select().from(schema.purchases).where(eq(schema.purchases.verdictId, id)).orderBy(asc(schema.purchases.check));
  return {
    id,
    root: v.root,
    items: v.items,
    verdictHash: v.hash,
    lines: ps.map((p) => ({
      check: p.check,
      intent: p.intent,
      minerId: p.minerId,
      minerName: p.minerName,
      pinned: p.pinned,
      rail: p.rail,
      receiptHash: p.receiptHash,
      signalHash: p.signalHash,
      amountUsdc: usdc(p.amountUusdc),
      epochId: p.epochId,
      httpStatus: p.httpStatus,
      durationMs: p.durationMs,
      attempts: p.attempts,
      sourceGroup: p.sourceGroup,
      adapterVersion: p.adapterVersion,
      error: p.error,
      billed: !!p.receiptHash,
      createdAt: p.createdAt.toISOString(),
    })),
  };
}
