import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { InputError, process as runAgent, receive, tick } from "@/lib/agent";
import { DAILY_LIMIT, deskDeps } from "@/lib/desk";

export const dynamic = "force-dynamic";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The board: every application, newest first. Settles open ones briefly first, so watching the board moves the queue. */
export async function GET() {
  const deps = await deskDeps({ waitMs: 1_500 });
  if (deps.skein) await tick(deps, 4_000).catch(() => null);
  const apps = await deps.store.list();
  return NextResponse.json({ agent: deps.skein ? "online" : "offline", applications: apps });
}

/**
 * A new application, from the form or a webhook (header x-desk-webhook-secret).
 * The agent starts on it at once and waits a few seconds for the verdict; if
 * it is not sealed by then, the next tick decides it.
 */
export async function POST(req: Request) {
  const secret = process.env.DESK_WEBHOOK_SECRET;
  const presented = req.headers.get("x-desk-webhook-secret");
  if (presented && !(secret && same(presented, secret))) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "bad webhook secret" } }, { status: 401 });
  const source = presented ? "webhook" : "form";

  const deps = await deskDeps({ waitMs: 8_000 });
  const today = new Date().toISOString().slice(0, 10);
  if (source === "form" && (await deps.store.list()).filter((a) => a.receivedAt.startsWith(today)).length >= DAILY_LIMIT) {
    return NextResponse.json({ error: { code: "RATE_LIMITED", message: "the desk takes a limited number of applications a day; try tomorrow" } }, { status: 429 });
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "send JSON" } }, { status: 400 });
  try {
    const app = await receive(deps, body as never, source);
    const out = (await runAgent(deps, app.id)) ?? app;
    return NextResponse.json(out, { status: 201 });
  } catch (e) {
    if (e instanceof InputError) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: e.message } }, { status: 400 });
    throw e;
  }
}
