// pnpm dev:api — the real API on an in-process Postgres (PGlite) with a fake
// Telegraph node. Everything it serves is labelled "simulated"; see
// src/simulated.ts for the scenarios.
import { serve } from "@hono/node-server";
import { simulatedApi } from "../src/simulated";

const port = Number(process.env.PORT ?? 8787);
const { app, config, key } = await simulatedApi();
serve({ fetch: app.fetch, port });
console.log(`skein api (SIMULATED) on http://localhost:${port} · partner key ${key} · CORS ${config.webOrigins.join(", ")}`);
