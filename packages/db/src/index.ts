export * as schema from "./schema";
export * from "./store";

import { fileURLToPath } from "node:url";
/** Folder of SQL migrations, for drizzle's migrate(). */
export const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));
export * from "./roles";

import { readFileSync } from "node:fs";
/** How many migrations this build ships (drizzle's journal). */
export function bundledMigrations(): number {
  const j = JSON.parse(readFileSync(`${MIGRATIONS_DIR}/meta/_journal.json`, "utf8")) as { entries: unknown[] };
  return j.entries.length;
}
