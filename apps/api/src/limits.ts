import type { Db } from "@skein/db";
import { sql } from "drizzle-orm";

/** Seconds to wait when refused, or null when the request may go ahead. */
export interface Limiter {
  take(key: string): Promise<number | null>;
}

const rows = <T>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[]));

/**
 * A token bucket per key, held in Postgres so every API replica counts the
 * same requests. One statement per request: it refills the bucket for the
 * time since its last use, takes a token when there is one, and records
 * whether it did. `name` namespaces the limiter (read, quote, key, ...).
 */
export class SharedRateLimiter implements Limiter {
  constructor(
    private readonly db: Db,
    private readonly name: string,
    private readonly perMinute: number,
  ) {}

  async take(key: string): Promise<number | null> {
    const k = `${this.name}:${key}`.slice(0, 300);
    const cap = this.perMinute;
    try {
      const r = await this.db.execute(sql`
        INSERT INTO rate_limits (key, tokens, allowed, at) VALUES (${k}, ${cap - 1}, true, now())
        ON CONFLICT (key) DO UPDATE SET
          tokens = CASE
            WHEN LEAST(${cap}::float8, rate_limits.tokens + EXTRACT(EPOCH FROM (now() - rate_limits.at)) / 60.0 * ${cap}) >= 1
              THEN LEAST(${cap}::float8, rate_limits.tokens + EXTRACT(EPOCH FROM (now() - rate_limits.at)) / 60.0 * ${cap}) - 1
            ELSE LEAST(${cap}::float8, rate_limits.tokens + EXTRACT(EPOCH FROM (now() - rate_limits.at)) / 60.0 * ${cap})
          END,
          allowed = LEAST(${cap}::float8, rate_limits.tokens + EXTRACT(EPOCH FROM (now() - rate_limits.at)) / 60.0 * ${cap}) >= 1,
          at = now()
        RETURNING tokens, allowed`);
      const [row] = rows<{ tokens: number | string; allowed: boolean }>(r);
      if (!row || row.allowed) return null;
      return Math.max(1, Math.ceil(((1 - Number(row.tokens)) / cap) * 60));
    } catch (e) {
      // A limiter that cannot reach its store lets the request through: the
      // request itself will meet the same database, and spend caps are separate.
      console.error(JSON.stringify({ level: "error", msg: "rate limiter unavailable", limiter: this.name, error: (e as Error).message }));
      return null;
    }
  }
}

/** Drops buckets idle for an hour, expired flight leases and error_log rows over 30 days old. */
export async function pruneShared(db: Db): Promise<void> {
  await db.execute(sql`DELETE FROM rate_limits WHERE at < now() - interval '1 hour'`);
  await db.execute(sql`DELETE FROM flights WHERE expires_at < now()`);
  await db.execute(sql`DELETE FROM error_log WHERE at < now() - interval '30 days'`);
}

/**
 * Takes the lease on `key` for `runId` when it is free or expired. Returns
 * null when taken, or the run id that holds it.
 */
export async function acquireFlight(db: Db, key: string, runId: string, ttlMs: number): Promise<string | null> {
  const r = await db.execute(sql`
    INSERT INTO flights (key, run_id, expires_at) VALUES (${key}, ${runId}, now() + (${ttlMs} * interval '1 millisecond'))
    ON CONFLICT (key) DO UPDATE SET run_id = EXCLUDED.run_id, expires_at = EXCLUDED.expires_at
      WHERE flights.expires_at < now()
    RETURNING run_id`);
  if (rows<{ run_id: string }>(r).length > 0) return null;
  const held = await db.execute(sql`SELECT run_id FROM flights WHERE key = ${key}`);
  return rows<{ run_id: string }>(held)[0]?.run_id ?? null;
}

export async function releaseFlight(db: Db, key: string, runId: string): Promise<void> {
  await db.execute(sql`DELETE FROM flights WHERE key = ${key} AND run_id = ${runId}`);
}
