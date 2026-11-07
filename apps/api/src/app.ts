import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { claimRun, finishRun, getRun, loadStoredVerdict, newVerdictId, schema, type RunRow } from "@skein/db";
import { ATTESTATION_SCHEME, attestationMessage, canonicalJson, InvalidSubjectError, parseSubject, plan, reproduce, SUPPORTED_CHAINS, type Attestation, type Policy, type Subject } from "@skein/engine";
import { availability, quotes, type VerdictContext } from "@skein/pipeline";
import { getPolicy, listPolicies, type PolicyRecord } from "@skein/policies";
import { CHECK_INTENTS, SEASON_START, SERVED_INTENTS } from "@skein/telegraph";
import { and, asc, count, desc, eq, gte, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { ApiError, errorResponse } from "./errors";
import { contextHash, FAILED_MESSAGE, normaliseContext, type Consumer, type Refusal, type RunOutcome, type VerdictEvent, type VerdictService } from "./service";
import { privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
import { bomObject, verdictObject, type VerdictObject } from "./views";

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
      return new ApiError(503, "MARGIN_GUARD", r.detail, { quoteUsdc: usdc(r.quoteUusdc ?? 0) });
    case "SELF_ROUTING":
      return new ApiError(503, "SELF_ROUTING", r.detail, { checks: r.checks });
  }
}

/** A token bucket per key, in memory, bounded: the oldest key is evicted past `maxKeys`. */
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

function sameSecret(a: string, b: string): boolean {
  return timingSafeEqual(Buffer.from(sha256(a)), Buffer.from(sha256(b)));
}

/**
 * The caller's address as the trusted proxy saw it: each trusted hop appends
 * one entry to X-Forwarded-For, so the entry `hops` from the right is the
 * one the client could not forge. Anything left of it is client-supplied.
 */
export function clientIp(c: Context, hops: number): string {
  const xff = (c.req.header("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (hops > 0 && xff.length >= hops) return xff[xff.length - hops]!;
  return xff.at(-1) ?? "direct";
}

const secondsToUtcMidnight = (now: Date) => Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) / 1000);

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

export function createApp(service: VerdictService) {
  const { config } = service.deps;
  const db = service.db;
  const now = service.deps.now ?? (() => new Date());
  const limits = {
    read: new RateLimiter(240),
    publicRead: new RateLimiter(120),
    quote: new RateLimiter(30),
    verify: new RateLimiter(10),
    stream: new RateLimiter(30),
    badKey: new RateLimiter(20),
    key: new RateLimiter(30),
    webhook: new RateLimiter(5),
  };
  /** /miner/verdict: one run per token and policy at a time, however many dispatcher calls arrive. */
  const minerFlights = new Map<string, Promise<RunOutcome>>();
  const app = new Hono();

  app.use("*", secureHeaders({ crossOriginResourcePolicy: "cross-origin" }));
  app.use(
    "*",
    cors({
      origin: (origin) => (config.webOrigins.includes(origin) ? origin : null),
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["authorization", "content-type", "idempotency-key", "last-event-id"],
      exposeHeaders: ["X-Skein-Verdict-Hash", "X-Skein-Bom-Root", "X-Skein-Cache", "Retry-After"],
      maxAge: 600,
    }),
  );
  app.use(
    "*",
    bodyLimit({ maxSize: 64 * 1024, onError: () => { throw new ApiError(413, "PAYLOAD_TOO_LARGE", "request body over 64 KB"); } }),
  );

  app.onError((err, c) => {
    if (err instanceof ApiError) return errorResponse(c, err);
    // Internals go to the log, never to the caller.
    console.error(`${c.req.method} ${c.req.path}:`, err);
    return c.json({ error: { code: "INTERNAL", message: "internal error" } }, 500);
  });

  const limit = (c: Context, l: RateLimiter, key: string) => {
    const wait = l.take(key);
    if (wait !== null) throw new ApiError(429, "RATE_LIMITED", "too many requests", undefined, { "Retry-After": String(wait) });
  };
  const ip = (c: Context) => clientIp(c, config.trustProxyHops);

  async function consumerFor(c: Context) {
    const auth = c.req.header("authorization") ?? "";
    const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!key) {
      throw new ApiError(402, "PAYMENT_REQUIRED", "send a partner API key (Authorization: Bearer ...), or buy through Telegraph; x402 payment on the direct API is not enabled");
    }
    const hash = sha256(key);
    const [consumer] = await db.select().from(schema.consumers).where(eq(schema.consumers.apiKeyHash, hash));
    if (!consumer || consumer.revokedAt || config.revokedKeyHashes.includes(hash)) {
      limit(c, limits.badKey, `ip:${ip(c)}`);
      throw new ApiError(401, "UNAUTHORIZED", "unknown or revoked API key");
    }
    return consumer;
  }

  // Every served verdict is signed. The signature is deterministic (RFC 6979),
  // so signing on read gives the same attestation every time, with nothing stored.
  const attester = config.attestationKey ? privateKeyToAccount(config.attestationKey) : null;
  const attest = async (v: VerdictObject): Promise<Attestation | null> => {
    if (!attester) return null;
    const message = attestationMessage(v);
    return { scheme: ATTESTATION_SCHEME, signer: attester.address, message, signature: await attester.signMessage({ message }) };
  };

  const sendVerdict = async (c: Context, id: string, extra: Record<string, unknown> = {}) => {
    const v = await verdictObject(db, id);
    if (!v) throw new ApiError(404, "NOT_FOUND", `verdict ${id} not found`);
    c.header("X-Skein-Verdict-Hash", v.verdictHash);
    c.header("X-Skein-Bom-Root", v.bom.root);
    const attestation = await attest(v);
    if (attestation) c.header("X-Skein-Attestation", attestation.signature);
    return c.json({ ...v, ...(attestation ? { attestation } : {}), ...extra });
  };

  /** What a run that is not a fresh verdict tells its caller. */
  const fromRun = async (c: Context, run: RunRow, extra: Record<string, unknown> = {}) => {
    if (run.status === "running") return c.json({ id: run.id, status: "running", events: `/v1/verdicts/${run.id}/events` }, 202);
    if (run.status === "done" && run.verdictId) return sendVerdict(c, run.verdictId, { ...(run.verdictId !== run.id ? { servedFrom: run.verdictId, cached: true } : {}), ...extra });
    const o = (run.outcome ?? {}) as { code?: string; detail?: string; message?: string; checks?: string[]; quoteUusdc?: number };
    if (run.status === "refused" && o.code) {
      if (o.code === "DAILY_CAP_REACHED") throw new ApiError(503, "DAILY_CAP_REACHED", o.detail ?? "daily spend cap reached");
      if (o.code === "RATE_LIMITED") throw new ApiError(429, "RATE_LIMITED", o.detail ?? "this key's daily cap is reached");
      throw refusalError(o as Refusal);
    }
    throw new ApiError(503, run.status === "lost" ? "LOST" : "VERDICT_FAILED", o.message ?? FAILED_MESSAGE, { id: run.id, status: run.status });
  };

  app.get("/healthz", (c) => c.json({ ok: true }));
  app.get("/readyz", async (c) => {
    if (!service.accepting) return c.json({ ok: false, draining: true }, 503);
    await db.execute(sql`select 1`);
    return c.json({ ok: true, catalogueFetchedAt: service.catalogue.fetchedAt });
  });

  app.post("/v1/verdicts", async (c) => {
    if (!service.accepting) throw new ApiError(503, "UPSTREAM_UNAVAILABLE", "the service is restarting; retry with the same Idempotency-Key");
    const consumer = await consumerFor(c);
    limit(c, limits.key, `key:${consumer.id}`);
    const idemKey = c.req.header("idempotency-key");
    if (!idemKey || idemKey.length > 128) throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required (at most 128 characters)");
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

    const id = newVerdictId(now().getTime());
    const claim = await claimRun(db, {
      id, consumerId: consumer.id, idempotencyKey: idemKey, requestHash, channel: "api",
      subjectChainId: subject.chainId, subjectToken: subject.token, policyId: record.policy.id, policyVersion: record.policy.version, contextHash: ctxHash,
    });
    if (!claim.claimed) {
      // Idempotent replay: the original outcome, never charged again.
      if (claim.existing.requestHash !== requestHash) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "this Idempotency-Key was used with a different body");
      return fromRun(c, claim.existing, { replayed: true });
    }

    const cached = await service.findCached(subject, record.policy, ctxHash);
    if (cached) {
      await finishRun(db, id, { status: "done", verdictId: cached.id, at: now() });
      c.header("X-Skein-Cache", "hit");
      return sendVerdict(c, cached.id, { cached: true, servedFrom: cached.id });
    }

    // Early, friendly refusals; the spend gate enforces the same caps atomically per payment.
    if ((await service.spentTodayUusdc()) + config.perVerdictCapUusdc > config.dailyCapUusdc) {
      await finishRun(db, id, { status: "refused", outcome: { code: "DAILY_CAP_REACHED", detail: "the purchaser's daily spend cap is reached" }, at: now() });
      throw new ApiError(503, "DAILY_CAP_REACHED", "the purchaser's daily spend cap is reached; try again tomorrow (UTC)", undefined, { "Retry-After": String(secondsToUtcMidnight(now())) });
    }
    if ((await service.spentTodayUusdc({ consumerId: consumer.id })) >= consumer.dailyCapUusdc) {
      await finishRun(db, id, { status: "refused", outcome: { code: "RATE_LIMITED", detail: "this key's daily cap is reached" }, at: now() });
      throw new ApiError(429, "RATE_LIMITED", "this key's daily cap is reached", undefined, { "Retry-After": String(secondsToUtcMidnight(now())) });
    }

    const run = service.start({
      id, policy: record.policy, policySha256: record.sha256, subject, context, contextHash: ctxHash, channel: "api", claimed: true,
      consumer: { id: consumer.id, dailyCapUusdc: consumer.dailyCapUusdc } satisfies Consumer,
      idempotencyKey: idemKey, requestHash,
      ...(body.budgetUsdcMax ? { budgetUusdc: Math.round(body.budgetUsdcMax * UUSDC) } : {}),
    });
    if (body.mode === "async") return c.json({ id, status: "running", events: `/v1/verdicts/${id}/events` }, 202);

    const timeout = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), config.syncTimeoutMs).unref());
    const out = await Promise.race([run, timeout]);
    if (out === "timeout") throw new ApiError(504, "TIMEOUT", "sync mode ran out of time; poll the id", { id });
    if (out.kind === "refused") throw refusalError(out.refusal);
    if (out.kind === "failed") throw new ApiError(503, "VERDICT_FAILED", out.message, { id });
    return sendVerdict(c, out.id);
  });

  app.get("/v1/verdicts/:id", async (c) => {
    limit(c, limits.read, `ip:${ip(c)}`);
    const id = c.req.param("id");
    const [row] = await db.select({ id: schema.verdicts.id }).from(schema.verdicts).where(eq(schema.verdicts.id, id));
    if (row) return sendVerdict(c, id);
    const run = await getRun(db, id);
    if (!run) throw new ApiError(404, "NOT_FOUND", `verdict ${id} not found`);
    return fromRun(c, run);
  });

  app.get("/v1/verdicts/:id/bom", async (c) => {
    limit(c, limits.read, `ip:${ip(c)}`);
    const bom = await bomObject(db, c.req.param("id"));
    if (!bom) throw new ApiError(404, "NOT_FOUND", "verdict not found");
    return c.json(bom);
  });

  app.get("/v1/verdicts/:id/events", async (c) => {
    limit(c, limits.stream, `ip:${ip(c)}`);
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
          // Finished: replay from the table, ids as the live stream gave them.
          for (const [i, e] of past.entries()) {
            const seq = e.seq ?? i;
            if (seq <= after) continue;
            await stream.writeSSE({ event: e.type, data: JSON.stringify(e.payload), id: String(seq) });
          }
          if (past.length === 0) {
            // A run that never recorded events (lost before its first one): say so and end.
            const run = await getRun(db, id);
            await stream.writeSSE({ event: "error", data: JSON.stringify({ message: run?.status === "running" ? "still starting" : FAILED_MESSAGE, status: run?.status }) });
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

  app.post("/v1/verify", async (c) => {
    limit(c, limits.verify, `ip:${ip(c)}`);
    const body = (await c.req.json().catch(() => null)) as { id?: unknown } | null;
    if (typeof body?.id !== "string" || body.id.length > 64) throw new ApiError(400, "INVALID_REQUEST", "send { id }");
    const stored = await loadStoredVerdict(db, body.id);
    if (!stored) throw new ApiError(404, "NOT_FOUND", "verdict not found");
    const record = resolvePolicy(`${stored.policy.id}@${stored.policy.version}`);
    const report = reproduce(stored, record.policy, { policySha256: record.sha256 });
    const has = (prefix: string) => report.problems.some((p) => p.startsWith(prefix));
    // The signature over the served verdict: rebuilt from the stored record, then recovered.
    const served = attester ? await verdictObject(db, body.id) : null;
    const attestation = served ? await attest(served) : null;
    const attestationOk = attestation
      ? await verifyMessage({ address: attestation.signer as `0x${string}`, message: attestationMessage(served!), signature: attestation.signature as `0x${string}` })
      : null;

    // The network's own record of each paid answer.
    const signals = { verified: 0, missing: 0, mismatch: 0, unchecked: 0 };
    const paid = (stored.purchases ?? []).filter((p) => p.signalHash).slice(0, 12);
    for (const p of paid) {
      const s = service.deps.client.verifySignal ? await service.deps.client.verifySignal(p.signalHash, p.minerId ? { minerId: p.minerId } : {}).catch(() => "unchecked" as const) : "unchecked";
      signals[s]++;
    }
    return c.json({
      id: body.id,
      ok: report.ok,
      checks: {
        adaptersRerun: !has("findings re-derived") && !has("adapter replay"),
        policyRerun: !report.problems.includes("verdict hash mismatch"),
        bomRootRebuilt: !report.problems.includes("bom root mismatch"),
        engineVersion: !has("no engine"),
        decisionMatches: !has("served "),
        receiptsMatch: !has("BOM receipt") && !has("purchase receipt"),
        policyFile: !has("policy file differs"),
        ...(attestationOk === null ? {} : { attestation: attestationOk }),
      },
      ...(attestation ? { attester: attestation.signer } : {}),
      signals,
      verdictHash: { stored: stored.verdictHash, recomputed: report.verdictHash },
      bomRoot: { stored: stored.bomRoot, recomputed: report.bomRoot },
      receipts: stored.receipts,
      problems: report.problems,
    });
  });

  app.get("/v1/policies", (c) => {
    limit(c, limits.publicRead, `ip:${ip(c)}`);
    return c.json(listPolicies().map((p) => ({ ref: p.ref, id: p.policy.id, version: p.policy.version, sha256: p.sha256, description: p.policy.description })));
  });
  app.get("/v1/policies/:ref", (c) => {
    limit(c, limits.publicRead, `ip:${ip(c)}`);
    let p: PolicyRecord;
    try {
      p = getPolicy(c.req.param("ref"));
    } catch {
      throw new ApiError(404, "UNKNOWN_POLICY", "policy not found");
    }
    return c.json({ ref: p.ref, sha256: p.sha256, yaml: p.yaml, policy: p.policy });
  });

  app.get("/v1/quote", (c) => {
    limit(c, limits.quote, `ip:${ip(c)}`);
    const subject = resolveSubject({ chainId: Number(c.req.query("chain")), token: c.req.query("token") });
    const { policy } = resolvePolicy(c.req.query("policy") ?? config.defaultPolicy);
    const p = plan({
      policy,
      checkIntents: CHECK_INTENTS,
      availability: availability(service.catalogue),
      quotesUusdc: quotes(service.catalogue, CHECK_INTENTS, true),
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
    limit(c, limits.publicRead, `ip:${ip(c)}`);
    const t = now().getTime();
    const spent = await service.spentTodayUusdc();
    const health = await intentHealth();
    const wallet = walletState.get();
    return c.json({
      network: config.networkLabel ?? config.network.caip2,
      node: config.networkLabel === "simulated" ? "local fake node" : config.network.nodeUrl,
      preSeason: t < SEASON_START && !config.allowPreSeason,
      payer: service.deps.payerAddress ?? null,
      attester: attester?.address ?? null,
      payerUsdcBalance: wallet.balanceUusdc === null ? null : usdc(wallet.balanceUusdc),
      walletAlert: wallet.balanceUusdc !== null && wallet.balanceUusdc < config.hotWalletAlertUusdc,
      catalogueFetchedAt: service.catalogue.fetchedAt,
      intents: Object.entries(CHECK_INTENTS).map(([check, intent]) => {
        const miners = intent ? service.catalogue.minersByIntent[intent] ?? [] : [];
        return { check, intent, activeMiners: miners.filter((m) => m.activation_status === "active").length, ...(intent ? health[intent] ?? {} : {}) };
      }),
      spentTodayUsdc: usdc(spent),
      dailyCapUsdc: usdc(config.dailyCapUusdc),
      // Spec: stop-and-alert at 80% of the day's cap. Verdicts stop at 100% (the spend gate).
      capAlert: spent >= 0.8 * config.dailyCapUusdc,
      chainsAnalysed: SUPPORTED_CHAINS,
    });
  });

  const ledger = memo(5_000, async () => {
    const byVerdict = await db.select({ verdict: schema.verdicts.verdict, n: count() }).from(schema.verdicts).groupBy(schema.verdicts.verdict);
    const [spend] = await db.select({ s: sql<string>`coalesce(sum(${schema.purchases.amountUusdc}), 0)`, receipts: count(schema.purchases.receiptHash) }).from(schema.purchases);
    const [miners] = await db.select({ n: sql<string>`count(distinct ${schema.purchases.minerId})` }).from(schema.purchases);
    const [owed] = await db.select({ s: sql<string>`coalesce(sum(${schema.spendLedger.amountUusdc}), 0)` }).from(schema.spendLedger).where(eq(schema.spendLedger.kind, "revenue_owed"));
    const recent = await db.select({ id: schema.verdicts.id, verdict: schema.verdicts.verdict, createdAt: schema.verdicts.createdAt }).from(schema.verdicts).orderBy(desc(schema.verdicts.createdAt)).limit(10);
    return {
      network: config.networkLabel ?? config.network.caip2,
      verdicts: Object.fromEntries(byVerdict.map((r) => [r.verdict, r.n])),
      upstreamSpendUsdc: usdc(Number(spend?.s ?? 0)),
      revenueOwedUsdc: usdc(Number(owed?.s ?? 0)),
      receipts: spend?.receipts ?? 0,
      minersUsed: Number(miners?.n ?? 0),
      recent,
    };
  });
  app.get("/v1/ledger", async (c) => {
    limit(c, limits.publicRead, `ip:${ip(c)}`);
    return c.json(await ledger());
  });

  /** Registers (or replaces) the caller's webhook. The signing secret is shown once. */
  app.post("/v1/webhooks", async (c) => {
    const consumer = await consumerFor(c);
    limit(c, limits.webhook, `key:${consumer.id}`);
    const body = (await c.req.json().catch(() => null)) as { url?: unknown } | null;
    const url = typeof body?.url === "string" ? body.url : "";
    let parsed: URL | null = null;
    try {
      parsed = new URL(url);
    } catch {
      parsed = null;
    }
    if (!parsed || parsed.protocol !== "https:" || url.length > 500 || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/.test(parsed.hostname)) {
      throw new ApiError(400, "INVALID_REQUEST", "url must be a public https URL");
    }
    const secret = randomBytes(32).toString("base64url");
    await db.transaction(async (tx) => {
      await tx.update(schema.webhooks).set({ active: false }).where(eq(schema.webhooks.consumerId, consumer.id));
      await tx.insert(schema.webhooks).values({ consumerId: consumer.id, url, secret, secretHash: sha256(secret) });
    });
    return c.json({ url, secret, signature: "X-Skein-Signature: sha256=HMAC_SHA256(secret, body)", events: ["verdict.done", "verdict.refused"] }, 201);
  });

  /**
   * The endpoint Telegraph's dispatcher calls (mapped in skein-miner.yaml).
   * Accepts the declared params ({ token, chain, policy }), a subject object,
   * a numeric chain id, a { params: {...} } wrapper, and Plan B's
   * FRAUD_RISK_GENERAL shape (subject as an address string). Answers within
   * MINER_DEADLINE_MS: a verdict still being bought is answered ABSTAIN, and
   * the next call gets it from cache.
   */
  app.post("/miner/verdict", async (c) => {
    if (!config.minerAuthKey) throw new ApiError(503, "UPSTREAM_UNAVAILABLE", "miner endpoint not configured");
    const presented = c.req.header("x-skein-miner-key") ?? "";
    if (!presented || !sameSecret(presented, config.minerAuthKey)) throw new ApiError(401, "UNAUTHORIZED", "bad miner key");
    const outer = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    const b = (outer.params && typeof outer.params === "object" ? outer.params : outer) as Record<string, unknown>;
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

    const answer = async (id: string, cached: boolean) => {
      const v = await verdictObject(db, id);
      if (!v) throw new ApiError(503, "VERDICT_FAILED", FAILED_MESSAGE);
      const reasons = v.reasons as { code: string; check?: string; detail: string }[];
      const attestation = await attest(v);
      return c.json({
        verdict: v.verdict,
        // Plan B (FRAUD_RISK_GENERAL) reads its response fields: risk_level, risk_score, signals, summary.
        risk_level: riskLevel(v.verdict, reasons),
        risk_score: v.riskBps / 10_000,
        signals: [...reasons.map((r) => r.detail), ...(v.openRisks as string[]).map((r) => `open: ${r}`)],
        confidence: v.confidenceBps / 10_000,
        summary: v.summary,
        reasons: (v.reasons as { code: string; check?: string; detail: string }[]).map((r) => ({ code: r.code, ...(r.check ? { check: r.check } : {}), detail: r.detail })),
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
      });
    };
    const abstain = (code: string, detail: string, extra: Record<string, unknown> = {}) =>
      c.json({
        verdict: "ABSTAIN", risk_level: "MEDIUM", risk_score: 0, signals: [detail], confidence: 0, summary: `Abstained: ${detail}`,
        reasons: [{ code, detail }], open_risks: [], verdict_code: 0, risk_bps: 0, confidence_bps: 0, bom_root: null, cached: false, ...extra,
      });

    const cached = await service.findCached(subject, record.policy, ctxHash);
    if (cached) {
      service.maybeRefresh({ policy: record.policy, policySha256: record.sha256, subject, context: {}, contextHash: ctxHash, budgetUusdc: config.perVerdictCapUusdc }, cached.createdAt);
      return answer(cached.id, true);
    }
    if (!service.accepting) return abstain("RESTARTING", "the service is restarting");

    const key = `${subject.chainId}:${subject.token}:${record.ref}`;
    let flight = minerFlights.get(key);
    let flightId: string | undefined;
    if (!flight) {
      flightId = newVerdictId(now().getTime());
      flight = service.start({ id: flightId, policy: record.policy, policySha256: record.sha256, subject, context: {}, contextHash: ctxHash, budgetUusdc: config.perVerdictCapUusdc, channel: "telegraph" });
      minerFlights.set(key, flight);
      void flight.finally(() => minerFlights.delete(key));
    }
    const timeout = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), config.minerDeadlineMs).unref());
    const out = await Promise.race([flight, timeout]);
    if (out === "timeout") return abstain("DEADLINE", "the verdict is still being bought; ask again shortly", flightId ? { pending_id: flightId } : {});
    if (out.kind === "refused") {
      // Out of budget (or no live miners) is an answer, not a dispatcher error that trips the circuit.
      if (out.refusal.code === "BUDGET_TOO_LOW" || out.refusal.code === "UPSTREAM_UNAVAILABLE" || out.refusal.code === "MARGIN_GUARD") {
        return abstain(out.refusal.code, out.refusal.detail);
      }
      throw refusalError(out.refusal);
    }
    if (out.kind === "failed") return abstain("VERDICT_FAILED", FAILED_MESSAGE);
    return answer(out.id, false);
  });

  return app;
}

/** The purchaser wallet's USDC balance, refreshed by the server (null until read, or in tests). */
export const walletState = (() => {
  let balanceUusdc: number | null = null;
  return {
    get: () => ({ balanceUusdc }),
    set: (v: number | null) => {
      balanceUusdc = v;
    },
  };
})();
