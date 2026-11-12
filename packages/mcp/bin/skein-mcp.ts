// Skein MCP server over stdio. Configure it in an MCP client, e.g.
//   { "command": "npx", "args": ["-y", "@skeinlabs/mcp"], "env": { "SKEIN_API_KEY": "sk_part_…" } }
//
// Environment:
//   SKEIN_API_URL             default https://api.skeinlabs.site
//   SKEIN_WEB_URL             default https://skeinlabs.site
//   SKEIN_API_KEY             a partner key (pays nothing during the hackathon), or
//   SKEIN_PAYER_KEY           a burner private key that pays through Telegraph escrow
//   SKEIN_INTENT              with SKEIN_PAYER_KEY: the intent asked, default FRAUD_RISK_GENERAL
//   SKEIN_MINER_ID            with SKEIN_PAYER_KEY: the miner pinned, default Skein's 845301
//   SKEIN_MAX_USDC_PER_CALL   default 0.30
//   SKEIN_SESSION_CAP_USDC    what one server process may spend in total, default 2
//                             (SKEIN_DAILY_CAP_USDC: deprecated alias; the cap is per process)
//   SKEIN_API_KEY_BILLING     list (default): a partner-key verdict counts at list price
//                             against the session cap; free: it counts 0
//
// A cap that is not a positive number stops the server. stdout carries the
// protocol; everything else goes to stderr.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Skein, type Payer } from "@skeinlabs/sdk";
import { networkFromEnv, TelegraphClient, viemSigner } from "@skeinlabs/sdk/telegraph";
import { ConfigError, mcpConfigFromEnv, type McpConfig } from "../src/config";
import { createSkeinMcp } from "../src/server";

const env = process.env;
let cfg: McpConfig;
try {
  cfg = mcpConfigFromEnv(env);
} catch (e) {
  if (!(e instanceof ConfigError)) throw e;
  console.error(`skein-mcp: ${e.message}`);
  process.exit(1);
}
for (const w of cfg.warnings) console.error(`skein-mcp: warning: ${w}`);

let payer: Payer | undefined;
if (env.SKEIN_PAYER_KEY) {
  const client = new TelegraphClient({
    network: networkFromEnv(env),
    signer: viemSigner(env.SKEIN_PAYER_KEY as `0x${string}`),
    maxUusdcPerCall: Math.round(cfg.maxUsdcPerCall * 1e6),
  });
  payer = { kind: "telegraph", client, intent: cfg.intent, minerId: cfg.minerId };
} else if (env.SKEIN_API_KEY) {
  payer = { kind: "apiKey", key: env.SKEIN_API_KEY };
}
if (!payer) console.error("skein-mcp: no SKEIN_API_KEY or SKEIN_PAYER_KEY; skein_quote and skein_verify work, skein_verdict will refuse.");

const skein = new Skein({ apiUrl: cfg.apiUrl, ...(payer ? { payer } : {}), maxUsdcPerCall: cfg.maxUsdcPerCall });
const { server } = createSkeinMcp({ skein, webUrl: cfg.webUrl, sessionCapUsdc: cfg.sessionCapUsdc, maxUsdcPerCall: cfg.maxUsdcPerCall, apiKeyBilling: cfg.apiKeyBilling });
await server.connect(new StdioServerTransport());
const rail = payer?.kind === "telegraph" ? `telegraph (${cfg.intent}, miner ${cfg.minerId})` : (payer?.kind ?? "no payer");
console.error(`skein-mcp ready · ${rail} · cap ${cfg.maxUsdcPerCall} USDC/call, ${cfg.sessionCapUsdc} USDC/session`);
