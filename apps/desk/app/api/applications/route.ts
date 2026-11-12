import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { agentReady, InputError, parseApplication, process as runAgent, receive, type ApplicationInput } from "@/lib/agent";
import { DAILY_LIMIT, deskDeps, kickBackgroundAgent, onNetlify, PER_IP_DAILY_LIMIT, payerRail } from "@/lib/desk";
import { cached, clientIp, errorResponse, guarded, limiter } from "@/lib/http";
import type { Application } from "@/lib/types";

export const dynamic = "force-dynamic";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const err = (status: number, code: string, message: string) => errorResponse(status, code, message);
/** The public view of one application: everything but the lease. */
const publicView = ({ lease: _lease, ...a }: Application) => a;

/** Reads per caller and minute, per instance: the board polls every 10 s, so a person's tabs stay far below it. */
const reads = limiter(60, 60_000);
/** The board, shared by every caller for a few seconds: two store reads per instance per BOARD_TTL_MS, however many tabs poll. */
const BOARD_TTL_MS = 5_000;
const board = cached(BOARD_TTL_MS, async () => {
  const deps = await deskDeps();
  const lastError = (await deps.store.kv.get<{ at: string; code: string }>("agent/last_error"))?.value ?? null;
  const recentError = lastError && Date.now() - Date.parse(lastError.at) < 15 * 60_000 ? lastError : null;
  return {
    agent: !agentReady(deps) ? "offline" : recentError ? "misconfigured" : "online",
    rail: payerRail(),
    ...(recentError ? { lastError: recentError } : {}),
    applications: await deps.store.list(),
  };
});

/**
 * The board (no ?id) or one application (?id=). Read-only: polling never
 * starts work; the agent runs on intake and on the minute's tick.
 */
export async function GET(req: Request) {
  return guarded("GET /api/applications", () => read(req));
}

async function read(req: Request): Promise<Response> {
  if (!reads(createHash("sha256").update(clientIp(req)).digest("hex"))) {
    return NextResponse.json({ error: { code: "RATE_LIMITED", message: "too many requests; the board refreshes on its own every few seconds" } }, { status: 429, headers: { "retry-after": "30" } });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    if (!/^app_[a-z0-9]{6,32}$/.test(id)) return err(400, "INVALID_REQUEST", "bad application id");
    const a = await (await deskDeps()).store.get(id);
    return a ? NextResponse.json(publicView(a.value)) : err(404, "NOT_FOUND", "no such application");
  }
  // The CDN may serve the board for a few seconds too; browsers always ask again.
  return NextResponse.json(await board(), {
    headers: { "cache-control": "public, max-age=0, must-revalidate", "netlify-cdn-cache-control": `public, s-maxage=${BOARD_TTL_MS / 1000}, stale-while-revalidate=10` },
  });
}

/**
 * A new application, from the form or a webhook (header x-desk-webhook-secret).
 * The form is limited per visitor and per day, atomically. On the partner-key
 * rail the agent starts at once under a lease and waits a few seconds for the
 * verdict. A Telegraph ask is never made here on Netlify: a request function
 * can be stopped mid-ask, after paying. The background agent makes it
 * instead (kicked now, and by the minute's tick in any case).
 */
export async function POST(req: Request) {
  return guarded("POST /api/applications", () => apply(req));
}

async function apply(req: Request): Promise<Response> {
  const secret = process.env.DESK_WEBHOOK_SECRET;
  const presented = req.headers.get("x-desk-webhook-secret");
  if (presented && !(secret && same(presented, secret))) return err(401, "UNAUTHORIZED", "bad webhook secret");
  const source = presented ? "webhook" : "form";

  const body = (await req.json().catch(() => null)) as (ApplicationInput & { website?: unknown }) | null;
  if (!body) return err(400, "INVALID_REQUEST", "send JSON");
  // A field no person sees: bots fill it.
  if (source === "form" && typeof body.website === "string" && body.website !== "") return err(400, "INVALID_REQUEST", "rejected");
  try {
    parseApplication(body);
  } catch (e) {
    if (e instanceof InputError) return err(400, "INVALID_REQUEST", e.message);
    throw e;
  }

  const deps = await deskDeps({ waitMs: 8_000 });
  if (source === "form") {
    const day = new Date().toISOString().slice(0, 10);
    const who = createHash("sha256").update(clientIp(req)).digest("hex").slice(0, 24);
    if (!(await deps.store.take(`ip/${day}/${who}`, PER_IP_DAILY_LIMIT))) return err(429, "RATE_LIMITED", `at most ${PER_IP_DAILY_LIMIT} applications a day from one address`);
    if (!(await deps.store.take(`day/${day}`, DAILY_LIMIT))) return err(429, "RATE_LIMITED", "the desk has taken all the applications it can today; try tomorrow");
  }
  const app = await receive(deps, body, source);
  if (deps.rail === "telegraph" && onNetlify()) {
    await kickBackgroundAgent(new URL(req.url).origin);
    return NextResponse.json(publicView(app), { status: 201 });
  }
  const out = (await runAgent(deps, app.id).catch((e) => (console.error(`agent on ${app.id}:`, e), null))) ?? app;
  return NextResponse.json(publicView(out), { status: 201 });
}
