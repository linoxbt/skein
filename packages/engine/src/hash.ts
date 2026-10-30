import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

export const ZERO_HASH = `0x${"00".repeat(32)}`;

/**
 * Canonical JSON: object keys sorted by code unit, no whitespace, undefined
 * object members dropped. Non-finite numbers are refused rather than encoded.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new Error(`canonicalJson: non-finite number ${value}`);
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
      }
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
    }
    default:
      throw new Error(`canonicalJson: unsupported type ${typeof value}`);
  }
}

export function keccakHex(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? utf8ToBytes(data) : data;
  return `0x${bytesToHex(keccak_256(bytes))}`;
}

const HEX = /^0x(?:[0-9a-fA-F]{2})+$/;

/** Hex receipts compare case-insensitively; anything else is taken verbatim. */
export function normaliseReceipt(receipt: string): string {
  return HEX.test(receipt) ? receipt.toLowerCase() : receipt;
}

/** The distinct receipts a BOM covers. */
export function uniqueReceipts(receipts: readonly string[]): string[] {
  return [...new Set(receipts.map(normaliseReceipt))];
}

/** Bytes of a receipt hash: hex is decoded, anything else is hashed as UTF-8. */
function receiptBytes(receipt: string): Uint8Array {
  return HEX.test(receipt) ? hexToBytes(receipt.slice(2).toLowerCase()) : utf8ToBytes(receipt);
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

function hashPair(a: Uint8Array, b: Uint8Array): Uint8Array {
  const [lo, hi] = compareBytes(a, b) <= 0 ? [a, b] : [b, a];
  const buf = new Uint8Array(lo.length + hi.length);
  buf.set(lo, 0);
  buf.set(hi, lo.length);
  return keccak_256(buf);
}

/**
 * Merkle root over receipt hashes. Leaves are keccak256 of each receipt's
 * bytes, de-duplicated and sorted; pairs are hashed in sorted order
 * (commutative, OpenZeppelin-compatible); an odd node is promoted unchanged.
 * An empty set gives the zero hash.
 */
export function merkleRoot(receipts: readonly string[]): string {
  let level: Uint8Array[] = uniqueReceipts(receipts).map((r) => keccak_256(receiptBytes(r))).sort(compareBytes);
  if (level.length === 0) return ZERO_HASH;
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const right = level[i + 1];
      next.push(right ? hashPair(level[i]!, right) : level[i]!);
    }
    level = next;
  }
  return `0x${bytesToHex(level[0]!)}`;
}
