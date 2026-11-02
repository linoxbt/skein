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

/** A receipt hash in the BOM: exactly 32 bytes of hex. */
const RECEIPT = /^0x[0-9a-f]{64}$/;

export function isReceiptHash(receipt: string): boolean {
  return RECEIPT.test(normaliseReceipt(receipt));
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

function prefixed(tag: number, ...parts: Uint8Array[]): Uint8Array {
  const buf = new Uint8Array(1 + parts.reduce((n, p) => n + p.length, 0));
  buf[0] = tag;
  let at = 1;
  for (const p of parts) {
    buf.set(p, at);
    at += p.length;
  }
  return buf;
}

/**
 * Merkle root over receipt hashes, domain-separated (engine 0.2.0 on):
 * leaf = keccak256(0x00 ‖ receipt), node = keccak256(0x01 ‖ lo ‖ hi) with the
 * pair in sorted order; an odd node is promoted unchanged; the empty set gives
 * the zero hash. Receipts must be 32-byte hashes, so neither a leaf nor a
 * crafted "receipt" can stand in for an internal node.
 */
export function merkleRoot(receipts: readonly string[]): string {
  const unique = uniqueReceipts(receipts);
  const bad = unique.find((r) => !RECEIPT.test(r));
  if (bad !== undefined) throw new Error(`not a 32-byte receipt hash: ${bad.slice(0, 20)}`);
  let level: Uint8Array[] = unique.map((r) => keccak_256(prefixed(0x00, hexToBytes(r.slice(2))))).sort(compareBytes);
  if (level.length === 0) return ZERO_HASH;
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i]!;
      const b = level[i + 1];
      if (!b) {
        next.push(a);
        continue;
      }
      const [lo, hi] = compareBytes(a, b) <= 0 ? [a, b] : [b, a];
      next.push(keccak_256(prefixed(0x01, lo, hi)));
    }
    level = next;
  }
  return `0x${bytesToHex(level[0]!)}`;
}
