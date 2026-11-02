import { schema, type Db } from "@skein/db";
import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";

export interface SeedConsumer {
  name: string;
  kind: "agent" | "team" | "contract";
  apiKeyHash: string;
  dailyCapUusdc: number;
}

/**
 * SEED_CONSUMERS provisions partner keys without database access:
 * "name|kind|sha256-of-key|daily cap USDC", comma-separated. Only the hash is
 * ever in the environment; the key itself goes to the partner.
 */
export function parseSeedConsumers(raw: string | undefined): SeedConsumer[] {
  if (!raw?.trim()) return [];
  return raw.split(",").map((entry) => {
    const [name, kind, hash, cap] = entry.split("|").map((s) => s.trim());
    if (!name || !hash || !/^[0-9a-f]{64}$/.test(hash)) throw new Error(`SEED_CONSUMERS: bad entry "${entry.slice(0, 40)}" (want name|kind|sha256|capUsdc)`);
    if (kind !== "agent" && kind !== "team" && kind !== "contract") throw new Error(`SEED_CONSUMERS: kind must be agent, team or contract, not "${kind}"`);
    const capUsdc = cap ? Number(cap) : 2;
    if (!Number.isFinite(capUsdc) || capUsdc < 0) throw new Error(`SEED_CONSUMERS: bad cap "${cap}"`);
    return { name, kind, apiKeyHash: hash, dailyCapUusdc: Math.round(capUsdc * 1e6) };
  });
}

/**
 * Reconciles seeded consumers with SEED_CONSUMERS on every start: a new entry
 * is inserted, an existing one gets the env's name and cap (and is un-revoked),
 * and a seeded consumer whose hash left the env is revoked. Only rows created
 * by seeding are ever revoked here; with no SEED_CONSUMERS set, nothing is.
 * Returns what changed.
 */
export async function seedConsumers(db: Db, seeds: SeedConsumer[], now = new Date()): Promise<{ added: string[]; updated: string[]; revoked: number }> {
  const added: string[] = [];
  const updated: string[] = [];
  for (const s of seeds) {
    const [have] = await db.select().from(schema.consumers).where(eq(schema.consumers.apiKeyHash, s.apiKeyHash));
    if (!have) {
      await db.insert(schema.consumers).values({ ...s, seeded: true }).onConflictDoNothing({ target: schema.consumers.apiKeyHash });
      added.push(s.name);
    } else if (have.name !== s.name || have.dailyCapUusdc !== s.dailyCapUusdc || have.kind !== s.kind || have.revokedAt) {
      await db.update(schema.consumers).set({ name: s.name, kind: s.kind, dailyCapUusdc: s.dailyCapUusdc, revokedAt: null, seeded: true }).where(eq(schema.consumers.id, have.id));
      updated.push(s.name);
    }
  }
  let revoked = 0;
  if (seeds.length > 0) {
    const gone = await db
      .update(schema.consumers)
      .set({ revokedAt: now })
      .where(and(eq(schema.consumers.seeded, true), isNull(schema.consumers.revokedAt), notInArray(schema.consumers.apiKeyHash, seeds.map((s) => s.apiKeyHash))))
      .returning({ id: schema.consumers.id });
    revoked = gone.length;
  }
  return { added, updated, revoked };
}

/** Revokes partner keys by hash (REVOKED_KEY_HASHES), seeded or not. */
export async function revokeKeys(db: Db, hashes: string[], now = new Date()): Promise<number> {
  if (hashes.length === 0) return 0;
  const rows = await db
    .update(schema.consumers)
    .set({ revokedAt: now })
    .where(and(inArray(schema.consumers.apiKeyHash, hashes), isNull(schema.consumers.revokedAt)))
    .returning({ id: schema.consumers.id });
  return rows.length;
}
