import type { Check } from "@skein/engine";

export interface MinerCandidate {
  minerId: string;
  name: string;
  /** Why this miner can answer the check for an arbitrary EVM token. */
  why: string;
}

/**
 * Pinned-purchase allowlist. Most miners registered on Skein's input intents
 * wrap a fixed public endpoint that does not take the token at all (for
 * example HN story feeds on SOCIAL_BOT_DETECTION, academic search on
 * SMART_CONTRACT_AUDIT, a static OFAC index on SANCTIONS_SCREENING_MATCH), so
 * a routed call can return a paid, receipted, irrelevant answer. Skein buys
 * with /engine/v1/ask/{miner_id} from this list.
 *
 * Candidates are from the 2026-10-30 catalogue snapshot and are UNVERIFIED:
 * each needs one paid test answer, recorded as an adapter fixture, on Nov 1.
 */
export const ALLOWLIST: Readonly<Partial<Record<Check, readonly MinerCandidate[]>>> = {
  contract_audit: [
    { minerId: "200001", name: "GoPlus Security", why: "token security flags (honeypot, taxes, owner, proxy, mint) for EVM tokens" },
  ],
  wash_trading: [
    { minerId: "7378", name: "VerifyWire Wash Trading Detection", why: "scans a token's Transfer logs by chain + token; no BNB" },
  ],
  holder_count: [
    { minerId: "7302", name: "ChainWire Token Holder Count", why: "takes chain + ERC-20 address; no BNB" },
    { minerId: "900", name: "OnChain Intel Miner", why: "token-holders endpoint; lists bsc among its chains" },
  ],
  liquidity_depth: [
    { minerId: "72006", name: "GeckoTerminal Pool", why: "takes a pool address; Skein must resolve the token's main pool first" },
    { minerId: "190021", name: "Liq Dexscreener Pair", why: "takes a pair address" },
    { minerId: "7373", name: "VerifyWire Liquidity Depth", why: "slippage quote on a pair; same operator as 7378 and 7302" },
  ],
  sanctions: [
    { minerId: "78021", name: "OFAC SDN Entity Screen", why: "screens an entity NAME; whether it matches a 0x address is untested" },
  ],
  social_bots: [
    { minerId: "7457", name: "TradeWire Social Bot Detection", why: "takes an account plus follower signals" },
  ],
  code_review: [],
};
