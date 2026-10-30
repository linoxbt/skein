import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { simulatedApi } from "@skein/api/simulated";
import { Skein } from "@skein/sdk";
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
  it("lists the three tools", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["skein_quote", "skein_verdict", "skein_verify"]);
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
});
