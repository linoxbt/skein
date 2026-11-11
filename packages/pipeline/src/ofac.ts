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
  fetched: string;
  sourceSha256: string;
  addresses: Record<string, SdnEntry[]>;
}

let cached: SdnSnapshot | null = null;
export function sdnSnapshot(): SdnSnapshot {
  cached ??= JSON.parse(readFileSync(new URL("../data/ofac-sdn-evm.json", import.meta.url), "utf8")) as SdnSnapshot;
  return cached;
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
