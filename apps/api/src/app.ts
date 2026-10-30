import { createHash, timingSafeEqual } from "node:crypto";
import { loadStoredVerdict, newVerdictId, schema } from "@skein/db";
import { canonicalJson, InvalidSubjectError, parseSubject, plan, reproduce, SUPPORTED_CHAINS, type Policy, type Subject } from "@skein/engine";
import { availability, quotes, type VerdictContext } from "@skein/pipeline";
import { getPolicy, listPolicies } from "@skein/policies";
import { CHECK_INTENTS, SEASON_START, SERVED_INTENTS } from "@skein/telegraph";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { ApiError, errorResponse } from "./errors";
import type { RunOutcome, VerdictEvent, VerdictService } from "./service";
import { bomObject, verdictObject } from "./views";

const UUSDC = 1_000_000;
const usdc = (u: number) => Math.round(u) / UUSDC;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const contextSchema = z
  .object({
    treasuryAddresses: z.array(z.string().regex(/^0x[0-9a-fA-F]{40}$/)).max(5).optional(),
    deployer: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
    repoUrl: z.string().url().max(300).refine((u) => /^https:\/\/(github\.com|gitlab\.com)\//.test(u), "repoUrl must be on github.com or gitlab.com").optional(),
    socialHandle: z.string().regex(/^@?[A-Za-z0-9_]{1,30}$/).optional(),
    pool: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
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

function resolvePolicy(ref: string): Policy {
  try {
    return getPolicy(ref).policy;
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

function refusalError(r: Extract<RunOutcome, { kind: "refused" }>["refusal"]): ApiError {
  switch (r.code) {
    case "BUDGET_TOO_LOW":
      return new ApiError(422, "BUDGET_TOO_LOW", r.detail, { quoteUsdc: usdc(r.quoteUusdc ?? 0), checks: r.checks });
    case "UPSTREAM_UNAVAILABLE":
      return new ApiError(503, "UPSTREAM_UNAVAILABLE", r.detail, { checks: r.checks });
    case "MARGIN_GUARD":
      return new ApiError(503, "MARGIN_GUARD", r.detail, { quoteUsdc: usdc(r.quoteUusdc ?? 0) });
    case "SELF_ROUTING":
      return new ApiError(503, "SELF_ROUTING", r.detail, { checks: r.checks });
  }
}

/** A token bucket per caller, in memory (one replica at hackathon scale). */
class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(private readonly perMinute: number) {}
  take(key: string, now = Date.now()): number | null {
    const b = this.buckets.get(key) ?? { tokens: this.perMinute, at: now };
    b.tokens = Math.min(this.perMinute, b.tokens + ((now - b.at) / 60_000) * this.perMinute);
    b.at = now;
    this.buckets.set(key, b);
    if (b.tokens < 1) return Math.ceil(((1 - b.tokens) / this.perMinute) * 60);
    b.tokens -= 1;
    return null;
  }
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(sha256(a));
  const y = Buffer.from(sha256(b));
  return timingSafeEqual(x, y);
}

export function createApp(service: VerdictService) {
  const { config } = service.deps;
  const db = service.db;
  const limiter = new RateLimiter(30);
  const inflight = new Map<string, string>();
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: (origin) => (config.webOrigins.includes(origin) ? origin : null),
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["authorization", "content-type", "idempotency-key"],
      exposeHeaders: ["X-Skein-Verdict-Hash", "X-Skein-Bom-Root", "X-Skein-Cache", "Retry-After"],
      maxAge: 600,
    }),
  );

  app.onError((err, c) => {
    if (err instanceof ApiError) return errorResponse(c, err);
    console.error(err);
    return c.json({ error: { code: "INTERNAL", message: "internal error" } }, 500);
  });

  const rateLimit = (c: Context, key: string) => {
    const wait = limiter.take(key);
    if (wait !== null) throw new ApiError(429, "RATE_LIMITED", "too many requests", undefined, { "Retry-After": String(wait) });
  };

  async function consumerFor(c: Context) {
    const auth = c.req.header("authorization") ?? "";
    const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!key) {
      throw new ApiError(402, "PAYMENT_REQUIRED", "send a partner API key (Authorization: Bearer ...); x402 payment for the direct API is not enabled yet");
    }
    const [consumer] = await db.select().from(schema.consumers).where(eq(schema.consumers.apiKeyHash, sha256(key)));
    if (!consumer) throw new ApiError(401, "UNAUTHORIZED", "unknown API key");
    return consumer;
  }

  const sendVerdict = async (c: Context, id: string, extra: Record<string, unknown> = {}) => {
    const v = await verdictObject(db, id);
    if (!v) throw new ApiError(404, "NOT_FOUND", `verdict ${id} not found`);
    c.header("X-Skein-Verdict-Hash", v.verdictHash);
    c.header("X-Skein-Bom-Root", v.bom.root);
    return c.json({ ...v, ...extra });
  };

  app.get("/healthz", (c) => c.json({ ok: true }));
  app.get("/readyz", async (c) => {
    await db.execute(sql`select 1`);
    return c.json({ ok: true, catalogueFetchedAt: service.catalogue.fetchedAt });
  });

  app.post("/v1/verdicts", async (c) => {
    const consumer = await consumerFor(c);
    rateLimit(c, `key:${consumer.id}`);
    const idemKey = c.req.header("idempotency-key");
    if (!idemKey || idemKey.length > 128) throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required (at most 128 characters)");
    const raw = await c.req.json().catch(() => null);
    const parsed = createSchema.safeParse(raw);
    if (!parsed.success) throw new ApiError(400, "INVALID_REQUEST", "invalid body", parsed.error.issues);
    const body = parsed.data;
    const requestHash = sha256(canonicalJson(body));

    // Idempotent replay: the original verdict, not charged again.
    const [prior] = await db
      .select({ id: schema.verdicts.id, requestHash: schema.verdicts.requestHash })
      .from(schema.verdicts)
      .where(and(eq(schema.verdicts.consumerId, consumer.id), eq(schema.verdicts.idempotencyKey, idemKey)));
    if (prior) {
      if (prior.requestHash !== requestHash) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "this Idempotency-Key was used with a different body");
      return sendVerdict(c, prior.id, { replayed: true });
    }
    const flightKey = `${consumer.id}:${idemKey}`;
    if (inflight.has(flightKey)) return c.json({ id: inflight.get(flightKey), status: "running" }, 202);

    const subject = resolveSubject(body.subject);
    const policy = resolvePolicy(body.policy ?? config.defaultPolicy);

    const cached = await service.findCached(subject, policy);
    if (cached) {
      c.header("X-Skein-Cache", "hit");
      return sendVerdict(c, cached, { cached: true });
    }

    if ((await service.spentTodayUusdc()) + config.perVerdictCapUusdc > config.dailyCapUusdc) {
      throw new ApiError(503, "DAILY_CAP_REACHED", "the purchaser's daily spend cap is reached; try again tomorrow (UTC)");
    }
    if ((await service.consumerSpentTodayUusdc(consumer.id)) >= consumer.dailyCapUusdc) {
      throw new ApiError(429, "RATE_LIMITED", "this key's daily cap is reached");
    }

    const budget = Math.min(config.perVerdictCapUusdc, body.budgetUsdcMax ? Math.round(body.budgetUsdcMax * UUSDC) : Infinity);
    const id = newVerdictId();
    inflight.set(flightKey, id);
    const run = service
      .start({ id, policy, subject, context: (body.context ?? {}) as VerdictContext, budgetUusdc: budget, channel: "api", consumerId: consumer.id, idempotencyKey: idemKey, requestHash })
      .finally(() => inflight.delete(flightKey));

    if (body.mode === "async") return c.json({ id, status: "running", events: `/v1/verdicts/${id}/events` }, 202);

    const timeout = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), config.syncTimeoutMs).unref());
    const out = await Promise.race([run, timeout]);
    if (out === "timeout") throw new ApiError(504, "TIMEOUT", "sync mode ran out of time; poll the id", { id });
    if (out.kind === "refused") throw refusalError(out.refusal);
    if (out.kind === "failed") throw new ApiError(503, "UPSTREAM_UNAVAILABLE", out.message);
    return sendVerdict(c, out.id);
  });

  app.get("/v1/verdicts/:id", async (c) => {
    const id = c.req.param("id");
    const [row] = await db.select({ id: schema.verdicts.id }).from(schema.verdicts).where(eq(schema.verdicts.id, id));
    if (!row && service.running.has(id)) return c.json({ id, status: "running" }, 202);
    return sendVerdict(c, id);
  });

  app.get("/v1/verdicts/:id/bom", async (c) => {
    const bom = await bomObject(db, c.req.param("id"));
    if (!bom) throw new ApiError(404, "NOT_FOUND", "verdict not found");
    return c.json(bom);
  });

  app.get("/v1/verdicts/:id/events", (c) => {
    const id = c.req.param("id");
    const terminal = new Set(["done", "refused", "error"]);
    return streamSSE(c, async (stream) => {
      const buffer = service.buffers.get(id);
      if (!buffer) {
        // Finished long ago: replay from the table.
        const past = await db.select().from(schema.events).where(eq(schema.events.verdictId, id)).orderBy(schema.events.id);
        if (past.length === 0) await stream.writeSSE({ event: "error", data: JSON.stringify({ message: "unknown verdict id" }) });
        for (const e of past) await stream.writeSSE({ event: e.type, data: JSON.stringify(e.payload), id: String(e.id) });
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
      try {
        let next = 0;
        const send = async (e: VerdictEvent) => {
          if (e.seq < next) return false;
          next = e.seq + 1;
          await stream.writeSSE({ event: e.type, data: JSON.stringify(e.payload), id: String(e.seq) });
          return terminal.has(e.type);
        };
        for (const e of [...buffer]) if (await send(e)) return;
        for (;;) {
          while (queue.length > 0) if (await send(queue.shift()!)) return;
          await new Promise<void>((r) => (wake = r));
          wake = null;
        }
      } finally {
        service.bus.off(id, onEvent);
      }
    });
  });

  app.post("/v1/verify", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { id?: string } | null;
    if (!body?.id) throw new ApiError(400, "INVALID_REQUEST", "send { id }");
    const stored = await loadStoredVerdict(db, body.id);
    if (!stored) throw new ApiError(404, "NOT_FOUND", "verdict not found");
    const report = reproduce(stored, resolvePolicy(`${stored.policy.id}@${stored.policy.version}`));
    return c.json({
      id: body.id,
      ok: report.ok,
      checks: {
        adaptersRerun: !report.problems.some((p) => p.startsWith("findings re-derived") || p.startsWith("adapter replay")),
        policyRerun: !report.problems.includes("verdict hash mismatch"),
        bomRootRebuilt: !report.problems.includes("bom root mismatch"),
        engineVersion: !report.problems.some((p) => p.startsWith("engine version")),
      },
      verdictHash: { stored: stored.verdictHash, recomputed: report.verdictHash },
      bomRoot: { stored: stored.bomRoot, recomputed: report.bomRoot },
      receipts: stored.receipts,
      problems: report.problems,
    });
  });

  app.get("/v1/policies", (c) =>
    c.json(listPolicies().map((p) => ({ ref: p.ref, id: p.policy.id, version: p.policy.version, sha256: p.sha256, description: p.policy.description }))),
  );
  app.get("/v1/policies/:ref", (c) => {
    try {
      const p = getPolicy(c.req.param("ref"));
      return c.json({ ref: p.ref, sha256: p.sha256, yaml: p.yaml, policy: p.policy });
    } catch {
      throw new ApiError(404, "UNKNOWN_POLICY", "policy not found");
    }
  });

  app.get("/v1/quote", (c) => {
    rateLimit(c, `ip:${c.req.header("x-forwarded-for") ?? "local"}`);
    const subject = resolveSubject({ chainId: Number(c.req.query("chain")), token: c.req.query("token") });
    const policy = resolvePolicy(c.req.query("policy") ?? config.defaultPolicy);
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
      ...(p.ok
        ? { ok: true, upstreamUsdc: usdc(p.estimateUusdc), checks: p.purchases.map((x) => ({ check: x.check, intent: x.intent, quoteUsdc: usdc(x.quoteUusdc) })), dropped: p.dropped }
        : { ok: false, refusal: p.refusal, dropped: p.dropped }),
    });
  });

  app.get("/v1/status", async (c) => {
    const now = Date.now();
    return c.json({
      network: config.networkLabel ?? config.network.caip2,
      node: config.networkLabel === "simulated" ? "local fake node" : config.network.nodeUrl,
      preSeason: now < SEASON_START && !config.allowPreSeason,
      payer: service.deps.payerAddress ?? null,
      catalogueFetchedAt: service.catalogue.fetchedAt,
      intents: Object.entries(CHECK_INTENTS).map(([check, intent]) => {
        const miners = intent ? service.catalogue.minersByIntent[intent] ?? [] : [];
        return { check, intent, activeMiners: miners.filter((m) => m.activation_status === "active").length };
      }),
      spentTodayUsdc: usdc(await service.spentTodayUusdc()),
      dailyCapUsdc: usdc(config.dailyCapUusdc),
      chainsAnalysed: SUPPORTED_CHAINS,
    });
  });

  app.get("/v1/ledger", async (c) => {
    const byVerdict = await db.select({ verdict: schema.verdicts.verdict, n: count() }).from(schema.verdicts).groupBy(schema.verdicts.verdict);
    const [spend] = await db.select({ s: sql<string>`coalesce(sum(${schema.purchases.amountUusdc}), 0)`, receipts: count(schema.purchases.receiptHash) }).from(schema.purchases);
    const [miners] = await db.select({ n: sql<string>`count(distinct ${schema.purchases.minerId})` }).from(schema.purchases);
    const recent = await db.select({ id: schema.verdicts.id, verdict: schema.verdicts.verdict, createdAt: schema.verdicts.createdAt }).from(schema.verdicts).orderBy(desc(schema.verdicts.createdAt)).limit(10);
    return c.json({
      network: config.networkLabel ?? config.network.caip2,
      verdicts: Object.fromEntries(byVerdict.map((r) => [r.verdict, r.n])),
      upstreamSpendUsdc: usdc(Number(spend?.s ?? 0)),
      receipts: spend?.receipts ?? 0,
      minersUsed: Number(miners?.n ?? 0),
      recent,
    });
  });

  /**
   * The endpoint Telegraph's dispatcher calls (mapped in skein-miner.yaml).
   * The request shape is unconfirmed until Nov 1, so both the declared params
   * ({ token, chain, policy }) and a subject object are accepted.
   */
  app.post("/miner/verdict", async (c) => {
    if (!config.minerAuthKey) throw new ApiError(503, "UPSTREAM_UNAVAILABLE", "miner endpoint not configured");
    const presented = c.req.header("x-skein-miner-key") ?? "";
    if (!presented || !sameSecret(presented, config.minerAuthKey)) throw new ApiError(401, "UNAUTHORIZED", "bad miner key");
    const b = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    const chainName = typeof b.chain === "string" ? b.chain.toLowerCase() : undefined;
    const chainId = (b.subject as { chainId?: number } | undefined)?.chainId ?? Number(Object.entries(SUPPORTED_CHAINS).find(([, n]) => n === chainName)?.[0]);
    const token = (b.subject as { token?: string } | undefined)?.token ?? b.token;
    const subject = resolveSubject({ chainId, token });
    const policy = resolvePolicy(typeof b.policy === "string" ? b.policy : config.defaultPolicy);
    const depth = Number(c.req.header("x-skein-depth") ?? b.skein_depth ?? 0);

    const respond = async (id: string, cached: boolean) => {
      const v = (await verdictObject(db, id))!;
      return c.json({
        verdict: v.verdict,
        confidence: v.confidenceBps / 10_000,
        summary: v.summary,
        verdict_code: v.verdictCode,
        risk_bps: v.riskBps,
        confidence_bps: v.confidenceBps,
        bom: { root: v.bom.root, items: v.bom.items },
        id: v.id,
        verdict_hash: v.verdictHash,
        cached,
      });
    };
    const cached = await service.findCached(subject, policy);
    if (cached) return respond(cached, true);
    // A request that came back to Skein from its own purchase is never re-bought.
    if (depth >= 1) throw new ApiError(409, "SELF_ROUTING", "nested request with no cached verdict");
    const spotSpend = await db
      .select({ s: sql<string>`coalesce(sum(${schema.verdicts.upstreamUusdc}), 0)` })
      .from(schema.verdicts)
      .where(and(eq(schema.verdicts.channel, "telegraph"), gte(schema.verdicts.createdAt, new Date(new Date().setUTCHours(0, 0, 0, 0)))));
    if (Number(spotSpend[0]?.s ?? 0) >= config.spotcheckDailyCapUusdc) {
      return c.json({ verdict: "ABSTAIN", confidence: 0, summary: "Abstained: the daily budget for uncached Telegraph requests is spent.", verdict_code: 0, risk_bps: 0, confidence_bps: 0, cached: false });
    }
    const out = await service.start({ id: newVerdictId(), policy, subject, context: {}, budgetUusdc: config.perVerdictCapUusdc, channel: "telegraph" });
    if (out.kind === "refused") throw refusalError(out.refusal);
    if (out.kind === "failed") throw new ApiError(503, "UPSTREAM_UNAVAILABLE", out.message);
    return respond(out.id, false);
  });

  return app;
}
