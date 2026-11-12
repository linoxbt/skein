import { randomUUID, timingSafeEqual } from "node:crypto";
import { createReporter } from "@skein/errors";
import { NextResponse } from "next/server";

/** Error tracking: SENTRY_DSN on the Netlify site (Sentry or compatible); off when unset. */
const reporter = createReporter({ dsn: process.env.SENTRY_DSN, service: "skein-desk", release: process.env.COMMIT_REF?.slice(0, 12) });

/** The shape every Desk API error has: the same as Skein's API, request id included. */
export const errorResponse = (status: number, code: string, message: string, requestId: string = randomUUID()) =>
  NextResponse.json({ error: { code, message, requestId } }, { status, headers: { "x-request-id": requestId } });

/** True for a failure of the Desk's store (Skein's /v1/kv, Netlify Blobs, or the file store in development). */
export const isStoreFailure = (e: unknown) => e instanceof Error && /^(blobs|store) |ENOENT|EACCES|BlobsInternalError|MissingBlobsEnvironmentError/.test(`${e.name} ${e.message}`.replace(/^Error /, ""));

/**
 * Runs a route handler so a failure never reaches the client as an empty 500:
 * a store that does not answer is a 503 the page can show and retry, and
 * anything else is a JSON 500. The cause goes to the function log.
 */
export async function guarded(what: string, handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (e) {
    // One JSON line per failure, carrying the id the caller sees in the error body.
    const requestId = randomUUID();
    const store = isStoreFailure(e);
    console.error(JSON.stringify({ level: "error", msg: store ? "store unavailable" : "unhandled", route: what, requestId, error: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : String(e) }));
    // Awaited: a serverless function can be frozen as soon as it has answered.
    await reporter.capture(e, { requestId, route: what, store });
    if (store) return errorResponse(503, "STORE_UNAVAILABLE", "the desk's store did not answer; the page retries on its own", requestId);
    return errorResponse(500, "INTERNAL", "something went wrong on the desk; it has been logged", requestId);
  }
}

/** Whether the request carries `Authorization: Bearer <secret>` (false when no secret is set). */
export function bearerIs(req: Request, secret: string | undefined): boolean {
  const presented = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  return !!secret && presented.length === secret.length && timingSafeEqual(Buffer.from(presented), Buffer.from(secret));
}

/** The caller's address: Netlify sets x-nf-client-connection-ip itself, so a client cannot supply it there. */
export const clientIp = (req: Request) => req.headers.get("x-nf-client-connection-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

/**
 * A fixed-window limit per key, in this process's memory. Serverless
 * instances each keep their own, so it bounds what one caller can make one
 * instance do (each uncached read costs the store), not a global quota.
 * Returns true when the request may go ahead.
 */
export function limiter(limit: number, windowMs: number) {
  const hits = new Map<string, { n: number; until: number }>();
  return (key: string, now = Date.now()): boolean => {
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.until <= now) hits.delete(k);
    const h = hits.get(key);
    if (!h || h.until <= now) {
      hits.set(key, { n: 1, until: now + windowMs });
      return true;
    }
    return ++h.n <= limit;
  };
}

/**
 * Serves one value to every caller for `ttlMs`, with one load at a time while
 * it refreshes, so a page polled by many tabs costs the store a bounded number
 * of reads per instance however many tabs there are.
 */
export function cached<T>(ttlMs: number, load: () => Promise<T>) {
  let hit: { at: number; value: T } | null = null;
  let inflight: Promise<T> | null = null;
  return (now = Date.now()): Promise<T> => {
    if (hit && now - hit.at < ttlMs) return Promise.resolve(hit.value);
    inflight ??= load()
      .then((value) => {
        hit = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };
}
