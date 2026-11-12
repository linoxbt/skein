import { NextResponse } from "next/server";
import { agentReady } from "@/lib/agent";
import { AUTO_DAILY, deskDeps, kickBackgroundAgent, onNetlify } from "@/lib/desk";
import { bearerIs, errorResponse, guarded } from "@/lib/http";
import { runAgent } from "@/lib/intake";

export const dynamic = "force-dynamic";

/**
 * One run of the agent: the intake files fresh launches (DESK_AUTO_DAILY a
 * day), then every open application is settled within a time budget. On
 * Netlify the scheduled function starts the background function instead
 * (netlify/functions/desk-agent-background.mts); this route, its fallback,
 * hands over to it on the Telegraph rail when it can, because a request
 * function can be stopped mid-ask, after paying. Elsewhere (next start), or
 * when no background function answers, it does the work itself.
 */
export async function POST(req: Request) {
  if (!bearerIs(req, process.env.DESK_CRON_SECRET)) return errorResponse(401, "UNAUTHORIZED", "bad cron secret");
  return guarded("POST /api/agent/tick", async () => {
    const deps = await deskDeps({ waitMs: 5_000 });
    if (!agentReady(deps)) return NextResponse.json({ agent: "offline" });
    if (deps.rail === "telegraph" && onNetlify() && (await kickBackgroundAgent(new URL(req.url).origin))) return NextResponse.json({ agent: "online", background: true });
    // No background function took the run (none deployed, or not on this plan): do it here rather than not at all.
    return NextResponse.json({ agent: "online", ...(await runAgent(deps, { budgetMs: 20_000, daily: AUTO_DAILY })) });
  });
}
