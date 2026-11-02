import { SkeinError, type Skein, type VerdictObject, type VerdictResult } from "@skein/sdk";
import { mutate, type Store } from "./store";
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
}

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

/** Project names show on a public board and head letters: plain words only, no links. */
const PROJECT = /^[\p{L}\p{N}][\p{L}\p{N} .&'_-]{0,47}$/u;

export function parseApplication(input: ApplicationInput): Pick<Application, "project" | "subject" | "context"> {
  const project = str(input.project, 48);
  if (!project) throw new InputError("project name is required");
  if (!PROJECT.test(project) || /https?:|www\.|\.(com|io|xyz|net|org)\b/i.test(project)) throw new InputError("project name: letters, digits, spaces and . & ' _ - only, no links");
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
  // No contact details are collected: the Desk never needs them, and the board is public.
  return {
    project,
    subject: { chainId, token },
    context: { ...(deployer ? { deployer } : {}), ...(social ? { social } : {}), ...(repo ? { repo } : {}) },
  };
}

function newId(now: Date) {
  return `app_${now.getTime().toString(36)}${crypto.getRandomValues(new Uint32Array(1))[0]!.toString(36)}`;
}

/** Files a new application. The agent picks it up in process() or the next tick. */
export async function receive(deps: AgentDeps, input: ApplicationInput, source: Application["source"]): Promise<Application> {
  const now = deps.now?.() ?? new Date();
  const app: Application = { id: newId(now), receivedAt: now.toISOString(), source, status: "received", ...parseApplication(input) };
  if (!(await deps.store.create(app))) throw new Error("application id collision");
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
      ...(v!.openRisks.length ? [``, `Not covered by the review, check before listing: ${v!.openRisks.join("; ")}`] : []),
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

/** The Desk itself is misconfigured (no or revoked key): nothing to decide, keep the application open. */
const CONFIG_ERRORS = new Set(["UNAUTHORIZED", "PAYMENT_REQUIRED", "NO_PAYER"]);
/** Transient: leave the application for the next tick. */
const TRANSIENT = new Set(["NETWORK", "TIMEOUT", "RATE_LIMITED", "DAILY_CAP_REACHED", "LOST", "VERDICT_FAILED"]);

function refusalOf(e: unknown): { code: string; message: string } | "config" | null {
  if (!(e instanceof SkeinError)) return null;
  if (CONFIG_ERRORS.has(e.code)) return "config";
  if (TRANSIENT.has(e.code) || e.code.startsWith("HTTP_5")) return null;
  return { code: e.code, message: e.message };
}

/** How long a lease is good for: longer than any one call's wait. */
const LEASE_MS = 90_000;

/**
 * Runs the agent on one application: buys the verdict (or picks up the one
 * already bought) and decides. Safe to call from anywhere, concurrently:
 *  - it first takes a lease with a compare-and-swap write, and only the lease
 *    holder buys or decides;
 *  - a Telegraph ask is only ever made under a lease that also marks the
 *    application "buying", so it is asked at most once (it cannot be replayed:
 *    a lost ask goes to an analyst after LOST_MS);
 *  - the partner-key rail reuses one idempotency key per application;
 *  - a decision is written once: a decided application is never rewritten.
 */
export async function process(deps: AgentDeps, id: string): Promise<Application | null> {
  const now = deps.now?.() ?? new Date();
  const me = crypto.randomUUID();
  const read = await deps.store.get(id);
  if (!read || read.value.status === "decided" || !deps.skein) return read?.value ?? null;
  const held = read.value.lease && Date.parse(read.value.lease.until) > now.getTime() && read.value.lease.by !== me;
  if (held) return read.value;

  let app: Application = { ...read.value, lease: { by: me, until: new Date(now.getTime() + LEASE_MS).toISOString() } };
  const lostAsk = deps.rail === "telegraph" && read.value.status === "buying" && now.getTime() - Date.parse(read.value.startedAt ?? read.value.receivedAt) >= LOST_MS;
  if (deps.rail === "telegraph" && read.value.status !== "buying") {
    // The ask is about to be paid: mark it in the same write that takes the lease.
    app = { ...app, status: "buying", rail: "telegraph", startedAt: now.toISOString() };
  }
  if (!(await deps.store.update(app, read.etag))) return (await deps.store.get(id))?.value ?? null;

  const settle = async (outcome: Parameters<typeof decide>[1]): Promise<Application> => {
    const cur = await deps.store.get(id);
    if (!cur || cur.value.status === "decided" || cur.value.lease?.by !== me) return cur?.value ?? app;
    const done: Application = { ...cur.value, status: "decided", lease: undefined, decision: decide(cur.value, outcome, deps.webUrl, deps.now?.() ?? new Date()) };
    return (await deps.store.update(done, cur.etag)) ? done : ((await deps.store.get(id))?.value ?? done);
  };
  const release = async (patch: Partial<Application> = {}): Promise<Application> => {
    const cur = await deps.store.get(id);
    if (!cur || cur.value.lease?.by !== me) return cur?.value ?? app;
    const next: Application = { ...cur.value, ...patch, lease: undefined };
    await deps.store.update(next, cur.etag);
    return next;
  };

  const request = { subject: app.subject, context: app.context, idempotencyKey: `desk-${app.id}` };
  try {
    if (deps.rail === "telegraph") {
      if (read.value.status === "buying") {
        // An ask from an earlier call is in flight, or was lost: never ask again (it may have been paid).
        return lostAsk
          ? settle({ refusal: { code: "LOST_ASK", message: "The paid Telegraph ask did not come back in time; not retried, to avoid paying twice." } })
          : release();
      }
      return await settle({ verdict: await deps.skein.verdict(request) });
    }

    if (!app.verdictId) {
      const started = await deps.skein.submit(request);
      if (!("status" in started)) return await settle({ verdict: started });
      const cur = await deps.store.get(id);
      app = { ...cur!.value, status: "buying", rail: "apiKey", verdictId: started.id, startedAt: now.toISOString() };
      if (!(await deps.store.update(app, cur!.etag))) return (await deps.store.get(id))?.value ?? app;
    }
    return await settle({ verdict: await deps.skein.wait(app.verdictId!, { timeoutMs: deps.waitMs ?? 8_000 }) });
  } catch (e) {
    const refusal = refusalOf(e);
    if (refusal === "config") {
      // Shown on the board ("agent misconfigured"); the application waits for a working key.
      await mutate(deps.store.kv, "agent/last_error", () => ({ at: now.toISOString(), code: (e as SkeinError).code })).catch(() => null);
      return release();
    }
    if (refusal) return settle({ refusal });
    return release();
  }
}

/** Settles everything still open, oldest first, within a time budget. Called by the scheduler only. */
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
