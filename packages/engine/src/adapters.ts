import type { Check, Finding, FindingStatus, Severity } from "./types";

/**
 * Adapters turn one upstream answer into one Finding. They parse by schema,
 * tolerate missing fields, and never copy miner free text into a finding:
 * anything unexpected becomes UNKNOWN with a fixed-vocabulary note.
 *
 * Field names follow the live intent schemas read from
 * /engine/v1/intents/{INTENT} on 2026-10-30 (see packages/telegraph/snapshots).
 * The answer envelope a miner returns through the engine is not confirmed
 * yet, so fields are looked up at the top level and under common wrappers.
 * Re-check every adapter against recorded paid answers on Nov 1.
 */

export interface AdapterContext {
  minerId?: string;
  minerRank?: number;
  receiptHash?: string;
  signalHash?: string;
  sourceGroup: string;
  httpStatus?: number;
  /** Set when the purchase failed (timeout, 5xx, refused 402). */
  error?: string;
  /** What was asked about, so an adapter can refuse an answer about something else. */
  subject?: { chainId: number; token: string };
  /** The pool asked about, for liquidity checks. */
  pool?: string;
}

export interface Adapter {
  check: Check;
  version: string;
  intent: string | null;
  defaultConfidence: number;
  adapt(raw: unknown, ctx: AdapterContext): Finding;
}

const WRAPPERS = ["result", "data", "response", "answer", "fields", "output", "payload", "attributes"];
const MAX_DEPTH = 3;
const MAX_STRING = 256;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Finds a field at the top level or inside common wrappers, breadth first. */
export function pick(raw: unknown, name: string): unknown {
  let level: unknown[] = [raw];
  for (let depth = 0; depth <= MAX_DEPTH && level.length > 0; depth++) {
    const next: unknown[] = [];
    for (const node of level) {
      if (!isObject(node)) continue;
      if (name in node && node[name] !== undefined && node[name] !== null) return node[name];
      for (const w of WRAPPERS) if (w in node) next.push(node[w]);
    }
    level = next;
  }
  return undefined;
}

export function pickNumber(raw: unknown, name: string, min: number, max: number): number | "out_of_range" | undefined {
  const v = pick(raw, name);
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (v === undefined) return undefined;
  if (!Number.isFinite(n)) return undefined;
  return n < min || n > max ? "out_of_range" : n;
}

function pickEnum<T extends string>(raw: unknown, name: string, allowed: readonly T[]): T | undefined {
  const v = pick(raw, name);
  if (typeof v !== "string" || v.length > MAX_STRING) return undefined;
  const norm = v.trim().toLowerCase();
  return allowed.find((a) => a.toLowerCase() === norm);
}

const TRUE_WHEN = ["true", "yes", "match", "matched", "1"];
const FALSE_WHEN = ["false", "no", "0", "no match", "not matched", "clear"];

function pickBool(raw: unknown, name: string): boolean | undefined {
  const v = pick(raw, name);
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1 ? true : v === 0 ? false : undefined;
  if (typeof v !== "string" || v.length > MAX_STRING) return undefined;
  const s = v.trim().toLowerCase();
  if (TRUE_WHEN.includes(s)) return true;
  if (FALSE_WHEN.includes(s)) return false;
  return undefined;
}

function confidenceOf(raw: unknown, fallback: number): number {
  const c = pickNumber(raw, "confidence", 0, 1);
  return typeof c === "number" ? c : fallback;
}

interface Base {
  check: Check;
  version: string;
  ctx: AdapterContext;
}

function finding(b: Base, f: Omit<Finding, "check" | "sourceGroup" | "evidence" | "adapterVersion">): Finding {
  const evidence = {
    ...(b.ctx.receiptHash ? { receiptHash: b.ctx.receiptHash } : {}),
    ...(b.ctx.signalHash ? { signalHash: b.ctx.signalHash } : {}),
    ...(b.ctx.minerId ? { minerId: b.ctx.minerId } : {}),
    ...(b.ctx.minerRank !== undefined ? { minerRank: b.ctx.minerRank } : {}),
  };
  return {
    check: b.check,
    sourceGroup: b.ctx.sourceGroup,
    adapterVersion: b.version,
    ...(Object.keys(evidence).length > 0 ? { evidence } : {}),
    ...f,
  };
}

const unknown = (b: Base, note: string): Finding => finding(b, { status: "UNKNOWN", severity: 0, confidence: 0, notes: [note] });

/** Shared front matter: failed purchases become ERROR, empty answers UNKNOWN. */
function guard(b: Base, raw: unknown): Finding | null {
  if (b.ctx.error) return finding(b, { status: "ERROR", severity: 0, confidence: 0, notes: ["purchase_failed"] });
  if (b.ctx.httpStatus !== undefined && (b.ctx.httpStatus < 200 || b.ctx.httpStatus >= 300)) {
    return finding(b, { status: "ERROR", severity: 0, confidence: 0, notes: [`http_${b.ctx.httpStatus}`] });
  }
  if (raw === undefined || raw === null || (isObject(raw) && Object.keys(raw).length === 0)) return unknown(b, "empty_answer");
  if (!isObject(raw)) return unknown(b, "unexpected_shape");
  return null;
}

type Mapping = Record<string, { status: FindingStatus; severity: Severity }>;

function enumAdapter(
  check: Check,
  intent: string,
  field: string,
  mapping: Mapping,
  metric?: { name: string; min: number; max: number; unit: string },
  defaultConfidence = 0.6,
): Adapter {
  const version = "0.1.0";
  return {
    check,
    version,
    intent,
    defaultConfidence,
    adapt(raw, ctx) {
      const b = { check, version, ctx };
      const early = guard(b, raw);
      if (early) return early;
      const label = pickEnum(raw, field, Object.keys(mapping));
      const value = metric ? pickNumber(raw, metric.name, metric.min, metric.max) : undefined;
      if (value === "out_of_range") return unknown(b, `${metric!.name}_out_of_range`);
      if (!label && value === undefined) return unknown(b, `missing_${field}`);
      const m = label ? mapping[label]! : { status: "PASS" as const, severity: 0 as Severity };
      return finding(b, {
        status: m.status,
        severity: m.severity,
        ...(metric && value !== undefined ? { metric: metric.name, value, unit: metric.unit } : {}),
        confidence: confidenceOf(raw, defaultConfidence),
        notes: label ? [`label_${label.toLowerCase().replace(/\s+/g, "_")}`] : [],
      });
    },
  };
}

/**
 * A numeric check. `names` lists the field to read: the intent's own field
 * first, then known native spellings from allowlisted miners asked in the
 * native form.
 */
function metricAdapter(check: Check, intent: string | null, names: readonly string[], min: number, max: number, unit: string, version = "0.1.0"): Adapter {
  const metric = names[0]!;
  const defaultConfidence = 0.7;
  return {
    check,
    version,
    intent,
    defaultConfidence,
    adapt(raw, ctx) {
      const b = { check, version, ctx };
      const early = guard(b, raw);
      if (early) return early;
      let value: number | "out_of_range" | undefined;
      for (const n of names) {
        value = pickNumber(raw, n, min, max);
        if (value !== undefined) break;
      }
      if (value === "out_of_range") return unknown(b, `${metric}_out_of_range`);
      if (value === undefined) return unknown(b, `missing_${metric}`);
      // PASS here means "answered"; the policy threshold sets the real status.
      return finding(b, { status: "PASS", severity: 0, metric, value, unit, confidence: confidenceOf(raw, defaultConfidence), notes: [] });
    },
  };
}

/** WASH_TRADING_DETECTION: verdict enum plus wash_volume_pct (0..100). */
const washTradingV1 = enumAdapter(
  "wash_trading",
  "WASH_TRADING_DETECTION_GENERAL",
  "verdict",
  {
    organic: { status: "PASS", severity: 0 },
    inconclusive: { status: "WARN", severity: 0 },
    likely_wash_trading: { status: "WARN", severity: 2 },
    wash_trading: { status: "FAIL", severity: 2 },
  },
  { name: "wash_volume_pct", min: 0, max: 100, unit: "percent" },
);

/**
 * 0.2.0: also reads the native answer of VerifyWire (miner 7378), asked in its
 * own form: a risk_label (LOW, MEDIUM, HIGH) and the share of volume that went
 * round trip, which stands in for wash_volume_pct so the policy threshold
 * grades it. The canonical verdict enum still wins when present.
 */
export const washTrading: Adapter = {
  check: "wash_trading",
  version: "0.2.0",
  intent: "WASH_TRADING_DETECTION_GENERAL",
  defaultConfidence: 0.6,
  adapt(raw, ctx) {
    const b = { check: "wash_trading" as const, version: "0.2.0", ctx };
    const early = guard(b, raw);
    if (early) return early;
    if (pick(raw, "verdict") !== undefined) return { ...washTradingV1.adapt(raw, ctx), adapterVersion: "0.2.0" };
    const RISK: Mapping = {
      LOW: { status: "PASS", severity: 0 },
      MEDIUM: { status: "WARN", severity: 1 },
      HIGH: { status: "WARN", severity: 2 },
    };
    const label = pickEnum(raw, "risk_label", Object.keys(RISK));
    let value: number | "out_of_range" | undefined;
    for (const n of ["wash_volume_pct", "round_trip_volume_share_percent"]) {
      value = pickNumber(raw, n, 0, 100);
      if (value !== undefined) break;
    }
    if (value === "out_of_range") return unknown(b, "wash_volume_pct_out_of_range");
    if (!label && value === undefined) return unknown(b, "missing_risk_label");
    const m = label ? RISK[label]! : { status: "PASS" as const, severity: 0 as Severity };
    const blocks = pickNumber(raw, "blocks_scanned", 0, 1e7) ?? pickNumber(raw, "blocks", 0, 1e7);
    return finding(b, {
      status: m.status,
      severity: m.severity,
      ...(value !== undefined ? { metric: "wash_volume_pct", value, unit: "percent" } : {}),
      confidence: confidenceOf(raw, 0.6),
      notes: [
        ...(label ? [`risk_${label.toLowerCase()}`] : []),
        ...(typeof blocks === "number" ? [`blocks_${blocks}`] : []),
      ],
    });
  },
};

/** SOCIAL_BOT_DETECTION: verdict enum (bot_score is off-chain only). */
export const socialBots = enumAdapter("social_bots", "SOCIAL_BOT_DETECTION_GENERAL", "verdict", {
  human: { status: "PASS", severity: 0 },
  likely_human: { status: "PASS", severity: 0 },
  inconclusive: { status: "WARN", severity: 0 },
  likely_bot: { status: "WARN", severity: 1 },
  bot: { status: "FAIL", severity: 2 },
});

/** CODE_REVIEW: verdict enum; findings and summary are free text and ignored. */
export const codeReview = enumAdapter("code_review", "CODE_REVIEW_GENERAL", "verdict", {
  Approve: { status: "PASS", severity: 0 },
  Comment: { status: "WARN", severity: 0 },
  "Request changes": { status: "WARN", severity: 2 },
});

/**
 * LIQUIDITY_DEPTH_VERIFY: total pool reserve in USD (not 2% depth).
 * reserve_in_usd is GeckoTerminal's own field, for the native-form miner.
 */
const liquidityDepthV2 = metricAdapter("liquidity_depth", "LIQUIDITY_DEPTH_VERIFY_GENERAL", ["liquidity_usd", "reserve_in_usd"], 0, 1e12, "USD", "0.2.0");

/** The pool an answer says it measured: a bare address, or GeckoTerminal's "<network>_<address>" id. */
function answeredPool(raw: unknown): string | undefined {
  for (const name of ["pool_address", "pool", "address", "id"]) {
    const v = pick(raw, name);
    if (typeof v !== "string" || v.length > MAX_STRING) continue;
    const m = /(0x[0-9a-fA-F]{40})$/.exec(v.trim());
    if (m) return m[1]!.toLowerCase();
  }
  return undefined;
}

/**
 * 0.3.0: an answer that names a pool must name the pool that was asked
 * about. A fallback miner's default pool on another chain is not this token's
 * liquidity.
 */
export const liquidityDepth: Adapter = {
  ...liquidityDepthV2,
  version: "0.3.0",
  adapt(raw, ctx) {
    const named = isObject(raw) ? answeredPool(raw) : undefined;
    if (named && ctx.pool && named !== ctx.pool.toLowerCase() && !ctx.error) {
      return unknown({ check: "liquidity_depth", version: "0.3.0", ctx }, "answer_for_other_pool");
    }
    const f = liquidityDepthV2.adapt(raw, ctx);
    return { ...f, adapterVersion: "0.3.0" };
  },
};

/** TOKEN_HOLDER_COUNT: distinct holder addresses. */
export const holderCount = metricAdapter("holder_count", "TOKEN_HOLDER_COUNT_GENERAL", ["holders_count"], 0, 1e10, "addresses");

/**
 * Top-10 holder share. No live intent supplies it (ONCHAIN_METRIC_VERIFY is an
 * ETH balance read), so this adapter waits for a disclosed miner.
 */
export const holderConcentration = metricAdapter("holder_concentration", null, ["top10_holders_pct"], 0, 1, "fraction");

/**
 * SANCTIONS_SCREENING_MATCH: matched bool (name screening). From 0.2.0 it also
 * reads on_list, the OFAC SDN Entity Screen miner's field in the native form.
 */
function sanctionsAdapter(version: string, fields: readonly string[]): Adapter {
  const defaultConfidence = 0.8;
  return {
    check: "sanctions",
    version,
    intent: "SANCTIONS_SCREENING_MATCH_GENERAL",
    defaultConfidence,
    adapt(raw, ctx) {
      const b = { check: "sanctions" as const, version, ctx };
      const early = guard(b, raw);
      if (early) return early;
      let matched: boolean | undefined;
      for (const f of fields) {
        matched = pickBool(raw, f);
        if (matched !== undefined) break;
      }
      if (matched === undefined) return unknown(b, "missing_matched");
      const score = pickNumber(raw, "match_score", 0, 1);
      return finding(b, {
        status: matched ? "FAIL" : "PASS",
        severity: matched ? 3 : 0,
        ...(typeof score === "number" ? { metric: "match_score", value: score, unit: "fraction" } : {}),
        confidence: confidenceOf(raw, defaultConfidence),
        notes: [matched ? "sanctions_match" : "no_match"],
      });
    },
  };
}

const sanctionsV2 = sanctionsAdapter("0.2.0", ["matched", "on_list"]);

/** Confidence ceiling for a name-screening answer about a wallet address. */
const ADDRESS_SCREEN_MAX_CONFIDENCE = 0.3;

/**
 * 0.3.0: the sanctions intent screens names; Skein asks it about an address.
 * Until address matching is proven against recorded answers, its answer is
 * evidence of low confidence either way: a "clear" is not a clearance, and a
 * "match" escalates to an analyst instead of rejecting on its own (blockers
 * need minConfidence).
 */
export const sanctions: Adapter = {
  ...sanctionsV2,
  version: "0.3.0",
  adapt(raw, ctx) {
    const f = sanctionsV2.adapt(raw, ctx);
    const answered = f.status === "PASS" || f.status === "WARN" || f.status === "FAIL";
    if (!answered) return { ...f, adapterVersion: "0.3.0" };
    return {
      ...f,
      adapterVersion: "0.3.0",
      confidence: Math.min(f.confidence, ADDRESS_SCREEN_MAX_CONFIDENCE),
      notes: [...f.notes, "address_matching_unverified"].sort(),
    };
  },
};

/**
 * SMART_CONTRACT_AUDIT has no response format on the network, so this adapter
 * reads GoPlus-style token-security flags ("0"/"1" strings), the one audit
 * miner in the catalogue that analyses token contracts.
 */
const AUDIT_FLAGS: ReadonlyArray<{ key: string; when: "1" | "0"; status: FindingStatus; severity: Severity }> = [
  { key: "is_honeypot", when: "1", status: "FAIL", severity: 3 },
  { key: "cannot_sell_all", when: "1", status: "FAIL", severity: 3 },
  { key: "selfdestruct", when: "1", status: "FAIL", severity: 3 },
  { key: "owner_change_balance", when: "1", status: "FAIL", severity: 3 },
  { key: "hidden_owner", when: "1", status: "FAIL", severity: 2 },
  { key: "can_take_back_ownership", when: "1", status: "FAIL", severity: 2 },
  { key: "is_blacklisted", when: "1", status: "WARN", severity: 2 },
  { key: "transfer_pausable", when: "1", status: "WARN", severity: 2 },
  { key: "is_open_source", when: "0", status: "WARN", severity: 2 },
  { key: "is_mintable", when: "1", status: "WARN", severity: 1 },
  { key: "is_proxy", when: "1", status: "WARN", severity: 1 },
  { key: "slippage_modifiable", when: "1", status: "WARN", severity: 1 },
];

function flag(raw: unknown, key: string): "0" | "1" | undefined {
  const v = pick(raw, key);
  if (v === 1 || v === "1" || v === true) return "1";
  if (v === 0 || v === "0" || v === false) return "0";
  return undefined;
}

/** GoPlus nests results under result[<address>]; unwrap a single-key map. */
function unwrapAddressMap(raw: unknown): unknown {
  const r = pick(raw, "result");
  if (isObject(r)) {
    const keys = Object.keys(r);
    if (keys.length === 1 && /^0x[0-9a-fA-F]{40}$/.test(keys[0]!)) return r[keys[0]!];
  }
  return raw;
}

const contractAuditV1: Adapter = {
  check: "contract_audit",
  version: "0.1.0",
  intent: "SMART_CONTRACT_AUDIT_GENERAL",
  defaultConfidence: 0.7,
  adapt(raw, ctx) {
    const b = { check: "contract_audit" as const, version: "0.1.0", ctx };
    const early = guard(b, raw);
    if (early) return early;
    const body = unwrapAddressMap(raw);
    let status: FindingStatus = "PASS";
    let severity: Severity = 0;
    const notes: string[] = [];
    let seen = 0;
    const rank = { PASS: 0, WARN: 1, FAIL: 2 } as Record<string, number>;
    for (const f of AUDIT_FLAGS) {
      const v = flag(body, f.key);
      if (v === undefined) continue;
      seen++;
      if (v !== f.when) continue;
      notes.push(f.key);
      if (rank[f.status]! > rank[status]! || (f.status === status && f.severity > severity)) {
        status = f.status;
        severity = f.severity;
      }
    }
    for (const tax of ["buy_tax", "sell_tax"]) {
      const t = pickNumber(body, tax, 0, 1);
      if (typeof t !== "number") continue;
      seen++;
      if (t > 0.1) {
        notes.push(`${tax}_gt_10pct`);
        if (status !== "FAIL") { status = "FAIL"; severity = 2; }
      } else if (t > 0.05) {
        notes.push(`${tax}_gt_5pct`);
        if (status === "PASS") { status = "WARN"; severity = 1; }
      }
    }
    if (seen === 0) return unknown(b, "no_security_flags");
    return finding(b, { status, severity, confidence: confidenceOf(raw, 0.7), notes: notes.sort() });
  },
};

/** GoPlus keys its answer by token address; take the entry for the token asked about. */
function entryForToken(raw: unknown, token: string): unknown | "other_token" {
  const r = pick(raw, "result");
  if (!isObject(r)) return raw;
  const keys = Object.keys(r).filter((k) => /^0x[0-9a-fA-F]{40}$/.test(k));
  if (keys.length === 0) return raw;
  const hit = keys.find((k) => k.toLowerCase() === token.toLowerCase());
  return hit ? r[hit] : "other_token";
}

/**
 * 0.2.0: the answer must be about the token asked about, and must carry the
 * flags that decide a token's safety (is_honeypot and a tax) before it can
 * PASS. One benign flag on its own is not an audit.
 */
const contractAuditV2: Adapter = {
  check: "contract_audit",
  version: "0.2.0",
  intent: "SMART_CONTRACT_AUDIT_GENERAL",
  defaultConfidence: 0.7,
  adapt(raw, ctx) {
    const b = { check: "contract_audit" as const, version: "0.2.0", ctx };
    const early = guard(b, raw);
    if (early) return early;
    if (!ctx.subject) return unknown(b, "no_subject");
    const body = entryForToken(raw, ctx.subject.token);
    if (body === "other_token") return unknown(b, "answer_for_other_token");
    const addr = pick(body, "token_address") ?? pick(body, "contract_address");
    if (typeof addr === "string" && /^0x[0-9a-fA-F]{40}$/.test(addr) && addr.toLowerCase() !== ctx.subject.token.toLowerCase()) {
      return unknown(b, "answer_for_other_token");
    }
    const hasHoneypot = flag(body, "is_honeypot") !== undefined;
    const hasTax = ["buy_tax", "sell_tax"].some((t) => typeof pickNumber(body, t, 0, 1) === "number");
    if (!hasHoneypot || !hasTax) return unknown(b, "insufficient_flags");
    const f = contractAuditV1.adapt({ result: body }, ctx);
    return { ...f, adapterVersion: "0.2.0" };
  },
};

/** The owner-privilege flags that, with is_honeypot, stand in for a missing tax simulation. */
const PRIVILEGE_FLAGS = [
  "is_open_source", "is_mintable", "hidden_owner", "can_take_back_ownership", "owner_change_balance",
  "selfdestruct", "transfer_pausable", "is_proxy", "is_blacklisted", "slippage_modifiable",
] as const;

/**
 * 0.3.0: GoPlus reports buy and sell taxes only when it has simulated a trade
 * (for WETH on Base on 2026-11-06 it sent is_honeypot and the owner flags, and
 * no tax). Without a tax, the answer must still carry is_honeypot and at least
 * six owner-privilege flags; it is then graded on them at lower confidence,
 * noted tax_not_reported. One benign flag on its own is still not an audit.
 */
export const contractAudit: Adapter = {
  check: "contract_audit",
  version: "0.3.0",
  intent: "SMART_CONTRACT_AUDIT_GENERAL",
  defaultConfidence: 0.7,
  adapt(raw, ctx) {
    const b = { check: "contract_audit" as const, version: "0.3.0", ctx };
    const early = guard(b, raw);
    if (early) return early;
    if (!ctx.subject) return unknown(b, "no_subject");
    const body = entryForToken(raw, ctx.subject.token);
    if (body === "other_token") return unknown(b, "answer_for_other_token");
    const addr = pick(body, "token_address") ?? pick(body, "contract_address");
    if (typeof addr === "string" && /^0x[0-9a-fA-F]{40}$/.test(addr) && addr.toLowerCase() !== ctx.subject.token.toLowerCase()) {
      return unknown(b, "answer_for_other_token");
    }
    if (flag(body, "is_honeypot") === undefined) return unknown(b, "insufficient_flags");
    const hasTax = ["buy_tax", "sell_tax"].some((t) => typeof pickNumber(body, t, 0, 1) === "number");
    const privileges = PRIVILEGE_FLAGS.filter((k) => flag(body, k) !== undefined).length;
    if (!hasTax && privileges < 6) return unknown(b, "insufficient_flags");
    const f = contractAuditV1.adapt({ result: body }, ctx);
    if (hasTax) return { ...f, adapterVersion: "0.3.0" };
    return {
      ...f,
      adapterVersion: "0.3.0",
      confidence: Math.min(f.confidence, 0.6),
      notes: [...f.notes, "tax_not_reported"].sort(),
    };
  },
};

/** Superseded versions stay registered so verdicts stored with them still replay. */
const SUPERSEDED: readonly Adapter[] = [
  contractAuditV2,
  washTradingV1,
  contractAuditV1,
  sanctionsV2,
  liquidityDepthV2,
  sanctionsAdapter("0.1.0", ["matched"]),
  metricAdapter("liquidity_depth", "LIQUIDITY_DEPTH_VERIFY_GENERAL", ["liquidity_usd"], 0, 1e12, "USD", "0.1.0"),
];

/** Current adapters, one per check. Never edit a published version: add a new one. */
export const ADAPTERS: readonly Adapter[] = [
  contractAudit,
  holderConcentration,
  holderCount,
  sanctions,
  washTrading,
  liquidityDepth,
  socialBots,
  codeReview,
];

export const ALL_ADAPTER_VERSIONS: readonly Adapter[] = [...ADAPTERS, ...SUPERSEDED];

/** The current adapter for a check, or a specific (possibly superseded) version. */
export function adapterFor(check: Check, version?: string): Adapter {
  const pool = version === undefined ? ADAPTERS : ALL_ADAPTER_VERSIONS;
  const a = pool.find((x) => x.check === check && (version === undefined || x.version === version));
  if (!a) throw new Error(`no adapter for ${check}${version ? `@${version}` : ""}`);
  return a;
}

/** A Finding for a check that was never bought. */
export function unavailable(check: Check, sourceGroup = "none"): Finding {
  return { check, status: "UNAVAILABLE", severity: 0, confidence: 0, sourceGroup, notes: ["not_purchased"] };
}
