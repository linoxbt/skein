import { PGlite } from "@electric-sql/pglite";
import { bundledMigrations, MIGRATIONS_DIR } from "@skein/db";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it, vi } from "vitest";
import { appliedMigrations, waitForMigrations } from "../src/db";

describe("waiting for the migrate job", () => {
  it("returns once every migration this build ships has run, and gives up with a clear error otherwise", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const pg = new PGlite();
    await migrate(drizzle(pg), { migrationsFolder: MIGRATIONS_DIR });
    expect(await appliedMigrations(pg)).toBe(bundledMigrations());
    await expect(waitForMigrations(pg, 1_000, 10)).resolves.toBeUndefined();

    await pg.exec(`DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations)`);
    await expect(waitForMigrations(pg, 100, 10)).rejects.toThrow(/has \d+ of \d+ migrations; the migrate job has not run/);
  });

  it("treats a database with no migrations table as zero", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(waitForMigrations(new PGlite(), 50, 10)).rejects.toThrow(/has 0 of/);
  });
});
