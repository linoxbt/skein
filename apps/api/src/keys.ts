import { createHash, randomBytes } from "node:crypto";
import { schema } from "@skein/db";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { getAddress, isAddress, verifyMessage } from "viem";
import type { ApiConfig as Config } from "./config";
import { ApiError } from "./errors";
import type { Limiter } from "./limits";
import type { VerdictService } from "./service";

/**
 * API keys without the operator in the loop.
 *
 *  - Self-serve: a wallet signs a one-time message (no gas, no transaction)
 *    and gets one partner key, plan "self", with a small daily cap. Signing
 *    again revokes that wallet's previous self-serve key and issues a new one.
 *    Every self-serve key also shares one daily budget, so many wallets
 *    cannot spend more than SELF_SERVE_TOTAL_DAILY_USDC between them.
 *  - Admin: a key whose SHA-256 is in ADMIN_KEY_HASHES lists every key,
 *    creates partner keys, changes caps and revokes keys. The admin key is
 *    not a partner key: it buys nothing.
 *
 * A key is shown once, when it is made; only its SHA-256 is stored.
 * Revocation is final (a database trigger refuses to undo it).
 */

const UUSDC = 1_000_000;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const usdc = (u: number) => Number((u / UUSDC).toFixed(6));
const newKey = () => `sk_part_${randomBytes(24).toString("base64url")}`;
/** How long a sign-in message may wait for its signature. */
export const CHALLENGE_TTL_MS = 10 * 60_000;
export const SELF_PLAN = "self";
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} .@_-]{0,47}$/u;
const KINDS = ["agent", "team", "contract"] as const;

export interface KeyRouteDeps {
  service: VerdictService;
  config: Config;
  now: () => Date;
  limit: (c: Context, l: Limiter, key: string) => Promise<void>;
  limiter: (name: string, perMinute: number, failClosed?: boolean) => Limiter;
  ip: (c: Context) => string;
}

const body = async <T>(c: Context): Promise<Partial<T>> => ((await c.req.json().catch(() => null)) ?? {}) as Partial<T>;

/** The message a wallet signs for its key. Plain text, so the wallet shows what it is signing. */
export function challengeMessage(address: string, nonce: string, issued: Date, expires: Date): string {
  return [
    "Sign in to Skein for an API key.",
    "",
    "This is not a transaction and costs nothing. Signing again replaces the key this wallet had.",
    "",
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued: ${issued.toISOString()}`,
    `Expires: ${expires.toISOString()}`,
  ].join("\n");
}

/** Upstream spend today by every self-serve key together (their shared budget). */
export async function selfServeSpentToday(service: VerdictService, now: Date): Promise<number> {
  const [r] = await service.db
    .select({ s: sql<string>`coalesce(sum(coalesce(${schema.spendHolds.spentUusdc}, ${schema.spendHolds.reservedUusdc})), 0)` })
    .from(schema.spendHolds)
    .innerJoin(schema.consumers, eq(schema.consumers.id, schema.spendHolds.consumerId))
    .where(and(eq(schema.spendHolds.day, now.toISOString().slice(0, 10)), eq(schema.consumers.plan, SELF_PLAN)));
  return Number(r?.s ?? 0);
}

export function registerKeyRoutes(app: Hono, d: KeyRouteDeps) {
  const { service, config, now, limit, ip } = d;
  const db = service.db;
  // Per caller IP and minute. Issuing fails closed: it writes a key.
  const challengeLimit = d.limiter("keyChallenge", 10, true);
  const issueLimit = d.limiter("keyIssue", 5, true);
  const adminLimit = d.limiter("admin", 120);
  const badAdmin = d.limiter("badAdmin", 10, true);

  const selfServe = () => {
    if (!config.selfServe.enabled) throw new ApiError(403, "SELF_SERVE_OFF", "self-serve keys are turned off; request a partner key instead");
  };

  app.post("/v1/keys/challenge", async (c) => {
    selfServe();
    await limit(c, challengeLimit, `ip:${ip(c)}`);
    const { address } = await body<{ address: string }>(c);
    if (typeof address !== "string" || !isAddress(address, { strict: false })) throw new ApiError(400, "INVALID_REQUEST", "address must be an EVM address (0x + 40 hex)");
    const at = now();
    const expires = new Date(at.getTime() + CHALLENGE_TTL_MS);
    const nonce = randomBytes(16).toString("hex");
    const checksummed = getAddress(address);
    const message = challengeMessage(checksummed, nonce, at, expires);
    // Old challenges are pruned as new ones arrive: the table stays a few minutes deep.
    await db.delete(schema.keyChallenges).where(lt(schema.keyChallenges.expiresAt, at));
    await db.insert(schema.keyChallenges).values({ nonce, address: checksummed, message, expiresAt: expires });
    return c.json({ address: checksummed, nonce, message, expiresAt: expires.toISOString() }, 201);
  });

  app.post("/v1/keys", async (c) => {
    selfServe();
    await limit(c, issueLimit, `ip:${ip(c)}`);
    const b = await body<{ nonce: string; signature: string; name: string }>(c);
    if (typeof b.nonce !== "string" || !/^[0-9a-f]{32}$/.test(b.nonce)) throw new ApiError(400, "INVALID_REQUEST", "send { nonce, signature } from POST /v1/keys/challenge");
    if (typeof b.signature !== "string" || !/^0x[0-9a-fA-F]{130,}$/.test(b.signature)) throw new ApiError(400, "INVALID_REQUEST", "signature must be the wallet's 0x-hex signature of the challenge message");
    const name = typeof b.name === "string" && b.name.trim() ? b.name.trim() : undefined;
    if (name && !NAME.test(name)) throw new ApiError(400, "INVALID_REQUEST", "name: up to 48 letters, digits, spaces and . @ _ -");
    // Used once: claiming deletes it, so a signature can never be replayed for a second key.
    const [ch] = await db
      .delete(schema.keyChallenges)
      .where(and(eq(schema.keyChallenges.nonce, b.nonce), gt(schema.keyChallenges.expiresAt, now())))
      .returning();
    if (!ch) throw new ApiError(400, "CHALLENGE_EXPIRED", "no such sign-in challenge, or it expired or was used; ask for a new one");
    const ok = await verifyMessage({ address: ch.address as `0x${string}`, message: ch.message, signature: b.signature as `0x${string}` }).catch(() => false);
    if (!ok) throw new ApiError(401, "BAD_SIGNATURE", `the signature is not ${ch.address}'s signature of the challenge`);
    const key = newKey();
    const at = now();
    const label = name ?? `wallet ${ch.address.slice(0, 6)}…${ch.address.slice(-4)}`;
    const { id, replaced } = await db.transaction(async (tx) => {
      const old = await tx
        .update(schema.consumers)
        .set({ revokedAt: at })
        .where(and(eq(schema.consumers.wallet, ch.address), eq(schema.consumers.plan, SELF_PLAN), isNull(schema.consumers.revokedAt)))
        .returning({ id: schema.consumers.id });
      const [row] = await tx
        .insert(schema.consumers)
        .values({ name: label, kind: "agent", wallet: ch.address, apiKeyHash: sha256(key), plan: SELF_PLAN, dailyCapUusdc: config.selfServe.capUusdc })
        .returning({ id: schema.consumers.id });
      return { id: row!.id, replaced: old.length };
    });
    return c.json(
      {
        key,
        id,
        name: label,
        wallet: ch.address,
        plan: SELF_PLAN,
        dailyCapUsdc: usdc(config.selfServe.capUusdc),
        replaced: replaced > 0,
        note: "Shown once; Skein keeps only its SHA-256. Send it as Authorization: Bearer <key>. Signing in again with this wallet replaces it.",
      },
      201,
    );
  });

  /** The admin key, or a refusal. Unknown keys are rate-limited like bad partner keys. */
  const admin = async (c: Context) => {
    const auth = c.req.header("authorization") ?? "";
    const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!config.adminKeyHashes.length) throw new ApiError(403, "FORBIDDEN", "no admin key is configured (ADMIN_KEY_HASHES)");
    if (!key || !config.adminKeyHashes.includes(sha256(key))) {
      await limit(c, badAdmin, `ip:${ip(c)}`);
      throw new ApiError(401, "UNAUTHORIZED", "not an admin key");
    }
    await limit(c, adminLimit, `ip:${ip(c)}`);
  };

  app.get("/v1/admin/keys", async (c) => {
    await admin(c);
    const day = now().toISOString().slice(0, 10);
    const rows = await db.select().from(schema.consumers).orderBy(desc(schema.consumers.createdAt));
    const spent = await db
      .select({ id: schema.spendHolds.consumerId, s: sql<string>`coalesce(sum(coalesce(${schema.spendHolds.spentUusdc}, ${schema.spendHolds.reservedUusdc})), 0)` })
      .from(schema.spendHolds)
      .where(eq(schema.spendHolds.day, day))
      .groupBy(schema.spendHolds.consumerId);
    const byId = new Map(spent.map((r) => [r.id, Number(r.s)]));
    return c.json({
      selfServe: {
        enabled: config.selfServe.enabled,
        dailyCapUsdc: usdc(config.selfServe.capUusdc),
        totalDailyUsdc: usdc(config.selfServe.totalDailyUusdc),
        spentTodayUsdc: usdc(await selfServeSpentToday(service, now())),
      },
      keys: rows.map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        plan: r.plan,
        wallet: r.wallet,
        dailyCapUsdc: usdc(r.dailyCapUusdc),
        spentTodayUsdc: usdc(byId.get(r.id) ?? 0),
        seeded: r.seeded,
        revokedAt: r.revokedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  });

  const capOf = (v: unknown): number => {
    const n = typeof v === "number" ? v : Number.NaN;
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new ApiError(400, "INVALID_REQUEST", "dailyCapUsdc must be a number of USDC from 0 to 100");
    return Math.round(n * UUSDC);
  };

  app.post("/v1/admin/keys", async (c) => {
    await admin(c);
    const b = await body<{ name: string; kind: string; dailyCapUsdc: number }>(c);
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!NAME.test(name)) throw new ApiError(400, "INVALID_REQUEST", "name: 1 to 48 letters, digits, spaces and . @ _ -");
    const kind = (KINDS as readonly string[]).includes(String(b.kind)) ? (b.kind as (typeof KINDS)[number]) : "team";
    const cap = capOf(b.dailyCapUsdc ?? 2);
    const key = newKey();
    const [row] = await db.insert(schema.consumers).values({ name, kind, apiKeyHash: sha256(key), plan: "partner", dailyCapUusdc: cap }).returning();
    return c.json({ key, id: row!.id, name, kind, plan: "partner", dailyCapUsdc: usdc(cap), note: "Shown once; Skein keeps only its SHA-256. Send it to its owner privately." }, 201);
  });

  /** One key, for an admin change: never the x402 payers' shared row, and a seeded key's cap lives in SEED_CONSUMERS. */
  const editable = async (c: Context) => {
    const id = c.req.param("id") ?? "";
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new ApiError(400, "INVALID_REQUEST", "bad key id");
    const [row] = await db.select().from(schema.consumers).where(eq(schema.consumers.id, id));
    if (!row) throw new ApiError(404, "NOT_FOUND", "no such key");
    if (row.plan === "x402") throw new ApiError(409, "NOT_EDITABLE", "the x402 payers' shared row is set by X402_DAILY_CAP_USDC");
    return row;
  };

  app.post("/v1/admin/keys/:id", async (c) => {
    await admin(c);
    const row = await editable(c);
    if (row.revokedAt) throw new ApiError(409, "NOT_EDITABLE", "this key is revoked");
    if (row.seeded) throw new ApiError(409, "NOT_EDITABLE", "this key's cap is set by SEED_CONSUMERS on the API service (reapplied on every start); change it there");
    const cap = capOf((await body<{ dailyCapUsdc: number }>(c)).dailyCapUsdc);
    await db.update(schema.consumers).set({ dailyCapUusdc: cap }).where(eq(schema.consumers.id, row.id));
    return c.json({ id: row.id, dailyCapUsdc: usdc(cap) });
  });

  app.post("/v1/admin/keys/:id/revoke", async (c) => {
    await admin(c);
    const row = await editable(c);
    const at = row.revokedAt ?? now();
    if (!row.revokedAt) await db.update(schema.consumers).set({ revokedAt: at }).where(and(eq(schema.consumers.id, row.id), isNull(schema.consumers.revokedAt)));
    return c.json({ id: row.id, revokedAt: at.toISOString(), final: true });
  });
}
