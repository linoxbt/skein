import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { Subject } from "./types";

/** Mainnet chains whose tokens Skein analyses (payments happen on the Telegraph testnet). */
export const SUPPORTED_CHAINS: Readonly<Record<number, string>> = {
  1: "ethereum",
  56: "bsc",
  8453: "base",
  42161: "arbitrum",
};

export class InvalidSubjectError extends Error {
  readonly code = "INVALID_SUBJECT";
}

export function toChecksumAddress(address: string): string {
  const lower = address.toLowerCase().replace(/^0x/, "");
  const hash = bytesToHex(keccak_256(utf8ToBytes(lower)));
  let out = "0x";
  for (let i = 0; i < lower.length; i++) {
    out += parseInt(hash[i]!, 16) >= 8 ? lower[i]!.toUpperCase() : lower[i]!;
  }
  return out;
}

/**
 * Validates a subject. All-lowercase and all-uppercase addresses are accepted
 * as unchecksummed; mixed case must be a valid EIP-55 checksum.
 * Whether the address is a contract is checked by the API, not here.
 */
export function parseSubject(input: { chainId: unknown; token: unknown }): Subject {
  const { chainId, token } = input;
  if (typeof chainId !== "number" || !Number.isInteger(chainId) || !(chainId in SUPPORTED_CHAINS)) {
    throw new InvalidSubjectError(`unsupported chain ${String(chainId)}`);
  }
  if (typeof token !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(token)) {
    throw new InvalidSubjectError("token must be a 0x-prefixed 20-byte address");
  }
  const body = token.slice(2);
  const mixed = body !== body.toLowerCase() && body !== body.toUpperCase();
  if (mixed && toChecksumAddress(token) !== token) {
    throw new InvalidSubjectError("bad EIP-55 checksum");
  }
  if (/^0x0{40}$/.test(token)) throw new InvalidSubjectError("zero address");
  return { chainId, token: token.toLowerCase() };
}
