import { SkeinError, type Skein, type VerdictObject, type VerdictResult } from "@skein/sdk";
import type { Store } from "./store";
import { CHAINS, EXCHANGE, RULE, type Action, type Application, type Decision } from "./types";

/**
 * The Desk agent. It receives a listing application, buys one Skein verdict
 * for the token, applies the exchange's house rule (APPROVE → shortlist,
 * REJECT → decline letter, ESCALATE or ABSTAIN → analyst queue) and logs the
 * receipt and cost. No human is involved until an analyst picks up the queue.
 */
export interface AgentDeps {
  store: Store;
  skein: Skein | null;
  rail: "apiKey" | "telegraph";
  webUrl: string;
  now?: () => Date;
  /** How long one call may wait for a verdict before leaving it to the next tick. */
  waitMs?: number;
}

export class InputError extends Error {}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** A Telegraph ask that has been in flight this long is treated as lost (and never retried: it may have been paid). */
const LOST_MS = 3 * 60_000;

export interface ApplicationInput {
  project: unknown;
  chainId: unknown;
  token: unknown;
  deployer?: unknown;
  social?: unknown;
  repo?: unknown;
  contact?: unknown;
}

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

export function parseApplication(input: ApplicationInput): Pick<Application, "project" | "subject" | "context" | "contact"> {
  const project = str(input.project, 80);
  if (!project) throw new InputError("project name is required");
  const chainId = Number(input.chainId);
  if (!(chainId in CHAINS)) throw new InputError(`chain must be one of ${Object.entries(CHAINS).map(([id, n]) => `${id} (${n})`).join(", ")}`);
  const token = str(input.token, 42);
  if (!token || !ADDRESS.test(token)) throw new InputError("token must be a contract address (0x + 40 hex)");
  const deployer = str(input.deployer, 42);
  if (deployer && !ADDRESS.test(deployer)) throw new InputError("deployer must be an address (0x + 40 hex)");
  const social = str(input.social, 40)?.replace(/^@/, "");
  if (social && !/^\w{1,30}$/.test(social)) throw new InputError("social must be an X handle");
  const repo = str(input.repo, 200);
  if (repo && !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(repo)) throw new InputError("repo must be a https://github.com/org/repo URL");
  const contact = str(input.contact, 120);
  return {
    project,
    subject: { chainId, token },
    context: { ...(deployer ? { deployer } : {}), ...(social ? { social } : {}), ...(repo ? { repo } : {}) },
    ...(contact ? { contact } : {}),
  };
}

function newId(now: Date) {
  return `app_${now.getTime().toString(36)}${crypto.getRandomValues(new Uint32Array(1))[0]!.toString(36)}`;
}

/** Files a new application. The agent picks it up in process() or the next tick. */
export async function receive(deps: AgentDeps, input: ApplicationInput, source: Application["source"]): Promise<Application> {
  const now = deps.now?.() ?? new Date();
  const app: Application = { id: newId(now), receivedAt: now.toISOString(), source, status: "received", ...parseApplication(input) };
  await deps.store.put(app);
  return app;
}

/** The letter or note that goes with each action. */
export function letterFor(app: Application, action: Action, v: VerdictObject | null, link: string | null, refusal?: { code: string; message: string }): string {
  const chain = CHAINS[app.subject.chainId] ?? String(app.subject.chainId);
  const where = `${app.subject.token} on ${chain}`;
  if (refusal) {
    return [
      `Analyst note: ${app.project}`,
      ``,
      `The agent could not get a verdict for ${where}: Skein refused (${refusal.code}). ${refusal.message}`,
      `Nothing was decided automatically. Review by hand, or re-file the application once the missing check is back.`,
    ].join("\n");
  }
  const reasons = v!.reasons.map((r) => `  - ${r.detail}`);
  if (action === "shortlist") {
    return [
      `Shortlisted: ${app.project}`,
      ``,
      `${where} passed the automated listing review (${v!.policy.id}@${v!.policy.version}).`,
      v!.summary,
      ``,
      `Next step: commercial terms with the listings team.`,
      `Evidence: ${link}`,
    ].join("\n");
  }
  if (action === "decline") {
    return [
      `Dear ${app.project} team,`,
      ``,
      `Thank you for applying to list on ${EXCHANGE}. We are unable to list ${where} at this time.`,
      `Our automated review found:`,
      ...reasons,
      ``,
      `You are welcome to apply again once these points are addressed. The decision rests on risk evidence anyone can check: ${link}`,
      ``,
      `${EXCHANGE} listings`,
    ].join("\n");
  }
  return [
    `Analyst brief: ${app.project}`,
    ``,
    `Skein returned ${v!.verdict} for ${where}: ${v!.summary}`,
    `Look at:`,
    ...(reasons.length ? reasons : ["  - (no reasons recorded)"]),
    ...(v!.openRisks.length ? [``, `Still open: ${v!.openRisks.join("; ")}`] : []),
    ``,
    `Every input and its receipt: ${link}`,
  ].join("\n");
}

export function decide(app: Application, outcome: { verdict: VerdictResult } | { refusal: { code: string; message: string } }, webUrl: string, now: Date): Decision {
  const seconds = Math.max(0, Math.round((now.getTime() - Date.parse(app.receivedAt)) / 100) / 10);
  if ("refusal" in outcome) {
    return {
      at: now.toISOString(), action: "analyst", verdict: null, verdictId: null, summary: `Skein refused: ${outcome.refusal.code}`,
      reasons: [outcome.refusal.message], openRisks: [], rail: "none", paidUsdc: 0, listPriceUsdc: 0, upstreamUsdc: 0, receipts: 0,
      receiptHash: null, verdictHash: null, network: null, seconds, letter: letterFor(app, "analyst", null, null, outcome.refusal), refusal: outcome.refusal,
    };
  }
  const v = outcome.verdict;
  const action = RULE[v.verdict];
  const link = `${webUrl.replace(/\/$/, "")}/v/${v.id}`;
  return {
    at: now.toISOString(),
    action,
    verdict: v.verdict,
    verdictId: v.id,
    summary: v.summary,
    reasons: v.reasons.map((r) => r.detail),
    openRisks: v.openRisks,
    rail: v.payment.rail,
    // A partner key pays nothing during the hackathon; a Telegraph ask pays what its receipt says.
    paidUsdc: v.payment.rail === "telegraph" ? v.payment.amountUsdc : 0,
    listPriceUsdc: v.cost.priceUsdc,
    upstreamUsdc: v.cost.upstreamUsdc,
    receipts: v.bom.items,
    receiptHash: v.payment.rail === "telegraph" ? v.payment.receiptHash : null,
    verdictHash: v.verdictHash,
    network: v.network,
    seconds,
    letter: letterFor(app, action, v, link),
  };
}

function refusalOf(e: unknown): { code: string; message: string } | null {
  if (!(e instanceof SkeinError)) return null;
  // Transient: leave the application for the next tick.
  if (["NETWORK", "TIMEOUT", "RATE_LIMITED"].includes(e.code) || e.code.startsWith("HTTP_5")) return null;
  return { code: e.code, message: e.message };
}

async function settle(deps: AgentDeps, app: Application, outcome: Parameters<typeof decide>[1]): Promise<Application> {
  const done: Application = { ...app, status: "decided", decision: decide(app, outcome, deps.webUrl, deps.now?.() ?? new Date()) };
  await deps.store.put(done);
  return done;
}

/**
 * Runs the agent on one application: buys the verdict (or picks up the one
 * already bought) and decides. Safe to call repeatedly: the partner-key rail
 * reuses one idempotency key per application, so a verdict is never bought twice.
 */
export async function process(deps: AgentDeps, id: string): Promise<Application | null> {
  let app = await deps.store.get(id);
  if (!app || app.status === "decided" || !deps.skein) return app;
  const now = deps.now?.() ?? new Date();
  const request = { subject: app.subject, context: app.context, idempotencyKey: `desk-${app.id}` };

  try {
    if (deps.rail === "telegraph") {
      if (app.status === "buying") {
        // An ask from an earlier call: if it is long gone, hand it to an analyst rather than pay twice.
        if (now.getTime() - Date.parse(app.startedAt ?? app.receivedAt) < LOST_MS) return app;
        return settle(deps, app, { refusal: { code: "LOST_ASK", message: "The paid Telegraph ask did not come back in time; not retried, to avoid paying twice." } });
      }
      app = { ...app, status: "buying", rail: "telegraph", startedAt: now.toISOString() };
      await deps.store.put(app);
      return settle(deps, app, { verdict: await deps.skein.verdict(request) });
    }

    if (!app.verdictId) {
      const started = await deps.skein.submit(request);
      if (!("status" in started)) return settle(deps, app, { verdict: started });
      app = { ...app, status: "buying", rail: "apiKey", verdictId: started.id, startedAt: now.toISOString() };
      await deps.store.put(app);
    }
    return settle(deps, app, { verdict: await deps.skein.wait(app.verdictId!, { timeoutMs: deps.waitMs ?? 8_000 }) });
  } catch (e) {
    const refusal = refusalOf(e);
    if (refusal) return settle(deps, app, { refusal });
    return app;
  }
}

/** Settles everything still open, oldest first, within a time budget. Called by the scheduler and by the board. */
export async function tick(deps: AgentDeps, budgetMs = 20_000): Promise<{ open: number; decided: number }> {
  const started = Date.now();
  const open = (await deps.store.list()).filter((a) => a.status !== "decided").reverse();
  let decided = 0;
  for (const a of open) {
    if (Date.now() - started > budgetMs) break;
    const out = await process(deps, a.id);
    if (out?.status === "decided") decided++;
  }
  return { open: open.length - decided, decided };
}
