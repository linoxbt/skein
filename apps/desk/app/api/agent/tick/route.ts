import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { tick } from "@/lib/agent";
import { deskDeps } from "@/lib/desk";

export const dynamic = "force-dynamic";

/** Called every minute by the scheduled function (netlify/functions/desk-tick.mts). */
export async function POST(req: Request) {
  const secret = process.env.DESK_CRON_SECRET;
  const presented = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || presented.length !== secret.length || !timingSafeEqual(Buffer.from(presented), Buffer.from(secret))) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "bad cron secret" } }, { status: 401 });
  }
  const deps = await deskDeps({ waitMs: 5_000 });
  if (!deps.skein) return NextResponse.json({ agent: "offline" });
  return NextResponse.json({ agent: "online", ...(await tick(deps, 20_000)) });
}
