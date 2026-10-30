export * as schema from "./schema";
export * from "./store";

import { fileURLToPath } from "node:url";
/** Folder of SQL migrations, for drizzle's migrate(). */
export const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));
