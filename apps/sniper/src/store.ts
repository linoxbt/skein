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
  /** The verdict: bought once, when the token first had enough liquidity to trade against. */
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
  checked: number;
  dodged: number;
  bought: number;
  expired: number;
  errors: number;
  paidUsdc: number;
  listUsdc: number;
}

export interface Store {
  /** Records a new launch; false when the token was already seen. */
  add(l: Launch, at: Date): Promise<boolean>;
  save(r: TokenRecord): Promise<void>;
  byStatus(status: Status, limit: number): Promise<TokenRecord[]>;
  /** Decided tokens checked since `since`, newest first. */
  checkedSince(since: Date, limit: number): Promise<TokenRecord[]>;
  stats(since: Date): Promise<Stats>;
}

const fromLaunch = (l: Launch, at: Date): TokenRecord => ({ ...l, seenAt: at.toISOString(), status: "watching" });

function tally(rs: TokenRecord[], since: Date): Stats {
  const s: Stats = { seen: 0, checked: 0, dodged: 0, bought: 0, expired: 0, errors: 0, paidUsdc: 0, listUsdc: 0 };
  const t = since.getTime();
  for (const r of rs) {
    if (Date.parse(r.seenAt) >= t) s.seen++;
    if (r.status === "expired" && Date.parse(r.seenAt) >= t) s.expired++;
    if (r.checkedAt && Date.parse(r.checkedAt) >= t) {
      if (r.status === "error") s.errors++;
      else {
        s.checked++;
        if (r.action === "buy") s.bought++;
        else s.dodged++;
        s.paidUsdc += r.paidUsdc ?? 0;
        s.listUsdc += r.priceUsdc ?? 0;
      }
    }
  }
  s.paidUsdc = Math.round(s.paidUsdc * 1e6) / 1e6;
  s.listUsdc = Math.round(s.listUsdc * 1e6) / 1e6;
  return s;
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
  };
}

/** The same records in Postgres: one table of its own, created on start. */
export async function pgStore(databaseUrl: string): Promise<Store> {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 3 });
  await pool.query(`create table if not exists sniper_tokens (
    token text primary key,
    status text not null,
    seen_at timestamptz not null,
    checked_at timestamptz,
    rec jsonb not null
  )`);
  await pool.query("create index if not exists sniper_tokens_status on sniper_tokens (status, seen_at)");
  await pool.query("create index if not exists sniper_tokens_checked on sniper_tokens (checked_at desc)");
  const rows = (r: { rows: { rec: TokenRecord }[] }) => r.rows.map((x) => x.rec);
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
    async checkedSince(since, limit) {
      return rows(await pool.query("select rec from sniper_tokens where checked_at >= $1 order by checked_at desc limit $2", [since, limit]));
    },
    async stats(since) {
      return tally(rows(await pool.query("select rec from sniper_tokens where seen_at >= $1 or checked_at >= $1", [since])), since);
    },
  };
}
