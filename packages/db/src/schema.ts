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

export const consumers = pgTable("consumers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["agent", "team", "contract"] }).notNull(),
  wallet: text("wallet"),
  apiKeyHash: text("api_key_hash"),
  plan: text("plan").notNull().default("partner"),
  dailyCapUusdc: bigint("daily_cap_uusdc", { mode: "number" }).notNull().default(2_000_000),
  createdAt: createdAt(),
});

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

export const verdicts = pgTable(
  "verdicts",
  {
    id: text("id").primaryKey(),
    subjectChainId: integer("subject_chain_id").notNull(),
    subjectToken: text("subject_token").notNull(),
    policyId: text("policy_id").notNull(),
    policyVersion: text("policy_version").notNull(),
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
    upstreamUusdc: bigint("upstream_uusdc", { mode: "number" }).notNull(),
    channel: text("channel", { enum: ["telegraph", "api", "job", "cli"] }).notNull(),
    network: text("network").notNull(),
    consumerId: uuid("consumer_id").references(() => consumers.id),
    idempotencyKey: text("idempotency_key"),
    durationMs: integer("duration_ms").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("verdicts_consumer_idempotency").on(t.consumerId, t.idempotencyKey),
    index("verdicts_subject").on(t.subjectChainId, t.subjectToken, t.policyId, t.createdAt),
    check("verdicts_bps", sql`${t.riskBps} between 0 and 10000 and ${t.confidenceBps} between 0 and 10000 and ${t.coverageBps} between 0 and 10000`),
  ],
);

/** One row per upstream attempt, including failures. Append-only. */
export const purchases = pgTable(
  "purchases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    verdictId: text("verdict_id").notNull().references(() => verdicts.id),
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
    createdAt: createdAt(),
  },
  (t) => [
    index("purchases_verdict").on(t.verdictId),
    uniqueIndex("purchases_receipt").on(t.receiptHash),
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
  (t) => [index("spend_ledger_ts").on(t.ts)],
);

export const webhooks = pgTable("webhooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  consumerId: uuid("consumer_id").notNull().references(() => consumers.id),
  url: text("url").notNull(),
  secretHash: text("secret_hash").notNull(),
  active: boolean("active").notNull().default(true),
});

/** Backs the SSE stream; pruned after 7 days. Not evidence. */
export const events = pgTable(
  "events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    verdictId: text("verdict_id").notNull(),
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
