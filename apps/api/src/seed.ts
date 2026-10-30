import { schema, type Db } from "@skein/db";
import { eq } from "drizzle-orm";

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

/** Inserts each seeded consumer whose key hash is not already present. Returns the names inserted. */
export async function seedConsumers(db: Db, seeds: SeedConsumer[]): Promise<string[]> {
  const added: string[] = [];
  for (const s of seeds) {
    const [have] = await db.select({ id: schema.consumers.id }).from(schema.consumers).where(eq(schema.consumers.apiKeyHash, s.apiKeyHash));
    if (have) continue;
    await db.insert(schema.consumers).values(s);
    added.push(s.name);
  }
  return added;
}
