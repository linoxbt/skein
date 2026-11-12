import { SkeinError, type Skein, type TelegraphAskOutcomeFail, type TelegraphAskOutcomeOk, type TelegraphAsker, type VerdictObject, type VerdictResult } from "@skeinlabs/sdk";
import { mutate, type Store, type Summary } from "./store";
import { CHAINS, EXCHANGE, RULE, type Action, type Application, type AskRecord, type Decision, type Origin } from "./types";

/**
 * The Desk agent. It receives a listing application, buys one Skein verdict
 * for the token, applies the exchange's house rule (APPROVE → shortlist,
 * REJECT → decline letter, ESCALATE or ABSTAIN → analyst queue) and logs the
 * receipt and cost. No human is involved until an analyst picks up the queue.
 */
export interface AgentDeps {
  store: Store;
  /**
   * The partner-key client: buys on the apiKey rail and reads verdicts. On
   * the Telegraph rail it buys only for form applications past the day's
   * Telegraph allowance, or after Telegraph kept failing before payment.
   */
  skein: Skein | null;
  /**
   * The Telegraph rail: builds a paying client around the Desk's asker. The
   * agent passes `wrap`, which records each ask on the application as soon
   * as it returns (receipt, amount, verdict id), before the SDK goes on.
   */
  telegraph?: TelegraphSkein | null;
  rail: "apiKey" | "telegraph";
  webUrl: string;
  now?: () => Date;
  /** How long one call may wait for a verdict before leaving it to the next tick. */
  waitMs?: number;
  /** Form and webhook applications a UTC day bought through Telegraph (the rest use the partner key, or wait). Default 1. */
  telegraphFormDaily?: number;
}

export type TelegraphSkein = (wrap: (client: TelegraphAsker) => TelegraphAsker) => Skein;

export class InputError extends Error {}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** How long a lease is good for: longer than any one call's wait. */
const LEASE_MS = 90_000;
/** A Telegraph lease outlasts one ask (an unpaid attempt, its retry, the paid call) and the verdict read. */
const TELEGRAPH_LEASE_MS = 5 * 60_000;
/**
 * A Telegraph ask in flight this long, with nothing recorded, is lost: no
 * function runs longer (Netlify background functions stop at 15 minutes). It
 * is never asked again, because it may have been paid.
 */
const LOST_MS = 15 * 60_000;
/** Telegraph asks that may fail before any payment before the application goes to the partner key (or an analyst). */
export const MAX_UNPAID_ATTEMPTS = 5;

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
export const PROJECT = /^[\p{L}\p{N}][\p{L}\p{N} .&'_-]{0,47}$/u;
export const LINKISH = /https?:|www\.|\.(com|io|xyz|net|org)\b/i;

export function parseApplication(input: ApplicationInput): Pick<Application, "project" | "subject" | "context"> {
  const project = str(input.project, 48);
  if (!project) throw new InputError("project name is required");
  if (!PROJECT.test(project) || LINKISH.test(project)) throw new InputError("project name: letters, digits, spaces and . & ' _ - only, no links");
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

/**
 * Files a new application. The agent picks it up in process() or the next
 * tick. `id` (the agent's own intake) makes filing the same token twice fail:
 * the store creates an application only if its id is new (CollisionError).
 */
export async function receive(deps: AgentDeps, input: ApplicationInput, source: Application["source"], opts: { id?: string; origin?: Origin } = {}): Promise<Application> {
  const now = deps.now?.() ?? new Date();
  const app: Application = { id: opts.id ?? newId(now), receivedAt: now.toISOString(), source, ...(opts.origin ? { origin: opts.origin } : {}), status: "received", ...parseApplication(input) };
  if (!(await deps.store.create(app))) throw new CollisionError(app.id);
  return app;
}

export class CollisionError extends Error {
  constructor(readonly id: string) {
    super(`application ${id} already exists`);
  }
}

/** What a Telegraph ask cost, when it produced no usable verdict. */
export interface Paid {
  amountUsdc: number;
  billing: "paid" | "unknown";
  receiptHash: string | null;
  minerId: string | null;
  signalHash: string | null;
}

export type Outcome = { verdict: VerdictResult } | { refusal: { code: string; message: string }; paid?: Paid };

const usdc = (n: number) => `${Number(n.toFixed(6))} USDC`;

/** The letter or note that goes with each action. */
export function letterFor(app: Application, action: Action, v: VerdictObject | null, link: string | null, refusal?: { code: string; message: string }, paid?: Paid): string {
  const chain = CHAINS[app.subject.chainId] ?? String(app.subject.chainId);
  const where = `${app.subject.token} on ${chain}`;
  if (refusal) {
    return [
      `Analyst note: ${app.project}`,
      ``,
      paid
        ? `The agent paid for a Telegraph ask for ${where} but got no usable verdict (${refusal.code}). ${refusal.message}`
        : `The agent could not get a verdict for ${where}: Skein refused (${refusal.code}). ${refusal.message}`,
      ...(paid
        ? [`Paid: ${paid.billing === "unknown" ? `unknown (the payment was sent, ${usdc(paid.amountUsdc)} signed; the node may not have billed it)` : usdc(paid.amountUsdc)}${paid.receiptHash ? `, receipt ${paid.receiptHash}` : ""}. Not asked again, so it is never paid twice.`]
        : []),
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

export function decide(app: Application, outcome: Outcome, webUrl: string, now: Date): Decision {
  const seconds = Math.max(0, Math.round((now.getTime() - Date.parse(app.receivedAt)) / 100) / 10);
  if ("refusal" in outcome) {
    const p = outcome.paid;
    return {
      at: now.toISOString(), action: "analyst", verdict: null, verdictId: null, summary: `${p ? "No verdict for a paid ask" : "Skein refused"}: ${outcome.refusal.code}`,
      reasons: [outcome.refusal.message], openRisks: [], rail: p ? "telegraph" : "none", paidUsdc: p?.amountUsdc ?? 0, listPriceUsdc: 0, upstreamUsdc: 0, receipts: 0,
      receiptHash: p?.receiptHash ?? null, ...(p ? { billing: p.billing, minerId: p.minerId, signalHash: p.signalHash } : {}),
      verdictHash: null, network: null, seconds, letter: letterFor(app, "analyst", null, null, outcome.refusal, p), refusal: outcome.refusal,
    };
  }
  const v = outcome.verdict;
  const action = RULE[v.verdict];
  const link = `${webUrl.replace(/\/$/, "")}/v/${v.id}`;
  const tg = v.payment.rail === "telegraph" ? v.payment : null;
  return {
    at: now.toISOString(),
    action,
    verdict: v.verdict,
    verdictId: v.id,
    summary: v.summary,
    reasons: v.reasons.map((r) => r.detail),
    openRisks: v.openRisks,
    rail: v.payment.rail,
    // A partner key pays nothing during the hackathon; a Telegraph ask pays what was signed for it.
    paidUsdc: tg ? tg.amountUsdc : 0,
    ...(tg ? { billing: "paid" as const, minerId: tg.minerId || null, signalHash: tg.signalHash } : {}),
    listPriceUsdc: v.cost.priceUsdc,
    upstreamUsdc: v.cost.upstreamUsdc,
    receipts: v.bom.items,
    receiptHash: tg ? tg.receiptHash : null,
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
const transient = (e: unknown) => !(e instanceof SkeinError) || TRANSIENT.has(e.code) || e.code.startsWith("HTTP_5");

function refusalOf(e: unknown): { code: string; message: string } | "config" | null {
  if (!(e instanceof SkeinError)) return null;
  if (CONFIG_ERRORS.has(e.code)) return "config";
  if (TRANSIENT.has(e.code) || e.code.startsWith("HTTP_5")) return null;
  return { code: e.code, message: e.message };
}

const VERDICT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** What one Telegraph ask came back with, in the form the application keeps. */
export function askRecord(out: TelegraphAskOutcomeOk | TelegraphAskOutcomeFail, at: Date): AskRecord {
  if (out.ok) {
    const raw = (out.response.result ?? {}) as { id?: unknown; pending_id?: unknown; result?: { id?: unknown; pending_id?: unknown } };
    const id = [raw.id, raw.result?.id, raw.pending_id, raw.result?.pending_id].find((x): x is string => typeof x === "string" && VERDICT_ID.test(x)) ?? null;
    const problems = (out as { receiptProblems?: unknown }).receiptProblems;
    return {
      at: at.toISOString(), billing: "paid", amountUsdc: out.amountUusdc / 1e6, minerId: out.response.miner_id ? String(out.response.miner_id) : null,
      receiptHash: out.receipt?.receipt_hash ?? null, signalHash: out.response.signal_hash ?? null, verdictId: id,
      ...(Array.isArray(problems) && problems.length ? { receiptProblems: problems.map(String).slice(0, 10) } : {}),
    };
  }
  // A Telegraph client says whether X-PAYMENT went out (billing "none": it did not). One that does not say is taken to have paid.
  const f = out as TelegraphAskOutcomeFail & { paidUusdc?: number; billing?: string };
  return {
    at: at.toISOString(), billing: f.billing === "none" ? "none" : "unknown", amountUsdc: (f.paidUusdc ?? 0) / 1e6,
    minerId: null, receiptHash: null, signalHash: null, verdictId: null, error: `${f.kind}: ${f.error}`.slice(0, 300),
  };
}

const paidOf = (r: AskRecord): Paid => ({
  amountUsdc: r.amountUsdc, billing: r.billing === "paid" ? "paid" : "unknown", receiptHash: r.receiptHash, minerId: r.minerId, signalHash: r.signalHash,
});

/** A verdict bought through Telegraph, checked against the application it was bought for. */
function telegraphOutcome(app: Application, v: VerdictResult, rec: AskRecord | undefined): Outcome {
  const payment = v.payment.rail === "telegraph" ? v.payment : rec ? { rail: "telegraph" as const, minerId: rec.minerId ?? "", amountUsdc: rec.amountUsdc, receiptHash: rec.receiptHash, signalHash: rec.signalHash } : null;
  const paid: Paid = payment
    ? { amountUsdc: payment.amountUsdc, billing: "paid", receiptHash: payment.receiptHash, minerId: payment.minerId || null, signalHash: payment.signalHash }
    : { amountUsdc: 0, billing: "unknown", receiptHash: null, minerId: null, signalHash: null };
  // The answering miner names the verdict: one for another token is not evidence for this one.
  const s = v.subject;
  if (!s || s.chainId !== app.subject.chainId || String(s.token).toLowerCase() !== app.subject.token.toLowerCase()) {
    return { refusal: { code: "SUBJECT_MISMATCH", message: `the miner answered with verdict ${v.id}, which is for ${s ? `${s.token} on chain ${s.chainId}` : "another subject"}` }, paid };
  }
  return { verdict: { ...v, payment: payment ?? v.payment } };
}

export const agentReady = (deps: AgentDeps) => (deps.rail === "telegraph" ? !!deps.telegraph : !!deps.skein);

type RailChoice = { rail: "apiKey" | "telegraph"; took: string | null } | { giveUp: true } | "wait";

/**
 * Which rail buys this application. On the Telegraph rail the agent's own
 * applications always use Telegraph (the intake's daily budget paid for
 * them); form and webhook ones do up to telegraphFormDaily a day, so nobody
 * can drain the escrow through the public form, and then use the partner key.
 */
async function chooseRail(deps: AgentDeps, a: Application, day: string): Promise<RailChoice> {
  if (deps.rail === "apiKey") return { rail: "apiKey", took: null };
  if (a.rail === "telegraph" && (a.attempts ?? 0) >= MAX_UNPAID_ATTEMPTS) return deps.skein ? { rail: "apiKey", took: null } : { giveUp: true };
  if (a.rail) return { rail: a.rail, took: null };
  if (a.source === "agent") return { rail: "telegraph", took: null };
  const counter = `telegraph-form/${day}`;
  if (await deps.store.take(counter, deps.telegraphFormDaily ?? 1)) return { rail: "telegraph", took: counter };
  return deps.skein ? { rail: "apiKey", took: null } : "wait";
}

/**
 * Runs the agent on one application: buys the verdict (or picks up the one
 * already bought) and decides. Safe to call from anywhere, concurrently:
 *  - it first takes a lease with a compare-and-swap write, and only the lease
 *    holder buys or decides;
 *  - a Telegraph ask is only ever made under a lease that also marks the
 *    application "buying", so it is asked at most once. Its result is written
 *    to the application the moment it returns, so a later tick finishes a
 *    paid ask by reading its verdict, never by asking again. An ask that
 *    failed before any payment is retried on later ticks (MAX_UNPAID_ATTEMPTS);
 *    a paid one that produced no verdict goes to an analyst with what it cost;
 *  - the partner-key rail reuses one idempotency key per application;
 *  - a decision is written once: a decided application is never rewritten.
 * `indexed` is the board's entry for the application, when the caller has
 * it: one that disagrees with the application is repaired.
 */
export async function process(deps: AgentDeps, id: string, indexed?: Summary): Promise<Application | null> {
  const now = deps.now?.() ?? new Date();
  const me = crypto.randomUUID();
  const read = await deps.store.get(id);
  if (!read) {
    if (indexed) await deps.store.unindex(id).catch(() => {});
    return null;
  }
  const leave = async () => {
    if (indexed) await deps.store.heal(read.value, indexed).catch(() => {});
    return read.value;
  };
  if (read.value.status === "decided" || !agentReady(deps)) return leave();
  if (read.value.lease && Date.parse(read.value.lease.until) > now.getTime()) return leave();

  const choice = await chooseRail(deps, read.value, now.toISOString().slice(0, 10));
  if (choice === "wait") return leave();
  const giveUp = "giveUp" in choice;
  const rail = giveUp ? read.value.rail! : choice.rail;
  const resuming = rail === "telegraph" && read.value.status === "buying";
  const viaTelegraph = rail === "telegraph" && !giveUp;

  const { waiting: _waiting, ...base } = read.value;
  let app: Application = { ...base, rail, lease: { by: me, until: new Date(now.getTime() + (viaTelegraph ? TELEGRAPH_LEASE_MS : LEASE_MS)).toISOString() } };
  if (viaTelegraph && !resuming) {
    // The ask is about to be paid: mark it in the same write that takes the lease.
    const { ask: _ask, ...fresh } = app;
    app = { ...fresh, status: "buying", startedAt: now.toISOString() };
  }
  if (!(await deps.store.update(app, read.etag))) {
    if (!giveUp && choice.took) await deps.store.refund(choice.took).catch(() => {});
    return (await deps.store.get(id))?.value ?? null;
  }

  const settle = async (outcome: Outcome): Promise<Application> => {
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
  const noteError = (code: string) => mutate(deps.store.kv, "agent/last_error", () => ({ at: now.toISOString(), code })).catch(() => null);
  const unpaidRetry = () => release({ status: "received", attempts: (read.value.attempts ?? 0) + 1 });

  if (giveUp) {
    return settle({ refusal: { code: "TELEGRAPH_UNAVAILABLE", message: `${MAX_UNPAID_ATTEMPTS} Telegraph asks failed before any payment (last: ${read.value.ask?.error ?? "unknown"}); nothing was paid and no partner key is configured.` } });
  }

  const request = { subject: app.subject, context: app.context, idempotencyKey: `desk-${app.id}` };
  const reader = deps.skein ?? deps.telegraph?.((c) => c) ?? null;
  if (viaTelegraph) {
    const state: { asked: boolean; rec: AskRecord | undefined } = { asked: false, rec: resuming ? read.value.ask : undefined };
    try {
      if (resuming) {
        // An ask from an earlier call: never ask again (it may have been paid). Finish it from its record.
        const rec = state.rec;
        if (rec?.billing === "none") return await unpaidRetry();
        if (rec?.verdictId) return await settle(telegraphOutcome(app, await reader!.wait(rec.verdictId, { timeoutMs: deps.waitMs ?? 8_000 }), rec));
        if (rec) return await settle({ refusal: { code: "TELEGRAPH_NO_VERDICT", message: rec.error ?? "the paid ask came back without a verdict id" }, paid: paidOf(rec) });
        const lost = now.getTime() - Date.parse(read.value.startedAt ?? read.value.receivedAt) >= LOST_MS;
        return lost
          ? await settle({
              refusal: { code: "LOST_ASK", message: "The Telegraph ask never came back and nothing was recorded; it may have been paid, so it is not asked again." },
              paid: { amountUsdc: 0, billing: "unknown", receiptHash: null, minerId: null, signalHash: null },
            })
          : await release();
      }
      const record = (client: TelegraphAsker): TelegraphAsker => ({
        ask: async (req, opts) => {
          state.asked = true;
          const out = await client.ask(req, opts);
          state.rec = askRecord(out, deps.now?.() ?? new Date());
          await saveAsk(deps.store, id, me, state.rec);
          return out;
        },
      });
      return await settle(telegraphOutcome(app, await deps.telegraph!(record).verdict(request), state.rec));
    } catch (e) {
      const rec = state.rec;
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      const code = e instanceof SkeinError ? e.code : "TELEGRAPH_ERROR";
      if (!rec) {
        // The ask itself threw: whether it paid is not known, so it is never made again.
        if (state.asked) return settle({ refusal: { code, message }, paid: { amountUsdc: 0, billing: "unknown", receiptHash: null, minerId: null, signalHash: null } });
        // Refused before any ask (resuming reads land here too, with no record).
        if (resuming) return release();
        const refusal = refusalOf(e);
        if (refusal && refusal !== "config") return settle({ refusal });
        return unpaidRetry();
      }
      if (rec.billing === "none") {
        // Nothing was paid (no answer before payment, or the payment refused): try again on a later tick.
        await noteError(code);
        return unpaidRetry();
      }
      // Paid, and the verdict is known but could not be read yet: read it on the next tick.
      if (rec.verdictId && transient(e)) return release();
      const refusal = e instanceof SkeinError ? { code, message } : { code: "TELEGRAPH_ERROR", message };
      return settle({ refusal, paid: paidOf(rec) });
    }
  }

  const skein = deps.skein!;
  try {
    if (!app.verdictId) {
      const started = await skein.submit(request);
      if (!("status" in started)) return await settle({ verdict: started });
      const cur = await deps.store.get(id);
      app = { ...cur!.value, status: "buying", rail: "apiKey", verdictId: started.id, startedAt: now.toISOString() };
      if (!(await deps.store.update(app, cur!.etag))) return (await deps.store.get(id))?.value ?? app;
    }
    return await settle({ verdict: await skein.wait(app.verdictId!, { timeoutMs: deps.waitMs ?? 8_000 }) });
  } catch (e) {
    const refusal = refusalOf(e);
    if (refusal === "config") {
      // Shown on the board ("agent misconfigured"); the application waits for a working key.
      await noteError((e as SkeinError).code);
      return release();
    }
    if (refusal) return settle({ refusal });
    return release();
  }
}

/** Writes a Telegraph ask's record onto the application, if this call still holds its lease. */
async function saveAsk(store: Store, id: string, me: string, rec: AskRecord): Promise<void> {
  try {
    const cur = await store.get(id);
    if (!cur || cur.value.status === "decided" || cur.value.lease?.by !== me) return;
    await store.update({ ...cur.value, ask: rec, ...(rec.verdictId ? { verdictId: rec.verdictId } : {}) }, cur.etag);
  } catch (e) {
    // The ask goes on: the verdict is still read and decided in this call.
    console.error(`recording the Telegraph ask for ${id} failed: ${(e as Error).message}`);
  }
}

/** Settles everything still open, oldest first, within a time budget. Called by the scheduler only. */
export async function tick(deps: AgentDeps, budgetMs = 20_000): Promise<{ open: number; decided: number }> {
  const started = Date.now();
  const open = (await deps.store.list()).filter((a) => a.status !== "decided").reverse();
  let decided = 0;
  for (const a of open) {
    if (Date.now() - started > budgetMs) break;
    // One application's failure (a store hiccup) does not stop the others.
    const out = await process(deps, a.id, a).catch((e) => (console.error(`agent on ${a.id}:`, e), null));
    if (out?.status === "decided") decided++;
  }
  return { open: open.length - decided, decided };
}
