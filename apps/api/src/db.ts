import { appRoleSql, appRoleUrl, derivedPassword, MIGRATIONS_DIR, schema, type Db } from "@skein/db";
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
    // Each verdict holds a connection only briefly, but buys 4–7 checks in parallel; 20 per replica keeps
    // two replicas, the sniper, the probe and the backup well inside Railway Postgres's 100 connections.
    max: Number(process.env.DATABASE_POOL_MAX ?? 20),
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

/**
 * Migrates under a session advisory lock, so two replicas starting together
 * cannot race. With `appPassword`, also creates or updates the runtime role
 * and sets its grants (packages/db/src/roles.ts) under the same lock.
 */
export async function runMigrations(pool: pg.Pool, appPassword?: string): Promise<void> {
  const lock = await pool.connect();
  try {
    await lock.query("select pg_advisory_lock(7405300)");
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_DIR });
    if (appPassword) await lock.query(appRoleSql(appPassword));
  } finally {
    await lock.query("select pg_advisory_unlock(7405300)").catch(() => {});
    lock.release();
  }
}

/**
 * Connects the way production runs: migrations and grants as the database
 * owner (DATABASE_URL), then every runtime query as the restricted role
 * skein_app. DB_RUNTIME_ROLE=owner keeps the owner connection. If the role
 * cannot be set up or reached, the API stays up on the owner connection and
 * says so in `role` (shown at /v1/status, alerted on by the probe).
 */
export async function connectForRuntime(ownerUrl: string): Promise<{ db: Db; pool: pg.Pool; role: "skein_app" | "owner" | "owner (fallback)" }> {
  const owner = connect(ownerUrl);
  if (process.env.DB_RUNTIME_ROLE === "owner") {
    await runMigrations(owner.pool);
    return { ...owner, role: "owner" };
  }
  const password = derivedPassword(decodeURIComponent(new URL(ownerUrl).password));
  try {
    await runMigrations(owner.pool, password);
    const app = connect(appRoleUrl(ownerUrl, password));
    await app.pool.query("select 1");
    await owner.pool.end();
    return { ...app, role: "skein_app" };
  } catch (e) {
    console.error(JSON.stringify({ level: "error", msg: "runtime role unavailable, using the owner connection", error: (e as Error).message }));
    await runMigrations(owner.pool);
    return { ...owner, role: "owner (fallback)" };
  }
}
