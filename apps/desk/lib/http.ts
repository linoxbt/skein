import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

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
    if (store) return errorResponse(503, "STORE_UNAVAILABLE", "the desk's store did not answer; the page retries on its own", requestId);
    return errorResponse(500, "INTERNAL", "something went wrong on the desk; it has been logged", requestId);
  }
}
