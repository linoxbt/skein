import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const consumers = pgTable(
  "consumers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["agent", "team", "contract"] }).notNull(),
    wallet: text("wallet"),
    /** SHA-256 of a 256-bit random partner key; only the hash is stored. */
    apiKeyHash: text("api_key_hash"),
    plan: text("plan").notNull().default("partner"),
    dailyCapUusdc: bigint("daily_cap_uusdc", { mode: "number" }).notNull().default(2_000_000),
    /** Set to revoke the key; a revoked key is refused like an unknown one. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** Provisioned from SEED_CONSUMERS (reconciled on every start). */
    seeded: boolean("seeded").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("consumers_api_key_hash").on(t.apiKeyHash)],
);

export const policies = pgTable(
  "policies",
  {
    id: text("id").notNull(),
    version: text("version").notNull(),
    yaml: text("yaml").notNull(),
    sha256: text("sha256").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.id, t.version] })],
);

/**
 * One row per verdict request, written before anything is bought. Mutable
 * (unlike the evidence tables): it carries the idempotency claim and the
 * run's status, so a restart can find runs that never finished.
 */
export const verdictRuns = pgTable(
  "verdict_runs",
  {
    id: text("id").primaryKey(),
    consumerId: uuid("consumer_id").references(() => consumers.id),
    idempotencyKey: text("idempotency_key"),
    requestHash: text("request_hash"),
    channel: text("channel", { enum: ["telegraph", "api", "job", "cli"] }).notNull(),
    subjectChainId: integer("subject_chain_id").notNull(),
    subjectToken: text("subject_token").notNull(),
    policyId: text("policy_id").notNull(),
    policyVersion: text("policy_version").notNull(),
    contextHash: text("context_hash").notNull(),
    status: text("status", { enum: ["running", "done", "refused", "failed", "lost"] }).notNull(),
    /** The verdict served: this run's own, or a cached one. */
    verdictId: text("verdict_id"),
    /** Refusal or failure, as served to the caller (no internals). */
    outcome: jsonb("outcome"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("verdict_runs_consumer_idempotency").on(t.consumerId, t.idempotencyKey),
    index("verdict_runs_status").on(t.status, t.startedAt),
  ],
);

/**
 * Daily spend, held before each upstream payment and settled with what was
 * actually spent (or possibly billed). Every cap sums this table under an
 * advisory lock, so concurrent verdicts cannot pass a cap together, and spend
 * from a run that crashed stays counted at its reservation.
 */
export const spendHolds = pgTable(
  "spend_holds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    day: text("day").notNull(),
    runId: text("run_id").notNull(),
    channel: text("channel").notNull(),
    consumerId: uuid("consumer_id"),
    reservedUusdc: bigint("reserved_uusdc", { mode: "number" }).notNull(),
    spentUusdc: bigint("spent_uusdc", { mode: "number" }),
    createdAt: createdAt(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => [index("spend_holds_day").on(t.day, t.channel, t.consumerId)],
);

export const verdicts = pgTable(
  "verdicts",
  {
    id: text("id").primaryKey(),
    subjectChainId: integer("subject_chain_id").notNull(),
    subjectToken: text("subject_token").notNull(),
    policyId: text("policy_id").notNull(),
    policyVersion: text("policy_version").notNull(),
    /** SHA-256 of the policy file, sealed into the verdict hash (engine 0.2.0 on). */
    policySha256: text("policy_sha256"),
    engineVersion: text("engine_version").notNull(),
    verdict: text("verdict", { enum: ["APPROVE", "REJECT", "ESCALATE", "ABSTAIN"] }).notNull(),
    verdictCode: smallint("verdict_code").notNull(),
    riskBps: integer("risk_bps").notNull(),
    confidenceBps: integer("confidence_bps").notNull(),
    coverageBps: integer("coverage_bps").notNull(),
    summary: text("summary").notNull(),
    reasons: jsonb("reasons").notNull(),
    openRisks: jsonb("open_risks").notNull(),
    conflicts: jsonb("conflicts").notNull(),
    verdictHash: text("verdict_hash").notNull(),
    bomRoot: text("bom_root").notNull(),
    bomItems: integer("bom_items").notNull(),
    priceUusdc: bigint("price_uusdc", { mode: "number" }).notNull(),
    /** Which pricing rule set priceUusdc: standard, or abstain_upstream_only. */
    pricingRule: text("pricing_rule").notNull().default("standard"),
    upstreamUusdc: bigint("upstream_uusdc", { mode: "number" }).notNull(),
    /** Hash of the normalised request context; the cache only serves a verdict made for the same context. */
    contextHash: text("context_hash"),
    channel: text("channel", { enum: ["telegraph", "api", "job", "cli"] }).notNull(),
    network: text("network").notNull(),
    consumerId: uuid("consumer_id").references(() => consumers.id),
    idempotencyKey: text("idempotency_key"),
    /** SHA-256 of the canonical request body, to spot an idempotency key reused with a different body. */
    requestHash: text("request_hash"),
    durationMs: integer("duration_ms").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("verdicts_consumer_idempotency").on(t.consumerId, t.idempotencyKey),
    index("verdicts_subject").on(t.subjectChainId, t.subjectToken, t.policyId, t.createdAt),
    index("verdicts_channel_created").on(t.channel, t.createdAt),
    // The quality window, /v1/ledger's windows and the recent list read by time.
    index("verdicts_created").on(t.createdAt),
    check("verdicts_bps", sql`${t.riskBps} between 0 and 10000 and ${t.confidenceBps} between 0 and 10000 and ${t.coverageBps} between 0 and 10000`),
  ],
);

/** One row per upstream attempt, including failures. Append-only. */
export const purchases = pgTable(
  "purchases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The run that paid for it; written the moment it is paid, before any verdict exists. */
    verdictId: text("verdict_id").notNull().references(() => verdictRuns.id),
    check: text("check").notNull(),
    intent: text("intent").notNull(),
    minerId: text("miner_id"),
    minerName: text("miner_name"),
    pinned: boolean("pinned").notNull(),
    skipped: jsonb("skipped"),
    rail: text("rail").notNull(),
    httpStatus: integer("http_status"),
    receiptHash: text("receipt_hash"),
    signalHash: text("signal_hash"),
    amountUusdc: bigint("amount_uusdc", { mode: "number" }).notNull(),
    epochId: bigint("epoch_id", { mode: "number" }),
    txHash: text("tx_hash"),
    durationMs: integer("duration_ms").notNull(),
    attempts: smallint("attempts").notNull(),
    resultShape: text("result_shape"),
    rawResult: jsonb("raw_result"),
    error: text("error"),
    sourceGroup: text("source_group").notNull(),
    adapterVersion: text("adapter_version").notNull(),
    /** paid (valid receipt), unknown (X-PAYMENT sent, outcome unknown) or none. */
    billing: text("billing").notNull().default("paid"),
    /** The node's record of the answer: verified, missing, mismatch or unchecked. */
    signalStatus: text("signal_status"),
    /** The pool asked about (liquidity), so replay can check the answer named it. */
    pool: text("pool"),
    createdAt: createdAt(),
  },
  (t) => [
    index("purchases_verdict").on(t.verdictId),
    uniqueIndex("purchases_receipt").on(t.receiptHash),
    index("purchases_created").on(t.createdAt),
  ],
);

/** One row per finding the engine decided from. Append-only. */
export const findings = pgTable(
  "findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    verdictId: text("verdict_id").notNull().references(() => verdicts.id),
    ordinal: smallint("ordinal").notNull(),
    check: text("check").notNull(),
    status: text("status").notNull(),
    severity: smallint("severity").notNull(),
    metric: text("metric"),
    value: doublePrecision("value"),
    unit: text("unit"),
    confidence: doublePrecision("confidence").notNull(),
    sourceGroup: text("source_group").notNull(),
    evidence: jsonb("evidence"),
    notes: jsonb("notes").notNull(),
    adapterVersion: text("adapter_version"),
    /** Never bought: a planner drop or missing context. */
    unpurchased: boolean("unpurchased").notNull(),
    /** The purchase whose receipt the finding cites (evidence.receiptHash), when there is one. */
    purchaseId: uuid("purchase_id").references(() => purchases.id),
  },
  (t) => [uniqueIndex("findings_verdict_ordinal").on(t.verdictId, t.ordinal)],
);

export const minerCatalog = pgTable("miner_catalog", {
  minerId: text("miner_id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  intents: jsonb("intents").notNull(),
  status: text("status").notNull(),
  minPriceUusdc: bigint("min_price_uusdc", { mode: "number" }).notNull(),
  baseUrl: text("base_url").notNull(),
  sourceGroup: text("source_group").notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
});

export const intentStatus = pgTable("intent_status", {
  intent: text("intent").primaryKey(),
  exists: boolean("exists").notNull(),
  onchainReady: boolean("onchain_ready"),
  minerCount: integer("miner_count").notNull(),
  p50Ms: integer("p50_ms"),
  p95Ms: integer("p95_ms"),
  errorRate24h: doublePrecision("error_rate_24h"),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
});

export const spendLedger = pgTable(
  "spend_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    kind: text("kind", { enum: ["deposit", "purchase", "refund", "revenue_owed", "revenue_settled"] }).notNull(),
    amountUusdc: bigint("amount_uusdc", { mode: "number" }).notNull(),
    ref: text("ref"),
  },
  (t) => [
    index("spend_ledger_ts").on(t.ts),
    // Lookups by kind and reference (a settlement, a refund) without a scan.
    index("spend_ledger_kind_ref").on(t.kind, t.ref),
  ],
);

/**
 * One row per x402 payment (an EIP-3009 authorization, keyed by payer and
 * nonce), written before it is settled. Mutable: it moves settling -> settled
 * (or failed), and records what is owed back to the payer when the verdict it
 * paid for was refused, failed or abstained. The money itself is in
 * spend_ledger (revenue_settled), which stays append-only.
 */
export const x402Payments = pgTable(
  "x402_payments",
  {
    /** x402:<payer>:<nonce>, lowercased: also the run's idempotency key. */
    key: text("key").primaryKey(),
    payer: text("payer").notNull(),
    nonce: text("nonce").notNull(),
    amountUusdc: bigint("amount_uusdc", { mode: "number" }).notNull(),
    network: text("network").notNull(),
    /** The canonical request it paid for: a replay with another body is refused. */
    requestHash: text("request_hash").notNull(),
    status: text("status", { enum: ["settling", "settled", "failed"] }).notNull(),
    txHash: text("tx_hash"),
    error: text("error"),
    /** The run serving this payment (the latest, after a retry of a transient failure). */
    runId: text("run_id"),
    /** What is owed back, from the latest outcome: the price on a refusal or failure, price less upstream on an ABSTAIN. */
    refundUusdc: bigint("refund_uusdc", { mode: "number" }).notNull().default(0),
    refundReason: text("refund_reason"),
    /** Set by the operator once the refund has been sent (apps/api/bin/x402-refunds.ts). */
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    refundTx: text("refund_tx"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => [index("x402_payments_payer").on(t.payer, t.createdAt)],
);

/**
 * The attester's signature over each verdict, made when the verdict is sealed
 * and stored, so what is served is what was signed then, not a fresh signature
 * over whatever the row holds now. Verdicts sealed before signatures were
 * stored are signed once, on first read, and say so (atSeal false).
 */
export const verdictAttestations = pgTable("verdict_attestations", {
  verdictId: text("verdict_id").primaryKey().references(() => verdicts.id),
  scheme: text("scheme").notNull(),
  signer: text("signer").notNull(),
  message: text("message").notNull(),
  signature: text("signature").notNull(),
  /** True when signed as the verdict was sealed; false for a verdict signed later (backfill). */
  atSeal: boolean("at_seal").notNull(),
  signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A small key-value store for first-party apps (Skein Desk), namespaced per
 * partner key and enabled per key (KV_KEY_HASHES). Writes are conditional on
 * the etag, so concurrent writers never lose each other's changes.
 */
export const kv = pgTable(
  "kv",
  {
    consumerId: uuid("consumer_id").notNull().references(() => consumers.id),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    etag: text("etag").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.consumerId, t.key] })],
);

/**
 * Shared rate-limit buckets, so every API replica counts the same requests
 * (apps/api/src/limits.ts). One row per limiter and key; pruned hourly.
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").primaryKey(),
    tokens: doublePrecision("tokens").notNull(),
    allowed: boolean("allowed").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  // The hourly prune deletes by age.
  (t) => [index("rate_limits_at").on(t.at)],
);

/**
 * A lease on one in-progress Telegraph-dispatched verdict per token and
 * policy, so a repeat call that lands on another replica waits for that run
 * instead of buying a second one. Expired leases are taken over.
 */
export const flights = pgTable("flights", {
  key: text("key").primaryKey(),
  runId: text("run_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/**
 * Alert state shared by every process (API replicas, the probe): what is
 * failing, since when, and when it was last sent (packages/alerts).
 */
export const alertState = pgTable("alert_state", {
  key: text("key").primaryKey(),
  failing: boolean("failing").notNull().default(false),
  since: timestamp("since", { withTimezone: true }),
  lastSent: timestamp("last_sent", { withTimezone: true }),
  detail: text("detail"),
});

/** The last run of each scheduled job (probe, backup), so a job that stops is noticed. */
export const heartbeats = pgTable("heartbeats", {
  name: text("name").primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull(),
  detail: text("detail"),
});

/**
 * Unhandled errors, kept 30 days: the self-hosted half of error tracking.
 * /v1/status shows only the last hour's count; the details stay here and in
 * the logs (matched by request id). Sentry gets them too when SENTRY_DSN is set.
 */
export const errorLog = pgTable(
  "error_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    service: text("service").notNull(),
    fingerprint: text("fingerprint").notNull(),
    message: text("message").notNull(),
    route: text("route"),
    requestId: text("request_id"),
    stack: text("stack"),
  },
  (t) => [index("error_log_at").on(t.at)],
);

export const webhooks = pgTable("webhooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  consumerId: uuid("consumer_id").notNull().references(() => consumers.id),
  url: text("url").notNull(),
  /**
   * HMAC key for the webhook signatures; shown to the partner once. Encrypted
   * at rest ("enc:v1:...", AES-256-GCM) when WEBHOOK_SECRET_KEY is set; older
   * rows, and every row without that key, hold it in plain text.
   */
  secret: text("secret").notNull(),
  /** SHA-256 of the plain secret: checks that a decrypted secret is the one issued. */
  secretHash: text("secret_hash").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

/** Backs the SSE stream; pruned after 7 days. Not evidence. */
export const events = pgTable(
  "events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    verdictId: text("verdict_id").notNull(),
    /** The event's position in its run, the SSE id both live and on replay. */
    seq: integer("seq"),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("events_verdict").on(t.verdictId, t.id)],
);

export const evalCases = pgTable("eval_cases", {
  id: text("id").primaryKey(),
  chainId: integer("chain_id").notNull(),
  token: text("token").notNull(),
  label: text("label", { enum: ["good", "bad", "ambiguous"] }).notNull(),
  labelSourceUrl: text("label_source_url").notNull(),
  labelEventAt: timestamp("label_event_at", { withTimezone: true }),
  asOfBlock: bigint("as_of_block", { mode: "number" }).notNull(),
  split: text("split", { enum: ["tune", "holdout"] }).notNull(),
  notes: text("notes"),
});

export const evalRuns = pgTable("eval_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  system: text("system", { enum: ["skein", "single_best", "weighted_avg", "direct_api", "cheapest"] }).notNull(),
  caseId: text("case_id").notNull().references(() => evalCases.id),
  decision: text("decision").notNull(),
  costUusdc: bigint("cost_uusdc", { mode: "number" }).notNull(),
  latencyMs: integer("latency_ms").notNull(),
  runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
});
