import { privateKeyToAccount } from "viem/accounts";
import { SEASON_START, type NetworkConfig } from "./config";
import {
  ChallengeMismatchError,
  decodeReceipt,
  readChallenge,
  receiptProblems,
  signEscrowPayment,
  type MessageSigner,
  type Receipt,
} from "./escrow";

/** POST /engine/v1/ask[/{minerId}] bodies (docs: "Make a Request"). */
export type AskRequest =
  | { intent: string; params?: Record<string, unknown>; query?: string; context?: Record<string, unknown> }
  | {
      method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      endpoint: string;
      payload: Record<string, unknown>;
      /** Runs a request the node's pre-check predicts will fail (a 422); charged only if it runs. */
      acknowledge_warnings?: true;
    };

export interface AskResponse {
  miner_id: string;
  miner_name?: string;
  endpoint?: string;
  result: unknown;
  result_shape?: "intent" | "raw";
  shape_error?: string;
  field_status?: Record<string, "ok" | "missing" | "rejected" | "unavailable">;
  intent?: string;
  cost_usd?: number;
  duration_ms?: number;
  signal_hash?: string;
  warnings?: string[];
}

/** incompatible: the node refused the request before payment (no_compatible_miner, invalid_params); try another miner. */
export type AskFailureKind = "timeout" | "network" | "refused" | "client_error" | "server_error" | "incompatible" | "mismatch" | "preseason";

/**
 * paidUusdc: what was signed and sent with X-PAYMENT on the failing attempt.
 * After a paid POST fails (timeout, dropped connection, 5xx, unreadable 200)
 * the node may still have billed it, so the amount is reported with
 * billing "unknown" and the call is never retried.
 */
export type AskOutcome =
  | {
      ok: true;
      response: AskResponse;
      receipt: Receipt | null;
      /** Why the receipt is not evidence of this purchase; empty when it checks out. */
      receiptProblems: string[];
      httpStatus: number;
      amountUusdc: number;
      durationMs: number;
      attempts: number;
    }
  | {
      ok: false;
      kind: AskFailureKind;
      httpStatus?: number;
      error: string;
      durationMs: number;
      attempts: number;
      paidUusdc: number;
      billing: "none" | "unknown";
    };

export type SignalStatus = "verified" | "missing" | "mismatch" | "unchecked";

export interface MinerRecord {
  id: string;
  slug: string;
  name: string;
  base_url: string;
  supported_intents: string[];
  activation_status: string;
  min_price_usdc: number;
  scored?: boolean;
  total_requests_served?: number;
}

export interface ClientOptions {
  network: NetworkConfig;
  signer?: MessageSigner;
  fetch?: typeof fetch;
  /** Hard cap on what one call may cost, in micro-USDC. */
  maxUusdcPerCall: number;
  now?: () => number;
  nonce?: () => string;
  /** Allow paid calls before the season opens (pre-season smoke tests only; never event evidence). */
  allowPreSeason?: boolean;
}

export class PreSeasonError extends Error {
  readonly code = "PRE_SEASON";
}

export function viemSigner(privateKey: `0x${string}`): MessageSigner {
  const account = privateKeyToAccount(privateKey);
  return { address: account.address, signMessage: (message) => account.signMessage({ message }) };
}

const RETRYABLE: ReadonlySet<AskFailureKind> = new Set(["timeout", "network", "server_error", "refused"]);

export class TelegraphClient {
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly nonce: () => string;

  constructor(private readonly opts: ClientOptions) {
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.now = opts.now ?? Date.now;
    this.nonce = opts.nonce ?? (() => crypto.randomUUID());
  }

  private url(path: string): string {
    return `${this.opts.network.nodeUrl.replace(/\/$/, "")}${path}`;
  }

  private async getJson<T>(path: string): Promise<T> {
    const r = await this.send(path, { method: "GET" }, 15_000);
    if (typeof r === "string") throw new Error(`GET ${path}: ${r}`);
    if (r.status < 200 || r.status >= 300) throw new Error(`GET ${path}: HTTP ${r.status}`);
    return JSON.parse(r.text) as T;
  }

  /**
   * One request with a referenced timer (unlike AbortSignal.timeout(), it keeps
   * a worker or CLI alive while an upstream call hangs) that also covers
   * reading the body, so a slow body cannot hang a verdict.
   */
  private async send(path: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; headers: Headers; text: string } | "timeout" | "network"> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new DOMException("upstream timed out", "TimeoutError")), timeoutMs);
    try {
      const res = await this.fetch(this.url(path), { ...init, signal: ctl.signal });
      const text = (await res.text()).slice(0, 1_000_000);
      return { status: res.status, headers: res.headers, text };
    } catch (e) {
      const err = e as Error;
      return err.name === "TimeoutError" || err.name === "AbortError" ? "timeout" : "network";
    } finally {
      clearTimeout(timer);
    }
  }

  private registrations = new Map<string, { slug: string; intents: string[] } | null>();
  private intentMiners = new Map<string, { at: number; slugById: Map<string, string> }>();

  /**
   * Whether `id`, a registration id from a receipt, names the same miner as
   * the pinned YAML id: the registration gives the miner's slug (its identity:
   * only the wallet holding a slug can register it) and intents; the pinned id
   * must carry that same slug on one of those intents. Small lookups only (the
   * full catalogue is over the body cap), cached; any failure means "not shown
   * to be the same", so the receipt stays flagged.
   */
  async sameMiner(id: string, pinnedYamlId: string): Promise<boolean> {
    try {
      if (!this.registrations.has(id)) {
        type Reg = { slug?: string; supported_intents?: string[] };
        const r = await this.getJson<Reg & { miner?: Reg }>(`/api/miners/${encodeURIComponent(id)}`).catch(() => null);
        const m = r?.miner ?? r; // the node wraps the record in { miner }
        this.registrations.set(id, m?.slug ? { slug: m.slug, intents: m.supported_intents ?? [] } : null);
      }
      const reg = this.registrations.get(id);
      if (!reg) return false;
      for (const intent of reg.intents) {
        let cached = this.intentMiners.get(intent);
        if (!cached || this.now() - cached.at > 10 * 60_000) {
          const d = await this.getIntent(intent).catch(() => null);
          const miners = ((d as { miners?: { id: string | number; slug: string }[] } | null)?.miners ?? []);
          cached = { at: this.now(), slugById: new Map(miners.map((m) => [String(m.id), m.slug])) };
          this.intentMiners.set(intent, cached);
        }
        const slug = cached.slugById.get(pinnedYamlId);
        if (slug !== undefined) return slug === reg.slug;
      }
      return false;
    } catch {
      return false;
    }
  }

  listMiners(q: { intent?: string; status?: string; limit?: number } = {}): Promise<MinerRecord[]> {
    const p = new URLSearchParams();
    if (q.intent) p.set("intent", q.intent);
    if (q.status) p.set("status", q.status);
    if (q.limit) p.set("limit", String(q.limit));
    return this.getJson(`/api/miners${p.size ? `?${p}` : ""}`);
  }

  getIntents(): Promise<{ count: number; intents: { intent_id: string; miner_count: number; canonical: boolean }[] }> {
    return this.getJson("/engine/v1/intents");
  }

  getIntent(intent: string): Promise<Record<string, unknown>> {
    return this.getJson(`/engine/v1/intents/${encodeURIComponent(intent)}`);
  }

  getSignal(signalHash: string): Promise<Record<string, unknown>> {
    return this.getJson(`/engine/v1/signal/${encodeURIComponent(signalHash)}`);
  }

  /**
   * Looks a paid answer's signal_hash up on the node, the network's own record
   * of it. "verified": the node has the signal (and, when it says which miner,
   * that miner is the one paid); "missing": the node has no such signal;
   * "mismatch": it does, from another miner; "unchecked": the node did not answer.
   */
  async verifySignal(signalHash: string | undefined, expect: { minerId?: string } = {}): Promise<SignalStatus> {
    if (!signalHash || !/^0x[0-9a-fA-F]{64}$/.test(signalHash)) return "missing";
    const r = await this.send(`/engine/v1/signal/${encodeURIComponent(signalHash)}`, { method: "GET" }, 10_000);
    if (typeof r === "string" || r.status >= 500) return "unchecked";
    if (r.status === 404) return "missing";
    if (r.status < 200 || r.status >= 300) return "unchecked";
    const body = parseJson(r.text) as { miner_id?: unknown; minerId?: unknown } | null;
    const miner = body?.miner_id ?? body?.minerId;
    if (expect.minerId && miner !== undefined && miner !== null && String(miner) !== expect.minerId) return "mismatch";
    return "verified";
  }

  /**
   * Buys one answer on the escrow rail. Failures before payment (no answer to
   * the unpaid probe, a 5xx) and an explicit 402 refusal of the payment are
   * retried once with a fresh challenge and nonce: nothing was billed. A
   * failure after X-PAYMENT was sent is never retried, because the node may
   * have billed it; it comes back with paidUusdc set and billing "unknown".
   * maxUusdc lowers the client-wide cap for this one call.
   */
  async ask(req: AskRequest, opts: { minerId?: string; timeoutMs: number; maxUusdc?: number }): Promise<AskOutcome> {
    const started = this.now();
    let last: AskOutcome | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const out = await this.attempt(req, opts, started, attempt);
      if (out.ok || out.billing === "unknown" || !RETRYABLE.has(out.kind)) return out;
      last = out;
    }
    return last!;
  }

  private async attempt(req: AskRequest, opts: { minerId?: string; timeoutMs: number; maxUusdc?: number }, started: number, attempts: number): Promise<AskOutcome> {
    const path = opts.minerId ? `/engine/v1/ask/${encodeURIComponent(opts.minerId)}` : "/engine/v1/ask";
    const body = JSON.stringify(req);
    const fail = (kind: AskFailureKind, error: string, httpStatus?: number, paidUusdc = 0): AskOutcome => ({
      ok: false, kind, error, durationMs: this.now() - started, attempts, paidUusdc, billing: paidUusdc > 0 ? "unknown" : "none",
      ...(httpStatus !== undefined ? { httpStatus } : {}),
    });
    const post = (headers: Record<string, string>) =>
      this.send(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body }, opts.timeoutMs);

    const challenge = await post({});
    if (typeof challenge === "string") return fail(challenge, `unpaid request: ${challenge}`);
    if (challenge.status !== 402) {
      const msg = challenge.text.slice(0, 2000);
      let err: string | undefined;
      try {
        err = (JSON.parse(msg) as { error?: string }).error;
      } catch {
        // not JSON: classify by status alone
      }
      // A 2xx to an unpaid ask is an answer nobody paid for: not evidence; try another miner.
      const kind: AskFailureKind =
        challenge.status < 300 || err === "no_compatible_miner" || err === "invalid_params" || err === "no_input_schema" || err === "intent_required"
          ? "incompatible"
          : challenge.status >= 500 ? "server_error" : "client_error";
      return fail(kind, `expected 402, got ${challenge.status}: ${msg}`, challenge.status);
    }
    const parsed = readChallenge(challenge.headers.get("payment-required"), parseJson(challenge.text));
    if (!parsed) return fail("mismatch", "the node offered no escrow scheme", 402);

    if (!this.opts.allowPreSeason && this.now() < SEASON_START) {
      return fail("preseason", "paid calls are refused before the season opens (Nov 1 UTC)");
    }
    if (!this.opts.signer) return fail("mismatch", "no signer configured");

    const maxUusdc = Math.min(this.opts.maxUusdcPerCall, opts.maxUusdc ?? Infinity);
    let signed;
    try {
      signed = await signEscrowPayment({
        accept: parsed.escrow,
        assets: parsed.assets,
        signer: this.opts.signer,
        expected: {
          caip2: this.opts.network.caip2,
          diamond: this.opts.network.diamond,
          usdc: this.opts.network.usdc,
          maxUusdc,
          // A pinned ask must be for that miner's resource, not another's.
          ...(opts.minerId ? { resource: `/v1/ask/${opts.minerId}` } : {}),
        },
        nowSec: Math.floor(this.now() / 1000),
        nonce: this.nonce(),
      });
    } catch (e) {
      if (e instanceof ChallengeMismatchError) return fail("mismatch", e.message, 402);
      throw e;
    }

    const paid = await post({ "X-PAYMENT": signed.header });
    const sent = signed.amountUusdc;
    if (typeof paid === "string") return fail(paid, `paid request: ${paid}`, undefined, sent);
    if (paid.status === 402) {
      // An explicit refusal of the payment (nonce, window, amount, balance): not billed.
      const reason = parseJson(paid.text) as { reason?: string; error?: string } | null;
      return fail("refused", `payment refused: ${reason?.reason ?? reason?.error ?? "no reason given"}`, 402);
    }
    if (paid.status < 200 || paid.status >= 300) {
      return fail(paid.status >= 500 ? "server_error" : "client_error", `HTTP ${paid.status}: ${paid.text.slice(0, 2000)}`, paid.status, sent);
    }
    const response = parseJson(paid.text) as AskResponse | null;
    if (!response || typeof response !== "object") return fail("server_error", "200 with a body that is not JSON", paid.status, sent);
    const receipt = decodeReceipt(paid.headers.get("x-payment-response"));
    // Miner identity is checked by slug below: receipts name the on-chain registration id,
    // the catalogue (and so the pin) the YAML id, two numbers for one miner.
    const problems = receiptProblems(receipt, { payer: signed.authorization.from, amountUusdc: sent });
    if (opts.minerId) {
      for (const [what, id] of [["receipt miner", receipt?.miner], ["answered by miner", response.miner_id]] as const) {
        if (id === undefined || id === null || String(id) === opts.minerId) continue;
        if (!(await this.sameMiner(String(id), opts.minerId))) problems.push(`${what} ${id}, pinned ${opts.minerId}`);
      }
    }
    return {
      ok: true,
      response,
      receipt,
      receiptProblems: problems,
      httpStatus: paid.status,
      amountUusdc: sent,
      durationMs: this.now() - started,
      attempts,
    };
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
