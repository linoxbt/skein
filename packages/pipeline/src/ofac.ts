import { readFileSync } from "node:fs";
import type { Finding } from "@skein/engine";

/**
 * An address screen against OFAC's SDN list, from a pinned snapshot
 * (data/ofac-sdn-evm.json, built by scripts/ofac-snapshot.py). The paid
 * sanctions intent screens names; this matches addresses exactly, so a hit
 * here is certain, not a fuzzy name match. EVM addresses are the same on
 * every EVM chain, so the list's ETH, USDT and USDC entries all apply.
 */
export interface SdnEntry {
  sdnUid: string;
  name: string;
  currency: string;
}
export interface SdnSnapshot {
  list: string;
  source: string;
  /** Treasury's files and their sha256 (sdn.csv and sdn_comments.csv since 2026-11-13). */
  sources?: { url: string; sha256: string }[];
  fetched: string;
  /** What a finding cites: since 2026-11-13, sha256 of the sources' hex digests joined by "\n" (scripts/ofac-snapshot.py). */
  sourceSha256: string;
  addresses: Record<string, SdnEntry[]>;
}

let cached: SdnSnapshot | null = null;
export function sdnSnapshot(): SdnSnapshot {
  cached ??= JSON.parse(readFileSync(new URL("../data/ofac-sdn-evm.json", import.meta.url), "utf8")) as SdnSnapshot;
  return cached;
}

/**
 * How old the shipped snapshot may get before it is reported stale. OFAC
 * amends the SDN list several times a month and adds addresses with some of
 * those amendments; a month-old list misses them. A paid name-screen "match"
 * escalates rather than rejects (adapters.ts, sanctions 0.3.0), so an address
 * the snapshot misses is caught only by a person, which is why the probe and
 * /v1/status should alert on this.
 */
export const SDN_SNAPSHOT_MAX_AGE_DAYS = 14;

export interface SnapshotStatus {
  list: string;
  /** The day the list was fetched from Treasury (YYYY-MM-DD). */
  fetched: string;
  sourceSha256: string;
  /** Whole days since it was fetched; NaN-free (an unreadable date reports Infinity). */
  ageDays: number;
  maxAgeDays: number;
  stale: boolean;
}

/** The snapshot's age against SDN_SNAPSHOT_MAX_AGE_DAYS, for /v1/status and the probe. */
export function sdnSnapshotStatus(now: Date = new Date(), snap: SdnSnapshot = sdnSnapshot(), maxAgeDays = SDN_SNAPSHOT_MAX_AGE_DAYS): SnapshotStatus {
  const fetched = Date.parse(`${snap.fetched}T00:00:00Z`);
  const ageDays = Number.isFinite(fetched) ? Math.max(0, Math.floor((now.getTime() - fetched) / 86_400_000)) : Infinity;
  return { list: snap.list, fetched: snap.fetched, sourceSha256: snap.sourceSha256, ageDays, maxAgeDays, stale: ageDays > maxAgeDays };
}

/**
 * The source sha256 of every SDN snapshot Skein has shipped. Verdicts sealed
 * with an older snapshot cite it, so when data/ofac-sdn-evm.json is refreshed
 * the previous sha256 is appended here, never replaced.
 */
export const SHIPPED_SDN_SNAPSHOTS: readonly string[] = [
  "7f43332dae0d1b78ce44c31692d87a3c66e4075bcd97e36d3f18585572ff55b8", // 2026-11-11 (sdn.csv only)
  "b2679e38cc2e2363050847c58f6c8f33465c2994b0c6a21bb69e962e9aae984d", // 2026-11-13 (sdn.csv + sdn_comments.csv: 31 more addresses)
];

/** The list snapshots Skein ships, for reproduce(): a list finding must cite one of them. */
export function knownLists(snap: SdnSnapshot = sdnSnapshot()): Record<string, string[]> {
  return { [snap.list]: [...new Set([...SHIPPED_SDN_SNAPSHOTS, snap.sourceSha256])] };
}

export interface SdnMatch extends SdnEntry {
  /** Which of the verdict's addresses matched: the token itself, or a context field such as the deployer. */
  field: string;
  address: string;
}

/** Every exact match among the given addresses (field → address; empty values are skipped). */
export function screenAddresses(addresses: Record<string, string | undefined>, snap: SdnSnapshot = sdnSnapshot()): SdnMatch[] {
  const out: SdnMatch[] = [];
  for (const [field, a] of Object.entries(addresses)) {
    if (!a) continue;
    const address = a.toLowerCase();
    for (const e of snap.addresses[address] ?? []) out.push({ field, address, ...e });
  }
  return out.sort((x, y) => x.field.localeCompare(y.field) || x.sdnUid.localeCompare(y.sdnUid));
}

/**
 * The sanctions finding for a match: FAIL, severity 3, confidence 1, so the
 * policy's sanctions blocker rejects. Its source is the list snapshot, which
 * anyone can check against Treasury's published file by its sha256 and the
 * SDN uid.
 */
export function sdnFinding(matches: readonly SdnMatch[], snap: SdnSnapshot = sdnSnapshot()): Finding {
  return {
    check: "sanctions",
    status: "FAIL",
    severity: 3,
    confidence: 1,
    sourceGroup: `ofac-sdn@${snap.fetched}`,
    evidence: {
      list: snap.list,
      listSha256: snap.sourceSha256,
      matches: matches.map((m) => ({ field: m.field, address: m.address, sdnUid: m.sdnUid })),
    },
    notes: ["ofac_sdn_address_match"],
    adapterVersion: "ofac-sdn-1",
  };
}
