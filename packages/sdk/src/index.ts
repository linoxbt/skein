import { parseSse } from "./sse";
import type { Bom, Quote, Subject, TelegraphAsker, VerdictEvent, VerdictObject, VerifyReport } from "./types";

export * from "./types";
export { parseSse } from "./sse";

/** The intent Skein serves on Telegraph (plan A; see miner/INTENT.md). */
export const SKEIN_INTENT = "FRAUD_RISK_TOKEN_LISTING";

const CHAIN_NAMES: Record<number, string> = { 1: "ethereum", 56: "bsc", 8453: "base", 42161: "arbitrum" };

/**
 * How a verdict is paid for:
 * - apiKey: a Skein partner key against the HTTP API (free during the hackathon);
 * - telegraph: one paid Telegraph ask, routed to the Skein miner or pinned to it.
 *   `client` is any Telegraph client, e.g. new TelegraphClient(...) from @skeinlabs/sdk/telegraph,
 *   which enforces its own per-call price cap on the 402 challenge.
 */
export type Payer =
  | { kind: "apiKey"; key: string }
  | { kind: "telegraph"; client: TelegraphAsker; minerId?: string; intent?: string };

export interface SkeinOptions {
  /** e.g. https://api.skeinlabs.site (with or without /v1). */
  apiUrl: string;
  payer?: Payer;
  /** Refuse, before paying, any verdict whose quoted price is above this. */
  maxUsdcPerCall?: number;
  /** Retries for network errors, 429 and retryable 5xx. Default 2. */
  retries?: number;
  /** The most the SDK sleeps between retries of one call, in total; a longer Retry-After throws instead. Default 10 s. */
  maxRetryWaitMs?: number;
  /** Each HTTP request (submit, quote, get, verify) gives up after this. Default 15 s. */
  requestTimeoutMs?: number;
  /** How long verdict() waits for a result. Default 120 s. */
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface VerdictRequest {
  subject: Subject;
  /** "dex-list@0.1.0", or an id for its latest version. */
  policy?: string;
  /**
   * Optional evidence about the project. socialHandle buys the social-bot
   * check, repoUrl (github.com or gitlab.com) buys the code review.
   * `social` and `repo` are accepted as aliases.
   */
  context?: VerdictContextInput;
  /** Reuse to make a retried call return the original verdict. Generated when omitted. */
  idempotencyKey?: string;
  /** Called with each live event (API key path). */
  onEvent?: (e: VerdictEvent) => void;
  signal?: AbortSignal;
  /** A quote you already fetched for this request, so verdict() does not fetch another. */
  quote?: Quote;
}

export interface VerdictContextInput {
  deployer?: string;
  socialHandle?: string;
  repoUrl?: string;
  treasuryAddresses?: string[];
  pool?: string;
  /** Alias of socialHandle. */
  social?: string;
  /** Alias of repoUrl. */
  repo?: string;
}

/** The API's field names: aliases mapped, empty values dropped. */
export function canonicalContext(c: VerdictContextInput | undefined): Record<string, unknown> | undefined {
  if (!c) return undefined;
  const { social, repo, ...rest } = c;
  const out: Record<string, unknown> = { ...rest };
  if (out.socialHandle === undefined && social) out.socialHandle = social;
  if (out.repoUrl === undefined && repo) out.repoUrl = repo;
  for (const [k, v] of Object.entries(out)) if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) delete out[k];
  return Object.keys(out).length ? out : undefined;
}

export type Payment =
  | { rail: "apiKey" }
  | { rail: "telegraph"; minerId: string; amountUsdc: number; receiptHash: string | null; signalHash: string | null };

export type VerdictResult = VerdictObject & { payment: Payment };

/** Every API error, with the API's code (BUDGET_TOO_LOW, RATE_LIMITED, …) or an SDK code. */
/** One entry of GET /v1/policies. */
export interface PolicySummary {
  id: string;
  version: string;
  ref?: string;
  sha256?: string;
  description?: string;
  [k: string]: unknown;
}

export class SkeinError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 0,
    readonly details?: unknown,
    /**
     * Set when money moved (or may have) before the failure: a Telegraph ask
     * that was paid but produced no verdict. Count it against your caps.
     */
    readonly payment?: { amountUsdc: number; billing: "paid" | "unknown"; receiptHash?: string | null },
  ) {
    super(message);
    this.name = "SkeinError";
  }
}

/** The quoted price is above maxUsdcPerCall; nothing was paid. */
export class SpendCapError extends SkeinError {
  constructor(
    readonly priceUsdc: number,
    readonly capUsdc: number,
  ) {
    super("SPEND_CAP", `quoted ${priceUsdc} USDC is above the cap of ${capUsdc} USDC; nothing was paid`);
    this.name = "SpendCapError";
  }
}

/** Refusals that will not change on retry. */
const FINAL = new Set(["UPSTREAM_UNAVAILABLE", "DAILY_CAP_REACHED", "MARGIN_GUARD", "SELF_ROUTING", "BUDGET_TOO_LOW"]);
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });

export class Skein {
  private readonly base: string;
  private readonly fetch: typeof fetch;
  private readonly retries: number;
  private readonly timeoutMs: number;

  constructor(private readonly opts: SkeinOptions) {
    this.base = opts.apiUrl.replace(/\/$/, "").replace(/\/v1$/, "");
    this.fetch = opts.fetch ?? ((...a) => globalThis.fetch(...a));
    this.retries = opts.retries ?? 2;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.maxRetryWaitMs = opts.maxRetryWaitMs ?? 10_000;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 15_000;
  }

  private readonly maxRetryWaitMs: number;
  private readonly requestTimeoutMs: number;

  /** One HTTP request with its own deadline, still cancellable by the caller's signal. */
  private async request(url: string, init: RequestInit): Promise<{ res: Response; json: unknown }> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new DOMException("request timed out", "TimeoutError")), this.requestTimeoutMs);
    const onAbort = () => ctl.abort(init.signal?.reason);
    init.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const res = await this.fetch(url, { ...init, signal: ctl.signal });
      const json = await res.json().catch(() => null);
      return { res, json };
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener("abort", onAbort);
    }
  }

  /**
   * A raw call with typed errors and retries. POSTs are retried only with an
   * idempotency key. Retries sleep at most maxRetryWaitMs in total: a
   * Retry-After past that (a daily cap until midnight) throws at once.
   */
  private async call<T>(path: string, init: RequestInit = {}, retryable = (init.method ?? "GET") === "GET"): Promise<{ status: number; body: T }> {
    let waited = 0;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      let json: (T & { error?: { code: string; message: string; details?: unknown } }) | null;
      try {
        ({ res, json } = (await this.request(`${this.base}${path}`, init)) as { res: Response; json: typeof json });
      } catch (e) {
        if (init.signal?.aborted) throw e;
        const backoff = 500 * 2 ** attempt;
        if (retryable && attempt < this.retries && waited + backoff <= this.maxRetryWaitMs) {
          waited += backoff;
          await sleep(backoff, init.signal ?? undefined);
          continue;
        }
        const timedOut = (e as Error).name === "TimeoutError";
        throw new SkeinError(timedOut ? "TIMEOUT" : "NETWORK", timedOut ? `no answer from Skein in ${this.requestTimeoutMs} ms` : `could not reach Skein: ${(e as Error).message}`);
      }
      if (res.ok) return { status: res.status, body: json as T };
      const err = json?.error ?? { code: `HTTP_${res.status}`, message: res.statusText || `HTTP ${res.status}` };
      const after = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(after) && after > 0 ? after * 1000 : 500 * 2 ** attempt;
      const again = retryable && attempt < this.retries && (res.status === 429 || (res.status >= 500 && !FINAL.has(err.code))) && waited + wait <= this.maxRetryWaitMs;
      if (!again) throw new SkeinError(err.code, err.message, res.status, err.details);
      waited += wait;
      await sleep(wait, init.signal ?? undefined);
    }
  }

  /** What a verdict would buy and cost, without buying. Free. */
  async quote(req: { subject: Subject; policy?: string }): Promise<Quote> {
    const q = new URLSearchParams({ chain: String(req.subject.chainId), token: req.subject.token });
    if (req.policy) q.set("policy", req.policy);
    return (await this.call<Quote>(`/v1/quote?${q}`)).body;
  }

  /** A stored verdict, or { status: "running" } while it is being made. */
  async get(id: string): Promise<VerdictObject | { id: string; status: "running" }> {
    return (await this.call<VerdictObject | { id: string; status: "running" }>(`/v1/verdicts/${encodeURIComponent(id)}`)).body;
  }

  /** The bill of materials: every paid input and its receipt. */
  async bom(id: string): Promise<Bom> {
    return (await this.call<Bom>(`/v1/verdicts/${encodeURIComponent(id)}/bom`)).body;
  }

  /** Recompute a verdict from its raw paid answers. */
  async verify(id: string): Promise<VerifyReport> {
    return (
      await this.call<VerifyReport>("/v1/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) }, true)
    ).body;
  }

  /** Every published policy, with the SHA-256 of its file. Free. */
  async policies(): Promise<PolicySummary[]> {
    const body = (await this.call<{ policies?: PolicySummary[] } | PolicySummary[]>("/v1/policies")).body;
    return Array.isArray(body) ? body : (body.policies ?? []);
  }

  /** One policy, by id (the latest version) or id@version. Free. */
  async policy(ref: string): Promise<Record<string, unknown>> {
    return (await this.call<Record<string, unknown>>(`/v1/policies/${encodeURIComponent(ref)}`)).body;
  }

  /** Network, wallet and cap alerts, the attester address and each check's miners. Free. */
  async status(): Promise<Record<string, unknown> & { attester?: string | null; walletAlert?: boolean; capAlert?: boolean }> {
    return (await this.call<Record<string, unknown> & { attester?: string | null }>("/v1/status")).body;
  }

  /** The public spend ledger. Free. */
  async ledger(): Promise<Record<string, unknown>> {
    return (await this.call<Record<string, unknown>>("/v1/ledger")).body;
  }

  private partnerHeaders(): Record<string, string> {
    const payer = this.opts.payer;
    if (payer?.kind !== "apiKey") throw new SkeinError("PAYMENT_REQUIRED", "webhooks need a partner API key (payer kind apiKey)", 402);
    return { authorization: `Bearer ${payer.key}` };
  }

  /**
   * Registers (or replaces) the partner's webhook. Keep the returned secret:
   * it is shown once, and verifyWebhook (@skeinlabs/sdk/webhooks) needs it.
   */
  async setWebhook(url: string): Promise<{ url: string; secret: string; events: string[] }> {
    return (
      await this.call<{ url: string; secret: string; events: string[] }>("/v1/webhooks", {
        method: "POST",
        headers: { "content-type": "application/json", ...this.partnerHeaders() },
        body: JSON.stringify({ url }),
      })
    ).body;
  }

  /** The partner's active webhook (never its secret), or null. */
  async webhook(): Promise<{ url: string; createdAt: string } | null> {
    return (await this.call<{ webhook: { url: string; createdAt: string } | null }>("/v1/webhooks", { headers: this.partnerHeaders() })).body.webhook;
  }

  /** Turns the partner's webhook off; true when one was on. */
  async deleteWebhook(): Promise<boolean> {
    return (await this.call<{ deleted: boolean }>("/v1/webhooks", { method: "DELETE", headers: this.partnerHeaders() }, true)).body.deleted;
  }

  /** The live events of a verdict, replayed from the start; ends after done, refused or error. */
  async *stream(id: string, opts: { signal?: AbortSignal } = {}): AsyncGenerator<VerdictEvent> {
    const res = await this.fetch(`${this.base}/v1/verdicts/${encodeURIComponent(id)}/events`, {
      headers: { accept: "text/event-stream" },
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    if (!res.ok || !res.body) throw new SkeinError(`HTTP_${res.status}`, `event stream failed: HTTP ${res.status}`, res.status);
    for await (const raw of parseSse(res.body, opts.signal)) {
      let data: unknown;
      try {
        data = JSON.parse(raw.data);
      } catch {
        continue;
      }
      const e = { type: raw.event, data } as VerdictEvent;
      yield e;
      if (e.type === "done" || e.type === "refused" || e.type === "error") return;
    }
  }

  /**
   * Buys one verdict and returns it once it is sealed. With maxUsdcPerCall
   * set, the price is quoted first and the call refused before any payment.
   */
  async verdict(req: VerdictRequest): Promise<VerdictResult> {
    const payer = this.opts.payer;
    if (!payer) throw new SkeinError("NO_PAYER", "verdict() needs a payer: { kind: 'apiKey', key } or { kind: 'telegraph', client }");
    if (this.opts.maxUsdcPerCall !== undefined) {
      const q = req.quote ?? (await this.quote({ subject: req.subject, ...(req.policy ? { policy: req.policy } : {}) }));
      if (!q.ok && q.refusal) throw new SkeinError(q.refusal.code, q.refusal.detail, q.refusal.code === "BUDGET_TOO_LOW" ? 422 : 503, q.refusal);
      if (q.priceUsdc > this.opts.maxUsdcPerCall) throw new SpendCapError(q.priceUsdc, this.opts.maxUsdcPerCall);
    }
    return payer.kind === "apiKey" ? this.viaApi(req) : this.viaTelegraph(payer, req);
  }

  /**
   * Starts a verdict on the partner-key rail and returns at once: the id while
   * it runs, or the verdict itself when it is cached or replayed. Pair with
   * wait(id). Spend-cap checks are the caller's (verdict() does them).
   */
  async submit(req: VerdictRequest): Promise<{ id: string; status: "running" } | VerdictResult> {
    const payer = this.opts.payer;
    if (payer?.kind !== "apiKey") throw new SkeinError("NO_PAYER", "submit() needs an apiKey payer");
    const { status, body } = await this.call<VerdictObject | { id: string; status: "running" }>(
      "/v1/verdicts",
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${payer.key}`, "idempotency-key": req.idempotencyKey ?? crypto.randomUUID() },
        body: JSON.stringify({
          subject: req.subject,
          ...(req.policy ? { policy: req.policy } : {}),
          ...(canonicalContext(req.context) ? { context: canonicalContext(req.context) } : {}),
          ...(this.opts.maxUsdcPerCall !== undefined ? { budgetUsdcMax: this.opts.maxUsdcPerCall } : {}),
          mode: "async",
        }),
        ...(req.signal ? { signal: req.signal } : {}),
      },
      true,
    );
    return status === 202 ? (body as { id: string; status: "running" }) : { ...(body as VerdictObject), payment: { rail: "apiKey" } };
  }

  /**
   * Waits for a submitted verdict: follows its event stream (falling back to
   * polling if the stream drops) and throws a SkeinError if it is refused.
   */
  async wait(id: string, opts: { onEvent?: (e: VerdictEvent) => void; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<VerdictResult> {
    const deadline = Date.now() + (opts.timeoutMs ?? this.timeoutMs);
    const timeout = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    try {
      for await (const e of this.stream(id, { signal })) {
        opts.onEvent?.(e);
        if (e.type === "refused") throw new SkeinError(e.data.code, e.data.detail, e.data.code === "BUDGET_TOO_LOW" ? 422 : 503, e.data);
        if (e.type === "error") throw new SkeinError("VERDICT_FAILED", e.data.message, 503);
      }
    } catch (e) {
      if (e instanceof SkeinError && !e.code.startsWith("HTTP_")) throw e;
      if (opts.signal?.aborted) throw e;
      // The stream dropped or timed out: fall back to polling until the deadline.
    }
    for (;;) {
      const v = await this.get(id);
      if (!("status" in v && v.status === "running")) return { ...(v as VerdictObject), payment: { rail: "apiKey" } };
      if (Date.now() >= deadline) throw new SkeinError("TIMEOUT", `verdict ${id} is still running; call wait(id) again`, 504, { id });
      await sleep(Math.min(1000, Math.max(0, deadline - Date.now())), opts.signal);
    }
  }

  private async viaApi(req: VerdictRequest): Promise<VerdictResult> {
    const started = await this.submit(req);
    if (!("status" in started && started.status === "running")) return started as VerdictResult;
    return this.wait(started.id, { ...(req.onEvent ? { onEvent: req.onEvent } : {}), ...(req.signal ? { signal: req.signal } : {}) });
  }

  private async viaTelegraph(payer: Extract<Payer, { kind: "telegraph" }>, req: VerdictRequest): Promise<VerdictResult> {
    const params = {
      token: req.subject.token,
      chain: CHAIN_NAMES[req.subject.chainId] ?? String(req.subject.chainId),
      subject: req.subject,
      ...(req.policy ? { policy: req.policy } : {}),
      ...(canonicalContext(req.context) ? { context: canonicalContext(req.context) } : {}),
    };
    const out = await payer.client.ask({ intent: payer.intent ?? SKEIN_INTENT, params }, { ...(payer.minerId ? { minerId: payer.minerId } : {}), timeoutMs: this.timeoutMs });
    if (!out.ok) {
      const paidUusdc = (out as { paidUusdc?: number }).paidUusdc ?? 0;
      throw new SkeinError(
        `TELEGRAPH_${out.kind.toUpperCase()}`,
        out.error,
        out.httpStatus ?? 0,
        undefined,
        paidUusdc > 0 ? { amountUsdc: paidUusdc / 1e6, billing: "unknown" } : undefined,
      );
    }
    const payment: Payment = {
      rail: "telegraph",
      minerId: out.response.miner_id,
      amountUsdc: out.amountUusdc / 1e6,
      receiptHash: out.receipt?.receipt_hash ?? null,
      signalHash: out.response.signal_hash ?? null,
    };
    const paid = { amountUsdc: payment.amountUsdc, billing: "paid" as const, receiptHash: payment.receiptHash };
    // The miner's JSON, either as the result itself or wrapped once by the node.
    const raw = (out.response.result ?? {}) as { id?: string; pending_id?: string; verdict?: string; reasons?: unknown; result?: { id?: string; pending_id?: string } };
    const id = raw.id ?? raw.result?.id;
    const pending = raw.pending_id ?? raw.result?.pending_id;
    if (!id && pending) {
      // The miner answered before its verdict was sealed (its deadline); the verdict is still being made.
      const v = await this.wait(pending, req.signal ? { signal: req.signal } : {});
      return { ...v, payment };
    }
    if (!id) {
      // Paid, but the miner abstained without a verdict (out of budget, upstream down): say what was paid.
      throw new SkeinError("TELEGRAPH_NO_VERDICT", `the miner answered ${raw.verdict ?? "without a verdict"}, with no verdict id`, 502, raw, paid);
    }
    const v = await this.get(id);
    if ("status" in v && v.status === "running") {
      const sealed = await this.wait(id, req.signal ? { signal: req.signal } : {});
      return { ...sealed, payment };
    }
    return { ...(v as VerdictObject), payment };
  }
}
