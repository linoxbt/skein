// pnpm dev:api — the real API on an in-process Postgres (PGlite) with a fake
// Telegraph node. Everything it serves is labelled "simulated": canned miner
// answers, no network, no money, never evidence.
//
// Scenarios, chosen by the request:
//   token ending in "c"     -> wash trading FAIL (the market-integrity conflict)
//   deployer ending in "e"  -> the sanctions miner hangs (ABSTAIN after two timeouts)
//   anything else           -> a clean token
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { PGlite } from "@electric-sql/pglite";
import { MIGRATIONS_DIR, schema, type Db } from "@skein/db";
import { catalogueFromSnapshot } from "@skein/pipeline";
import { TelegraphClient, TESTNET, viemSigner } from "@skein/telegraph";
import { FakeNode, type Behaviour } from "@skein/telegraph/testing";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createApp } from "../src/app";
import { configFromEnv } from "../src/config";
import { VerdictService } from "../src/service";

export const DEV_KEY = "sk_dev_local_simulated";

const pg = new PGlite();
await migrate(drizzle(pg), { migrationsFolder: MIGRATIONS_DIR });
const db = drizzle(pg, { schema }) as unknown as Db;
await db.insert(schema.consumers).values({ name: "local dev", kind: "team", apiKeyHash: createHash("sha256").update(DEV_KEY).digest("hex"), dailyCapUusdc: 100_000_000 });

const str = (v: unknown) => (typeof v === "string" ? v.toLowerCase() : "");
const jitter = (min: number, max: number) => Math.round(min + Math.random() * (max - min));

const node = new FakeNode({
  respond: (minerId, body): Behaviour => {
    const params = (body.params ?? body.payload ?? {}) as Record<string, unknown>;
    const ctx = (body.context ?? {}) as Record<string, unknown>;
    const token = str(params.token ?? params.subject ?? ctx.contract_addresses ?? ctx.token);
    const answer = (result: unknown, min = 300, max = 1600): Behaviour => ({ kind: "answer", result, delayMs: jitter(min, max) });
    switch (minerId) {
      case "200001":
        return answer({ result: { [token || "0x0"]: { is_honeypot: "0", is_open_source: "1", is_mintable: "0", buy_tax: "0", sell_tax: "0.01" } } }, 1500, 3500);
      case "78021":
        return str(params.entity).endsWith("e") ? { kind: "hang" } : answer({ on_list: false, entity: params.entity }, 200, 600);
      case "7373":
        return answer({ liquidity_usd: 3_850_000 + jitter(0, 900_000) });
      case "7302":
        return answer({ holders_count: 48_000 + jitter(0, 20_000) });
      case "7378":
        return token.endsWith("c")
          ? answer({ verdict: "wash_trading", wash_volume_pct: 71 }, 900, 2500)
          : answer({ verdict: "organic", wash_volume_pct: 4 }, 900, 2500);
      case "7457":
        return answer({ verdict: "likely_human" });
      default:
        return answer({ verdict: "Comment" });
    }
  },
});

const snapshot = JSON.parse(readFileSync(new URL("../../../packages/telegraph/snapshots/2026-10-30.json", import.meta.url), "utf8"));
const config = { ...configFromEnv({ ...process.env, NETWORK_LABEL: "simulated", DEFAULT_POLICY: process.env.DEFAULT_POLICY ?? "dex-list" }), allowPreSeason: true };
const signer = viemSigner(`0x${"44".repeat(32)}`);
const client = new TelegraphClient({ network: TESTNET, signer, fetch: node.fetch, maxUusdcPerCall: 50_000, allowPreSeason: true });
const service = new VerdictService({
  db,
  config,
  client,
  catalogue: catalogueFromSnapshot(snapshot),
  resolver: { resolve: async () => "0xd0b53d9277642d899df5c87a3966a349a798f224" },
  payerAddress: signer.address,
});

serve({ fetch: createApp(service).fetch, port: config.port });
console.log(`skein api (SIMULATED) on http://localhost:${config.port} · partner key ${DEV_KEY} · CORS ${config.webOrigins.join(", ")}`);
