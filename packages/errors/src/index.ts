/**
 * Error reporting for Skein's services, to Sentry or any service that speaks
 * Sentry's envelope API (GlitchTip, self-hosted Sentry). Dependency-free: it
 * posts the event itself with fetch, so it runs in Node, Netlify functions and
 * edge runtimes alike. Without a DSN it does nothing.
 *
 *   const errors = createReporter({ dsn: process.env.SENTRY_DSN, service: "skein-api" });
 *   errors.capture(err, { requestId, route: "POST /v1/verdicts" });
 *
 * Reporting never throws and never blocks the caller for long: each send has
 * a 3 s timeout, identical errors are sent at most once a minute, and at most
 * 30 events leave a process per minute. Messages and context are cut short
 * (an upstream error often quotes a whole response body).
 */
export interface ReporterOptions {
  /** https://<publicKey>@<host>/<projectId>; unset or empty disables reporting. */
  dsn?: string | undefined;
  service: string;
  environment?: string;
  release?: string;
  fetch?: typeof fetch;
  now?: () => number;
}

export interface Reporter {
  readonly enabled: boolean;
  /** Reports an error with optional context (tags must be short strings). Resolves true when sent. */
  capture(error: unknown, context?: Record<string, string | number | boolean | null | undefined>): Promise<boolean>;
}

interface ParsedDsn {
  envelopeUrl: string;
  publicKey: string;
  dsn: string;
}

export function parseDsn(dsn: string | undefined): ParsedDsn | null {
  if (!dsn) return null;
  let u: URL;
  try {
    u = new URL(dsn);
  } catch {
    return null;
  }
  const projectId = u.pathname.replace(/^\/+|\/+$/g, "").split("/").pop();
  if (!u.username || !projectId || !/^\d+$/.test(projectId) || (u.protocol !== "https:" && u.protocol !== "http:")) return null;
  const prefix = u.pathname.replace(/\/?[^/]*\/?$/, "");
  return { envelopeUrl: `${u.protocol}//${u.host}${prefix}/api/${projectId}/envelope/`, publicKey: u.username, dsn };
}

/** The longest error message and context value sent; longer ones are cut, marked with an ellipsis. */
export const MAX_MESSAGE = 500;
export const MAX_EXTRA = 1_000;

/** Cuts a string to `max` characters, marking the cut. */
export function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}… (${s.length - max} more chars)`;
}

/** Any thrown value as an Error, without throwing (circular objects, BigInts, throwing getters). */
function asError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  try {
    return new Error(JSON.stringify(error) ?? String(error));
  } catch {
    try {
      return new Error(String(error));
    } catch {
      return new Error("unprintable error value");
    }
  }
}

const hex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");

/** A stack trace as Sentry frames (innermost last), from a V8 stack string. */
export function framesOf(stack: string | undefined): { function?: string; filename?: string; lineno?: number; colno?: number }[] {
  if (!stack) return [];
  const frames = [];
  for (const line of stack.split("\n").slice(1, 40)) {
    const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
    if (!m) continue;
    frames.push({ ...(m[1] ? { function: m[1] } : {}), filename: m[2]!, lineno: Number(m[3]), colno: Number(m[4]) });
  }
  return frames.reverse();
}

export function createReporter(opts: ReporterOptions): Reporter {
  const parsed = parseDsn(opts.dsn);
  const now = opts.now ?? Date.now;
  const seen = new Map<string, number>();
  let windowStart = 0;
  let sentInWindow = 0;
  return {
    enabled: parsed !== null,
    async capture(error, context = {}) {
      if (!parsed) return false;
      try {
        return await send(error, context);
      } catch {
        return false;
      }
    },
  };

  async function send(error: unknown, context: Record<string, string | number | boolean | null | undefined>): Promise<boolean> {
    if (!parsed) return false;
    const err = asError(error);
    const message = clip(String(err.message ?? ""), MAX_MESSAGE);
    const t = now();
    const fingerprint = `${err.name}:${message}`.slice(0, 300);
    if ((seen.get(fingerprint) ?? -Infinity) > t - 60_000) return false;
    if (t - windowStart > 60_000) {
      windowStart = t;
      sentInWindow = 0;
    }
    if (sentInWindow >= 30) return false;
    seen.set(fingerprint, t);
    if (seen.size > 500) seen.delete(seen.keys().next().value!);
    sentInWindow++;

    const eventId = hex(16);
    const tags: Record<string, string> = { service: opts.service };
    const extra: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(context ?? {})) {
      if (v === undefined) continue;
      if (typeof v === "string" && v.length <= 200) tags[k] = v;
      else extra[k] = typeof v === "string" ? clip(v, MAX_EXTRA) : v;
    }
    const event = {
      event_id: eventId,
      timestamp: t / 1000,
      platform: "node",
      level: "error",
      logger: opts.service,
      server_name: opts.service,
      environment: opts.environment ?? "production",
      ...(opts.release ? { release: opts.release } : {}),
      tags,
      extra,
      exception: { values: [{ type: String(err.name), value: message, stacktrace: { frames: framesOf(typeof err.stack === "string" ? err.stack : undefined) } }] },
    };
    const body = [
      JSON.stringify({ event_id: eventId, sent_at: new Date(t).toISOString(), dsn: parsed.dsn }),
      JSON.stringify({ type: "event", content_type: "application/json" }),
      JSON.stringify(event),
    ].join("\n");
    try {
      const res = await (opts.fetch ?? fetch)(parsed.envelopeUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-sentry-envelope",
          "x-sentry-auth": `Sentry sentry_version=7, sentry_client=skein-errors/0.1.0, sentry_key=${parsed.publicKey}`,
        },
        body,
        signal: AbortSignal.timeout(3_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
