import type { Launch } from "./watch";

export type Status = "watching" | "checking" | "decided" | "expired" | "error";

/** Everything the sniper knows about one launched token. */
export interface TokenRecord {
  token: string;
  dex: string;
  pool: string | null;
  block: number;
  tx: string;
  seenAt: string;
  status: Status;
  symbol?: string | null;
  name?: string | null;
  marketUrl?: string | null;
  liquidityUsd?: number | null;
  /**
   * The verdict: bought once, when the token first had enough liquidity to trade
   * against. checkedAt is set when the check is claimed, so a check in flight
   * counts against the daily caps.
   */
  checkedAt?: string | null;
  ageAtCheckMin?: number | null;
  verdict?: string | null;
  verdictId?: string | null;
  action?: "buy" | "skip" | null;
  summary?: string | null;
  reasons?: string[];
  riskBps?: number | null;
  /** Skein's price for the verdict, and what the sniper actually paid (0 on a free partner key). */
  priceUsdc?: number | null;
  paidUsdc?: number | null;
  upstreamUsdc?: number | null;
  receipts?: number | null;
  rail?: string | null;
  receiptHash?: string | null;
  verdictHash?: string | null;
  signatureOk?: boolean | null;
  /** The verdict is about this token on Base, under the sniper's policy. */
  subjectOk?: boolean | null;
  latencyMs?: number | null;
  /** The paper position: entry price at the check, and the latest price. */
  priceAtCheck?: number | null;
  /** Liquidity when the verdict was bought; liquidityUsd is refreshed on every re-price. */
  liquidityAtCheck?: number | null;
  priceNow?: number | null;
  priceAt?: string | null;
  note?: string | null;
}

export interface Stats {
  seen: number;
  /** Verdicts bought and decided. */
  checked: number;
  dodged: number;
  bought: number;
  expired: number;
  /** Checks that ended without a usable verdict (refused, failed, or paid and unusable). */
  errors: number;
  /** Checks claimed and not finished yet. */
  inFlight: number;
  /** Money that moved: decided and error rows alike. */
  paidUsdc: number;
  listUsdc: number;
}

/** What one claim may use of the day: checks, USDC, and what one check in flight reserves. */
export interface ClaimLimits {
  since: Date;
  maxChecks: number;
  maxUsdc: number;
  reserveUsdc: number;
}

export type ClaimResult = "claimed" | "taken" | "cap";

export interface Store {
  /** Records a new launch; false when the token was already seen. */
  add(l: Launch, at: Date): Promise<boolean>;
  save(r: TokenRecord): Promise<void>;
  byStatus(status: Status, limit: number): Promise<TokenRecord[]>;
  count(status: Status): Promise<number>;
  /** Decided tokens checked since `since`, newest first. */
  checkedSince(since: Date, limit: number): Promise<TokenRecord[]>;
  stats(since: Date): Promise<Stats>;
  /**
   * Atomically moves a watched token to "checking" (as `r`, with checkedAt set),
   * if the day's checks (decided, error and in flight) and USDC (paid, plus
   * reserveUsdc per check in flight) leave room for one more. "taken": another
   * replica (or tick) has it; "cap": no room today.
   */
  claim(r: TokenRecord, limits: ClaimLimits): Promise<ClaimResult>;
}

const fromLaunch = (l: Launch, at: Date): TokenRecord => ({ ...l, seenAt: at.toISOString(), status: "watching" });
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
const spent = (s: Stats) => s.checked + s.errors + s.inFlight;

function tally(rs: TokenRecord[], since: Date): Stats {
  const s: Stats = { seen: 0, checked: 0, dodged: 0, bought: 0, expired: 0, errors: 0, inFlight: 0, paidUsdc: 0, listUsdc: 0 };
  const t = since.getTime();
  for (const r of rs) {
    if (Date.parse(r.seenAt) >= t) s.seen++;
    if (r.status === "expired" && Date.parse(r.seenAt) >= t) s.expired++;
    if (r.checkedAt && Date.parse(r.checkedAt) >= t) {
      if (r.status === "checking") s.inFlight++;
      else if (r.status === "error") {
        s.errors++;
        s.paidUsdc += r.paidUsdc ?? 0;
      } else if (r.status === "decided") {
        s.checked++;
        if (r.action === "buy") s.bought++;
        else s.dodged++;
        s.paidUsdc += r.paidUsdc ?? 0;
        s.listUsdc += r.priceUsdc ?? 0;
      }
    }
  }
  s.paidUsdc = round6(s.paidUsdc);
  s.listUsdc = round6(s.listUsdc);
  return s;
}

/** Room for one more check under the limits, given the day's stats. */
export function room(s: Stats, l: ClaimLimits): boolean {
  return spent(s) < l.maxChecks && s.paidUsdc + (s.inFlight + 1) * l.reserveUsdc <= l.maxUsdc + 1e-9;
}

export function memoryStore(): Store {
  const m = new Map<string, TokenRecord>();
  return {
    async add(l, at) {
      if (m.has(l.token)) return false;
      m.set(l.token, fromLaunch(l, at));
      return true;
    },
    async save(r) {
      m.set(r.token, structuredClone(r));
    },
    async byStatus(status, limit) {
      return [...m.values()].filter((r) => r.status === status).sort((a, b) => a.seenAt.localeCompare(b.seenAt)).slice(0, limit).map((r) => structuredClone(r));
    },
    async count(status) {
      return [...m.values()].filter((r) => r.status === status).length;
    },
    async checkedSince(since, limit) {
      return [...m.values()]
        .filter((r) => r.checkedAt && Date.parse(r.checkedAt) >= since.getTime())
        .sort((a, b) => b.checkedAt!.localeCompare(a.checkedAt!))
        .slice(0, limit)
        .map((r) => structuredClone(r));
    },
    async stats(since) {
      return tally([...m.values()], since);
    },
    async claim(r, limits) {
      // Synchronous from here to the write: nothing else runs in between.
      if (m.get(r.token)?.status !== "watching") return "taken";
      if (!room(tally([...m.values()], limits.since), limits)) return "cap";
      m.set(r.token, structuredClone({ ...r, status: "checking" as const }));
      return "claimed";
    },
  };
}

/** What the Postgres store needs of a pg.Pool (tests pass PGlite behind the same shape). */
export interface PgLike {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
  connect(): Promise<{ query: PgLike["query"]; release(): void }>;
}

/** The same records in Postgres: one table of its own, created on start. */
export async function pgStore(databaseUrl: string): Promise<Store> {
  const { default: pg } = await import("pg");
  return pgStoreOn(new pg.Pool({ connectionString: databaseUrl, max: 3 }));
}

export async function pgStoreOn(pool: PgLike): Promise<Store> {
  try {
    await pool.query(`create table if not exists sniper_tokens (
      token text primary key,
      status text not null,
      seen_at timestamptz not null,
      checked_at timestamptz,
      rec jsonb not null
    )`);
    await pool.query("create index if not exists sniper_tokens_status on sniper_tokens (status, seen_at)");
    await pool.query("create index if not exists sniper_tokens_checked on sniper_tokens (checked_at desc)");
  } catch (e) {
    // In production the sniper runs as skein_sniper, which may use its table but not create it
    // (insufficient_privilege, 42501): carry on when the table is already there.
    if ((e as { code?: string }).code !== "42501") throw e;
    await pool.query("select 1 from sniper_tokens limit 1");
  }
  const rows = (r: { rows: { rec: TokenRecord }[] }) => r.rows.map((x) => x.rec);
  // The tallies in SQL: the feed no longer loads every row to count them in JS.
  const STATS = `select
      count(*) filter (where seen_at >= $1) as seen,
      count(*) filter (where status = 'expired' and seen_at >= $1) as expired,
      count(*) filter (where status = 'decided' and checked_at >= $1) as checked,
      count(*) filter (where status = 'decided' and checked_at >= $1 and rec->>'action' = 'buy') as bought,
      count(*) filter (where status = 'error' and checked_at >= $1) as errors,
      count(*) filter (where status = 'checking' and checked_at >= $1) as in_flight,
      coalesce(sum((rec->>'paidUsdc')::numeric) filter (where status in ('decided', 'error') and checked_at >= $1), 0) as paid,
      coalesce(sum((rec->>'priceUsdc')::numeric) filter (where status = 'decided' and checked_at >= $1), 0) as list
    from sniper_tokens where seen_at >= $1 or checked_at >= $1`;
  const toStats = (r: Record<string, string | number>): Stats => {
    const n = (k: string) => Number(r[k] ?? 0);
    return {
      seen: n("seen"), checked: n("checked"), dodged: n("checked") - n("bought"), bought: n("bought"), expired: n("expired"),
      errors: n("errors"), inFlight: n("in_flight"), paidUsdc: round6(n("paid")), listUsdc: round6(n("list")),
    };
  };
  return {
    async add(l, at) {
      const rec = fromLaunch(l, at);
      const r = await pool.query("insert into sniper_tokens (token, status, seen_at, rec) values ($1, $2, $3, $4) on conflict (token) do nothing", [rec.token, rec.status, rec.seenAt, rec]);
      return (r.rowCount ?? 0) > 0;
    },
    async save(rec) {
      await pool.query("update sniper_tokens set status = $2, checked_at = $3, rec = $4 where token = $1", [rec.token, rec.status, rec.checkedAt ?? null, rec]);
    },
    async byStatus(status, limit) {
      return rows(await pool.query("select rec from sniper_tokens where status = $1 order by seen_at limit $2", [status, limit]));
    },
    async count(status) {
      return Number((await pool.query("select count(*) as n from sniper_tokens where status = $1", [status])).rows[0]?.n ?? 0);
    },
    async checkedSince(since, limit) {
      return rows(await pool.query("select rec from sniper_tokens where checked_at >= $1 order by checked_at desc limit $2", [since, limit]));
    },
    async stats(since) {
      return toStats((await pool.query(STATS, [since])).rows[0] ?? {});
    },
    async claim(r, limits) {
      // One claim at a time across replicas (a transaction-scoped advisory lock),
      // so two replicas can neither take the same token nor pass the caps together.
      const c = await pool.connect();
      try {
        await c.query("begin");
        await c.query("select pg_advisory_xact_lock(hashtext('sniper_tokens.claim'))");
        const s = toStats((await c.query(STATS, [limits.since])).rows[0] ?? {});
        if (!room(s, limits)) {
          await c.query("rollback");
          return "cap";
        }
        const rec = { ...r, status: "checking" as const };
        const u = await c.query("update sniper_tokens set status = 'checking', checked_at = $2, rec = $3 where token = $1 and status = 'watching'", [r.token, rec.checkedAt ?? new Date().toISOString(), rec]);
        await c.query("commit");
        return (u.rowCount ?? 0) > 0 ? "claimed" : "taken";
      } catch (e) {
        await c.query("rollback").catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
  };
}
