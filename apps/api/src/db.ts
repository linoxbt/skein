import { MIGRATIONS_DIR, schema, type Db } from "@skein/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

/**
 * Railway's private network and a local Postgres speak plain TCP. Any other
 * host uses TLS with full certificate verification; a provider that signs
 * with its own root (Supabase) supplies it in DATABASE_CA_CERT (PEM).
 */
export function connect(url: string, caCert = process.env.DATABASE_CA_CERT): { db: Db; pool: pg.Pool } {
  // Decide on the host, not the whole URL (a password could contain "localhost").
  const host = new URL(url).hostname;
  const internal = host.endsWith(".railway.internal") || host === "localhost" || host === "127.0.0.1";
  const ssl = internal ? undefined : caCert ? { ca: caCert } : true;
  const pool = new pg.Pool({
    connectionString: url,
    max: 10,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 15_000,
    ...(ssl ? { ssl } : {}),
  });
  // An idle client's error (a Postgres restart) is emitted on the pool; without
  // a listener it would crash the process. The pool replaces the client.
  pool.on("error", (e) => console.error("postgres pool error:", e.message));
  return { db: drizzle(pool, { schema }) as unknown as Db, pool };
}

/** Migrates under a session advisory lock, so two replicas starting together cannot race. */
export async function runMigrations(pool: pg.Pool): Promise<void> {
  const lock = await pool.connect();
  try {
    await lock.query("select pg_advisory_lock(7405300)");
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await lock.query("select pg_advisory_unlock(7405300)").catch(() => {});
    lock.release();
  }
}
