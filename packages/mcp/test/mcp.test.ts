import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { simulatedApi } from "@skein/api/simulated";
import { Skein, SKEIN_MINER_ID, type Payer } from "@skeinlabs/sdk";
import { beforeAll, describe, expect, it } from "vitest";
import pkg from "../package.json" with { type: "json" };
import { ConfigError, mcpConfigFromEnv } from "../src/config";
import { createSkeinMcp, type SkeinMcpOptions } from "../src/server";

let api: Awaited<ReturnType<typeof simulatedApi>>;
let n = 0;
const tok = () => `0x${(++n).toString(16).padStart(39, "0")}a`;

beforeAll(async () => {
  api = await simulatedApi({ fast: true, env: {} });
});

const inProcess: typeof fetch = (i, init) => Promise.resolve(api.app.fetch(new Request(String(i), init)));
async function connect(sessionCapUsdc = 2, payer?: Payer, extra: Partial<SkeinMcpOptions> = {}) {
  const skein = new Skein({ apiUrl: "http://skein.test", payer: payer ?? { kind: "apiKey", key: api.key }, maxUsdcPerCall: 0.3, fetch: inProcess });
  const mcp = createSkeinMcp({ skein, webUrl: "https://skein.test", sessionCapUsdc, maxUsdcPerCall: 0.3, ...extra });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await mcp.server.connect(a);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(b);
  return { client, mcp };
}

type Result = { content: { type: string; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

describe("skein mcp", () => {
  it("lists the five tools", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["skein_get", "skein_policies", "skein_quote", "skein_verdict", "skein_verify"]);
    expect(tools.find((t) => t.name === "skein_verdict")!.inputSchema.required).toEqual(["chainId", "token"]);
  });

  it("buys a verdict and verifies it", async () => {
    const { client, mcp } = await connect();
    const r = (await client.callTool({ name: "skein_verdict", arguments: { chainId: "base", token: tok() } })) as Result;
    expect(r.isError).toBeFalsy();
    expect(r.content[0]!.text).toMatch(/^APPROVE · risk/);
    expect(r.content[0]!.text).toContain("SIMULATED");
    const id = r.structuredContent!.id as string;
    expect(r.structuredContent!.link).toBe(`https://skein.test/v/${id}`);
    expect(mcp.spentUsdc()).toBe(0.25);
    const v = (await client.callTool({ name: "skein_verify", arguments: { id } })) as Result;
    expect(v.content[0]!.text).toMatch(/^VERIFIED/);
  });

  it("publishes chainId as one plain string type, and reads names, ids and numbers", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    for (const t of tools.filter((x) => x.name === "skein_quote" || x.name === "skein_verdict")) {
      const prop = (t.inputSchema.properties as Record<string, { type?: string; anyOf?: unknown }>).chainId!;
      expect(prop.type).toBe("string");
      expect(prop.anyOf).toBeUndefined();
    }
    for (const chainId of ["base", "BASE", "8453", 8453]) {
      const q = (await client.callTool({ name: "skein_quote", arguments: { chainId, token: tok() } })) as Result;
      expect(q.isError, String(chainId)).toBeFalsy();
      expect((q.structuredContent!.subject as { chainId: number }).chainId).toBe(8453);
    }
    const bad = (await client.callTool({ name: "skein_quote", arguments: { chainId: "solana", token: tok() } })) as Result;
    expect(bad.isError).toBe(true);
  });

  it("quotes for free", async () => {
    const { client, mcp } = await connect();
    const q = (await client.callTool({ name: "skein_quote", arguments: { chainId: 8453, token: tok() } })) as Result;
    expect(q.content[0]!.text).toMatch(/0\.25 USDC per verdict/);
    expect(mcp.spentUsdc()).toBe(0);
  });

  it("refuses past the session cap without paying", async () => {
    const { client } = await connect(0.3);
    const first = (await client.callTool({ name: "skein_verdict", arguments: { chainId: 8453, token: tok() } })) as Result;
    expect(first.isError).toBeFalsy();
    const charges = api.node.charges.length;
    const second = (await client.callTool({ name: "skein_verdict", arguments: { chainId: 8453, token: tok() } })) as Result;
    expect(second.isError).toBe(true);
    expect(second.content[0]!.text).toMatch(/^SESSION_CAP/);
    expect(api.node.charges.length).toBe(charges);
  });

  it("returns API errors as tool errors", async () => {
    const { client } = await connect();
    const r = (await client.callTool({ name: "skein_verify", arguments: { id: "vrd_missing" } })) as Result;
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/^NOT_FOUND/);
    const bad = (await client.callTool({ name: "skein_verdict", arguments: { chainId: 8453, token: "0x12" } })) as Result;
    expect(bad.isError).toBe(true);
  });

  it("lists the policies and re-reads a verdict without buying it", async () => {
    const { client } = await connect();
    const ps = (await client.callTool({ name: "skein_policies", arguments: {} })) as Result;
    expect(ps.isError).toBeFalsy();
    expect(JSON.stringify(ps.content)).toContain("dex-list@0.2.0");
    const missing = (await client.callTool({ name: "skein_get", arguments: { id: "vrd_doesnotexist" } })) as Result;
    expect(missing.isError).toBe(true);
  });
});

describe("skein mcp cost accounting", () => {
  it("reports the package version", async () => {
    const { client } = await connect();
    expect(client.getServerVersion()).toMatchObject({ name: "skein", version: pkg.version });
  });

  it("counts a paid Telegraph ask at what it cost, even when Skein answered from cache", async () => {
    const token = tok();
    const first = await new Skein({ apiUrl: "http://skein.test", payer: { kind: "apiKey", key: api.key }, fetch: inProcess }).verdict({ subject: { chainId: 8453, token } });
    // Skein's miner serves the stored verdict again: the ask was still paid.
    const asker = { ask: async () => ({ ok: true as const, response: { miner_id: SKEIN_MINER_ID, result: { id: first.id, cached: true } }, receipt: null, amountUusdc: 270_000, durationMs: 1 }) };
    const { client, mcp } = await connect(2, { kind: "telegraph", client: asker });
    const r = (await client.callTool({ name: "skein_verdict", arguments: { chainId: 8453, token } })) as Result;
    expect(r.isError).toBeFalsy();
    expect(mcp.spentUsdc()).toBeCloseTo(0.27);
    // A paid answer about another token is refused, and still counted.
    const wrong = (await client.callTool({ name: "skein_verdict", arguments: { chainId: 8453, token: tok() } })) as Result;
    expect(wrong.isError).toBe(true);
    expect(wrong.content[0]!.text).toMatch(/^TELEGRAPH_MISMATCH/);
    expect(mcp.spentUsdc()).toBeCloseTo(0.54);
  });

  it("counts a partner-key verdict at list price, or at nothing when the key is free", async () => {
    const list = await connect(2);
    await list.client.callTool({ name: "skein_verdict", arguments: { chainId: 8453, token: tok() } });
    expect(list.mcp.spentUsdc()).toBe(0.25);
    const free = await connect(0.1, undefined, { apiKeyBilling: "free" });
    const r = (await free.client.callTool({ name: "skein_verdict", arguments: { chainId: 8453, token: tok() } })) as Result;
    expect(r.isError).toBeFalsy();
    expect(free.mcp.spentUsdc()).toBe(0);
  });
});

describe("skein mcp configuration", () => {
  it("refuses caps that are not positive numbers instead of turning them off", () => {
    for (const [name, value] of [
      ["SKEIN_MAX_USDC_PER_CALL", "0.3usdc"],
      ["SKEIN_MAX_USDC_PER_CALL", "0"],
      ["SKEIN_SESSION_CAP_USDC", "NaN"],
      ["SKEIN_SESSION_CAP_USDC", "-1"],
      ["SKEIN_SESSION_CAP_USDC", "Infinity"],
      ["SKEIN_DAILY_CAP_USDC", "2usdc"],
      ["SKEIN_API_KEY_BILLING", "sometimes"],
      ["SKEIN_MINER_ID", "skein"],
      ["SKEIN_INTENT", "fraud risk"],
    ]) {
      expect(() => mcpConfigFromEnv({ [name!]: value }), `${name}=${value}`).toThrow(ConfigError);
    }
  });

  it("defaults to Skein's miner on FRAUD_RISK_GENERAL, and reads the deprecated daily-cap name as the session cap", () => {
    const d = mcpConfigFromEnv({});
    expect(d).toMatchObject({ maxUsdcPerCall: 0.3, sessionCapUsdc: 2, apiKeyBilling: "list", intent: "FRAUD_RISK_GENERAL", minerId: "845301", warnings: [] });
    const alias = mcpConfigFromEnv({ SKEIN_DAILY_CAP_USDC: "5" });
    expect(alias.sessionCapUsdc).toBe(5);
    expect(alias.warnings[0]).toMatch(/deprecated/);
    expect(mcpConfigFromEnv({ SKEIN_DAILY_CAP_USDC: "5", SKEIN_SESSION_CAP_USDC: "1" }).sessionCapUsdc).toBe(1);
    expect(mcpConfigFromEnv({ SKEIN_INTENT: "FRAUD_RISK_TOKEN_LISTING", SKEIN_MINER_ID: "5137", SKEIN_API_KEY_BILLING: "free" })).toMatchObject({ intent: "FRAUD_RISK_TOKEN_LISTING", minerId: "5137", apiKeyBilling: "free" });
  });
});

describe("skein mcp session cap under concurrency", () => {
  it("reserves before paying: concurrent calls cannot pass the cap together", async () => {
    const { client, mcp } = await connect(0.5);
    const outs = (await Promise.all(Array.from({ length: 4 }, () => client.callTool({ name: "skein_verdict", arguments: { chainId: 8453, token: tok() } })))) as Result[];
    expect(outs.filter((o) => !o.isError)).toHaveLength(2);
    expect(outs.filter((o) => o.isError && o.content[0]!.text.startsWith("SESSION_CAP"))).toHaveLength(2);
    expect(mcp.spentUsdc()).toBeCloseTo(0.5);
  });
});
