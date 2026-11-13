import type { Check, IntentAvailability } from "@skein/engine";
import { ALLOWLIST, CHECK_INTENTS, sourceGroup, type MinerCandidate, type MinerRecord, type TelegraphClient } from "@skein/telegraph";

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

/**
 * A miner's floor price in micro-USDC, or null when it is not one. The node's
 * field is named min_price_usdc but carries micro-USDC (10000 is $0.01, on
 * every miner seen live); a fractional value is a price in whole USDC, a
 * different unit, and such a miner is not planned on rather than guessed at.
 */
export function floorUusdc(m: Pick<MinerRecord, "min_price_usdc">): number | null {
  const v = m.min_price_usdc;
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
}

const active = (m: MinerRecord) => m.activation_status === "active" && floorUusdc(m) !== null;

/** How Skein buys: pinned to the allowlist (the default), with some checks allowed to route, never from itself. */
export interface BuyFrom {
  pinned?: boolean;
  allowRouted?: readonly Check[];
  excludeMinerIds?: readonly string[];
}

/**
 * Live miners per intent. With `buyFrom`, the count for each check's intent is
 * the miners Skein would actually buy from: active allowlisted candidates that
 * are not Skein itself (or, where routing is allowed, any active miner). The
 * planner refuses a verdict whose required check has none, before anything
 * is bought (audit H8): counting every active miner planned purchases for
 * checks that could only come back UNAVAILABLE.
 */
export function availability(c: Catalogue, buyFrom?: BuyFrom): Record<string, IntentAvailability> {
  const out: Record<string, IntentAvailability> = Object.fromEntries(
    Object.entries(c.minersByIntent).map(([i, ms]) => [i, { exists: true, minerCount: ms.filter(active).length }]),
  );
  if (!buyFrom) return out;
  const self = new Set(buyFrom.excludeMinerIds ?? []);
  for (const [check, intent] of Object.entries(CHECK_INTENTS) as [Check, string | null][]) {
    if (!intent || !out[intent]) continue;
    const routed = buyFrom.pinned === false;
    const pinnedCount = routed ? 0 : candidates(c, check, intent, self).length;
    const routedCount = (c.minersByIntent[intent] ?? []).filter((m) => active(m) && !self.has(m.id)).length;
    const minerCount = routed ? routedCount : pinnedCount > 0 ? pinnedCount : (buyFrom.allowRouted ?? []).includes(check) ? routedCount : 0;
    out[intent] = { exists: true, minerCount };
  }
  return out;
}

/** Allowlisted miners for a check that are active right now, in allowlist order, Skein's own excluded. */
export function candidates(c: Catalogue, check: Check, intent: string, exclude: ReadonlySet<string> = new Set()): (MinerCandidate & { record: MinerRecord })[] {
  const live = (c.minersByIntent[intent] ?? []).filter(active);
  return (ALLOWLIST[check] ?? []).flatMap((cand) => {
    const record = live.find((x) => x.id === cand.minerId);
    return record && !exclude.has(cand.minerId) ? [{ ...cand, record }] : [];
  });
}

/** The first allowlisted miner to pin for a check, if one is active; null means routed. */
export function chooseMiner(c: Catalogue, check: Check, intent: string, exclude: ReadonlySet<string> = new Set()): MinerRecord | null {
  return candidates(c, check, intent, exclude)[0]?.record ?? null;
}

/**
 * Quote per intent in micro-USDC: the pinned miner's floor, or for a routed
 * call the highest floor among active miners (the router may pick any).
 */
export function quotes(c: Catalogue, checkIntents: Partial<Record<Check, string | null>>, pinned: boolean, excludeMinerIds: readonly string[] = []): Record<string, number> {
  const out: Record<string, number> = {};
  const self = new Set(excludeMinerIds);
  for (const [check, intent] of Object.entries(checkIntents) as [Check, string | null][]) {
    if (!intent) continue;
    const live = (c.minersByIntent[intent] ?? []).filter(active);
    if (live.length === 0) continue;
    const pin = pinned ? chooseMiner(c, check, intent, self) : null;
    out[intent] = pin ? floorUusdc(pin)! : Math.max(...live.map((m) => floorUusdc(m)!));
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
