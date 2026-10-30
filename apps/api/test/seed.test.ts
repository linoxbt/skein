import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { MIGRATIONS_DIR, schema, type Db } from "@skein/db";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";
import { parseSeedConsumers, seedConsumers } from "../src/seed";

const h = (k: string) => createHash("sha256").update(k).digest("hex");

describe("SEED_CONSUMERS", () => {
  it("parses entries and rejects anything but a hash", () => {
    expect(parseSeedConsumers(` Skein Desk|agent|${h("a")}|5 , B|team|${h("b")}`)).toEqual([
      { name: "Skein Desk", kind: "agent", apiKeyHash: h("a"), dailyCapUusdc: 5_000_000 },
      { name: "B", kind: "team", apiKeyHash: h("b"), dailyCapUusdc: 2_000_000 },
    ]);
    expect(parseSeedConsumers(undefined)).toEqual([]);
    expect(() => parseSeedConsumers("Desk|agent|sk_part_plaintext|5")).toThrow(/bad entry/);
    expect(() => parseSeedConsumers(`Desk|robot|${h("a")}|5`)).toThrow(/kind/);
  });

  it("inserts once, however often the API restarts", async () => {
    const pg = new PGlite();
    await migrate(drizzle(pg), { migrationsFolder: MIGRATIONS_DIR });
    const db = drizzle(pg, { schema }) as unknown as Db;
    const seeds = parseSeedConsumers(`Skein Desk|agent|${h("desk")}|5`);
    expect(await seedConsumers(db, seeds)).toEqual(["Skein Desk"]);
    expect(await seedConsumers(db, seeds)).toEqual([]);
    const rows = await db.select().from(schema.consumers);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Skein Desk", kind: "agent", dailyCapUusdc: 5_000_000 });
  }, 30_000);
});
