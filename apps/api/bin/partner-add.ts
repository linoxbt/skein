// pnpm --filter @skein/api partner:add "<team name>" [daily cap in USDC]
// Creates a partner consumer and prints its API key ONCE. Only the SHA-256 is stored.
import { createHash, randomBytes } from "node:crypto";
import { schema } from "@skein/db";
import { connect } from "../src/db";

const [name, cap] = process.argv.slice(2);
if (!name) throw new Error('usage: partner:add "<team name>" [daily cap USDC]');
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const key = `sk_part_${randomBytes(32).toString("base64url")}`;
const { db, pool } = connect(url);
const [row] = await db
  .insert(schema.consumers)
  .values({ name, kind: "team", apiKeyHash: createHash("sha256").update(key).digest("hex"), dailyCapUusdc: Math.round(Number(cap ?? 2) * 1e6) })
  .returning({ id: schema.consumers.id });
await pool.end();
console.log(`consumer ${row!.id} (${name})\napi key (shown once): ${key}`);
