import { NextResponse, type NextRequest } from "next/server";

const API = (process.env.NEXT_PUBLIC_SKEIN_API ?? "http://localhost:8787").replace(/\/$/, "");

/** The request header that carries the verdict's title fields to the layout (app/v/[id]/layout.tsx). */
const META_HEADER = "x-skein-verdict-meta";

/**
 * /v/{id} for an id the API does not know is a real 404 status, decided here,
 * before rendering starts (a page-level notFound() still answers 200 once
 * Next.js streams, and so does a rewrite on Netlify). An id the API cannot confirm either way (slow, down)
 * loads the page as before, which reports the problem itself.
 *
 * The lookup's answer goes on to the layout in a request header, so the
 * page's metadata needs no second request to the API.
 */
export async function middleware(req: NextRequest) {
  const id = req.nextUrl.pathname.split("/")[2] ?? "";
  let missing = !/^vrd_[a-z0-9]{6,40}$/.test(id);
  let meta: string | null = null;
  if (!missing) {
    try {
      const r = await fetch(`${API}/v1/verdicts/${encodeURIComponent(id)}`, { method: "GET", signal: AbortSignal.timeout(2_500), cache: "no-store" });
      missing = r.status === 404;
      if (r.ok) {
        const v = (await r.json()) as { verdict?: string; summary?: string; subject?: { chainId: number; token: string } };
        if (v.verdict && v.subject) meta = encodeURIComponent(JSON.stringify({ verdict: v.verdict, summary: (v.summary ?? "").slice(0, 300), subject: v.subject }));
      }
    } catch {
      missing = false;
    }
  }
  if (!missing) {
    // Only this middleware sets the header: whatever a client sent is dropped.
    const headers = new Headers(req.headers);
    headers.delete(META_HEADER);
    if (meta) headers.set(META_HEADER, meta);
    return NextResponse.next({ request: { headers } });
  }
  // Serve the not-found page's HTML with a 404 status. A rewrite carrying the
  // status is not enough: Netlify's Next.js runtime answers a rewrite with 200.
  try {
    const page = await fetch(new URL("/verdict-not-found", req.nextUrl.origin), { signal: AbortSignal.timeout(4_000) });
    const headers = new Headers(page.headers);
    for (const h of ["content-length", "content-encoding", "transfer-encoding"]) headers.delete(h);
    headers.set("cache-control", "no-store");
    return new NextResponse(page.body, { status: 404, headers });
  } catch {
    return new NextResponse("Verdict not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}

export const config = { matcher: "/v/:id*" };
