// npx tsx packages/telegraph/bin/snapshot.ts [node url]
//
// Records the live miners on each of Skein's check intents to
// snapshots/<today>.json, from the node's public /engine/v1/intents/{intent}.
// The allowlist test checks every allowlisted miner against the newest
// snapshot, so adding a miner to ALLOWLIST starts with recording where it is
// registered. Free: no payments, no keys.
import { writeFileSync } from "node:fs";
import { CHECK_INTENTS } from "../src/intents";

const node = (process.argv[2] ?? "https://devnode.telegraphprotocol.com").replace(/\/$/, "");
const intents = [...new Set(Object.values(CHECK_INTENTS).filter((i): i is string => !!i))].sort();
const out: Record<string, unknown> = {};
for (const intent of intents) {
  const r = await fetch(`${node}/engine/v1/intents/${intent}`);
  if (!r.ok) throw new Error(`${intent}: HTTP ${r.status}`);
  const d = (await r.json()) as { class?: string; miner_count?: number; request?: unknown; response?: unknown; miners?: Record<string, unknown>[] };
  out[intent] = {
    class: d.class,
    miner_count: d.miner_count,
    request: d.request,
    response: d.response,
    miners: (d.miners ?? []).map((m) => ({ id: String(m.id), name: m.name, slug: m.slug, base_url: m.base_url, description: m.description })),
  };
  console.log(`${intent}: ${(d.miners ?? []).length} miners`);
}
const day = new Date().toISOString().slice(0, 10);
const file = new URL(`../snapshots/${day}.json`, import.meta.url);
writeFileSync(file, `${JSON.stringify({ source: `${node}/engine/v1/intents/{intent}`, fetched_at: new Date().toISOString(), note: "Skein's check intents only; recorded by bin/snapshot.ts", intents: out }, null, 1)}\n`);
console.log(`wrote ${file.pathname}`);
