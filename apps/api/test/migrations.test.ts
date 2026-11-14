import { PGlite } from "@electric-sql/pglite";
import { bundledMigrations, MIGRATIONS_DIR } from "@skein/db";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it, vi } from "vitest";
import { appliedMigrations, missingMigrations, waitForMigrations } from "../src/db";

describe("waiting for the migrate job", () => {
  it("returns once every migration this build ships has run, and gives up with a clear error otherwise", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const pg = new PGlite();
    await migrate(drizzle(pg), { migrationsFolder: MIGRATIONS_DIR });
    expect(await appliedMigrations(pg)).toBe(bundledMigrations());
    expect(await missingMigrations(pg)).toEqual([]);
    await expect(waitForMigrations(pg, 1_000, 10)).resolves.toBeUndefined();

    await pg.exec(`DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations)`);
    await expect(waitForMigrations(pg, 100, 10)).rejects.toThrow(/has \d+ of \d+ migrations; the migrate job has not run.*missing or different: 0011_key_challenges/);
  });

  it("does not take the right count of other migrations for the right ones", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const pg = new PGlite();
    await migrate(drizzle(pg), { migrationsFolder: MIGRATIONS_DIR });
    // Same number of rows, but one is another build's migration (a different file under the same slot).
    await pg.exec(`UPDATE drizzle.__drizzle_migrations SET hash = 'not-this-build' WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations)`);
    expect(await appliedMigrations(pg)).toBe(bundledMigrations());
    expect(await missingMigrations(pg)).toEqual(["0011_key_challenges"]);
    await expect(waitForMigrations(pg, 50, 10)).rejects.toThrow(/missing or different: 0011_key_challenges/);
  });

  it("treats a database with no migrations table as zero", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(waitForMigrations(new PGlite(), 50, 10)).rejects.toThrow(/has 0 of/);
  });
});
