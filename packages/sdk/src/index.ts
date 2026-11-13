import { parseSse } from "./sse";
import type { Bom, Quote, Subject, TelegraphAsker, VerdictEvent, VerdictObject, VerifyReport } from "./types";
import { chooseRequirements, readPaymentResponse, signX402Payment, X402MismatchError, type X402Account, type X402Network } from "./x402";

export * from "./types";
export { parseSse } from "./sse";
export { X402_NETWORKS, X402MismatchError, chooseRequirements, signX402Payment, readPaymentResponse } from "./x402";
export type { X402Account, X402Network, X402Requirements, X402Expectations, X402TypedData, X402Payment } from "./x402";

/**
 * The canonical Telegraph intent Skein's miner is registered on (plan B; see
 * docs/guides/MINER_REGISTRATION.md and miner/skein-miner.plan-b.yaml).
 */
export const SKEIN_INTENT = "FRAUD_RISK_GENERAL";
/** Skein's miner in the Telegraph catalogue: what a pinned ask names (/engine/v1/ask/845301). */
export const SKEIN_MINER_ID = "845301";
/**
 * Every id Skein's miner answers under: its catalogue id, and its on-chain
 * registration id (5137), which receipts name. An answer from any other miner
 * is refused.
 */
export const SKEIN_MINER_IDS: readonly string[] = [SKEIN_MINER_ID, "5137"];

const CHAIN_NAMES: Record<number, string> = { 1: "ethereum", 56: "bsc", 8453: "base", 42161: "arbitrum" };

/** A subject as FRAUD_RISK_GENERAL's `subject` string: "base:0x…", or CAIP-10 for a chain with no name. */
export function subjectText(s: Subject): string {
  const name = CHAIN_NAMES[s.chainId];
  return name ? `${name}:${s.token}` : `eip155:${s.chainId}:${s.token}`;
}

/**
 * How a verdict is paid for:
 * - apiKey: a Skein partner key against the HTTP API (free during the hackathon);
 * - telegraph: one paid Telegraph ask, pinned to Skein's miner (SKEIN_MINER_ID)
 *   unless `minerId` names another. `client` is any Telegraph client, e.g. new
 *   TelegraphClient(...) from @skeinlabs/sdk/telegraph, which enforces its own
 *   per-call price cap on the 402 challenge. The answer is accepted only from a
 *   miner in `expectedMinerIds` (default SKEIN_MINER_IDS plus the pinned id) and
 *   only for the subject and policy asked; otherwise TelegraphMismatchError,
 *   with what was paid. `routed: true` lets the network pick the miner instead:
 *   any of the intent's miners may then answer, and a non-Skein answer is paid
 *   for and refused. The rail carries no context (Skein's miner endpoint takes a
 *   subject and a policy): context is left out, and the payment's
 *   `contextDropped` names what was; `strictContext: true` refuses such a
 *   request before paying instead;
 * - x402: pays the direct API per verdict with a signed USDC authorization
 *   (EIP-3009). Nothing is signed unless the 402 names the pinned network,
 *   payTo and asset, at a price within maxUsdc (and the client's maxUsdcPerCall).
 */
export type Payer =
  | { kind: "apiKey"; key: string }
  | { kind: "telegraph"; client: TelegraphAsker; minerId?: string; intent?: string; routed?: boolean; expectedMinerIds?: readonly string[]; strictContext?: boolean }
  | { kind: "x402"; account: X402Account; network: X402Network; payTo: string; asset?: string; maxUsdc?: number };

export type PayerByRail = { [K in Payer["kind"]]: Extract<Payer, { kind: K }> };
/** How a client pays: "apiKey", "telegraph" or "x402". */
export type Rail = Payer["kind"];
/**
 * The rails a plain `Skein` (no type argument) is typed for, as before x402:
 * code that switches over payment.rail keeps compiling. A client made with an
 * x402 payer is a Skein<"x402">, whose verdicts carry the x402 payment.
 */
export type DefaultRail = "apiKey" | "telegraph";

export interface SkeinOptions<R extends Rail = DefaultRail> {
  /** e.g. https://api.skeinlabs.site (with or without /v1). */
  apiUrl: string;
  payer?: PayerByRail[R] & { kind: R };
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
  | {
      rail: "telegraph";
      minerId: string;
      amountUsdc: number;
      receiptHash: string | null;
      signalHash: string | null;
      /** Why the Telegraph client does not take the receipt as evidence of this purchase; empty when it checks out. */
      receiptProblems?: string[];
      /** The request's context fields the rail could not carry: the verdict was bought without them. */
      contextDropped?: string[];
    }
  | {
      rail: "x402";
      /** What was settled: 0 when the authorization was not settled (an ABSTAIN is never charged). */
      amountUsdc: number;
      settled: boolean;
      network: string;
      payer: string;
      transaction: string | null;
    };

/** Each rail's payment, by rail (an indexed type, so a Skein<"telegraph"> is assignable to a Skein). */
export type PaymentByRail = { [K in Payment["rail"]]: Extract<Payment, { rail: K }> };
export type VerdictResult<R extends Rail = DefaultRail> = VerdictObject & { payment: PaymentByRail[R] };

/** One entry of GET /v1/policies. */
export interface PolicySummary {
  id: string;
  version: string;
  ref?: string;
  sha256?: string;
  description?: string;
  [k: string]: unknown;
}

/**
 * What a failed call cost. billing "paid": the ask was billed (a receipt came
 * back); "unknown": the payment was sent and the call failed, so it may have
 * been billed. minerId: the miner paid (Telegraph), when known.
 */
export interface FailurePayment {
  amountUsdc: number;
  billing: "paid" | "unknown";
  receiptHash?: string | null;
  minerId?: string | null;
}

/** Every API error, with the API's code (BUDGET_TOO_LOW, RATE_LIMITED, …) or an SDK code. */
export class SkeinError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 0,
    readonly details?: unknown,
    /**
     * Set when money moved (or may have) before the failure: a Telegraph ask
     * or an x402 authorization that was paid (or sent) but produced no usable
     * verdict, whatever failed after it (the miner's answer, reading or
     * waiting for the verdict, a subject or policy mismatch). The one place a
     * failure's cost is reported: count it against your caps.
     */
    readonly payment?: FailurePayment,
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

/**
 * A paid Telegraph answer that is not about what was asked: another token,
 * another policy, or a miner that is not Skein's. The ask was paid: `payment`
 * says how much. Never act on such an answer.
 */
export class TelegraphMismatchError extends SkeinError {
  constructor(message: string, details: unknown, payment: FailurePayment) {
    super("TELEGRAPH_MISMATCH", message, 502, details, payment);
    this.name = "TelegraphMismatchError";
  }
}

/** Refusals that will not change on retry. */
const FINAL = new Set(["UPSTREAM_UNAVAILABLE", "DAILY_CAP_REACHED", "MARGIN_GUARD", "SELF_ROUTING", "BUDGET_TOO_LOW"]);
/**
 * A replica draining for a deploy answers 503 "restarting", which a retry with
 * the same idempotency key gets past. The API sends it as UPSTREAM_UNAVAILABLE
 * with a restarting message; a later API may name it RESTARTING.
 */
const isRestarting = (err: { code: string; message?: string }) => err.code === "RESTARTING" || (err.code === "UPSTREAM_UNAVAILABLE" && /restarting/i.test(err.message ?? ""));
const isFinal = (err: { code: string; message?: string }) => FINAL.has(err.code) && !isRestarting(err);

/** "id@version" or "id", as a request names a policy. */
const policyRef = (p: string) => {
  const at = p.indexOf("@");
  return at < 0 ? { id: p } : { id: p.slice(0, at), version: p.slice(at + 1) };
};

/** Why a verdict is not the one asked for (its subject, then its policy); empty when it is. */
export function bindingProblems(v: Pick<VerdictObject, "subject" | "policy">, req: { subject: Subject; policy?: string }): string[] {
  const problems: string[] = [];
  const s = v.subject;
  if (!s || s.chainId !== req.subject.chainId || String(s.token).toLowerCase() !== req.subject.token.toLowerCase()) {
    problems.push(`the verdict is for ${s ? `${s.chainId}:${s.token}` : "no subject"}, not ${req.subject.chainId}:${req.subject.token}`);
  }
  if (req.policy) {
    const want = policyRef(req.policy);
    if (!v.policy || v.policy.id !== want.id || (want.version !== undefined && v.policy.version !== want.version)) {
      problems.push(`the verdict is under ${v.policy ? `${v.policy.id}@${v.policy.version}` : "no policy"}, not ${req.policy}`);
    }
  }
  return problems;
}
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });

export class Skein<R extends Rail = DefaultRail> {
  private readonly base: string;
  private readonly fetch: typeof fetch;
  private readonly retries: number;
  private readonly timeoutMs: number;

  // Kept as SkeinOptions<Rail>: R then appears only in what verdict() returns, so a
  // Skein<"telegraph"> is a Skein (of its default rails), as before x402.
  private readonly opts: SkeinOptions<Rail>;

  constructor(opts: SkeinOptions<R>) {
    this.opts = opts as unknown as SkeinOptions<Rail>;
    this.base = opts.apiUrl.replace(/\/$/, "").replace(/\/v1$/, "");
    this.fetch = opts.fetch ?? ((...a) => globalThis.fetch(...a));
    this.retries = opts.retries ?? 2;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.maxRetryWaitMs = opts.maxRetryWaitMs ?? 10_000;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 15_000;
  }

  private readonly maxRetryWaitMs: number;
  private readonly requestTimeoutMs: number;

  /** How this client pays: "apiKey", "telegraph" or "x402"; undefined with no payer. */
  get rail(): Payer["kind"] | undefined {
    return this.opts.payer?.kind;
  }

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
      const again = retryable && attempt < this.retries && (res.status === 429 || (res.status >= 500 && !isFinal(err)))&& waited + wait <= this.maxRetryWaitMs;
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
    const payer = this.opts.payer as Payer | undefined;
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
  async verdict(req: VerdictRequest): Promise<VerdictResult<R>> {
    const payer = this.opts.payer as Payer | undefined;
    if (!payer) throw new SkeinError("NO_PAYER", "verdict() needs a payer: { kind: 'apiKey', key }, { kind: 'telegraph', client } or { kind: 'x402', account, network, payTo }");
    if (payer.kind === "telegraph" && payer.strictContext && canonicalContext(req.context)) {
      // Skein's miner endpoint, like the intent's request schema, takes a subject and a policy only.
      throw new SkeinError(
        "CONTEXT_NOT_SUPPORTED",
        "the Telegraph rail sends only the subject and the policy, so context (socialHandle, repoUrl, pool, …) cannot be used; nothing was paid. Use the partner-key or x402 rail for checks that need context, or leave strictContext off to buy without it",
        400,
      );
    }
    if (this.opts.maxUsdcPerCall !== undefined) {
      const q = req.quote ?? (await this.quote({ subject: req.subject, ...(req.policy ? { policy: req.policy } : {}) }));
      if (!q.ok && q.refusal) throw new SkeinError(q.refusal.code, q.refusal.detail, q.refusal.code === "BUDGET_TOO_LOW" ? 422 : 503, q.refusal);
      if (q.priceUsdc > this.opts.maxUsdcPerCall) throw new SpendCapError(q.priceUsdc, this.opts.maxUsdcPerCall);
    }
    const v = payer.kind === "apiKey" ? await this.viaApi(req) : payer.kind === "x402" ? await this.viaX402(payer, req) : await this.viaTelegraph(payer, req);
    return v as VerdictResult<R>;
  }

  /**
   * Starts a verdict on the partner-key rail and returns at once: the id while
   * it runs, or the verdict itself when it is cached or replayed. Pair with
   * wait(id). Spend-cap checks are the caller's (verdict() does them).
   */
  async submit(req: VerdictRequest): Promise<{ id: string; status: "running" } | VerdictResult> {
    const payer = this.opts.payer as Payer | undefined;
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
    const intent = payer.intent ?? SKEIN_INTENT;
    const dropped = Object.keys(canonicalContext(req.context) ?? {});
    // FRAUD_RISK_GENERAL declares one string `subject` and an optional `policy`
    // (miner/skein-miner.plan-b.yaml); plan A's draft declared token and chain.
    const params: Record<string, unknown> =
      intent === "FRAUD_RISK_TOKEN_LISTING"
        ? { token: req.subject.token, chain: CHAIN_NAMES[req.subject.chainId] ?? String(req.subject.chainId) }
        : { subject: subjectText(req.subject) };
    if (req.policy) params.policy = req.policy;
    const minerId = payer.routed ? undefined : (payer.minerId ?? SKEIN_MINER_ID);
    const expected = new Set([...(payer.expectedMinerIds ?? SKEIN_MINER_IDS), ...(minerId ? [minerId] : [])].map(String));
    // One absolute deadline for the whole ask (probe, payment, retry, identity lookups).
    const out = await payer.client.ask({ intent, params }, { ...(minerId ? { minerId } : {}), timeoutMs: this.timeoutMs, deadline: Date.now() + this.timeoutMs });
    if (!out.ok) {
      const paidUusdc = out.paidUusdc ?? 0;
      throw new SkeinError(
        `TELEGRAPH_${out.kind.toUpperCase()}`,
        out.error,
        out.httpStatus ?? 0,
        undefined,
        paidUusdc > 0 ? { amountUsdc: paidUusdc / 1e6, billing: "unknown", receiptHash: null, minerId: minerId ?? null } : undefined,
      );
    }
    const receiptProblems = out.receiptProblems ?? [];
    const payment: Payment = {
      rail: "telegraph",
      minerId: String(out.response.miner_id),
      amountUsdc: out.amountUusdc / 1e6,
      receiptHash: out.receipt?.receipt_hash ?? null,
      signalHash: out.response.signal_hash ?? null,
      ...(receiptProblems.length ? { receiptProblems } : {}),
      ...(dropped.length ? { contextDropped: dropped } : {}),
    };
    const paid: FailurePayment = { amountUsdc: payment.amountUsdc, billing: "paid", receiptHash: payment.receiptHash, minerId: payment.minerId };
    // Only Skein's miner answers with a Skein verdict id. Another miner on the
    // intent could return the id of a real, signed verdict for another token.
    const receiptMiner = out.receipt?.miner;
    const strangers = [out.response.miner_id, receiptMiner].filter((m) => m !== undefined && m !== null && !expected.has(String(m)));
    if (strangers.length) {
      throw new TelegraphMismatchError(`answered by miner ${strangers.map(String).join(", ")}, which is not Skein's (${[...expected].join(", ")}); the answer is not used`, { minerId: out.response.miner_id, receiptMiner }, paid);
    }
    try {
      // The miner's JSON, either as the result itself or wrapped once by the node.
      const raw = (out.response.result ?? {}) as { id?: string; pending_id?: string; verdict?: string; reasons?: unknown; result?: { id?: string; pending_id?: string } };
      const id = raw.id ?? raw.result?.id;
      const pending = raw.pending_id ?? raw.result?.pending_id;
      let v: VerdictObject;
      if (!id && pending) {
        // The miner answered before its verdict was sealed (its deadline); the verdict is still being made.
        v = await this.wait(pending, req.signal ? { signal: req.signal } : {});
      } else if (!id) {
        // Paid, but the miner abstained without a verdict (out of budget, upstream down): say what was paid.
        throw new SkeinError("TELEGRAPH_NO_VERDICT", `the miner answered ${raw.verdict ?? "without a verdict"}, with no verdict id`, 502, raw, paid);
      } else {
        const got = await this.get(id);
        v = "status" in got && got.status === "running" ? await this.wait(id, req.signal ? { signal: req.signal } : {}) : (got as VerdictObject);
      }
      // The verdict must be about what was asked: a valid, signed verdict for another token is still the wrong answer.
      const problems = bindingProblems(v, req);
      if (problems.length) throw new TelegraphMismatchError(`${problems.join("; ")}; the answer is not used`, { id: v.id, subject: v.subject, policy: v.policy }, paid);
      const { payment: _, ...verdict } = v as VerdictResult;
      return { ...verdict, payment };
    } catch (e) {
      // Whatever went wrong after the ask, it was paid: say so.
      if (e instanceof SkeinError && !e.payment) throw new SkeinError(e.code, e.message, e.status, e.details, paid);
      throw e;
    }
  }

  /**
   * One verdict paid with x402: the unpaid request returns the 402 terms; they
   * are checked against the payer's pins and signed once; the paid request is
   * retried only with that same X-PAYMENT, so a retry can never pay twice (the
   * API keys the run on the authorization).
   */
  private async viaX402(payer: Extract<Payer, { kind: "x402" }>, req: VerdictRequest): Promise<VerdictResult<"x402">> {
    const caps = [payer.maxUsdc, this.opts.maxUsdcPerCall].filter((x): x is number => typeof x === "number" && Number.isFinite(x) && x > 0);
    if (!caps.length) throw new SkeinError("NO_PRICE_CAP", "the x402 payer needs a price cap: set payer.maxUsdc or maxUsdcPerCall; nothing was signed", 400);
    const maxUusdc = Math.round(Math.min(...caps) * 1e6);
    const url = `${this.base}/v1/verdicts`;
    const context = canonicalContext(req.context);
    const body = JSON.stringify({
      subject: req.subject,
      ...(req.policy ? { policy: req.policy } : {}),
      ...(context ? { context } : {}),
      ...(this.opts.maxUsdcPerCall !== undefined ? { budgetUsdcMax: this.opts.maxUsdcPerCall } : {}),
    });
    const post = (headers: Record<string, string>) =>
      this.request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body, ...(req.signal ? { signal: req.signal } : {}) });
    const apiError = (status: number, json: unknown, fallback: string) => {
      const err = (json as { error?: { code: string; message: string; details?: unknown } } | null)?.error;
      return { code: err?.code ?? `HTTP_${status}`, message: err?.message ?? fallback, details: err?.details };
    };

    // 1. The terms, from an unpaid request (nothing is bought without X-PAYMENT).
    let challenge: { res: Response; json: unknown };
    try {
      challenge = await post({});
    } catch (e) {
      if (req.signal?.aborted) throw e;
      throw new SkeinError("NETWORK", `could not reach Skein: ${(e as Error).message}`);
    }
    if (challenge.res.status !== 402) {
      const err = apiError(challenge.res.status, challenge.json, challenge.res.statusText);
      throw new SkeinError(challenge.res.ok ? "X402_NOT_OFFERED" : err.code, challenge.res.ok ? "the API answered an unpaid request without a 402" : err.message, challenge.res.status, err.details);
    }
    let payment: Awaited<ReturnType<typeof signX402Payment>>;
    try {
      const terms = chooseRequirements((challenge.json as { accepts?: unknown } | null)?.accepts, { network: payer.network, payTo: payer.payTo, maxUusdc, ...(payer.asset ? { asset: payer.asset } : {}) });
      payment = await signX402Payment(terms, payer.account);
    } catch (e) {
      if (e instanceof X402MismatchError) throw new SkeinError(e.code, `${e.message}; nothing was signed`, 402, (challenge.json as { accepts?: unknown } | null)?.accepts);
      throw e;
    }
    // From here the authorization exists: until it lapses, a failure may still have been settled.
    const sent = { amountUsdc: payment.amountUusdc / 1e6, billing: "unknown" as const };

    // 2. The paid request; every retry resends the same X-PAYMENT.
    let waited = 0;
    for (let attempt = 0; ; attempt++) {
      const backoff = (after?: string | null) => {
        const s = Number(after);
        return Number.isFinite(s) && s > 0 ? s * 1000 : 500 * 2 ** attempt;
      };
      const again = async (ms: number) => {
        if (attempt >= this.retries + 1 || waited + ms > this.maxRetryWaitMs) return false;
        waited += ms;
        await sleep(ms, req.signal);
        return true;
      };
      let r: { res: Response; json: unknown };
      try {
        r = await post({ "x-payment": payment.header });
      } catch (e) {
        if (req.signal?.aborted) throw e;
        if (await again(backoff())) continue;
        throw new SkeinError("NETWORK", `the paid request failed: ${(e as Error).message}; resend it with the same X-PAYMENT`, 0, { xPayment: payment.header }, sent);
      }
      const { res, json } = r;
      if (res.ok && res.status !== 202) {
        const v = json as VerdictObject;
        const problems = bindingProblems(v, req);
        if (problems.length) throw new SkeinError("X402_MISMATCH", `${problems.join("; ")}; the answer is not used`, 502, { id: v.id }, sent);
        const settledTo = readPaymentResponse(res.headers.get("x-payment-response"));
        const settled = settledTo !== null;
        const { payment: _, ...verdict } = v as VerdictResult;
        return {
          ...verdict,
          payment: {
            rail: "x402",
            amountUsdc: settled ? payment.amountUusdc / 1e6 : 0,
            settled,
            network: settledTo?.network ?? payer.network,
            payer: settledTo?.payer ?? payment.from,
            transaction: settledTo?.transaction ?? null,
          },
        };
      }
      const err = apiError(res.status, json, res.statusText);
      // Still running (a replay of a run in flight, or a sync timeout): wait for the seal, then resend to settle and receive it.
      const running = res.status === 202 ? (json as { id?: string }).id : err.code === "TIMEOUT" ? (err.details as { id?: string } | undefined)?.id : undefined;
      if (running) {
        try {
          await this.wait(running, req.signal ? { signal: req.signal } : {});
        } catch (e) {
          if (e instanceof SkeinError && !e.payment) throw new SkeinError(e.code, e.message, e.status, e.details, sent);
          throw e;
        }
        if (attempt < this.retries + 2) continue;
        throw new SkeinError("TIMEOUT", `verdict ${running} is sealed but was not delivered; resend the same X-PAYMENT to receive it`, 504, { id: running, xPayment: payment.header }, sent);
      }
      if (res.status === 402) {
        // Sealed, but settlement failed: the API asks for the same X-PAYMENT again.
        const unsettled = /same X-PAYMENT/i.test(err.message);
        if (unsettled && (await again(backoff(res.headers.get("retry-after"))))) continue;
        // An explicit refusal of the payment: nothing was settled.
        throw new SkeinError("PAYMENT_REFUSED", err.message, 402, { accepts: (json as { accepts?: unknown } | null)?.accepts, xPayment: payment.header }, unsettled ? sent : undefined);
      }
      if ((res.status === 429 || (res.status >= 500 && !isFinal(err))) && (await again(backoff(res.headers.get("retry-after"))))) continue;
      throw new SkeinError(err.code, err.message, res.status, err.details, sent);
    }
  }
}
