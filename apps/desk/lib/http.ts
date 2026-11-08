import { NextResponse } from "next/server";

/** The shape every Desk API error has: the same as Skein's API. */
export const errorResponse = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status });

/** True for a failure of the Desk's store (Netlify Blobs, or the file store in development). */
export const isStoreFailure = (e: unknown) => e instanceof Error && /^blobs |ENOENT|EACCES|BlobsInternalError|MissingBlobsEnvironmentError/.test(`${e.name} ${e.message}`.replace(/^Error /, ""));

/**
 * Runs a route handler so a failure never reaches the client as an empty 500:
 * a store that does not answer is a 503 the page can show and retry, and
 * anything else is a JSON 500. The cause goes to the function log.
 */
export async function guarded(what: string, handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (e) {
    console.error(`${what}:`, e);
    if (isStoreFailure(e)) {
      return errorResponse(503, "STORE_UNAVAILABLE", "the desk's store did not answer; the page retries on its own");
    }
    return errorResponse(500, "INTERNAL", "something went wrong on the desk; it has been logged");
  }
}
