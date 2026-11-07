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
  native?: {
    method: "GET" | "POST";
    endpoint: string;
    params: Readonly<Record<string, string>>;
    /** Fixed native params sent with every ask. */
    fixed?: Readonly<Record<string, string | number>>;
    /**
     * Send acknowledge_warnings: the node's pre-check rejects well-formed asks
     * to this miner (it reads the params as empty), and the miner answers them.
     */
    acknowledgeWarnings?: true;
  };
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
    {
      minerId: "7378",
      name: "VerifyWire Wash Trading Detection",
      why:
        "scans a token's Transfer logs; no BNB. Native form: the intent's one param (subject) reached it as an empty token on 2026-11-06, " +
        "and the node's pre-check rejects even the native ask (422 'predicted to fail') that the miner answers when acknowledged",
      native: {
        method: "GET",
        endpoint: "/washtrade",
        params: { subject: "token", chain: "chain" },
        // The widest scan window it allows (its default is 120 blocks).
        fixed: { blocks: 600 },
        acknowledgeWarnings: true,
      },
    },
  ],
  // Paid answers for PLINKS (a 3-hour-old Clanker token on Base), 2026-11-07: 9002 counted 4696 holders
  // (GoPlus said 4973); 7302, 73606 and 73102 returned null (no index yet); 900 failed upstream (its
  // Etherscan plan does not cover Base) and was charged: not listed.
  holder_count: [
    { minerId: "9002", name: "TxLens", why: "canonical {token, chain}; counted the holders of a 3-hour-old Base token that Blockscout had not indexed" },
    {
      minerId: "7302",
      name: "ChainWire Token Holder Count",
      why:
        "chain + ERC-20 address, from Blockscout, so fresh tokens can come back null; no BNB. Native form: on 2026-11-06 the node's " +
        "canonical-to-native mapping sent it an empty chain (422 'predicted to fail'); the node's pre-check also rejects the native ask, " +
        "which the miner answers when acknowledged",
      native: { method: "GET", endpoint: "/holders", params: { token: "token", chain: "chain" }, acknowledgeWarnings: true },
    },
  ],
  liquidity_depth: [
    {
      minerId: "7373",
      name: "VerifyWire Liquidity Depth",
      why: "canonical {pool, chain}, including a Uniswap v4 pool id ($21,220.11 for PLINKS on 2026-11-07, as DEX Screener); same operator as 7378 and 7302",
    },
    {
      minerId: "77081",
      name: "VerifyWire Exact Pool Liquidity",
      why:
        "canonical {pool, chain}: GeckoTerminal's reserve for the exact pool, compared with DEX Screener; gave the same v4 figure as 7373. " +
        "Same operator and host as 7373, so a fallback, not an independent second source",
    },
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
  // Checked 2026-11-05 with unpaid asks carrying the listing question (dex-list@0.2.0's request).
  // The github.com wrappers (60001-60007) each return one fixed endpoint, not a review: not listed.
  code_review: [
    { minerId: "1900999004", name: "CodeWire Code Review", why: "a model reviews the code or link it is sent and states whether it is correct; answered 503 'try again later' on 2026-11-05" },
    { minerId: "7310045", name: "CodeWire Code Review Request Contract", why: "accepted the canonical {code} request (402); says it returns review prose rather than the canonical verdict enum, so it may score UNKNOWN until a paid answer is checked" },
  ],
};
