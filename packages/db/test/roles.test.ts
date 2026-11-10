import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { APP_ROLE, appRoleSql, appRoleUrl, derivedPassword, MIGRATIONS_DIR, PRIVILEGES } from "../src/index";

let pg: PGlite;
beforeAll(async () => {
  pg = new PGlite();
  await migrate(drizzle(pg), { migrationsFolder: MIGRATIONS_DIR });
  await pg.exec(appRoleSql("pw-1"));
  await pg.exec(appRoleSql("pw-2")); // idempotent, and re-syncs the password
});

const PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE"] as const;

describe("the API's runtime role", () => {
  it("covers every table: a new table cannot ship without a decision on its privileges", async () => {
    const r = await pg.query<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
    expect(r.rows.map((x) => x.tablename).sort()).toEqual(Object.keys(PRIVILEGES).sort());
  });

  it("has exactly the listed privileges on each table, and nothing else", async () => {
    for (const [table, granted] of Object.entries(PRIVILEGES)) {
      for (const p of PRIVS) {
        const r = await pg.query<{ ok: boolean }>(`SELECT has_table_privilege($1, $2, $3) AS ok`, [APP_ROLE, `public.${table}`, p]);
        expect({ table, p, ok: r.rows[0]!.ok }).toEqual({ table, p, ok: granted.includes(p) });
      }
    }
  });

  it("is a plain role: no superuser, DDL, role creation or RLS bypass", async () => {
    const r = await pg.query<Record<string, boolean>>(`SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = $1`, [APP_ROLE]);
    expect(r.rows[0]).toEqual({ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolbypassrls: false, rolcanlogin: true });
  });

  it("can work, but cannot edit evidence, change the schema or read past RLS as another role", async () => {
    await pg.exec(`SET ROLE ${APP_ROLE}`);
    try {
      await pg.query(`INSERT INTO heartbeats (name, at) VALUES ('t', now())`);
      expect((await pg.query(`SELECT * FROM heartbeats WHERE name = 't'`)).rows).toHaveLength(1); // RLS policy lets it read
      await expect(pg.query(`DELETE FROM verdicts`)).rejects.toThrow(/permission denied/);
      await expect(pg.query(`UPDATE purchases SET amount_uusdc = 0`)).rejects.toThrow(/permission denied/);
      await expect(pg.query(`DELETE FROM spend_ledger`)).rejects.toThrow(/permission denied/);
      await expect(pg.query(`DROP TABLE kv`)).rejects.toThrow(/must be owner|permission denied/);
      await expect(pg.query(`CREATE TABLE x (id int)`)).rejects.toThrow(/permission denied/);
      await expect(pg.query(`CREATE ROLE other`)).rejects.toThrow(/permission denied/);
    } finally {
      await pg.exec(`RESET ROLE`);
    }
    await pg.exec(`CREATE ROLE outsider; GRANT SELECT ON heartbeats TO outsider; SET ROLE outsider`);
    try {
      expect((await pg.query(`SELECT * FROM heartbeats`)).rows).toHaveLength(0); // no policy for other roles
    } finally {
      await pg.exec(`RESET ROLE`);
    }
  });

  it("derives its password from the owner's, and builds the runtime URL", () => {
    expect(derivedPassword("owner-secret")).toMatch(/^[0-9a-f]{64}$/);
    expect(derivedPassword("owner-secret")).not.toBe(derivedPassword("other"));
    const u = new URL(appRoleUrl("postgresql://postgres:p%40ss@postgres.railway.internal:5432/railway"));
    expect(u.username).toBe(APP_ROLE);
    expect(u.password).toBe(derivedPassword("p@ss"));
    expect(u.host).toBe("postgres.railway.internal:5432");
    expect(u.pathname).toBe("/railway");
  });
});
