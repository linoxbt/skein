// Skein MCP server over stdio. Configure it in an MCP client, e.g.
//   { "command": "npx", "args": ["tsx", "/path/to/skein/packages/mcp/bin/skein-mcp.ts"],
//     "env": { "SKEIN_API_KEY": "sk_part_…" } }
//
// Environment:
//   SKEIN_API_URL             default https://api-production-9396.up.railway.app
//   SKEIN_WEB_URL             default https://skein-web.netlify.app
//   SKEIN_API_KEY             a partner key (pays nothing during the hackathon), or
//   SKEIN_PAYER_KEY           a burner private key that pays through Telegraph escrow
//   SKEIN_MINER_ID            pin the Skein miner (otherwise routed by intent)
//   SKEIN_MAX_USDC_PER_CALL   default 0.30
//   SKEIN_DAILY_CAP_USDC      per-session cap, default 2
//
// stdout carries the protocol; everything else goes to stderr.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Skein, type Payer } from "@skein/sdk";
import { networkFromEnv, TelegraphClient, viemSigner } from "@skein/telegraph";
import { createSkeinMcp } from "../src/server";

const env = process.env;
const maxUsdcPerCall = Number(env.SKEIN_MAX_USDC_PER_CALL ?? 0.3);
const sessionCapUsdc = Number(env.SKEIN_DAILY_CAP_USDC ?? 2);

let payer: Payer | undefined;
if (env.SKEIN_PAYER_KEY) {
  const client = new TelegraphClient({
    network: networkFromEnv(env),
    signer: viemSigner(env.SKEIN_PAYER_KEY as `0x${string}`),
    maxUusdcPerCall: Math.round(maxUsdcPerCall * 1e6),
  });
  payer = { kind: "telegraph", client, ...(env.SKEIN_MINER_ID ? { minerId: env.SKEIN_MINER_ID } : {}) };
} else if (env.SKEIN_API_KEY) {
  payer = { kind: "apiKey", key: env.SKEIN_API_KEY };
}
if (!payer) console.error("skein-mcp: no SKEIN_API_KEY or SKEIN_PAYER_KEY; skein_quote and skein_verify work, skein_verdict will refuse.");

const skein = new Skein({ apiUrl: env.SKEIN_API_URL ?? "https://api-production-9396.up.railway.app", ...(payer ? { payer } : {}), maxUsdcPerCall });
const { server } = createSkeinMcp({ skein, webUrl: env.SKEIN_WEB_URL ?? "https://skein-web.netlify.app", sessionCapUsdc, maxUsdcPerCall });
await server.connect(new StdioServerTransport());
console.error(`skein-mcp ready · ${payer?.kind ?? "no payer"} · cap ${maxUsdcPerCall} USDC/call, ${sessionCapUsdc} USDC/session`);
