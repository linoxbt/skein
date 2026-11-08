import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { simulatedApi } from "@skein/api/simulated";
import { Skein } from "@skeinlabs/sdk";
import { beforeAll, describe, expect, it } from "vitest";
import { createSkeinMcp } from "../src/server";

let api: Awaited<ReturnType<typeof simulatedApi>>;
let n = 0;
const tok = () => `0x${(++n).toString(16).padStart(39, "0")}a`;

beforeAll(async () => {
  api = await simulatedApi({ fast: true, env: {} });
});

async function connect(sessionCapUsdc = 2) {
  const skein = new Skein({
    apiUrl: "http://skein.test",
    payer: { kind: "apiKey", key: api.key },
    maxUsdcPerCall: 0.3,
    fetch: (i, init) => Promise.resolve(api.app.fetch(new Request(String(i), init))),
  });
  const mcp = createSkeinMcp({ skein, webUrl: "https://skein.test", sessionCapUsdc, maxUsdcPerCall: 0.3 });
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

describe("skein mcp session cap under concurrency", () => {
  it("reserves before paying: concurrent calls cannot pass the cap together", async () => {
    const { client, mcp } = await connect(0.5);
    const outs = (await Promise.all(Array.from({ length: 4 }, () => client.callTool({ name: "skein_verdict", arguments: { chainId: 8453, token: tok() } })))) as Result[];
    expect(outs.filter((o) => !o.isError)).toHaveLength(2);
    expect(outs.filter((o) => o.isError && o.content[0]!.text.startsWith("SESSION_CAP"))).toHaveLength(2);
    expect(mcp.spentUsdc()).toBeCloseTo(0.5);
  });
});
