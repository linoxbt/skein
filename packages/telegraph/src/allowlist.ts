import type { Check } from "@skein/engine";

export interface MinerCandidate {
  minerId: string;
  name: string;
  /** Why this miner can answer the check for an arbitrary EVM token. */
  why: string;
  /**
   * Set when the miner cannot take the intent's canonical params (the node
   * answers 503 no_compatible_miner): the ask is sent in the native form, with
   * canonical params renamed to the miner's own.
   */
  native?: { method: "GET" | "POST"; endpoint: string; params: Readonly<Record<string, string>> };
}

/**
 * Pinned-purchase allowlist, tried in order. Most miners registered on Skein's
 * input intents wrap a fixed public endpoint that does not take the token at
 * all (HN story feeds on SOCIAL_BOT_DETECTION, academic search on
 * SMART_CONTRACT_AUDIT, static sanctions indexes on SANCTIONS_SCREENING_MATCH),
 * so a routed call can return a paid, receipted, irrelevant answer.
 *
 * Request forms were checked against the live node with unpaid requests on
 * 2026-10-30 (402 = accepted, 503 = cannot take the params). Answer quality is
 * UNVERIFIED until one paid answer per candidate is recorded as a fixture.
 */
export const ALLOWLIST: Readonly<Partial<Record<Check, readonly MinerCandidate[]>>> = {
  contract_audit: [
    { minerId: "200001", name: "GoPlus Security", why: "token security flags (honeypot, taxes, owner, proxy, mint); accepts query + context" },
  ],
  wash_trading: [
    { minerId: "7378", name: "VerifyWire Wash Trading Detection", why: "scans a token's Transfer logs; canonical params accepted; no BNB" },
  ],
  holder_count: [
    { minerId: "7302", name: "ChainWire Token Holder Count", why: "chain + ERC-20 address; canonical params accepted; no BNB" },
    { minerId: "900", name: "OnChain Intel Miner", why: "token-holders endpoint; lists bsc among its chains" },
  ],
  liquidity_depth: [
    { minerId: "7373", name: "VerifyWire Liquidity Depth", why: "the only live miner that accepts canonical {pool, chain}; same operator as 7378 and 7302" },
    {
      minerId: "72006",
      name: "GeckoTerminal Pool",
      why: "reserve_in_usd for a pool address; its default pool is on Ethereum, so other chains are unverified",
      native: { method: "GET", endpoint: "/query", params: { pool: "address" } },
    },
  ],
  sanctions: [
    {
      minerId: "78021",
      name: "OFAC SDN Entity Screen",
      why: "screens one entity against the SDN list; whether it matches a 0x address is untested",
      native: { method: "GET", endpoint: "/query", params: { name: "entity" } },
    },
    { minerId: "9002", name: "TxLens", why: "multi-intent miner with a sanctions-screening endpoint; canonical params accepted" },
  ],
  social_bots: [
    { minerId: "7457", name: "TradeWire Social Bot Detection", why: "takes an account plus follower signals; canonical params accepted" },
  ],
  code_review: [],
};
