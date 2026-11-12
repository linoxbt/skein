import { schema, type Db } from "@skein/db";
import type { Catalogue } from "@skein/pipeline";
import { listPolicies } from "@skein/policies";
import { CHECK_INTENTS, sourceGroup } from "@skein/telegraph";
import { gte, sql } from "drizzle-orm";

/**
 * Snapshots of what the API holds in memory, in the tables the spec gives
 * them (§7), so they can be queried and audited after the fact:
 *   miner_catalog  every miner on the intents Skein buys, as last seen (5-minute refresh);
 *   intent_status  each intent's live miners and 24 h latency and error rate;
 *   policies       each published policy file, written once (immutable).
 * Planning still reads the in-memory catalogue; these are its record.
 */
export async function snapshotCatalogue(db: Db, catalogue: Catalogue, now = new Date()): Promise<{ miners: number; intents: number }> {
  const seen = new Map<string, { id: string; slug: string; name: string; intents: Set<string>; status: string; minPrice: number; baseUrl: string }>();
  for (const [intent, miners] of Object.entries(catalogue.minersByIntent)) {
    for (const m of miners) {
      const row = seen.get(m.id) ?? { id: m.id, slug: m.slug, name: m.name, intents: new Set<string>(), status: m.activation_status, minPrice: m.min_price_usdc, baseUrl: m.base_url };
      row.intents.add(intent);
      seen.set(m.id, row);
    }
  }
  const lastSeenAt = new Date(catalogue.fetchedAt);
  for (const m of seen.values()) {
    const values = { minerId: m.id, slug: m.slug, name: m.name, intents: [...m.intents].sort(), status: m.status, minPriceUusdc: Math.round(m.minPrice), baseUrl: m.baseUrl, sourceGroup: sourceGroup(m.baseUrl), lastSeenAt };
    await db.insert(schema.minerCatalog).values(values).onConflictDoUpdate({ target: schema.minerCatalog.minerId, set: values });
  }
  const since = new Date(now.getTime() - 86_400_000);
  const health = await db
    .select({
      intent: schema.purchases.intent,
      n: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) filter (where ${schema.purchases.error} is not null)::int`,
      p50: sql<string | null>`percentile_cont(0.5) within group (order by ${schema.purchases.durationMs})`,
      p95: sql<string | null>`percentile_cont(0.95) within group (order by ${schema.purchases.durationMs})`,
    })
    .from(schema.purchases)
    .where(gte(schema.purchases.createdAt, since))
    .groupBy(schema.purchases.intent);
  const intents = Object.values(CHECK_INTENTS).filter((i): i is string => !!i);
  for (const intent of intents) {
    const miners = catalogue.minersByIntent[intent];
    const h = health.find((x) => x.intent === intent);
    const values = {
      intent,
      exists: miners !== undefined,
      onchainReady: null,
      minerCount: (miners ?? []).filter((m) => m.activation_status === "active").length,
      p50Ms: h?.p50 == null ? null : Math.round(Number(h.p50)),
      p95Ms: h?.p95 == null ? null : Math.round(Number(h.p95)),
      errorRate24h: h && h.n > 0 ? h.errors / h.n : null,
      checkedAt: now,
    };
    await db.insert(schema.intentStatus).values(values).onConflictDoUpdate({ target: schema.intentStatus.intent, set: values });
  }
  return { miners: seen.size, intents: intents.length };
}

/** Writes each policy file the API serves into `policies`, once: a published version never changes (a trigger refuses it). */
export async function publishPolicies(db: Db): Promise<number> {
  const rows = listPolicies().map((p) => ({ id: p.policy.id, version: p.policy.version, yaml: p.yaml, sha256: p.sha256 }));
  if (rows.length === 0) return 0;
  const written = await db.insert(schema.policies).values(rows).onConflictDoNothing().returning({ id: schema.policies.id });
  return written.length;
}
