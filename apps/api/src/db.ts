import { appRoleSql, appRoleUrl, bundledMigrations, derivedPassword, migrationsReadSql, MIGRATIONS_DIR, schema, sniperRoleSql, type Db } from "@skein/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { readFileSync } from "node:fs";
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
export async function runMigrations(pool: pg.Pool, appPassword?: string, sniperPassword?: string): Promise<void> {
  const lock = await pool.connect();
  try {
    await lock.query("select pg_advisory_lock(7405300)");
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_DIR });
    if (appPassword) {
      await lock.query(appRoleSql(appPassword));
      await lock.query(migrationsReadSql());
    }
    if (sniperPassword) await lock.query(sniperRoleSql(sniperPassword));
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
export async function connectForRuntime(ownerUrl: string): Promise<{ db: Db; pool: pg.Pool; role: string }> {
  // Production: the migrate job (src/migrate.ts) holds the owner's credentials, and DATABASE_URL here is
  // already skein_app's. The API only waits until the migrations this build needs have run.
  if (process.env.DATABASE_MIGRATIONS === "external") {
    const app = connect(ownerUrl);
    await waitForMigrations(app.pool);
    const [row] = (await app.pool.query<{ u: string }>("select current_user as u")).rows;
    return { ...app, role: row?.u ?? "unknown" };
  }
  const owner = connect(ownerUrl);
  if (process.env.DB_RUNTIME_ROLE === "owner") {
    await runMigrations(owner.pool);
    return { ...owner, role: "owner" };
  }
  const password = process.env.DB_APP_PASSWORD || derivedPassword(decodeURIComponent(new URL(ownerUrl).password));
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

/** How many migrations have run: drizzle records each in drizzle.__drizzle_migrations. */
export async function appliedMigrations(q: { query(sql: string): Promise<{ rows: Record<string, unknown>[] }> }): Promise<number> {
  const r = await q.query(`select count(*)::int as n from drizzle.__drizzle_migrations`);
  return Number(r.rows[0]?.n ?? 0);
}

/**
 * The bundled migrations missing from the database, by tag. drizzle records
 * each applied migration's SHA-256 (of its SQL file) and its journal time; a
 * bundled migration counts as applied only when both match, so a database at
 * the right count but on other migrations (another branch's, or an edited
 * file) is not taken as ready. Throws when the table cannot be read.
 */
export async function missingMigrations(q: { query(sql: string): Promise<{ rows: Record<string, unknown>[] }> }): Promise<string[]> {
  const bundled = readMigrationFiles({ migrationsFolder: MIGRATIONS_DIR });
  const journal = JSON.parse(readFileSync(`${MIGRATIONS_DIR}/meta/_journal.json`, "utf8")) as { entries: { tag: string; when: number }[] };
  const tagOf = new Map(journal.entries.map((e) => [e.when, e.tag]));
  const r = await q.query(`select hash, created_at from drizzle.__drizzle_migrations`);
  const applied = new Set(r.rows.map((x) => `${String(x.hash)}@${Number(x.created_at)}`));
  return bundled.filter((m) => !applied.has(`${m.hash}@${m.folderMillis}`)).map((m) => tagOf.get(m.folderMillis) ?? String(m.folderMillis));
}

/**
 * Waits (up to `timeoutMs`) until the database has every migration this build
 * ships, matched by hash and journal time (missingMigrations). A replica that
 * starts before the migrate job finishes waits here; its health check fails
 * meanwhile, so Railway keeps the previous deployment serving.
 */
export async function waitForMigrations(q: { query(sql: string): Promise<{ rows: Record<string, unknown>[] }> }, timeoutMs = Number(process.env.MIGRATION_WAIT_MS ?? 100_000), stepMs = 3_000): Promise<void> {
  const want = bundledMigrations();
  const until = Date.now() + timeoutMs;
  for (;;) {
    const missing = await missingMigrations(q).catch(() => null);
    if (missing && missing.length === 0) return;
    const have = missing ? want - missing.length : 0;
    if (Date.now() > until) {
      throw new Error(`the database has ${have} of ${want} migrations; the migrate job has not run for this build${missing ? ` (missing or different: ${missing.join(", ")})` : ""}`);
    }
    console.log(JSON.stringify({ level: "info", msg: "waiting for migrations", have, want, ...(missing ? { missing } : {}) }));
    await new Promise((r) => setTimeout(r, stepMs));
  }
}
