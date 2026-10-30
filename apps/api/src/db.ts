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
  const internal = /\.railway\.internal|localhost|127\.0\.0\.1/.test(url);
  const ssl = internal ? undefined : caCert ? { ca: caCert } : true;
  const pool = new pg.Pool({ connectionString: url, max: 10, ...(ssl ? { ssl } : {}) });
  return { db: drizzle(pool, { schema }) as unknown as Db, pool };
}

export async function runMigrations(pool: pg.Pool): Promise<void> {
  await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_DIR });
}
