import { readFileSync } from "node:fs";
import { isSelfRouting } from "@skein/engine";
import { describe, expect, it } from "vitest";
import { ALLOWLIST, CHECK_INTENTS, SERVED_INTENTS, sourceGroup } from "../src";

interface Snapshot {
  intents: Record<string, { miner_count: number; miners: { id: string; base_url: string }[] }>;
}
const snap = JSON.parse(
  readFileSync(new URL("../snapshots/2026-10-30.json", import.meta.url), "utf8"),
) as Snapshot;

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

  it("every allowlisted miner was registered on its check's intent", () => {
    for (const [check, miners] of Object.entries(ALLOWLIST)) {
      const intent = CHECK_INTENTS[check as keyof typeof CHECK_INTENTS];
      const ids = new Set(snap.intents[intent!]?.miners.map((m) => m.id));
      for (const m of miners ?? []) expect(ids.has(m.minerId), `${m.minerId} on ${intent}`).toBe(true);
    }
  });

  it("several of the strongest candidates share one operator", () => {
    const byId = new Map(Object.values(snap.intents).flatMap((i) => i.miners.map((m) => [m.id, m.base_url] as const)));
    const groups = ["7378", "7302", "7373", "7457"].map((id) => sourceGroup(byId.get(id)!));
    expect(new Set(groups)).toEqual(new Set(["margyn.workers.dev"]));
  });
});
