import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { claimRun, finishRun, getRun, loadStoredVerdict, newVerdictId, schema, type RunRow } from "@skein/db";
import { canonicalJson, InvalidSubjectError, parseSubject, plan, reproduce, SUPPORTED_CHAINS, type Subject } from "@skein/engine";
import { availability, knownLists, quotes, sdnSnapshotStatus, type VerdictContext } from "@skein/pipeline";
import { getPolicy, listPolicies, type PolicyRecord } from "@skein/policies";
import { CHECK_INTENTS, SEASON_START, SERVED_INTENTS } from "@skein/telegraph";
import { and, asc, count, desc, eq, gt, gte, isNull, ne, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { streamSSE } from "hono/streaming";
import { getAddress } from "viem";
import { z } from "zod";
import { ApiError, errorResponse } from "./errors";
import { acquireFlight, releaseFlight, SharedRateLimiter, type Limiter } from "./limits";
import { OPENAPI } from "./openapi";
import { refuseUnsafeUrl } from "./safeurl";
import { contextHash, FAILED_MESSAGE, flightKey, normaliseContext, type Consumer, type Refusal, type RunOutcome, type VerdictEvent, type VerdictService } from "./service";
import { bomObject, verdictObject } from "./views";
import { sealSecret, WEBHOOK_TOLERANCE_SEC } from "./webhooks";
import { checkPayment, decodePayment, Facilitator, PaymentError, paymentKey, paymentResponse, requirements, type PaymentPayload, type PaymentRequirements } from "./x402";

const UUSDC = 1_000_000;
const usdc = (u: number) => Math.round(u) / UUSDC;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const contextSchema = z
  .object({
    treasuryAddresses: z.array(z.string().regex(/^0x[0-9a-fA-F]{40}$/)).max(5).optional(),
    deployer: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
    repoUrl: z.string().url().max(300).refine((u) => /^https:\/\/(github\.com|gitlab\.com)\//.test(u), "repoUrl must be on github.com or gitlab.com").optional(),
    socialHandle: z.string().regex(/^@?[A-Za-z0-9_]{1,30}$/).optional(),
    // A pool address, or a Uniswap v4 pool id.
    pool: z.string().regex(/^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/).optional(),
  })
  .strict();

const createSchema = z
  .object({
    subject: z.object({ chainId: z.number().int(), token: z.string() }).strict(),
    policy: z.string().max(64).optional(),
    context: contextSchema.optional(),
    budgetUsdcMax: z.number().positive().max(10).optional(),
    mode: z.enum(["sync", "async"]).default("sync"),
  })
  .strict();

function resolvePolicy(ref: string): PolicyRecord {
  try {
    return getPolicy(ref);
  } catch {
    throw new ApiError(400, "UNKNOWN_POLICY", `policy ${ref} not found`);
  }
}

function resolveSubject(s: { chainId: unknown; token: unknown }): Subject {
  try {
    return parseSubject(s);
  } catch (e) {
    if (e instanceof InvalidSubjectError) throw new ApiError(400, "INVALID_SUBJECT", e.message);
    throw e;
  }
}

/** The chain a plan-B subject means when it names none (the YAML says so to the request builder). */
const MINER_DEFAULT_CHAIN = 1;

/**
 * Reads a token and, if present, a chain out of a free-text subject, as
 * FRAUD_RISK_GENERAL sends it: "eip155:8453:0x…" (CAIP-10), "base:0x…",
 * "8453:0x…", "0x… on base", or a bare address. undefined when it holds no address.
 */
export function subjectFromText(text: string): { token: string; chain?: string } | undefined {
  const token = text.match(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/)?.[0];
  if (!token) return undefined;
  const rest = text.replace(token, " ").toLowerCase();
  const caip = rest.match(/eip155:(\d+)/)?.[1];
  if (caip) return { token, chain: caip };
  const named = Object.values(SUPPORTED_CHAINS).find((n) => new RegExp(`\\b${n}\\b`).test(rest)) ?? (/\bbnb\b/.test(rest) ? "bsc" : /\beth\b/.test(rest) ? "ethereum" : undefined);
  if (named) return { token, chain: named };
  const id = rest.match(/(?:^|[^\w])(\d{1,6})\s*:/)?.[1] ?? rest.match(/chain\s*(?:id)?\s*[:=]?\s*(\d{1,6})/)?.[1];
  return id ? { token, chain: id } : { token };
}

/** FRAUD_RISK_GENERAL's risk_level, as the intent proposal maps it: a blocker REJECT is CRITICAL. */
/**
 * The 0-1 risk_score Telegraph buyers read. An ABSTAIN means "not enough
 * evidence", never "no risk": it reports at least 0.5, the middle of MEDIUM,
 * so a buyer that thresholds on the score cannot read a failed check as safe.
 */
export function riskScore(verdict: string, riskBps: number): number {
  const r = riskBps / 10_000;
  return verdict === "ABSTAIN" ? Math.max(0.5, r) : r;
}

export function riskLevel(verdict: string, reasons: readonly { code: string }[]): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  if (verdict === "APPROVE") return "LOW";
  if (verdict === "REJECT") return reasons.some((r) => r.code.startsWith("BLOCKER_")) ? "CRITICAL" : "HIGH";
  return "MEDIUM"; // ESCALATE, and ABSTAIN: not enough evidence is not "low risk"
}

/** A refusal before any spend, as the HTTP error the spec names for it. */
export function refusalError(r: Refusal): ApiError {
  switch (r.code) {
    case "BUDGET_TOO_LOW":
      return new ApiError(422, "BUDGET_TOO_LOW", r.detail, { quoteUsdc: usdc(r.quoteUusdc ?? 0), checks: r.checks });
    case "PURCHASE_CEILING":
      return new ApiError(422, "PURCHASE_CEILING", r.detail, { checks: r.checks });
    case "INVALID_INPUT":
      return new ApiError(400, "INVALID_INPUT", r.detail);
    case "UPSTREAM_UNAVAILABLE":
      return new ApiError(503, "UPSTREAM_UNAVAILABLE", r.detail, { checks: r.checks });
    case "MARGIN_GUARD":
      // Spec §8: ABSTAIN with MARGIN_GUARD rather than sell at a loss. Nothing was bought, so there is
      // no sealed verdict to return; the refusal says it is that ABSTAIN (details.verdict).
      return new ApiError(503, "MARGIN_GUARD", r.detail, { quoteUsdc: usdc(r.quoteUusdc ?? 0), verdict: "ABSTAIN", reasons: [{ code: "MARGIN_GUARD", detail: r.detail }] });
    case "SELF_ROUTING":
      return new ApiError(503, "SELF_ROUTING", r.detail, { checks: r.checks });
  }
}

/**
 * Outcomes that may clear on their own. A run that ended in one does not hold
 * its idempotency key: a retry with the same key runs again (still charged at
 * most once: partner keys are free, and an x402 payment is settled once).
 */
const TRANSIENT_REFUSALS = new Set(["DAILY_CAP_REACHED", "RATE_LIMITED", "UPSTREAM_UNAVAILABLE", "MARGIN_GUARD", "WALLET_EMPTY"]);
export function isTransient(run: Pick<RunRow, "status" | "outcome">): boolean {
  if (run.status === "failed" || run.status === "lost") return true;
  return run.status === "refused" && TRANSIENT_REFUSALS.has(String((run.outcome as { code?: unknown } | null)?.code ?? ""));
}
/** A Telegraph caller's own request id on /miner/verdict: long enough to be unguessable when random. */
const CALLER_REQUEST_ID = /^[A-Za-z0-9_-]{16,64}$/;
/** Spec §6: a replay within 24 hours returns the original verdict; after that the key is free again. */
export const IDEMPOTENCY_WINDOW_MS = 24 * 3_600_000;

/**
 * A token bucket per key, in memory, bounded: the oldest key is evicted past
 * `maxKeys`. For one process only (RATE_LIMIT_STORE=memory); replicas share
 * SharedRateLimiter (limits.ts) instead.
 */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(
    private readonly perMinute: number,
    private readonly maxKeys = 10_000,
  ) {}
  take(key: string, now = Date.now()): number | null {
    const b = this.buckets.get(key) ?? { tokens: this.perMinute, at: now };
    b.tokens = Math.min(this.perMinute, b.tokens + ((now - b.at) / 60_000) * this.perMinute);
    b.at = now;
    this.buckets.delete(key);
    this.buckets.set(key, b);
    if (this.buckets.size > this.maxKeys) this.buckets.delete(this.buckets.keys().next().value!);
    if (b.tokens < 1) return Math.ceil(((1 - b.tokens) / this.perMinute) * 60);
    b.tokens -= 1;
    return null;
  }
}

const memory = new Map<string, RateLimiter>();
/** The in-memory limiter for one name, kept per process (RATE_LIMIT_STORE=memory). */
function memoryLimiters(name: string, perMinute: number): RateLimiter {
  let l = memory.get(name);
  if (!l) memory.set(name, (l = new RateLimiter(perMinute)));
  return l;
}

function sameSecret(a: string, b: string): boolean {
  return timingSafeEqual(Buffer.from(sha256(a)), Buffer.from(sha256(b)));
}

/**
 * The caller's address as the trusted proxy saw it: each trusted hop appends
 * one entry to X-Forwarded-For, so the entry `hops` from the right is the
 * one the client could not forge. Anything left of it is client-supplied.
 * Railway's edge is one hop (TRUST_PROXY_HOPS=1, the default): it appends the
 * address it accepted the connection from, so a client that sends its own
 * X-Forwarded-For only adds entries to the left of that one.
 */
export function clientIp(c: Context, hops: number): string {
  const xff = (c.req.header("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (hops > 0 && xff.length >= hops) return xff[xff.length - hops]!;
  return xff.at(-1) ?? "direct";
}

const secondsToUtcMidnight = (now: Date) => Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) / 1000);
const utcMidnight = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/** A short-lived memo for expensive public reads. */
function memo<T>(ms: number, f: () => Promise<T>): () => Promise<T> {
  let at = 0;
  let value: Promise<T> | null = null;
  return () => {
    if (!value || Date.now() - at > ms) {
      at = Date.now();
      value = f().catch((e) => {
        value = null;
        throw e;
      });
    }
    return value;
  };
}

/** Runs `f` over `items`, at most `limit` at a time, keeping order. */
async function mapBounded<T, R>(items: readonly T[], limit: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await f(items[i]!);
      }
    }),
  );
  return out;
}

const rowsOf = <T>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[]));

/** What a request finally came to: a verdict to serve, or the error to answer with. */
type Final =
  | { kind: "verdict"; verdictId: string; /** this run bought it (its upstream spend is this request's) */ own: boolean; cached: boolean }
  | { kind: "refused"; code: string; error: ApiError }
  | { kind: "failed"; error: ApiError };
type Produced = Final | { kind: "running"; id: string; timedOut: boolean; final: Promise<Final> };

/**
 * "Not a contract" (spec §6, INVALID_SUBJECT): one eth_getCode per subject on
 * the subject's chain, where SUBJECT_RPC_URLS names an endpoint. A contract
 * stays one; an empty address is re-checked after 10 minutes (it may be
 * deployed yet). An RPC failure skips the check rather than refusing.
 */
function contractCheck(urls: Record<number, string>, override?: (chainId: number, address: string) => Promise<string | null>) {
  const known = new Map<string, { contract: boolean; at: number }>();
  const getCode =
    override ??
    (async (chainId: number, address: string): Promise<string | null> => {
      const url = urls[chainId];
      if (!url) return null;
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [address, "latest"] }),
        signal: AbortSignal.timeout(3_000),
      });
      const body = (await res.json()) as { result?: unknown };
      return typeof body.result === "string" ? body.result : null;
    });
  return async (s: Subject): Promise<void> => {
    const k = `${s.chainId}:${s.token.toLowerCase()}`;
    const hit = known.get(k);
    if (hit && (hit.contract || Date.now() - hit.at < 600_000)) {
      if (!hit.contract) throw new ApiError(400, "INVALID_SUBJECT", `${s.token} is not a contract on chain ${s.chainId}`);
      return;
    }
    const code = await getCode(s.chainId, s.token).catch(() => null);
    if (code === null) return;
    const contract = /^0x[0-9a-fA-F]{2,}$/.test(code);
    if (known.size >= 10_000) known.delete(known.keys().next().value!);
    known.set(k, { contract, at: Date.now() });
    if (!contract) throw new ApiError(400, "INVALID_SUBJECT", `${s.token} is not a contract on chain ${s.chainId}`);
  };
}

/** The inbound loop marker (spec §9): a header or a body field, as a number; 0 when absent. */
export function skeinDepth(header: string | undefined, ...bodies: unknown[]): number {
  const vals: unknown[] = [header];
  for (const b of bodies) {
    if (!b || typeof b !== "object") continue;
    const o = b as Record<string, unknown>;
    vals.push(o["skein-depth"], o.skein_depth, o.skeinDepth);
    const ctx = o.context;
    if (ctx && typeof ctx === "object") vals.push((ctx as Record<string, unknown>)["skein-depth"], (ctx as Record<string, unknown>).skein_depth);
  }
  return Math.max(0, ...vals.map((v) => (typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v.trim())) ? Number(v) : 0)));
}

export function createApp(service: VerdictService) {
  const { config } = service.deps;
  const db = service.db;
  const now = service.deps.now ?? (() => new Date());
  // Shared by every replica (Postgres) unless RATE_LIMIT_STORE=memory. Reads fail open when the store is
  // down (the request meets the same database anyway); paid POSTs fail closed (failClosed).
  const limiter = (name: string, perMinute: number, failClosed = false): Limiter =>
    config.rateLimitStore === "memory"
      ? { take: async (key: string) => memoryLimiters(name, perMinute).take(key) }
      : new SharedRateLimiter(db, name, perMinute, { failClosed });
  const limits = {
    read: limiter("read", 240),
    publicRead: limiter("publicRead", 120),
    quote: limiter("quote", 30),
    verify: limiter("verify", 10),
    stream: limiter("stream", 30),
    badKey: limiter("badKey", 20),
    key: limiter("key", 30, true),
    payer: limiter("payer", config.x402?.payerPerMinute ?? 10, true),
    webhook: limiter("webhook", 5),
    kv: limiter("kv", 1200),
  };
  /** /miner/verdict: one run per token and policy at a time, however many dispatcher calls arrive. */
  const minerFlights = new Map<string, Promise<RunOutcome>>();
  /** The run id behind each in-process flight, so a caller that shares one still gets its pending_id. */
  const minerFlightIds = new Map<string, string>();
  const isContract = contractCheck(config.subjectRpcUrls, service.deps.getCode);
  const app = new Hono();

  // Every request gets an id (X-Request-Id, echoed if the caller sent a sane one),
  // one structured log line, and the id in any error body, so a report can be traced.
  app.use("*", requestId({ limitLength: 64 }));
  app.use("*", async (c, next) => {
    const t0 = Date.now();
    await next();
    if (c.req.path === "/healthz" || c.req.path === "/readyz") return;
    console.log(JSON.stringify({ level: "info", msg: "request", requestId: c.get("requestId"), method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - t0 }));
  });
  app.use("*", secureHeaders({ crossOriginResourcePolicy: "cross-origin" }));
  app.use(
    "*",
    cors({
      origin: (origin) => (config.webOrigins.includes(origin) ? origin : null),
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["authorization", "content-type", "idempotency-key", "last-event-id", "if-match", "if-none-match", "x-payment"],
      exposeHeaders: ["X-Skein-Verdict-Hash", "X-Skein-Bom-Root", "X-Skein-Cache", "Retry-After", "X-PAYMENT-RESPONSE", "X-Skein-Payment", "X-Skein-Attestation"],
      maxAge: 600,
    }),
  );
  app.use(
    "*",
    bodyLimit({ maxSize: 64 * 1024, onError: () => { throw new ApiError(413, "PAYLOAD_TOO_LARGE", "request body over 64 KB"); } }),
  );

  app.onError((err, c) => {
    if (err instanceof ApiError) return errorResponse(c, err);
    // Internals go to the log, never to the caller; the request id links the two.
    const id = c.get("requestId");
    console.error(JSON.stringify({ level: "error", msg: "unhandled", requestId: id, method: c.req.method, path: c.req.path, error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err) }));
    void service.logError(err, `${c.req.method} ${c.req.path}`, id);
    void service.deps.alerts?.raise("unhandled-error", `unhandled error on ${c.req.method} ${c.req.path} (request ${id}): ${err instanceof Error ? err.message : String(err)}`.slice(0, 500));
    return c.json({ error: { code: "INTERNAL", message: "internal error", requestId: id } }, 500);
  });
  app.notFound((c) => c.json({ error: { code: "NOT_FOUND", message: `no route ${c.req.method} ${c.req.path}`, requestId: c.get("requestId") } }, 404));

  const limit = async (c: Context, l: Limiter, key: string) => {
    const wait = await l.take(key);
    if (wait !== null) throw new ApiError(429, "RATE_LIMITED", "too many requests", undefined, { "Retry-After": String(wait) });
  };
  const ip = (c: Context) => clientIp(c, config.trustProxyHops);

  async function consumerFor(c: Context) {
    const auth = c.req.header("authorization") ?? "";
    const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!key) {
      throw new ApiError(
        402,
        "PAYMENT_REQUIRED",
        config.x402
          ? "send a partner API key (Authorization: Bearer ...); POST /v1/verdicts also takes x402 payment, and Telegraph buys through the network"
          : "send a partner API key (Authorization: Bearer ...), or buy through Telegraph; x402 payment on the direct API is not enabled",
      );
    }
    const hash = sha256(key);
    const [consumer] = await db.select().from(schema.consumers).where(eq(schema.consumers.apiKeyHash, hash));
    if (!consumer || consumer.revokedAt || config.revokedKeyHashes.includes(hash)) {
      await limit(c, limits.badKey, `ip:${ip(c)}`);
      throw new ApiError(401, "UNAUTHORIZED", "unknown or revoked API key");
    }
    return consumer;
  }

  const attester = service.attester;

  /** The purchaser's escrow is too low to pay for a purchase: uncached verdicts pause until it is refilled. */
  const walletEmpty = () => {
    const e = walletState.get().escrowUusdc;
    return e !== null && e < config.walletPauseUusdc;
  };
  const walletEmptyError = () =>
    new ApiError(503, "WALLET_EMPTY", "verdicts are paused: the purchaser's escrow is empty and is being refilled; cached verdicts are still served", undefined, { "Retry-After": "600" });

  /** The refusals that need no purchase to decide: an empty wallet, the global stop, the caller's daily cap. */
  const precheck = async (consumer: Consumer): Promise<ApiError | null> => {
    if (walletEmpty()) return walletEmptyError();
    if ((await service.spentTodayUusdc()) + config.perVerdictCapUusdc > config.stopAtUusdc) {
      return new ApiError(503, "DAILY_CAP_REACHED", "the purchaser's daily spend cap is reached; try again tomorrow (UTC)", undefined, { "Retry-After": String(secondsToUtcMidnight(now())) });
    }
    if ((await service.spentTodayUusdc({ consumerId: consumer.id })) >= consumer.dailyCapUusdc) {
      return new ApiError(429, "RATE_LIMITED", "this key's daily cap is reached", undefined, { "Retry-After": String(secondsToUtcMidnight(now())) });
    }
    return null;
  };

  /** The plan /v1/quote shows, as a refusal: what a run would refuse before buying anything. */
  const planRefusal = (record: PolicyRecord, budgetUsdcMax?: number): ApiError | null => {
    const p = plan({
      policy: record.policy,
      checkIntents: CHECK_INTENTS,
      // What a verdict would buy from: allowlisted miners, Skein's own excluded (as runVerdict plans it).
      availability: availability(service.catalogue, { pinned: true, excludeMinerIds: config.selfRegistrationIds }),
      quotesUusdc: quotes(service.catalogue, CHECK_INTENTS, true, config.selfRegistrationIds),
      servedIntents: SERVED_INTENTS,
      priceUusdc: config.priceUusdc,
      callerBudgetUusdc: Math.min(budgetUsdcMax ? Math.round(budgetUsdcMax * UUSDC) : Infinity, config.perVerdictCapUusdc),
    });
    return p.ok ? null : refusalError(p.refusal as Refusal);
  };

  // x402: pay per verdict without a partner key (x402.ts). Every x402 payer
  // shares one consumer row, whose daily cap bounds what they can make Skein spend.
  const x402 = config.x402;
  const facilitator = x402 ? new Facilitator(x402.facilitatorUrl, service.deps.facilitatorFetch) : null;
  const X402_CONSUMER = "00000000-0000-4000-8000-000000000402";
  let x402Ready: Promise<void> | null = null;
  const x402Consumer = async (): Promise<Consumer> => {
    const cap = x402?.dailyCapUusdc ?? 0;
    x402Ready ??= db
      .insert(schema.consumers)
      .values({ id: X402_CONSUMER, name: "x402 payers", kind: "agent", plan: "x402", dailyCapUusdc: cap })
      .onConflictDoUpdate({ target: schema.consumers.id, set: { dailyCapUusdc: cap } })
      .then(() => undefined)
      .catch((e: unknown) => {
        x402Ready = null;
        throw e;
      });
    await x402Ready;
    return { id: X402_CONSUMER, dailyCapUusdc: cap };
  };
  /** The x402 terms, in the standard 402 body, with Skein's error object alongside. */
  const needPayment = (c: Context, terms: PaymentRequirements, message: string) =>
    c.json({ x402Version: 1, accepts: [terms], error: { code: "PAYMENT_REQUIRED", message, requestId: c.get("requestId") } }, 402);

  const sendVerdict = async (c: Context, id: string, extra: Record<string, unknown> = {}) => {
    const v = await verdictObject(db, id);
    if (!v) throw new ApiError(404, "NOT_FOUND", `verdict ${id} not found`);
    c.header("X-Skein-Verdict-Hash", v.verdictHash);
    c.header("X-Skein-Bom-Root", v.bom.root);
    const attestation = await attester.forVerdict(v);
    if (attestation) c.header("X-Skein-Attestation", attestation.signature);
    return c.json({ ...v, ...(attestation ? { attestation } : {}), ...extra });
  };

  /** The error a finished run answers with, from its stored outcome. */
  const runError = (run: RunRow): ApiError => {
    const o = (run.outcome ?? {}) as { code?: string; detail?: string; message?: string; checks?: string[]; quoteUusdc?: number };
    if (run.status === "refused" && o.code) {
      if (o.code === "DAILY_CAP_REACHED") return new ApiError(503, "DAILY_CAP_REACHED", o.detail ?? "daily spend cap reached");
      if (o.code === "RATE_LIMITED") return new ApiError(429, "RATE_LIMITED", o.detail ?? "this key's daily cap is reached");
      if (o.code === "WALLET_EMPTY") return walletEmptyError();
      return refusalError(o as Refusal);
    }
    return new ApiError(503, run.status === "lost" ? "LOST" : "VERDICT_FAILED", o.message ?? FAILED_MESSAGE, { id: run.id, status: run.status });
  };
  const finalOfRun = (run: RunRow): Final | null => {
    if (run.status === "running") return null;
    if (run.status === "done" && run.verdictId) return { kind: "verdict", verdictId: run.verdictId, own: run.verdictId === run.id, cached: run.verdictId !== run.id };
    if (run.status === "refused") return { kind: "refused", code: String((run.outcome as { code?: unknown } | null)?.code ?? "REFUSED"), error: runError(run) };
    return { kind: "failed", error: runError(run) };
  };

  /** What a run that is not a fresh verdict tells its caller. */
  const fromRun = async (c: Context, run: RunRow, extra: Record<string, unknown> = {}) => {
    if (run.status === "running") return c.json({ id: run.id, status: "running", events: `/v1/verdicts/${run.id}/events` }, 202);
    if (run.status === "done" && run.verdictId) return sendVerdict(c, run.verdictId, { ...(run.verdictId !== run.id ? { servedFrom: run.verdictId, cached: true } : {}), ...extra });
    throw runError(run);
  };

  const fromOutcome = (id: string, o: RunOutcome): Final =>
    o.kind === "done" ? { kind: "verdict", verdictId: o.id, own: true, cached: false }
    : o.kind === "refused" ? { kind: "refused", code: o.refusal.code, error: refusalError(o.refusal) }
    : { kind: "failed", error: new ApiError(503, "VERDICT_FAILED", o.message, { id }) };

  /**
   * Waits for another run buying the same verdict (the flights lease) and
   * finishes this run with its result, so N identical concurrent requests
   * buy one verdict (M10).
   */
  const follow = async (id: string, holder: string): Promise<Final> => {
    const until = Date.now() + config.verdictDeadlineMs + 30_000;
    for (;;) {
      const run = await getRun(db, holder).catch(() => null);
      if (run && run.status !== "running") {
        if (run.status === "done" && run.verdictId) {
          await finishRun(db, id, { status: "done", verdictId: run.verdictId, at: now() });
          return { kind: "verdict", verdictId: run.verdictId, own: false, cached: true };
        }
        await finishRun(db, id, { status: run.status === "refused" ? "refused" : "failed", outcome: run.outcome ?? { code: "VERDICT_FAILED", message: FAILED_MESSAGE }, at: now() });
        return finalOfRun({ ...run, id, status: run.status === "refused" ? "refused" : "failed" })!;
      }
      if (!run || Date.now() > until) {
        await finishRun(db, id, { status: "failed", outcome: { code: "VERDICT_FAILED", message: FAILED_MESSAGE }, at: now() });
        return { kind: "failed", error: new ApiError(503, "VERDICT_FAILED", FAILED_MESSAGE, { id }) };
      }
      await new Promise((r) => setTimeout(r, 400).unref());
    }
  };

  interface Ask {
    id: string;
    consumer: Consumer;
    requestHash: string;
    idemKey: string;
    subject: Subject;
    record: PolicyRecord;
    context: VerdictContext;
    ctxHash: string;
    budgetUsdcMax?: number;
    mode: "sync" | "async";
  }

  /**
   * Produces the verdict for a claimed run: from cache, from a concurrent run
   * of the same request, or bought. Sync callers wait up to SYNC_TIMEOUT_MS;
   * past that (or in async mode) the answer is 202 with the id (spec §6).
   */
  const produce = async (a: Ask): Promise<Produced> => {
    const cached = await service.findCached(a.subject, a.record.policy, a.ctxHash);
    if (cached) {
      await finishRun(db, a.id, { status: "done", verdictId: cached.id, at: now() });
      return { kind: "verdict", verdictId: cached.id, own: false, cached: true };
    }
    const pre = await precheck(a.consumer);
    if (pre) {
      await finishRun(db, a.id, { status: "refused", outcome: { code: pre.code, detail: pre.message }, at: now() });
      return { kind: "refused", code: pre.code, error: pre };
    }
    const key = flightKey(a.subject, a.record.ref, a.ctxHash);
    const holder = await acquireFlight(db, key, a.id, config.verdictDeadlineMs + 60_000);
    const final: Promise<Final> = holder
      ? follow(a.id, holder)
      : service
          .start({
            id: a.id, policy: a.record.policy, policySha256: a.record.sha256, subject: a.subject, context: a.context, contextHash: a.ctxHash,
            channel: "api", claimed: true, consumer: a.consumer, idempotencyKey: a.idemKey, requestHash: a.requestHash,
            ...(a.budgetUsdcMax ? { budgetUusdc: Math.round(a.budgetUsdcMax * UUSDC) } : {}),
          })
          .then((o) => fromOutcome(a.id, o))
          .finally(() => void releaseFlight(db, key, a.id).catch(() => {}));
    if (a.mode === "async") return { kind: "running", id: a.id, timedOut: false, final };
    const out = await Promise.race([final, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), config.syncTimeoutMs).unref())]);
    return out === "timeout" ? { kind: "running", id: a.id, timedOut: true, final } : out;
  };

  /** The HTTP answer for a produced outcome. */
  const respond = async (c: Context, out: Produced, extra: Record<string, unknown> = {}) => {
    switch (out.kind) {
      case "verdict":
        if (out.cached) c.header("X-Skein-Cache", "hit");
        return sendVerdict(c, out.verdictId, { ...(out.cached ? { cached: true, servedFrom: out.verdictId } : {}), ...extra });
      case "running":
        // A sync request that ran out of time gets the id to poll (spec §6), not an error: the verdict is still being bought.
        return c.json({ id: out.id, status: "running", events: `/v1/verdicts/${out.id}/events`, ...(out.timedOut ? { timedOut: true, message: "sync mode ran out of time; poll the id or follow its events" } : {}), ...extra }, 202);
      default:
        throw out.error;
    }
  };

  // ---- x402 payments (x402.ts: settle first, then buy) ----

  type PaymentRow = typeof schema.x402Payments.$inferSelect;
  const getPayment = async (key: string): Promise<PaymentRow | null> => (await db.select().from(schema.x402Payments).where(eq(schema.x402Payments.key, key)))[0] ?? null;

  /**
   * Records what a settled payment is owed back, from the outcome of the run
   * it paid for. Idempotent: it states the current amount, so a retry that
   * succeeds after a failure cancels the refund. Never after it was sent.
   */
  const account = async (pay: PaymentRow, final: Final | null) => {
    if (!final) return;
    let refund = 0;
    let reason: string | null = null;
    if (final.kind === "verdict") {
      const [v] = await db.select({ verdict: schema.verdicts.verdict, upstream: schema.verdicts.upstreamUusdc }).from(schema.verdicts).where(eq(schema.verdicts.id, final.verdictId));
      if (v?.verdict === "ABSTAIN") {
        const spent = final.own ? Math.min(pay.amountUusdc, v.upstream) : 0;
        refund = pay.amountUusdc - spent;
        reason = `ABSTAIN is charged at the upstream cost only (${usdc(spent)} USDC)`;
      }
    } else {
      refund = pay.amountUusdc;
      reason = `${final.kind === "refused" ? final.code : final.error.code}: ${final.error.message}`.slice(0, 300);
    }
    await db
      .update(schema.x402Payments)
      .set({ refundUusdc: refund, refundReason: reason, updatedAt: now() })
      .where(and(eq(schema.x402Payments.key, pay.key), isNull(schema.x402Payments.refundedAt)));
    return refund;
  };

  const paymentHeaders = (c: Context, pay: PaymentRow, refund: number | undefined) => {
    if (pay.txHash) c.header("X-PAYMENT-RESPONSE", paymentResponse({ transaction: pay.txHash, network: pay.network, payer: getAddress(pay.payer) }));
    c.header("X-Skein-Payment", refund ? `settled; refund owed ${usdc(refund)} USDC` : "settled");
  };

  /** Serves the run a settled payment pays for: replays it, or (first time, or after a transient failure) runs it. */
  const servePaid = async (c: Context, pay: PaymentRow, a: Omit<Ask, "id" | "idemKey">) => {
    const id = newVerdictId(now().getTime());
    const claim = await claimRun(
      db,
      {
        id, consumerId: a.consumer.id, idempotencyKey: pay.key, requestHash: a.requestHash, channel: "api",
        subjectChainId: a.subject.chainId, subjectToken: a.subject.token, policyId: a.record.policy.id, policyVersion: a.record.policy.version, contextHash: a.ctxHash,
      },
      // A refunded payment is spent: it replays what it got, never runs again.
      { reclaimable: (r) => r.requestHash === a.requestHash && !pay.refundedAt && isTransient(r) },
    );
    if (!claim.claimed) {
      const refund = await account(pay, finalOfRun(claim.existing));
      paymentHeaders(c, pay, refund ?? pay.refundUusdc);
      return fromRun(c, claim.existing, { replayed: true });
    }
    await db.update(schema.x402Payments).set({ runId: id, updatedAt: now() }).where(eq(schema.x402Payments.key, pay.key));
    const out = await produce({ ...a, id, idemKey: pay.key, mode: a.mode });
    let refund: number | undefined;
    if (out.kind === "running") {
      void out.final.then((f) => account(pay, f)).catch((e: Error) => console.error(JSON.stringify({ level: "error", msg: "x402 refund not recorded", key: pay.key, error: e.message })));
    } else refund = await account(pay, out);
    paymentHeaders(c, pay, refund);
    if (out.kind === "refused" || out.kind === "failed") {
      const e = out.error;
      throw new ApiError(e.status, e.code, e.message, { ...((e.details as object | undefined) ?? {}), payment: { settled: true, transaction: pay.txHash, refundOwedUsdc: usdc(pay.amountUusdc), note: "the payment was settled before this refusal; it is owed back in full, or retry with the same X-PAYMENT within 24 hours" } }, e.headers);
    }
    return respond(c, out);
  };

  /** Waits for a payment another request is settling. A settlement stuck past 2 minutes is marked failed (the settler stopped). */
  const awaitSettling = async (pay: PaymentRow): Promise<PaymentRow> => {
    const until = Date.now() + 35_000;
    let row: PaymentRow | null = pay;
    while (row?.status === "settling" && Date.now() < until) {
      if (now().getTime() - row.updatedAt.getTime() > 120_000) {
        await db
          .update(schema.x402Payments)
          .set({ status: "failed", error: "settlement outcome unknown: the request settling it stopped; if the transfer went through on-chain, the operator reconciles it", updatedAt: now() })
          .where(and(eq(schema.x402Payments.key, row.key), eq(schema.x402Payments.status, "settling"), eq(schema.x402Payments.updatedAt, row.updatedAt)));
        return (await getPayment(pay.key))!;
      }
      await new Promise((r) => setTimeout(r, 300).unref());
      row = await getPayment(pay.key);
    }
    if (!row || row.status === "settling") throw new ApiError(503, "PAYMENT_PENDING", "this payment is being settled by another request; retry with the same X-PAYMENT shortly", undefined, { "Retry-After": "5" });
    return row;
  };

  const x402Verdict = async (c: Context, terms: PaymentRequirements, a: Omit<Ask, "id" | "idemKey">): Promise<Response> => {
    const header = c.req.header("x-payment");
    if (!header) return needPayment(c, terms, "pay for this verdict with x402 (X-PAYMENT), or send a partner API key");
    let payment: PaymentPayload;
    try {
      payment = decodePayment(header, terms);
    } catch (e) {
      if (e instanceof PaymentError) return needPayment(c, terms, e.message);
      throw e;
    }
    const key = paymentKey(payment);
    const payer = payment.payload.authorization.from.toLowerCase();
    // A payment already on record is replayed: never verified or settled again (a settled
    // authorization's nonce is spent, so the facilitator would refuse it).
    let prior = await getPayment(key);
    if (prior && prior.requestHash !== a.requestHash) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "this payment already paid for a different request");
    if (prior?.status === "settling") prior = await awaitSettling(prior);
    if (prior?.status === "settled") return servePaid(c, prior, a);

    // A new payment (or one whose settlement failed): check it, then refuse what can be refused before taking money.
    try {
      await checkPayment(payment, terms, Math.floor(now().getTime() / 1000));
    } catch (e) {
      if (e instanceof PaymentError) return needPayment(c, terms, e.message);
      throw e;
    }
    await limit(c, limits.payer, payer);
    if (!prior) {
      const [today] = await db
        .select({ n: count() })
        .from(schema.x402Payments)
        .where(and(eq(schema.x402Payments.payer, payer), gte(schema.x402Payments.createdAt, utcMidnight(now())), ne(schema.x402Payments.status, "failed")));
      const payerMax = x402!.payerDailyMax ?? 20;
      if ((today?.n ?? 0) >= payerMax) {
        throw new ApiError(429, "RATE_LIMITED", `this payer has bought ${payerMax} verdicts today, the most one address may (UTC day)`, undefined, { "Retry-After": String(secondsToUtcMidnight(now())) });
      }
    }
    const v = await facilitator!.verify(payment, terms);
    if (!v.isValid) return needPayment(c, terms, `the facilitator refused the payment: ${v.invalidReason ?? "invalid"}`);
    if (!(await service.findCached(a.subject, a.record.policy, a.ctxHash))) {
      const refusal = (await precheck(a.consumer)) ?? planRefusal(a.record, a.budgetUsdcMax);
      if (refusal) throw new ApiError(refusal.status, refusal.code, `${refusal.message} (nothing was charged)`, refusal.details, refusal.headers);
    }

    // Claim the settlement: of concurrent requests with the same payment, exactly one settles it.
    const values = { key, payer, nonce: payment.payload.authorization.nonce.toLowerCase(), amountUusdc: Number(payment.payload.authorization.value), network: terms.network, requestHash: a.requestHash, status: "settling" as const, updatedAt: now() };
    const claimed = prior
      ? await db.update(schema.x402Payments).set({ status: "settling", error: null, updatedAt: now() }).where(and(eq(schema.x402Payments.key, key), eq(schema.x402Payments.status, "failed"))).returning()
      : await db.insert(schema.x402Payments).values(values).onConflictDoNothing({ target: schema.x402Payments.key }).returning();
    if (claimed.length === 0) {
      const row = await awaitSettling((await getPayment(key))!);
      if (row.status === "settled") return servePaid(c, row, a);
      return needPayment(c, terms, `the payment could not be settled (${row.error ?? "unknown"}); nothing was bought`);
    }
    const r = await facilitator!.settle(payment, terms);
    if (!r.success || !r.transaction) {
      const reason = r.errorReason ?? "unknown";
      console.error(JSON.stringify({ level: "error", msg: "x402 settlement failed", key, reason }));
      await db.update(schema.x402Payments).set({ status: "failed", error: reason.slice(0, 300), updatedAt: now() }).where(eq(schema.x402Payments.key, key));
      return needPayment(c, terms, `the payment could not be settled (${reason}); nothing was bought: retry with the same X-PAYMENT, or a new one`);
    }
    const [settled] = await db
      .update(schema.x402Payments)
      .set({ status: "settled", txHash: r.transaction, settledAt: now(), updatedAt: now() })
      .where(eq(schema.x402Payments.key, key))
      .returning();
    await db.insert(schema.spendLedger).values({ kind: "revenue_settled", amountUusdc: settled!.amountUusdc, ref: `${key}:${r.transaction}` });
    return servePaid(c, settled!, a);
  };

  app.get("/healthz", (c) => c.json({ ok: true }));
  app.get("/v1/openapi.json", (c) => {
    c.header("cache-control", "public, max-age=300");
    return c.json(OPENAPI);
  });
  app.get("/readyz", async (c) => {
    if (!service.accepting) return c.json({ ok: false, draining: true }, 503);
    // A database outage is a 503 for the load balancer, not an unhandled error (no alert storm: the probe alerts on it).
    try {
      await db.execute(sql`select 1`);
    } catch (e) {
      console.error(JSON.stringify({ level: "error", msg: "readyz: database unreachable", error: (e as Error).message }));
      return c.json({ ok: false, database: false }, 503);
    }
    return c.json({ ok: true, catalogueFetchedAt: service.catalogue.fetchedAt });
  });

  app.post("/v1/verdicts", async (c) => {
    if (!service.accepting) throw new ApiError(503, "UPSTREAM_UNAVAILABLE", "the service is restarting; retry with the same Idempotency-Key");
    // No partner key and x402 on: the caller pays for this verdict (x402.ts).
    const terms = x402 && !c.req.header("authorization") ? requirements(x402) : null;
    let consumer: Consumer;
    let idemKey = "";
    if (terms) {
      await limit(c, limits.key, `x402:${ip(c)}`);
      consumer = await x402Consumer();
    } else {
      consumer = await consumerFor(c);
      await limit(c, limits.key, `key:${consumer.id}`);
      const k = c.req.header("idempotency-key");
      if (!k || k.length > 128 || k.includes("#")) throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required (at most 128 characters, no '#')");
      idemKey = k;
    }
    const raw = await c.req.json().catch(() => null);
    const parsed = createSchema.safeParse(raw);
    if (!parsed.success) {
      const where = parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
      throw new ApiError(400, "INVALID_REQUEST", `invalid body (${where})`, parsed.error.issues);
    }
    const body = parsed.data;
    const subject = resolveSubject(body.subject);
    const record = resolvePolicy(body.policy ?? config.defaultPolicy);
    const context = normaliseContext((body.context ?? {}) as VerdictContext);
    const ctxHash = contextHash(context);
    // The request as understood, not as spelled: case, @-handles and sync/async don't make a different request.
    const requestHash = sha256(canonicalJson({ subject, policy: record.ref, context, budgetUsdcMax: body.budgetUsdcMax ?? null }));
    await isContract(subject);
    const ask = { consumer, requestHash, subject, record, context, ctxHash, mode: body.mode, ...(body.budgetUsdcMax ? { budgetUsdcMax: body.budgetUsdcMax } : {}) };
    if (terms) return x402Verdict(c, terms, ask);

    const id = newVerdictId(now().getTime());
    const claim = await claimRun(
      db,
      {
        id, consumerId: consumer.id, idempotencyKey: idemKey, requestHash, channel: "api",
        subjectChainId: subject.chainId, subjectToken: subject.token, policyId: record.policy.id, policyVersion: record.policy.version, contextHash: ctxHash,
      },
      // The key is free again after a transient failure (same body), or once the 24-hour window has passed (M7).
      {
        reclaimable: (r) =>
          (r.requestHash === requestHash && isTransient(r)) || (r.status !== "running" && now().getTime() - r.startedAt.getTime() > IDEMPOTENCY_WINDOW_MS),
      },
    );
    if (!claim.claimed) {
      // Idempotent replay: the original outcome, never charged again.
      if (claim.existing.requestHash !== requestHash) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "this Idempotency-Key was used with a different body");
      return fromRun(c, claim.existing, { replayed: true });
    }
    return respond(c, await produce({ ...ask, id, idemKey }));
  });

  app.get("/v1/verdicts/:id", async (c) => {
    await limit(c, limits.read, `ip:${ip(c)}`);
    const id = c.req.param("id");
    const [row] = await db.select({ id: schema.verdicts.id }).from(schema.verdicts).where(eq(schema.verdicts.id, id));
    if (row) return sendVerdict(c, id);
    const run = await getRun(db, id);
    if (!run) throw new ApiError(404, "NOT_FOUND", `verdict ${id} not found`);
    return fromRun(c, run);
  });

  app.get("/v1/verdicts/:id/bom", async (c) => {
    await limit(c, limits.read, `ip:${ip(c)}`);
    const bom = await bomObject(db, c.req.param("id"));
    if (!bom) throw new ApiError(404, "NOT_FOUND", "verdict not found");
    return c.json(bom);
  });

  app.get("/v1/verdicts/:id/events", async (c) => {
    await limit(c, limits.stream, `ip:${ip(c)}`);
    const id = c.req.param("id");
    const terminal = new Set(["done", "refused", "error"]);
    const lastId = Number(c.req.header("last-event-id") ?? -1);
    const after = Number.isInteger(lastId) ? lastId : -1;
    const buffer = service.buffers.get(id);
    const past = buffer
      ? []
      : await db.select().from(schema.events).where(eq(schema.events.verdictId, id)).orderBy(asc(schema.events.id));
    if (!buffer && past.length === 0) {
      const run = await getRun(db, id);
      if (!run) throw new ApiError(404, "NOT_FOUND", "unknown verdict id");
    }
    return streamSSE(c, async (stream) => {
      const ping = setInterval(() => void stream.write(": ping\n\n").catch(() => {}), 15_000);
      try {
        if (!buffer) {
          // Not live on this replica: replay from the table, ids as the live
          // stream gave them, and keep following the table while the run is
          // still going on another replica.
          let last = after;
          let ended = false;
          for (const [i, e] of past.entries()) {
            const seq = e.seq ?? i;
            if (terminal.has(e.type)) ended = true;
            if (seq <= last) continue;
            last = seq;
            await stream.writeSSE({ event: e.type, data: JSON.stringify(e.payload), id: String(seq) });
          }
          const followUntil = Date.now() + config.verdictDeadlineMs + 30_000;
          while (!ended && !stream.aborted && Date.now() < followUntil) {
            const run = await getRun(db, id);
            const fresh = await db.select().from(schema.events).where(and(eq(schema.events.verdictId, id), gt(schema.events.seq, last))).orderBy(asc(schema.events.seq));
            for (const e of fresh) {
              last = e.seq ?? last + 1;
              await stream.writeSSE({ event: e.type, data: JSON.stringify(e.payload), id: String(last) });
              if (terminal.has(e.type)) ended = true;
            }
            if (ended || !run || run.status !== "running") break;
            await new Promise((r) => setTimeout(r, 500).unref());
          }
          if (!ended && !stream.aborted) {
            // The run recorded no terminal event of its own: it was served from cache or from a
            // concurrent run, refused before buying, lost, or is still going. Say which, from the run.
            const run = await getRun(db, id);
            if (run?.status === "done" && run.verdictId) {
              await stream.writeSSE({ event: "done", data: JSON.stringify({ id: run.verdictId, ...(run.verdictId !== id ? { servedFrom: run.verdictId, cached: true } : {}) }), id: String(last + 1) });
            } else if (run?.status === "refused") {
              await stream.writeSSE({ event: "refused", data: JSON.stringify(run.outcome ?? {}), id: String(last + 1) });
            } else {
              await stream.writeSSE({ event: "error", data: JSON.stringify({ message: run?.status === "running" ? "still running: reconnect with Last-Event-ID to keep following" : FAILED_MESSAGE, status: run?.status }) });
            }
          }
          return;
        }
        // Live: subscribe first, then replay the buffer, then follow by sequence number.
        const queue: VerdictEvent[] = [];
        let wake: (() => void) | null = null;
        const onEvent = (e: VerdictEvent) => {
          queue.push(e);
          wake?.();
        };
        service.bus.on(id, onEvent);
        stream.onAbort(() => wake?.());
        try {
          let next = after + 1;
          const send = async (e: VerdictEvent) => {
            if (e.seq < next) return terminal.has(e.type);
            next = e.seq + 1;
            await stream.writeSSE({ event: e.type, data: JSON.stringify(e.payload), id: String(e.seq) });
            return terminal.has(e.type);
          };
          for (const e of [...buffer]) if (await send(e)) return;
          while (!stream.aborted) {
            while (queue.length > 0) if (await send(queue.shift()!)) return;
            await new Promise<void>((r) => (wake = r));
            wake = null;
          }
        } finally {
          service.bus.off(id, onEvent);
        }
      } finally {
        clearInterval(ping);
      }
    });
  });

  /**
   * Re-verifies a verdict: re-derives its findings and decision, rebuilds the
   * BOM root, checks receipts, re-asks the network for each signal, and checks
   * the attestation stored when it was sealed. `inputs` carries everything a
   * client needs to recompute the hashes itself (the policy file is at
   * /v1/policies/{ref}).
   */
  app.post("/v1/verify", async (c) => {
    await limit(c, limits.verify, `ip:${ip(c)}`);
    const body = (await c.req.json().catch(() => null)) as { id?: unknown } | null;
    if (typeof body?.id !== "string" || body.id.length > 64) throw new ApiError(400, "INVALID_REQUEST", "send { id }");
    const stored = await loadStoredVerdict(db, body.id);
    if (!stored) throw new ApiError(404, "NOT_FOUND", "verdict not found");
    const record = resolvePolicy(`${stored.policy.id}@${stored.policy.version}`);
    const report = reproduce(stored, record.policy, { policySha256: record.sha256, policySource: record.source, knownLists: knownLists() });
    const has = (prefix: string) => report.problems.some((p) => p.startsWith(prefix));
    const served = await verdictObject(db, body.id);
    const att = served ? await attester.check(served) : null;

    // The network's own record of each paid answer, a few at a time.
    const signals = { verified: 0, missing: 0, mismatch: 0, unchecked: 0 };
    const paid = (stored.purchases ?? []).filter((p) => p.signalHash).slice(0, 12);
    const verifySignal = service.deps.client.verifySignal?.bind(service.deps.client);
    const statuses = await mapBounded(paid, 4, async (p) => (verifySignal ? await verifySignal(p.signalHash!, p.minerId ? { minerId: p.minerId } : {}).catch(() => "unchecked" as const) : ("unchecked" as const)));
    for (const s of statuses) signals[s]++;
    const checks = {
      adaptersRerun: !has("findings re-derived") && !has("adapter replay"),
      policyRerun: !report.problems.includes("verdict hash mismatch"),
      verdictHashRecomputes: report.verdictHash === stored.verdictHash,
      bomRootRebuilt: !report.problems.includes("bom root mismatch"),
      engineVersion: !has("no engine"),
      decisionMatches: !has("served "),
      receiptsMatch: !has("BOM receipt") && !has("purchase receipt"),
      policyFile: !has("policy file differs"),
      // Findings recorded as never bought must be non-answers or a list screen Skein ships (M1).
      unpurchased: !has("unpurchased "),
      // Every reproduce() problem, including any the flags above do not name: ok false always shows a failing check.
      reproduces: report.ok,
      // The network disowns none of the answers it was asked about.
      signals: signals.mismatch === 0,
      ...(att
        ? {
            attestation: att.signatureValid && att.messageMatches,
            attestationSignature: att.signatureValid,
            attestationMatchesVerdict: att.messageMatches,
            ...(att.signerIsAttester === null ? {} : { attestationSigner: att.signerIsAttester }),
          }
        : {}),
    };
    const ok = report.ok && checks.signals && (!att || (att.signatureValid && att.messageMatches && att.signerIsAttester !== false));
    return c.json({
      id: body.id,
      ok,
      checks,
      ...(att ? { attester: att.attestation.signer, publishedAttester: attester.address, attestation: att.attestation } : {}),
      signals,
      verdictHash: { stored: stored.verdictHash, recomputed: report.verdictHash },
      bomRoot: { stored: stored.bomRoot, recomputed: report.bomRoot },
      receipts: stored.receipts,
      problems: [...report.problems, ...(checks.signals ? [] : [`${signals.mismatch} signal(s) do not match the network's record`]), ...(att && !att.messageMatches ? ["the stored attestation does not sign the verdict as stored now"] : []), ...(att && !att.signatureValid ? ["the stored attestation signature does not verify"] : [])],
      policy: { ref: record.ref, sha256: record.sha256, url: `/v1/policies/${record.ref}` },
      // The stored record reproduce() ran on: findings, purchases with their raw answers, and what was never bought.
      inputs: stored,
    });
  });

  app.get("/v1/policies", async (c) => {
    await limit(c, limits.publicRead, `ip:${ip(c)}`);
    return c.json(listPolicies().map((p) => ({ ref: p.ref, id: p.policy.id, version: p.policy.version, sha256: p.sha256, description: p.policy.description })));
  });
  app.get("/v1/policies/:ref", async (c) => {
    await limit(c, limits.publicRead, `ip:${ip(c)}`);
    let p: PolicyRecord;
    try {
      p = getPolicy(c.req.param("ref"));
    } catch {
      throw new ApiError(404, "UNKNOWN_POLICY", "policy not found");
    }
    return c.json({ ref: p.ref, sha256: p.sha256, yaml: p.yaml, policy: p.policy });
  });

  app.get("/v1/quote", async (c) => {
    await limit(c, limits.quote, `ip:${ip(c)}`);
    const subject = resolveSubject({ chainId: Number(c.req.query("chain")), token: c.req.query("token") });
    const { policy } = resolvePolicy(c.req.query("policy") ?? config.defaultPolicy);
    const p = plan({
      policy,
      checkIntents: CHECK_INTENTS,
      // What a verdict would buy from: allowlisted miners, Skein's own excluded (as runVerdict plans it).
      availability: availability(service.catalogue, { pinned: true, excludeMinerIds: config.selfRegistrationIds }),
      quotesUusdc: quotes(service.catalogue, CHECK_INTENTS, true, config.selfRegistrationIds),
      servedIntents: SERVED_INTENTS,
      priceUusdc: config.priceUusdc,
      callerBudgetUusdc: config.perVerdictCapUusdc,
    });
    return c.json({
      subject,
      policy: `${policy.id}@${policy.version}`,
      priceUsdc: usdc(config.priceUusdc),
      pricing: "standard; ABSTAIN is charged at upstream cost only",
      ...(p.ok
        ? { ok: true, upstreamUsdc: usdc(p.estimateUusdc), checks: p.purchases.map((x) => ({ check: x.check, intent: x.intent, quoteUsdc: usdc(x.quoteUusdc) })), dropped: p.dropped }
        : { ok: false, refusal: p.refusal, dropped: p.dropped }),
    });
  });

  /**
   * Service quality over the last 3 hours, for the probe: a burst of
   * ABSTAINs or failed purchases is an outage even when every process is up
   * (on Nov 10 a change in the node's 402 made every purchase fail for a day),
   * and verdict latency (p50/p95 of bought verdicts) for the p95 alert.
   */
  const QUALITY_WINDOW_H = 3;
  const quality = memo(30_000, async () => {
    const since = new Date(now().getTime() - QUALITY_WINDOW_H * 3_600_000);
    const [v] = await db
      .select({
        n: count(),
        abstain: sql<string>`count(*) filter (where ${schema.verdicts.verdict} = 'ABSTAIN')`,
        // ABSTAINs because a required check's purchase failed: the outage signal.
        // A policy may abstain by design (agent-pretrade on a launch with no trades yet).
        abstainFailed: sql<string>`count(*) filter (where ${schema.verdicts.verdict} = 'ABSTAIN' and exists (select 1 from jsonb_array_elements(${schema.verdicts.reasons}) r where r->>'detail' like '% is ERROR'))`,
        p50: sql<string | null>`percentile_cont(0.5) within group (order by ${schema.verdicts.durationMs})`,
        p95: sql<string | null>`percentile_cont(0.95) within group (order by ${schema.verdicts.durationMs})`,
      })
      .from(schema.verdicts)
      .where(gte(schema.verdicts.createdAt, since));
    const [p] = await db
      .select({ n: count(), errors: sql<string>`count(*) filter (where ${schema.purchases.error} is not null)` })
      .from(schema.purchases)
      .where(gte(schema.purchases.createdAt, since));
    return {
      windowHours: QUALITY_WINDOW_H, verdicts: v?.n ?? 0, abstain: Number(v?.abstain ?? 0), abstainFailed: Number(v?.abstainFailed ?? 0), purchases: p?.n ?? 0, purchaseErrors: Number(p?.errors ?? 0),
      verdictP50Ms: v?.p50 == null ? null : Math.round(Number(v.p50)),
      verdictP95Ms: v?.p95 == null ? null : Math.round(Number(v.p95)),
    };
  });

  /** Latency and failure per intent over 24 h, from the purchase log. */
  const intentHealth = memo(30_000, async () => {
    const since = new Date(now().getTime() - 86_400_000);
    const rows = await db
      .select({
        intent: schema.purchases.intent,
        n: count(),
        errors: sql<string>`count(*) filter (where ${schema.purchases.error} is not null)`,
        p50: sql<string | null>`percentile_cont(0.5) within group (order by ${schema.purchases.durationMs})`,
        p95: sql<string | null>`percentile_cont(0.95) within group (order by ${schema.purchases.durationMs})`,
      })
      .from(schema.purchases)
      .where(gte(schema.purchases.createdAt, since))
      .groupBy(schema.purchases.intent);
    return Object.fromEntries(rows.map((r) => [r.intent, { calls24h: r.n, errorRate24h: r.n ? Number(r.errors) / r.n : null, p50Ms: r.p50 === null ? null : Math.round(Number(r.p50)), p95Ms: r.p95 === null ? null : Math.round(Number(r.p95)) }]));
  });

  app.get("/v1/status", async (c) => {
    await limit(c, limits.publicRead, `ip:${ip(c)}`);
    const t = now().getTime();
    const spent = await service.spentTodayUusdc();
    const health = await intentHealth();
    const wallet = walletState.get();
    const [errs] = await db.select({ n: count() }).from(schema.errorLog).where(gte(schema.errorLog.at, new Date(t - 3_600_000)));
    const beats = Object.fromEntries((await db.select().from(schema.heartbeats)).map((h) => [h.name, h.at.toISOString()]));
    const failing = await db.select({ key: schema.alertState.key, since: schema.alertState.since }).from(schema.alertState).where(eq(schema.alertState.failing, true));
    const sdn = sdnSnapshotStatus(now());
    const paused = walletEmpty() ? "the purchaser's escrow is empty" : spent + config.perVerdictCapUusdc > config.stopAtUusdc ? "the day's spend reached the stop threshold" : null;
    return c.json({
      network: config.networkLabel ?? config.network.caip2,
      node: config.networkLabel === "simulated" ? "local fake node" : config.network.nodeUrl,
      preSeason: t < SEASON_START && !config.allowPreSeason,
      payer: service.deps.payerAddress ?? null,
      attester: attester.address,
      payerUsdcBalance: wallet.balanceUusdc === null ? null : usdc(wallet.balanceUusdc),
      // What purchases actually spend: the escrow, not the wallet (the alert follows it).
      payerEscrowUsdc: wallet.escrowUusdc === null ? null : usdc(wallet.escrowUusdc),
      walletAlert: wallet.escrowUusdc !== null && wallet.escrowUusdc < config.hotWalletAlertUusdc,
      // Uncached verdicts stop (503) while this is set; cached ones are still served.
      paused: paused !== null,
      pausedReason: paused,
      catalogueFetchedAt: service.catalogue.fetchedAt,
      intents: Object.entries(CHECK_INTENTS).map(([check, intent]) => {
        const miners = intent ? service.catalogue.minersByIntent[intent] ?? [] : [];
        return { check, intent, activeMiners: miners.filter((m) => m.activation_status === "active").length, ...(intent ? health[intent] ?? {} : {}) };
      }),
      spentTodayUsdc: usdc(spent),
      dailyCapUsdc: usdc(config.dailyCapUusdc),
      // Spec §8: the purchaser stops and alerts at 80% of the day's cap (GLOBAL_CAP_STOP_PCT).
      stopAtUsdc: usdc(config.stopAtUusdc),
      capAlert: spent >= 0.8 * config.dailyCapUusdc || spent + config.perVerdictCapUusdc > config.stopAtUusdc,
      // Unhandled errors in the last hour, across replicas; details in error_log and the logs.
      errorsLastHour: errs?.n ?? 0,
      // Scheduled jobs' last runs (the probe every 10 min, the backup nightly) and the alerts open now.
      dbRole: service.deps.dbRole ?? null,
      probeAt: beats.probe ?? null,
      backupAt: beats.backup ?? null,
      alertsOpen: failing.map((f) => ({ key: f.key, since: f.since?.toISOString() ?? null })),
      quality: await quality(),
      // The pinned OFAC address list the sanctions screen matches against; the probe alerts when it is stale.
      ofacSnapshot: sdn,
      chainsAnalysed: SUPPORTED_CHAINS,
    });
  });

  /**
   * The public ledger. Totals are all-time (cheap aggregates on indexed
   * columns); the analyses that scan rows (stability, abstain causes) read the
   * last LEDGER_WINDOW_DAYS, so the endpoint's cost stays flat as verdicts
   * accumulate and never nears the 15 s statement timeout.
   */
  const LEDGER_WINDOW_DAYS = 30;
  const ledger = memo(15_000, async () => {
    const windowStart = sql`now() - make_interval(days => ${LEDGER_WINDOW_DAYS})`;
    const byVerdict = await db.select({ verdict: schema.verdicts.verdict, n: count() }).from(schema.verdicts).groupBy(schema.verdicts.verdict);
    const [spend] = await db.select({ s: sql<string>`coalesce(sum(${schema.purchases.amountUusdc}), 0)`, receipts: count(schema.purchases.receiptHash) }).from(schema.purchases);
    const [miners] = await db.select({ n: sql<string>`count(distinct ${schema.purchases.minerId})` }).from(schema.purchases);
    const revenue = await db
      .select({ kind: schema.spendLedger.kind, s: sql<string>`coalesce(sum(${schema.spendLedger.amountUusdc}), 0)` })
      .from(schema.spendLedger)
      .where(sql`${schema.spendLedger.kind} in ('revenue_owed', 'revenue_settled')`)
      .groupBy(schema.spendLedger.kind);
    const rev = (k: string) => Number(revenue.find((r) => r.kind === k)?.s ?? 0);
    const [refunds] = await db
      .select({
        owed: sql<string>`coalesce(sum(${schema.x402Payments.refundUusdc}) filter (where ${schema.x402Payments.refundedAt} is null), 0)`,
        sent: sql<string>`coalesce(sum(${schema.x402Payments.refundUusdc}) filter (where ${schema.x402Payments.refundedAt} is not null), 0)`,
      })
      .from(schema.x402Payments)
      .where(eq(schema.x402Payments.status, "settled"));
    const recent = await db.select({ id: schema.verdicts.id, verdict: schema.verdicts.verdict, createdAt: schema.verdicts.createdAt }).from(schema.verdicts).orderBy(desc(schema.verdicts.createdAt)).limit(10);
    // Stability: the same token under the same policy, decided again within 7
    // days, should get the same answer. Consecutive pairs of answered
    // (non-ABSTAIN) verdicts, grouped by the later one's engine.
    const stab = await db.execute(sql`
      WITH v AS (
        SELECT verdict, engine_version, created_at,
               lag(verdict) OVER w AS prev, lag(created_at) OVER w AS prev_at
        FROM ${schema.verdicts}
        WHERE verdict <> 'ABSTAIN' AND created_at > ${windowStart}
        WINDOW w AS (PARTITION BY subject_chain_id, subject_token, policy_id, policy_version ORDER BY created_at)
      )
      SELECT engine_version AS engine, count(*)::int AS pairs, count(*) FILTER (WHERE verdict = prev)::int AS same
      FROM v WHERE prev IS NOT NULL AND created_at - prev_at < interval '7 days'
      GROUP BY engine_version ORDER BY engine_version`);
    const stabRows = rowsOf<{ engine: string; pairs: number; same: number }>(stab);
    // Why verdicts abstained: each required check that had no real answer, with that finding's status and
    // first note (timeout, purchase failure, no miner, …), in the window and in the last 7 days.
    const causes = await db.execute(sql`
      SELECT r->>'code' AS code, coalesce(r->>'check', '') AS "check", coalesce(f.status, '') AS status, coalesce(f.notes->>0, '') AS note,
             count(*)::int AS n, count(*) FILTER (WHERE v.created_at > now() - interval '7 days')::int AS last7d
      FROM ${schema.verdicts} v
      CROSS JOIN LATERAL jsonb_array_elements(v.reasons) r
      LEFT JOIN ${schema.findings} f ON f.verdict_id = v.id AND f."check" = r->>'check'
      WHERE v.verdict = 'ABSTAIN' AND v.created_at > ${windowStart} AND r->>'code' IN ('MISSING_REQUIRED_CHECK', 'LOW_COVERAGE')
      GROUP BY 1, 2, 3, 4 ORDER BY n DESC LIMIT 25`);
    // The same mix over rolling windows: the all-time mix still carries the first days' payment outage.
    const windows = await db
      .select({
        verdict: schema.verdicts.verdict,
        h24: sql<number>`count(*) FILTER (WHERE ${schema.verdicts.createdAt} > now() - interval '24 hours')::int`,
        h72: sql<number>`count(*)::int`,
      })
      .from(schema.verdicts)
      .where(gt(schema.verdicts.createdAt, sql`now() - interval '72 hours'`))
      .groupBy(schema.verdicts.verdict);
    const [ab] = await db.select({ n: count(), last7d: sql<number>`count(*) FILTER (WHERE ${schema.verdicts.createdAt} > now() - interval '7 days')::int` }).from(schema.verdicts).where(eq(schema.verdicts.verdict, "ABSTAIN"));
    const causeRows = rowsOf<{ code: string; check: string; status: string; note: string; n: number; last7d: number }>(causes);
    // Verdicts and upstream spend per UTC day, over the window (the /ledger charts).
    const days = await db.execute(sql`
      SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day, verdict, count(*)::int AS n, coalesce(sum(upstream_uusdc), 0)::bigint AS up
      FROM ${schema.verdicts} WHERE created_at > ${windowStart} GROUP BY 1, 2 ORDER BY 1`);
    const byDay = new Map<string, { day: string; verdicts: Record<string, number>; upstreamUusdc: number }>();
    for (const r of rowsOf<{ day: string; verdict: string; n: number; up: string | number }>(days)) {
      const d = byDay.get(r.day) ?? { day: r.day, verdicts: {}, upstreamUusdc: 0 };
      d.verdicts[r.verdict] = Number(r.n);
      d.upstreamUusdc += Number(r.up);
      byDay.set(r.day, d);
    }
    // Distinct miners Skein paid per check, over the window.
    const perCheck = await db
      .select({ check: schema.purchases.check, n: sql<string>`count(distinct ${schema.purchases.minerId})` })
      .from(schema.purchases)
      .where(and(gt(schema.purchases.createdAt, windowStart), sql`${schema.purchases.amountUusdc} > 0`))
      .groupBy(schema.purchases.check);
    return {
      network: config.networkLabel ?? config.network.caip2,
      verdicts: Object.fromEntries(byVerdict.map((r) => [r.verdict, r.n])),
      upstreamSpendUsdc: usdc(Number(spend?.s ?? 0)),
      // Telegraph answers, at the floor (the network's demand multiplier is not known here, so this is a lower bound).
      revenueOwedUsdc: usdc(rev("revenue_owed")),
      // x402 payments settled on the direct API, gross; refunds owed and sent are separate.
      revenueSettledUsdc: usdc(rev("revenue_settled")),
      refundsOwedUsdc: usdc(Number(refunds?.owed ?? 0)),
      refundsSentUsdc: usdc(Number(refunds?.sent ?? 0)),
      receipts: spend?.receipts ?? 0,
      minersUsed: Number(miners?.n ?? 0),
      last24h: Object.fromEntries(windows.map((w) => [w.verdict, Number(w.h24)])),
      last72h: Object.fromEntries(windows.map((w) => [w.verdict, Number(w.h72)])),
      abstain: { total: ab?.n ?? 0, last7d: Number(ab?.last7d ?? 0), causesWindowDays: LEDGER_WINDOW_DAYS, causes: causeRows.map((r) => ({ ...r, n: Number(r.n), last7d: Number(r.last7d) })) },
      stability: {
        definition: `consecutive non-ABSTAIN verdicts for the same token and policy, at most 7 days apart, that agree (verdicts of the last ${LEDGER_WINDOW_DAYS} days)`,
        windowDays: LEDGER_WINDOW_DAYS,
        byEngine: stabRows.map((r) => ({ engine: r.engine, pairs: Number(r.pairs), same: Number(r.same), rate: Number(r.pairs) ? Number(r.same) / Number(r.pairs) : null })),
      },
      byDay: [...byDay.values()].map((d) => ({ day: d.day, verdicts: d.verdicts, upstreamUsdc: usdc(d.upstreamUusdc) })),
      minersByCheck: Object.fromEntries(perCheck.map((r) => [r.check, Number(r.n)])),
      recent,
    };
  });
  app.get("/v1/ledger", async (c) => {
    await limit(c, limits.publicRead, `ip:${ip(c)}`);
    return c.json(await ledger());
  });

  /** Registers (or replaces) the caller's webhook. The signing secret is shown once. */
  app.post("/v1/webhooks", async (c) => {
    const consumer = await consumerFor(c);
    await limit(c, limits.webhook, `key:${consumer.id}`);
    const body = (await c.req.json().catch(() => null)) as { url?: unknown } | null;
    const url = typeof body?.url === "string" ? body.url : "";
    let parsed: URL | null = null;
    try {
      parsed = new URL(url);
    } catch {
      parsed = null;
    }
    const refused = !parsed || url.length > 500 ? "not a URL of at most 500 characters" : await refuseUnsafeUrl(url, service.deps.lookup);
    if (refused) throw new ApiError(400, "INVALID_REQUEST", `url must be a public https URL: ${refused}`);
    const secret = randomBytes(32).toString("base64url");
    await db.transaction(async (tx) => {
      await tx.update(schema.webhooks).set({ active: false }).where(eq(schema.webhooks.consumerId, consumer.id));
      await tx.insert(schema.webhooks).values({ consumerId: consumer.id, url, secret: sealSecret(secret, config.webhookSecretKey), secretHash: sha256(secret) });
    });
    return c.json(
      {
        url,
        secret,
        signature: `X-Skein-Signature: sha256=HMAC_SHA256(secret, X-Skein-Timestamp + "." + body); refuse a timestamp more than ${WEBHOOK_TOLERANCE_SEC} s old (@skeinlabs/sdk verifyWebhook does both)`,
        events: ["verdict.completed", "verdict.refused"],
      },
      201,
    );
  });

  /** The caller's active webhook, without its secret. */
  app.get("/v1/webhooks", async (c) => {
    const consumer = await consumerFor(c);
    await limit(c, limits.key, `key:${consumer.id}`);
    const [hook] = await db
      .select({ url: schema.webhooks.url, createdAt: schema.webhooks.createdAt })
      .from(schema.webhooks)
      .where(and(eq(schema.webhooks.consumerId, consumer.id), eq(schema.webhooks.active, true)));
    return c.json({ webhook: hook ? { url: hook.url, createdAt: hook.createdAt } : null });
  });

  /** Turns the caller's webhook off. Idempotent. */
  app.delete("/v1/webhooks", async (c) => {
    const consumer = await consumerFor(c);
    await limit(c, limits.key, `key:${consumer.id}`);
    const off = await db
      .update(schema.webhooks)
      .set({ active: false })
      .where(and(eq(schema.webhooks.consumerId, consumer.id), eq(schema.webhooks.active, true)))
      .returning({ id: schema.webhooks.id });
    return c.json({ deleted: off.length > 0 });
  });

  /**
   * A small key-value store for first-party apps (Skein Desk keeps its queue
   * here). Only keys listed in KV_KEY_HASHES may use it; each key sees only its
   * own namespace. Writes are conditional: If-None-Match: * creates, If-Match:
   * <etag> replaces, and a lost race answers 412 so the caller re-reads.
   */
  const kvKey = (c: Context) => {
    const key = c.req.query("key") ?? "";
    if (!/^[A-Za-z0-9/_.:-]{1,200}$/.test(key)) throw new ApiError(400, "INVALID_REQUEST", "key must be 1-200 characters of letters, digits and / _ . : -");
    return key;
  };
  async function kvConsumer(c: Context) {
    const consumer = await consumerFor(c);
    const presented = (c.req.header("authorization") ?? "").slice(7).trim();
    if (!config.kvKeyHashes.includes(sha256(presented))) throw new ApiError(403, "FORBIDDEN", "this key may not use the key-value store");
    await limit(c, limits.kv, `key:${consumer.id}`);
    return consumer;
  }

  app.get("/v1/kv", async (c) => {
    const consumer = await kvConsumer(c);
    const key = kvKey(c);
    const [row] = await db.select({ value: schema.kv.value, etag: schema.kv.etag }).from(schema.kv).where(and(eq(schema.kv.consumerId, consumer.id), eq(schema.kv.key, key)));
    if (!row) throw new ApiError(404, "NOT_FOUND", `no value for ${key}`);
    return c.json({ key, value: row.value, etag: row.etag });
  });

  app.put("/v1/kv", async (c) => {
    const consumer = await kvConsumer(c);
    const key = kvKey(c);
    const body = (await c.req.json().catch(() => null)) as { value?: unknown } | null;
    if (!body || !("value" in body) || body.value === undefined) throw new ApiError(400, "INVALID_REQUEST", "send { value }");
    const ifMatch = c.req.header("if-match");
    const create = c.req.header("if-none-match") === "*";
    if (!create && !ifMatch) throw new ApiError(428, "PRECONDITION_REQUIRED", "send If-None-Match: * to create, or If-Match: <etag> to replace");
    const etag = randomBytes(12).toString("hex");
    const written = create
      ? await db.insert(schema.kv).values({ consumerId: consumer.id, key, value: body.value, etag }).onConflictDoNothing().returning({ etag: schema.kv.etag })
      : await db
          .update(schema.kv)
          .set({ value: body.value, etag, updatedAt: now() })
          .where(and(eq(schema.kv.consumerId, consumer.id), eq(schema.kv.key, key), eq(schema.kv.etag, ifMatch!)))
          .returning({ etag: schema.kv.etag });
    if (written.length === 0) throw new ApiError(412, "PRECONDITION_FAILED", create ? `${key} already exists` : `${key} changed since you read it`);
    return c.json({ key, etag });
  });

  /**
   * What /miner/verdict answered the call that carried this request_id (H9):
   * a Telegraph caller whose function died after paying recovers its verdict
   * here. Public like the verdicts themselves; the id is the caller's own
   * random one, so it is not enumerable. When the answer was "still being
   * bought" (DEADLINE), the run is followed: once it is sealed, verdictId is set.
   */
  app.get("/v1/miner/requests/:id", async (c) => {
    await limit(c, limits.read, `ip:${ip(c)}`);
    const requestId = c.req.param("id");
    if (!CALLER_REQUEST_ID.test(requestId)) throw new ApiError(400, "INVALID_REQUEST", "request ids are 16-64 characters of letters, digits, '-' and '_'");
    const [row] = await db.select().from(schema.minerRequests).where(eq(schema.minerRequests.requestId, requestId));
    if (!row) throw new ApiError(404, "NOT_FOUND", "no answer recorded for this request id (answers are kept 30 days)");
    let verdictId = row.verdictId;
    let status: "answered" | "pending" | "abstained" = verdictId ? "answered" : "abstained";
    if (!verdictId && row.runId) {
      const run = await getRun(db, row.runId);
      if (run?.status === "done" && run.verdictId) verdictId = run.verdictId;
      status = verdictId ? "answered" : run?.status === "running" ? "pending" : "abstained";
    }
    return c.json({
      requestId,
      status,
      verdictId,
      ...(verdictId ? { verdict: `/v1/verdicts/${verdictId}` } : {}),
      ...(row.code ? { code: row.code } : {}),
      ...(row.runId ? { runId: row.runId } : {}),
      answeredAt: row.answeredAt.toISOString(),
    });
  });

  /**
   * The endpoint Telegraph's dispatcher calls (mapped in skein-miner.yaml).
   * Accepts the declared params ({ token, chain, policy }), a subject object,
   * a numeric chain id, a { params: {...} } wrapper, and Plan B's
   * FRAUD_RISK_GENERAL shape (subject as an address string). Answers within
   * MINER_DEADLINE_MS: a verdict still being bought is answered ABSTAIN, and
   * the next call gets it from cache.
   *
   * Every 200 here is an answer the network bills at Skein's floor, ABSTAIN
   * included (spec §6), so each one records revenue_owed.
   *
   * Loop guard (spec §9): a request that carries skein-depth >= 1 (header
   * X-Skein-Depth, or "skein-depth" in the body, its params or its context)
   * came through Skein's own purchases; it is answered from cache only, and
   * never starts a purchase.
   */
  app.post("/miner/verdict", async (c) => {
    if (!config.minerAuthKey) throw new ApiError(503, "UPSTREAM_UNAVAILABLE", "miner endpoint not configured");
    const presented = c.req.header("x-skein-miner-key") ?? "";
    if (!presented || !sameSecret(presented, config.minerAuthKey)) throw new ApiError(401, "UNAUTHORIZED", "bad miner key");
    const outer = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    const b = (outer.params && typeof outer.params === "object" ? outer.params : outer) as Record<string, unknown>;
    const depth = skeinDepth(c.req.header("x-skein-depth"), outer, b);
    const subjectObj = typeof b.subject === "object" && b.subject !== null ? (b.subject as { chainId?: unknown; token?: unknown }) : undefined;
    // Plan B sends one free-text `subject` and no chain: read both out of it.
    const fromText = typeof b.subject === "string" ? subjectFromText(b.subject) : undefined;
    const chainRaw = subjectObj?.chainId ?? b.chain ?? b.chainId ?? b.chain_id ?? fromText?.chain;
    const chainId =
      typeof chainRaw === "number" ? chainRaw
      : typeof chainRaw === "string" && /^\d+$/.test(chainRaw) ? Number(chainRaw)
      : typeof chainRaw === "string" ? Number(Object.entries(SUPPORTED_CHAINS).find(([, n]) => n === chainRaw.toLowerCase())?.[0])
      : fromText ? MINER_DEFAULT_CHAIN
      : NaN;
    const token = subjectObj?.token ?? fromText?.token ?? b.token ?? b.address;
    const subject = resolveSubject({ chainId, token });
    const record = resolvePolicy(typeof b.policy === "string" ? b.policy : config.defaultPolicy);
    const ctxHash = contextHash({});
    await isContract(subject);

    // The caller's own request id (optional): the answer is recorded under it, so a caller that paid
    // and lost the connection can fetch it later at GET /v1/miner/requests/{request_id}.
    const callerRequestId = [b.request_id, outer.request_id, (outer.context as Record<string, unknown> | undefined)?.request_id].find((x) => x !== undefined);
    if (callerRequestId !== undefined && (typeof callerRequestId !== "string" || !CALLER_REQUEST_ID.test(callerRequestId))) {
      throw new ApiError(400, "INVALID_REQUEST", "request_id must be 16-64 characters of letters, digits, '-' and '_' (a random id, such as a UUID)");
    }

    /** One billed answer: revenue owed at the floor, referenced by this request; and the caller's request id, if given. */
    const owed = async (what: string, answered: { verdictId?: string; runId?: string; code?: string }) => {
      await db
        .insert(schema.spendLedger)
        .values({ kind: "revenue_owed", amountUusdc: config.priceUusdc, ref: `telegraph:${c.get("requestId")}:${what}`.slice(0, 200) })
        .catch((e: Error) => console.error(JSON.stringify({ level: "error", msg: "revenue_owed not recorded", error: e.message })));
      if (typeof callerRequestId === "string") {
        const row = { verdictId: answered.verdictId ?? null, runId: answered.runId ?? null, code: answered.code ?? null, answeredAt: now() };
        await db
          .insert(schema.minerRequests)
          .values({ requestId: callerRequestId, ...row })
          // A repeat call never loses a verdict an earlier one was served.
          .onConflictDoUpdate({ target: schema.minerRequests.requestId, set: { ...row, verdictId: sql`coalesce(excluded.verdict_id, ${schema.minerRequests.verdictId})` } })
          .catch((e: Error) => console.error(JSON.stringify({ level: "error", msg: "miner request not recorded", error: e.message })));
      }
    };
    const answer = async (id: string, cached: boolean) => {
      const v = await verdictObject(db, id);
      if (!v) throw new ApiError(503, "VERDICT_FAILED", FAILED_MESSAGE);
      const reasons = v.reasons as { code: string; check?: string; detail: string }[];
      const attestation = await attester.forVerdict(v);
      await owed(v.id, { verdictId: v.id });
      c.header("X-Skein-Verdict-Hash", v.verdictHash);
      c.header("X-Skein-Bom-Root", v.bom.root);
      return c.json({
        verdict: v.verdict,
        // Plan B (FRAUD_RISK_GENERAL) reads its response fields: risk_level, risk_score, signals, summary.
        risk_level: riskLevel(v.verdict, reasons),
        risk_score: riskScore(v.verdict, v.riskBps),
        signals: [...reasons.map((r) => r.detail), ...(v.openRisks as string[]).map((r) => `open: ${r}`)],
        confidence: v.confidenceBps / 10_000,
        // The node rebuilds a FRAUD_RISK_GENERAL answer from the YAML's label and reason fields
        // (risk_level, summary) and drops the rest, so the verdict id rides in the summary too:
        // a caller reads it from there, or from the signal record on the node.
        summary: `${v.summary} [verdict ${v.id}]`,
        reasons: reasons.map((r) => ({ code: r.code, ...(r.check ? { check: r.check } : {}), detail: r.detail })),
        open_risks: v.openRisks,
        verdict_code: v.verdictCode,
        risk_bps: v.riskBps,
        confidence_bps: v.confidenceBps,
        bom_root: v.bom.root,
        bom: { root: v.bom.root, items: v.bom.items },
        id: v.id,
        verdict_hash: v.verdictHash,
        ...(attestation ? { attestation } : {}),
        cached,
        disclaimer: v.disclaimer,
      });
    };
    const abstain = async (code: string, detail: string, extra: Record<string, unknown> = {}) => {
      await owed(code, { code, ...(typeof extra.pending_id === "string" ? { runId: extra.pending_id } : {}) });
      return c.json({
        verdict: "ABSTAIN", risk_level: "MEDIUM", risk_score: riskScore("ABSTAIN", 0), signals: [detail], confidence: 0,
        summary: `Abstained: ${detail}${typeof extra.pending_id === "string" ? ` [pending ${extra.pending_id}]` : ""}`,
        reasons: [{ code, detail }], open_risks: [], verdict_code: 0, risk_bps: 0, confidence_bps: 0, bom_root: null, cached: false,
        disclaimer: "Risk evidence, not investment advice.", ...extra,
      });
    };

    const cached = await service.findCached(subject, record.policy, ctxHash);
    if (cached) {
      if (depth === 0) service.maybeRefresh({ policy: record.policy, policySha256: record.sha256, subject, context: {}, contextHash: ctxHash, budgetUusdc: config.perVerdictCapUusdc }, cached.createdAt, record.ref);
      return answer(cached.id, true);
    }
    if (depth >= 1) return abstain("LOOP_GUARD", "this request came through Skein's own purchases (skein-depth >= 1): answered from cache only, and there is no cached verdict");
    if (!service.accepting) return abstain("RESTARTING", "the service is restarting");
    if (walletEmpty()) return abstain("WALLET_EMPTY", "verdicts are paused while the purchaser's escrow is refilled");

    const key = flightKey(subject, record.ref, ctxHash);
    let flight = minerFlights.get(key);
    let flightId: string | undefined = minerFlightIds.get(key);
    if (!flight) {
      flightId = newVerdictId(now().getTime());
      // One run per token and policy across every replica: a lease in Postgres.
      // A repeat call that lands on another replica waits for the holder's run.
      const holder = await acquireFlight(db, key, flightId, config.verdictDeadlineMs + 60_000);
      if (holder) {
        const deadline = Date.now() + config.minerDeadlineMs;
        while (Date.now() < deadline) {
          const run = await getRun(db, holder);
          if (run && run.status !== "running") {
            if (run.status === "done" && run.verdictId) return answer(run.verdictId, false);
            return abstain("VERDICT_FAILED", FAILED_MESSAGE);
          }
          await new Promise((r) => setTimeout(r, 400).unref());
        }
        return abstain("DEADLINE", "the verdict is still being bought; ask again shortly", { pending_id: holder });
      }
      const id = flightId;
      flight = service.start({ id, policy: record.policy, policySha256: record.sha256, subject, context: {}, contextHash: ctxHash, budgetUusdc: config.perVerdictCapUusdc, channel: "telegraph" });
      minerFlights.set(key, flight);
      minerFlightIds.set(key, id);
      void flight.finally(() => {
        minerFlights.delete(key);
        minerFlightIds.delete(key);
        void releaseFlight(db, key, id).catch(() => {});
      });
    }
    const timeout = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), config.minerDeadlineMs).unref());
    const out = await Promise.race([flight, timeout]);
    if (out === "timeout") return abstain("DEADLINE", "the verdict is still being bought; ask again shortly", flightId ? { pending_id: flightId } : {});
    if (out.kind === "refused") {
      // Out of budget, or a required check no miner Skein buys from can answer (refused before any
      // purchase since engine 0.4.0), is an answer, not a dispatcher error that trips the circuit.
      // Nothing was bought upstream (upstream_usdc 0); Telegraph bills it at the floor like any answer.
      if (out.refusal.code === "BUDGET_TOO_LOW" || out.refusal.code === "UPSTREAM_UNAVAILABLE" || out.refusal.code === "MARGIN_GUARD") {
        return abstain(out.refusal.code, out.refusal.detail, { upstream_usdc: 0, ...(out.refusal.checks.length ? { checks: out.refusal.checks } : {}) });
      }
      throw refusalError(out.refusal);
    }
    if (out.kind === "failed") return abstain("VERDICT_FAILED", FAILED_MESSAGE);
    return answer(out.id, false);
  });

  return app;
}

/**
 * The purchaser's balances, refreshed by the server (null until read, or in tests):
 * escrowUusdc is the Telegraph escrow's effective balance, what purchases spend;
 * balanceUusdc is the wallet's own test USDC, what a refill deposits from.
 */
export const walletState = (() => {
  let balanceUusdc: number | null = null;
  let escrowUusdc: number | null = null;
  return {
    get: () => ({ balanceUusdc, escrowUusdc }),
    set: (v: number | null) => {
      balanceUusdc = v;
    },
    setEscrow: (v: number | null) => {
      escrowUusdc = v;
    },
  };
})();
