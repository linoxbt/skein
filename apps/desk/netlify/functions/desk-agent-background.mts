import { timingSafeEqual } from "node:crypto";
import { agentReady } from "../../lib/agent";
import { AUTO_DAILY, deskDeps } from "../../lib/desk";
import { runAgent } from "../../lib/intake";

/**
 * The agent's run on Netlify, as a background function: Netlify answers the
 * caller 202 at once and lets this run for up to 15 minutes. A Telegraph ask
 * is paid before its answer arrives, so it must not run in a request function
 * that can be stopped mid-ask (the scheduled function has 30 s, a request
 * function 60 s); here a whole ask, and the verdict read after it, fit with
 * room to spare. The run stops starting new applications after RUN_BUDGET_MS,
 * so the last one still finishes well inside the limit.
 *
 * Started every minute by desk-tick (scheduled) and right after a form
 * application on the Telegraph rail. Runs may overlap: every application is
 * leased before it is bought, so two runs never buy the same one.
 */
const RUN_BUDGET_MS = 8 * 60_000;

export default async (req: Request) => {
  const secret = process.env.DESK_CRON_SECRET ?? "";
  const presented = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || presented.length !== secret.length || !timingSafeEqual(Buffer.from(presented), Buffer.from(secret))) {
    console.error("desk-agent-background: bad or missing cron secret");
    return;
  }
  const deps = await deskDeps({ waitMs: 30_000 });
  if (!agentReady(deps)) {
    console.log(JSON.stringify({ msg: "desk agent offline", rail: deps.rail }));
    return;
  }
  const out = await runAgent(deps, { budgetMs: RUN_BUDGET_MS, daily: AUTO_DAILY });
  console.log(JSON.stringify({ msg: "desk agent run", rail: deps.rail, ...out }));
};

export const config = { background: true };
