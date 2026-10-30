import type { Check, IntentAvailability } from "@skein/engine";
import { ALLOWLIST, sourceGroup, type MinerCandidate, type MinerRecord, type TelegraphClient } from "@skein/telegraph";

/** Live miners per intent, as /api/miners?intent= lists them. */
export interface Catalogue {
  fetchedAt: string;
  minersByIntent: Record<string, MinerRecord[]>;
}

export async function loadCatalogue(client: Pick<TelegraphClient, "listMiners">, intents: readonly string[]): Promise<Catalogue> {
  const entries = await Promise.all(
    intents.map(async (i) => [i, await client.listMiners({ intent: i, limit: 200 }).catch(() => [])] as const),
  );
  return { fetchedAt: new Date().toISOString(), minersByIntent: Object.fromEntries(entries) };
}

interface SnapshotMiner { id: string; name: string; base_url: string; min_price_uusdc: number | null; activation_status: string | null }

/** A catalogue from a dated snapshot file, for offline runs and tests. */
export function catalogueFromSnapshot(snap: { fetched_at: string; intents: Record<string, { miners: SnapshotMiner[] }> }): Catalogue {
  const minersByIntent: Record<string, MinerRecord[]> = {};
  for (const [intent, entry] of Object.entries(snap.intents)) {
    minersByIntent[intent] = entry.miners.map((m) => ({
      id: m.id, slug: m.id, name: m.name, base_url: m.base_url, supported_intents: [intent],
      activation_status: m.activation_status ?? "unknown", min_price_usdc: m.min_price_uusdc ?? 10_000,
    }));
  }
  return { fetchedAt: snap.fetched_at, minersByIntent };
}

const active = (m: MinerRecord) => m.activation_status === "active";

export function availability(c: Catalogue): Record<string, IntentAvailability> {
  return Object.fromEntries(
    Object.entries(c.minersByIntent).map(([i, ms]) => [i, { exists: true, minerCount: ms.filter(active).length }]),
  );
}

/** Allowlisted miners for a check that are active right now, in allowlist order. */
export function candidates(c: Catalogue, check: Check, intent: string): (MinerCandidate & { record: MinerRecord })[] {
  const live = (c.minersByIntent[intent] ?? []).filter(active);
  return (ALLOWLIST[check] ?? []).flatMap((cand) => {
    const record = live.find((x) => x.id === cand.minerId);
    return record ? [{ ...cand, record }] : [];
  });
}

/** The first allowlisted miner to pin for a check, if one is active; null means routed. */
export function chooseMiner(c: Catalogue, check: Check, intent: string): MinerRecord | null {
  return candidates(c, check, intent)[0]?.record ?? null;
}

/**
 * Quote per intent in micro-USDC: the pinned miner's floor, or for a routed
 * call the highest floor among active miners (the router may pick any).
 */
export function quotes(c: Catalogue, checkIntents: Partial<Record<Check, string | null>>, pinned: boolean): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [check, intent] of Object.entries(checkIntents) as [Check, string | null][]) {
    if (!intent) continue;
    const live = (c.minersByIntent[intent] ?? []).filter(active);
    if (live.length === 0) continue;
    const pin = pinned ? chooseMiner(c, check, intent) : null;
    out[intent] = pin ? pin.min_price_usdc : Math.max(...live.map((m) => m.min_price_usdc));
  }
  return out;
}

export function groupOf(c: Catalogue, minerId: string | undefined): string {
  if (!minerId) return "unknown";
  for (const ms of Object.values(c.minersByIntent)) {
    const m = ms.find((x) => x.id === minerId);
    if (m) return sourceGroup(m.base_url);
  }
  return `miner:${minerId}`;
}
