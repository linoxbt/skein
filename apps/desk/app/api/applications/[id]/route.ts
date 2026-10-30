import { NextResponse } from "next/server";
import { process as runAgent } from "@/lib/agent";
import { deskDeps } from "@/lib/desk";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const deps = await deskDeps({ waitMs: 2_000 });
  const app = (await runAgent(deps, id).catch(() => null)) ?? (await deps.store.get(id));
  if (!app) return NextResponse.json({ error: { code: "NOT_FOUND", message: "no such application" } }, { status: 404 });
  return NextResponse.json(app);
}
