import { readdirSync, readFileSync } from "node:fs";
import { isSelfRouting } from "@skein/engine";
import { describe, expect, it } from "vitest";
import { ALLOWLIST, CHECK_INTENTS, SERVED_INTENTS, sourceGroup, TelegraphClient, TESTNET } from "../src";

interface Snapshot {
  intents: Record<string, { miner_count: number; miners: { id: string; base_url: string }[] }>;
}
const snap = JSON.parse(
  readFileSync(new URL("../snapshots/2026-10-30.json", import.meta.url), "utf8"),
) as Snapshot;
/** The newest recorded catalogue (bin/snapshot.ts): where an allowlisted miner must be registered. */
const latestName = readdirSync(new URL("../snapshots/", import.meta.url)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().at(-1)!;
const latest = JSON.parse(readFileSync(new URL(`../snapshots/${latestName}`, import.meta.url), "utf8")) as Snapshot;

describe("source groups", () => {
  it.each([
    ["https://api.dexscreener.com", "dexscreener.com"],
    ["https://eth.blockscout.com", "blockscout.com"],
    ["https://base.blockscout.com", "blockscout.com"],
    ["https://telegraph-verify.margyn.workers.dev", "margyn.workers.dev"],
    ["https://telegraph-chain.margyn.workers.dev", "margyn.workers.dev"],
    ["https://omni-chat.13.237.89.59.sslip.io", "13.237.89.59"],
    ["https://eviplan-miner.onrender.com", "eviplan-miner.onrender.com"],
    ["https://miner-wine.vercel.app", "miner-wine.vercel.app"],
    ["https://api.gopluslabs.io", "gopluslabs.io"],
  ])("%s -> %s", (url, group) => {
    expect(sourceGroup(url)).toBe(group);
  });
});

describe("intent map against the 2026-10-30 snapshot", () => {
  it("every mapped intent exists and has miners", () => {
    for (const [check, intent] of Object.entries(CHECK_INTENTS)) {
      if (intent === null) continue;
      expect(snap.intents[intent], `${check} -> ${intent}`).toBeDefined();
      expect(snap.intents[intent]!.miner_count).toBeGreaterThan(0);
    }
  });

  it("no input is in the family of an intent Skein serves", () => {
    for (const intent of Object.values(CHECK_INTENTS)) {
      if (intent) expect(isSelfRouting(intent, SERVED_INTENTS)).toBe(false);
    }
    expect(isSelfRouting("FRAUD_RISK_GENERAL", SERVED_INTENTS)).toBe(true);
  });

  it("every allowlisted miner is registered on its check's intent in the newest snapshot", () => {
    for (const [check, miners] of Object.entries(ALLOWLIST)) {
      const intent = CHECK_INTENTS[check as keyof typeof CHECK_INTENTS];
      const ids = new Set(latest.intents[intent!]?.miners.map((m) => m.id));
      for (const m of miners ?? []) expect(ids.has(m.minerId), `${m.minerId} on ${intent}`).toBe(true);
    }
  });

  it("several of the strongest candidates share one operator", () => {
    const byId = new Map(Object.values(snap.intents).flatMap((i) => i.miners.map((m) => [m.id, m.base_url] as const)));
    const groups = ["7378", "7302", "7373", "7457"].map((id) => sourceGroup(byId.get(id)!));
    expect(new Set(groups)).toEqual(new Set(["margyn.workers.dev"]));
  });
});

describe("miner identity on receipts", () => {
  // Receipts name the on-chain registration id; the pin is the catalogue's YAML id.
  const node = (url: string) => {
    if (url.endsWith("/api/miners/2859")) return { miner: { registration_id: 2859, slug: "san-ofac-entity", supported_intents: ["SANCTIONS_SCREENING_MATCH_GENERAL"] } };
    if (url.endsWith("/api/miners/4819")) return { miner: { registration_id: 4819, slug: "goplus-security", supported_intents: ["SMART_CONTRACT_AUDIT_GENERAL"] } };
    if (url.endsWith("/engine/v1/intents/SANCTIONS_SCREENING_MATCH_GENERAL")) return { miners: [{ id: "78021", slug: "san-ofac-entity" }, { id: "9002", slug: "txlens" }] };
    if (url.endsWith("/engine/v1/intents/SMART_CONTRACT_AUDIT_GENERAL")) return { miners: [{ id: "200001", slug: "goplus-security" }] };
    return null;
  };
  const client = () =>
    new TelegraphClient({
      network: TESTNET,
      maxUusdcPerCall: 1,
      fetch: async (u) => {
        const body = node(String(u));
        return new Response(body ? JSON.stringify(body) : '{"error":"miner registration not found"}', { status: body ? 200 : 404 });
      },
    });

  it("accepts a registration id whose slug is the pinned miner's", async () => {
    expect(await client().sameMiner("2859", "78021")).toBe(true);
    expect(await client().sameMiner("4819", "200001")).toBe(true);
  });

  it("refuses another miner's registration, an unknown one, and a pin it cannot place", async () => {
    expect(await client().sameMiner("2859", "9002")).toBe(false);
    expect(await client().sameMiner("4819", "78021")).toBe(false);
    expect(await client().sameMiner("999", "78021")).toBe(false);
  });
});
