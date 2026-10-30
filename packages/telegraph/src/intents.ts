import type { Check } from "@skein/engine";

/**
 * Which Telegraph intent supplies each check. Ids carry the network's
 * _GENERAL suffix, as /engine/v1/intents listed them on 2026-10-30.
 * null means no live intent supplies the check.
 */
export const CHECK_INTENTS: Readonly<Record<Check, string | null>> = {
  contract_audit: "SMART_CONTRACT_AUDIT_GENERAL",
  sanctions: "SANCTIONS_SCREENING_MATCH_GENERAL",
  // ONCHAIN_METRIC_VERIFY_GENERAL is an ETH balance read at a block, not a
  // holder-share metric. Needs a disclosed miner (spec section 18).
  holder_concentration: null,
  holder_count: "TOKEN_HOLDER_COUNT_GENERAL",
  liquidity_depth: "LIQUIDITY_DEPTH_VERIFY_GENERAL",
  wash_trading: "WASH_TRADING_DETECTION_GENERAL",
  social_bots: "SOCIAL_BOT_DETECTION_GENERAL",
  code_review: "CODE_REVIEW_GENERAL",
};

export const MEMO_INTENT = "TEXT_SUMMARIZATION_GENERAL";

/**
 * Intents Skein serves. Plan A is a new intent; FRAUD_RISK_GENERAL already
 * exists (11 IP/URL/payment-fraud miners) and is the Plan B candidate.
 * The planner refuses to buy anything in these families.
 */
export const SERVED_INTENTS = ["FRAUD_RISK_TOKEN_LISTING"] as const;
