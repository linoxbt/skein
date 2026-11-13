/**
 * Operational alerts for every Skein process (API replicas, the probe).
 *
 * Delivery: ALERT_WEBHOOK_URL holds one or more comma-separated destinations.
 * An ntfy topic (https://ntfy.sh/<topic>: push to a phone with no account), a
 * Slack incoming webhook, a Discord webhook, or any URL that takes JSON.
 *
 * Deduplication: alert state lives in Postgres (table alert_state), so two
 * API replicas and the probe agree on what is already failing. An alert is
 * sent when a condition starts, repeated at most once per `repeatMs` while it
 * lasts, and followed by one "recovered" message when it clears.
 */

export type Level = "failing" | "recovered" | "info";
export interface Alert {
  key: string;
  title: string;
  message: string;
  level: Level;
}

type Fetch = typeof fetch;
/** A Postgres client: pg.Pool and PGlite both fit. */
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export const parseDestinations = (raw: string | undefined): string[] =>
  (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^https:\/\//.test(s));

export type Kind = "ntfy" | "slack" | "discord" | "json";
export function kindOf(url: string): Kind {
  const host = new URL(url).hostname;
  if (host === "ntfy.sh" || host.startsWith("ntfy.")) return "ntfy";
  if (host === "hooks.slack.com") return "slack";
  if (host === "discord.com" || host === "discordapp.com" || host.endsWith(".discord.com")) return "discord";
  return "json";
}

const EMOJI: Record<Level, string> = { failing: "🔴", recovered: "✅", info: "ℹ️" };

/** The longest alert text sent (an upstream error often quotes a whole response body). */
export const MAX_ALERT_MESSAGE = 1_500;
const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max)}… (${s.length - max} more chars)`);

/** One request per destination; never throws, returns how many were delivered. */
export async function deliver(destinations: string[], a: Alert, f: Fetch = fetch): Promise<number> {
  let ok = 0;
  const logFailure = (detail: Record<string, unknown>) => {
    try {
      console.error(JSON.stringify({ level: "error", msg: "alert not delivered", key: String(a?.key).slice(0, 200), ...detail }));
    } catch {
      // Logging must not throw either.
    }
  };
  try {
    const title = clip(String(a.title), 200);
    const message = clip(String(a.message), MAX_ALERT_MESSAGE);
    await Promise.all(
      destinations.map(async (url) => {
        try {
          const kind = kindOf(url);
          const text = `${EMOJI[a.level] ?? ""} ${title}: ${message}`;
          const init: RequestInit =
            kind === "ntfy"
              ? {
                  method: "POST",
                  headers: {
                    Title: `${a.level === "failing" ? "Skein alert" : a.level === "recovered" ? "Skein recovered" : "Skein"}: ${title}`.slice(0, 200),
                    Priority: a.level === "failing" ? "high" : "default",
                    Tags: a.level === "failing" ? "rotating_light" : a.level === "recovered" ? "white_check_mark" : "information_source",
                  },
                  body: message,
                }
              : {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(kind === "slack" ? { text } : kind === "discord" ? { content: text } : { text, content: text, key: a.key, level: a.level }),
                };
          const res = await f(url, { ...init, signal: AbortSignal.timeout(5_000) });
          if (res.ok) ok += 1;
          else logFailure({ kind, status: res.status });
        } catch (e) {
          logFailure({ error: clip(String((e as Error)?.message ?? e), 300) });
        }
      }),
    );
  } catch (e) {
    logFailure({ error: clip(String((e as Error)?.message ?? e), 300) });
  }
  return ok;
}

/**
 * Shared state in Postgres. `start` returns true when this caller should send
 * now (the condition is new, or the last message is older than repeatMs).
 * `stop` returns true when the condition was failing, so a recovery is due.
 * Both are single statements, so concurrent callers never both send.
 */
export class SharedAlertState {
  constructor(private readonly db: Queryable) {}

  async start(key: string, repeatMs: number, detail: string): Promise<boolean> {
    const r = await this.db.query(
      `INSERT INTO alert_state (key, failing, since, last_sent, detail) VALUES ($1, true, now(), now(), $3)
       ON CONFLICT (key) DO UPDATE SET
         failing = true,
         since = CASE WHEN alert_state.failing THEN alert_state.since ELSE now() END,
         last_sent = now(),
         detail = EXCLUDED.detail
       WHERE NOT alert_state.failing OR alert_state.last_sent < now() - ($2 * interval '1 millisecond')
       RETURNING key`,
      [key, repeatMs, detail.slice(0, 1000)],
    );
    return r.rows.length > 0;
  }

  async stop(key: string): Promise<boolean> {
    const r = await this.db.query(`UPDATE alert_state SET failing = false, detail = null WHERE key = $1 AND failing RETURNING key`, [key]);
    return r.rows.length > 0;
  }

  async failing(): Promise<{ key: string; since: string; detail: string | null }[]> {
    const r = await this.db.query(`SELECT key, since, detail FROM alert_state WHERE failing ORDER BY since`);
    return r.rows.map((x) => ({ key: String(x.key), since: new Date(x.since as string).toISOString(), detail: (x.detail as string | null) ?? null }));
  }
}

/** Records that a scheduled job ran (heartbeats table), for the probe and /v1/status. */
export async function beat(db: Queryable, name: string, detail = ""): Promise<void> {
  await db.query(
    `INSERT INTO heartbeats (name, at, detail) VALUES ($1, now(), $2) ON CONFLICT (name) DO UPDATE SET at = EXCLUDED.at, detail = EXCLUDED.detail`,
    [name, detail.slice(0, 500)],
  );
}

export async function lastBeat(db: Queryable, name: string): Promise<Date | null> {
  const r = await db.query(`SELECT at FROM heartbeats WHERE name = $1`, [name]);
  return r.rows[0] ? new Date(r.rows[0].at as string) : null;
}

/**
 * The alerting front door: raise/clear by key. With a database the state is
 * shared; without one (tests, a single process) it is kept in memory.
 */
export class Alerter {
  private memory = new Map<string, number>();
  private readonly destinations: string[];
  private readonly state?: SharedAlertState;

  constructor(
    private readonly opts: { url?: string; service: string; repeatMs?: number; db?: Queryable; fetch?: Fetch; now?: () => number } ,
  ) {
    this.destinations = parseDestinations(opts.url);
    if (opts.db) this.state = new SharedAlertState(opts.db);
  }

  get configured(): boolean {
    return this.destinations.length > 0;
  }

  /** The condition holds. True when a message went out (or was logged) now. */
  async raise(key: string, message: string): Promise<boolean> {
    const repeat = this.opts.repeatMs ?? 6 * 3_600_000;
    let send: boolean;
    if (this.state) {
      send = await this.state.start(key, repeat, message).catch((e: Error) => {
        console.error(JSON.stringify({ level: "error", msg: "alert state unavailable", key, error: e.message }));
        return this.memoryStart(key, repeat);
      });
    } else send = this.memoryStart(key, repeat);
    if (!send) return false;
    console.warn(JSON.stringify({ level: "warn", msg: "alert", key, alert: message }));
    await deliver(this.destinations, { key, title: `${this.opts.service} · ${key}`, message, level: "failing" }, this.opts.fetch);
    return true;
  }

  /** The condition is over. Sends one recovery message if it had been raised. */
  async clear(key: string, message = "back to normal"): Promise<boolean> {
    let was: boolean;
    if (this.state) was = await this.state.stop(key).catch(() => this.memory.delete(key));
    else was = this.memory.delete(key);
    if (this.state) this.memory.delete(key);
    if (!was) return false;
    console.log(JSON.stringify({ level: "info", msg: "alert cleared", key }));
    await deliver(this.destinations, { key, title: `${this.opts.service} · ${key}`, message, level: "recovered" }, this.opts.fetch);
    return true;
  }

  private memoryStart(key: string, repeat: number): boolean {
    const now = (this.opts.now ?? Date.now)();
    const prev = this.memory.get(key);
    if (prev !== undefined && now - prev < repeat) return false;
    this.memory.set(key, now);
    return true;
  }
}
