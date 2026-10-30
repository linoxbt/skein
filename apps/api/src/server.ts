import { serve } from "@hono/node-server";
import { dexScreenerResolver } from "@skein/pipeline";
import { TelegraphClient, viemSigner } from "@skein/telegraph";
import { createApp } from "./app";
import { configFromEnv } from "./config";
import { connect, runMigrations } from "./db";
import { parseSeedConsumers, seedConsumers } from "./seed";
import { VerdictService } from "./service";

const config = configFromEnv();
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const { db, pool } = connect(url);
await runMigrations(pool);
const seeded = await seedConsumers(db, parseSeedConsumers(process.env.SEED_CONSUMERS));
if (seeded.length) console.log(`seeded consumers: ${seeded.join(", ")}`);

const key = process.env.PURCHASER_PRIVATE_KEY as `0x${string}` | undefined;
const signer = key ? viemSigner(key) : undefined;
const client = new TelegraphClient({
  network: config.network,
  maxUusdcPerCall: 50_000,
  allowPreSeason: config.allowPreSeason,
  ...(signer ? { signer } : {}),
});
const service = new VerdictService({
  db,
  config,
  client,
  resolver: dexScreenerResolver(),
  ...(signer ? { payerAddress: signer.address } : {}),
});

await service.refreshCatalogue().catch((e) => console.error("catalogue refresh failed", e));
setInterval(() => void service.refreshCatalogue().catch((e) => console.error("catalogue refresh failed", e)), 5 * 60_000);

serve({ fetch: createApp(service).fetch, port: config.port });
console.log(
  `skein api on :${config.port} · ${config.network.caip2} · payer ${signer?.address ?? "none (paid calls disabled)"} · ` +
    `catalogue ${Object.values(service.catalogue.minersByIntent).flat().length} miners`,
);
