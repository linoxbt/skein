import { createHmac } from "node:crypto";

/**
 * The API's runtime role. Migrations run as the database owner; every query
 * the API makes at runtime runs as `skein_app`, which can only do what this
 * table allows. Evidence (verdicts, purchases, findings, the spend ledger) is
 * insert-only: no runtime bug or injected query can edit or delete it. The
 * role has no DDL, cannot create roles or databases, and does not bypass
 * row-level security; each table gets a policy for this role alone, so RLS
 * still shuts out every other non-owner role (Supabase's anon, for one).
 */
export const APP_ROLE = "skein_app";

type Priv = "SELECT" | "INSERT" | "UPDATE" | "DELETE";
export const PRIVILEGES: Record<string, Priv[]> = {
  // Evidence: append-only.
  verdicts: ["SELECT", "INSERT"],
  purchases: ["SELECT", "INSERT"],
  findings: ["SELECT", "INSERT"],
  spend_ledger: ["SELECT", "INSERT"],
  // Runs and holds move through states; never deleted.
  verdict_runs: ["SELECT", "INSERT", "UPDATE"],
  spend_holds: ["SELECT", "INSERT", "UPDATE"],
  // Partner keys: provisioned and revoked by hash; never deleted.
  consumers: ["SELECT", "INSERT", "UPDATE"],
  webhooks: ["SELECT", "INSERT", "UPDATE"],
  kv: ["SELECT", "INSERT", "UPDATE"],
  alert_state: ["SELECT", "INSERT", "UPDATE"],
  heartbeats: ["SELECT", "INSERT", "UPDATE"],
  // Operational, pruned on a schedule.
  events: ["SELECT", "INSERT", "DELETE"],
  error_log: ["SELECT", "INSERT", "DELETE"],
  rate_limits: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  flights: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  // Reference and offline-evaluation data: read only at runtime.
  policies: ["SELECT"],
  miner_catalog: ["SELECT"],
  intent_status: ["SELECT"],
  eval_cases: ["SELECT"],
  eval_runs: ["SELECT"],
};

/** The role's password, derived from the owner's, so no second secret has to be provisioned or rotated. */
export function derivedPassword(ownerPassword: string): string {
  return createHmac("sha256", ownerPassword).update(`${APP_ROLE}/v1`).digest("hex");
}

/** The runtime connection string: the owner's URL with the app role's name and password. */
export function appRoleUrl(ownerUrl: string, password = derivedPassword(decodeURIComponent(new URL(ownerUrl).password))): string {
  const u = new URL(ownerUrl);
  u.username = APP_ROLE;
  u.password = password;
  return u.toString();
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`unexpected identifier ${s}`);
  return `"${s}"`;
};

/**
 * Idempotent SQL that creates or updates the role and sets its grants and
 * policies exactly (anything not listed is revoked). Run as the owner, after
 * migrations, under the migration lock.
 */
export function appRoleSql(password: string | null): string {
  const r = ident(APP_ROLE);
  const out = [
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${lit(APP_ROLE)}) THEN CREATE ROLE ${r}; END IF; END $$`,
    `ALTER ROLE ${r} ${password ? `LOGIN PASSWORD ${lit(password)}` : "NOLOGIN"} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    `GRANT USAGE ON SCHEMA public TO ${r}`,
    `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${r}`,
  ];
  for (const [table, privs] of Object.entries(PRIVILEGES)) {
    const t = ident(table);
    out.push(`GRANT ${privs.join(", ")} ON ${t} TO ${r}`);
    const policy = `${APP_ROLE}_all`;
    out.push(
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = ${lit(table)} AND policyname = ${lit(policy)}) THEN CREATE POLICY ${ident(policy)} ON ${t} TO ${r} USING (true) WITH CHECK (true); END IF; END $$`,
    );
  }
  out.push(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${r}`);
  return out.join(";\n") + ";";
}

/**
 * The sniper's role: its own table only (sniper_tokens, created by the sniper
 * on first start). No access to Skein's tables. Applied by the migrate job;
 * a database without the table yet gets the role and no grant.
 */
export const SNIPER_ROLE = "skein_sniper";
export function sniperRoleSql(password: string): string {
  const r = ident(SNIPER_ROLE);
  return [
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${lit(SNIPER_ROLE)}) THEN CREATE ROLE ${r}; END IF; END $$`,
    `ALTER ROLE ${r} LOGIN PASSWORD ${lit(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    `GRANT USAGE ON SCHEMA public TO ${r}`,
    `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${r}`,
    `DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'sniper_tokens') THEN GRANT SELECT, INSERT, UPDATE ON sniper_tokens TO ${r}; END IF; END $$`,
  ].join(";\n") + ";";
}

/** Lets the runtime role read which migrations ran, so a replica can wait for the migrate job. */
export function migrationsReadSql(role = APP_ROLE): string {
  const r = ident(role);
  return `DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'drizzle') THEN EXECUTE 'GRANT USAGE ON SCHEMA drizzle TO ${r}'; EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO ${r}'; END IF; END $$;`;
}
