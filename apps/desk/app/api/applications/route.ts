import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { InputError, parseApplication, process as runAgent, receive, type ApplicationInput } from "@/lib/agent";
import { DAILY_LIMIT, deskDeps, PER_IP_DAILY_LIMIT, payerRail } from "@/lib/desk";
import { guarded } from "@/lib/http";
import type { Application } from "@/lib/types";

export const dynamic = "force-dynamic";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const err = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status });
/** The public view of one application: everything but the lease. */
const publicView = ({ lease: _lease, ...a }: Application) => a;

/**
 * The board (no ?id) or one application (?id=). Read-only: polling never
 * starts work; the agent runs on intake and on the minute's tick.
 */
export async function GET(req: Request) {
  return guarded("GET /api/applications", () => board(req));
}

async function board(req: Request): Promise<Response> {
  const deps = await deskDeps();
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    if (!/^app_[a-z0-9]{6,32}$/.test(id)) return err(400, "INVALID_REQUEST", "bad application id");
    const a = await deps.store.get(id);
    return a ? NextResponse.json(publicView(a.value)) : err(404, "NOT_FOUND", "no such application");
  }
  const lastError = (await deps.store.kv.get<{ at: string; code: string }>("agent/last_error"))?.value ?? null;
  const recentError = lastError && Date.now() - Date.parse(lastError.at) < 15 * 60_000 ? lastError : null;
  return NextResponse.json({
    agent: !deps.skein ? "offline" : recentError ? "misconfigured" : "online",
    rail: payerRail(),
    ...(recentError ? { lastError: recentError } : {}),
    applications: await deps.store.list(),
  });
}

/**
 * A new application, from the form or a webhook (header x-desk-webhook-secret).
 * The form is limited per visitor and per day, atomically; the agent starts
 * at once under a lease and waits a few seconds for the verdict, and the
 * minute's tick decides anything still open.
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
    // Netlify sets x-nf-client-connection-ip itself; it cannot be supplied by the client.
    const ip = req.headers.get("x-nf-client-connection-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const who = createHash("sha256").update(ip).digest("hex").slice(0, 24);
    if (!(await deps.store.take(`ip/${day}/${who}`, PER_IP_DAILY_LIMIT))) return err(429, "RATE_LIMITED", `at most ${PER_IP_DAILY_LIMIT} applications a day from one address`);
    if (!(await deps.store.take(`day/${day}`, DAILY_LIMIT))) return err(429, "RATE_LIMITED", "the desk has taken all the applications it can today; try tomorrow");
  }
  const app = await receive(deps, body, source);
  const out = (await runAgent(deps, app.id).catch((e) => (console.error(`agent on ${app.id}:`, e), null))) ?? app;
  return NextResponse.json(publicView(out), { status: 201 });
}

