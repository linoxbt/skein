// The migrate job: the only Skein process with the database owner's credentials
// (besides the nightly backup). Railway runs it once per deploy (service
// `migrate`, start command `node --import tsx src/migrate.ts`). It applies
// migrations and sets the runtime roles' passwords and grants, under the
// migration lock, then exits. The API waits for it (DATABASE_MIGRATIONS=external).
//
//   DATABASE_URL          the owner's connection string
//   DB_APP_PASSWORD       skein_app's password (the API and the probe connect with it)
//   DB_SNIPER_PASSWORD    skein_sniper's password (optional; the sniper's own table only)
import { connect, runMigrations } from "./db";

const url = process.env.DATABASE_URL;
const app = process.env.DB_APP_PASSWORD;
if (!url || !app) throw new Error("DATABASE_URL (owner) and DB_APP_PASSWORD are required");
if (app.length < 32) throw new Error("DB_APP_PASSWORD must be at least 32 characters");
const sniper = process.env.DB_SNIPER_PASSWORD || undefined;
const { pool } = connect(url);
const t0 = Date.now();
try {
  await runMigrations(pool, app, sniper);
  const r = await pool.query<{ n: number }>("select count(*)::int as n from drizzle.__drizzle_migrations");
  console.log(JSON.stringify({ level: "info", msg: "migrations applied", migrations: r.rows[0]?.n, roles: sniper ? ["skein_app", "skein_sniper"] : ["skein_app"], ms: Date.now() - t0 }));
} finally {
  await pool.end();
}
