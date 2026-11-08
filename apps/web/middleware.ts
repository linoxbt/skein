import { NextResponse, type NextRequest } from "next/server";

const API = (process.env.NEXT_PUBLIC_SKEIN_API ?? "http://localhost:8787").replace(/\/$/, "");

/**
 * /v/{id} for an id the API does not know is a real 404 status, decided here,
 * before rendering starts (a page-level notFound() still answers 200 once
 * Next.js streams). An id the API cannot confirm either way (slow, down)
 * loads the page as before, which reports the problem itself.
 */
export async function middleware(req: NextRequest) {
  const id = req.nextUrl.pathname.split("/")[2] ?? "";
  let missing = !/^vrd_[a-z0-9]{6,40}$/.test(id);
  if (!missing) {
    try {
      const r = await fetch(`${API}/v1/verdicts/${encodeURIComponent(id)}`, { method: "GET", signal: AbortSignal.timeout(2_500), cache: "no-store" });
      missing = r.status === 404;
    } catch {
      missing = false;
    }
  }
  if (!missing) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/verdict-not-found";
  return NextResponse.rewrite(url, { status: 404 });
}

export const config = { matcher: "/v/:id*" };
