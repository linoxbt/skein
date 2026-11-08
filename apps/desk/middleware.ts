import { NextResponse, type NextRequest } from "next/server";

/**
 * /a/{id} (and its memo) for an application the Desk does not have is a real
 * 404 status, decided before rendering (the page itself is client-rendered and
 * would answer 200). The check asks the Desk's own API; if that cannot answer,
 * the page loads as before and reports the problem itself.
 */
export async function middleware(req: NextRequest) {
  const id = req.nextUrl.pathname.split("/")[2] ?? "";
  let missing = !/^app_[a-z0-9]{6,32}$/.test(id);
  if (!missing) {
    try {
      const r = await fetch(new URL(`/api/applications?id=${encodeURIComponent(id)}`, req.nextUrl.origin), { signal: AbortSignal.timeout(4_000), cache: "no-store" });
      missing = r.status === 404;
    } catch {
      missing = false;
    }
  }
  if (!missing) return NextResponse.next();
  // The not-found page's HTML with a 404 status (a rewrite answers 200 on Netlify).
  try {
    const page = await fetch(new URL("/application-not-found", req.nextUrl.origin), { signal: AbortSignal.timeout(4_000) });
    const headers = new Headers(page.headers);
    for (const h of ["content-length", "content-encoding", "transfer-encoding"]) headers.delete(h);
    headers.set("cache-control", "no-store");
    return new NextResponse(page.body, { status: 404, headers });
  } catch {
    return new NextResponse("Application not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}

export const config = { matcher: "/a/:id*" };
