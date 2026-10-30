import { privateKeyToAccount } from "viem/accounts";
import { SEASON_START, type NetworkConfig } from "./config";
import {
  ChallengeMismatchError,
  decodeReceipt,
  findEscrowAccept,
  signEscrowPayment,
  type MessageSigner,
  type Receipt,
} from "./escrow";

/** POST /engine/v1/ask[/{minerId}] bodies (docs: "Make a Request"). */
export type AskRequest =
  | { intent: string; params?: Record<string, unknown>; query?: string; context?: Record<string, unknown> }
  | { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; endpoint: string; payload: Record<string, unknown> };

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

export type AskOutcome =
  | { ok: true; response: AskResponse; receipt: Receipt | null; httpStatus: number; amountUusdc: number; durationMs: number; attempts: number }
  | { ok: false; kind: AskFailureKind; httpStatus?: number; error: string; durationMs: number; attempts: number };

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
    const res = await this.fetch(this.url(path), { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
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
   * Buys one answer on the escrow rail. A failed attempt is retried once
   * (timeout, network, 5xx, or a 402 refusal) with a fresh challenge and a
   * fresh nonce; a 4xx is never retried. Failed calls are not billed.
   */
  async ask(req: AskRequest, opts: { minerId?: string; timeoutMs: number }): Promise<AskOutcome> {
    const started = this.now();
    let last: AskOutcome | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const out = await this.attempt(req, opts, started, attempt);
      if (out.ok || !RETRYABLE.has(out.kind)) return out;
      last = out;
    }
    return last!;
  }

  private async attempt(req: AskRequest, opts: { minerId?: string; timeoutMs: number }, started: number, attempts: number): Promise<AskOutcome> {
    const path = opts.minerId ? `/engine/v1/ask/${encodeURIComponent(opts.minerId)}` : "/engine/v1/ask";
    const body = JSON.stringify(req);
    const fail = (kind: AskFailureKind, error: string, httpStatus?: number): AskOutcome => ({
      ok: false, kind, error, durationMs: this.now() - started, attempts, ...(httpStatus !== undefined ? { httpStatus } : {}),
    });
    const post = async (headers: Record<string, string>) => {
      // A referenced timer, unlike AbortSignal.timeout(), keeps a worker or
      // CLI process alive while an upstream call hangs.
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(new DOMException("upstream timed out", "TimeoutError")), opts.timeoutMs);
      try {
        return await this.fetch(this.url(path), {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body,
          signal: ctl.signal,
        });
      } catch (e) {
        const err = e as Error;
        return err.name === "TimeoutError" || err.name === "AbortError" ? ("timeout" as const) : ("network" as const);
      } finally {
        clearTimeout(timer);
      }
    };

    const challenge = await post({});
    if (typeof challenge === "string") return fail(challenge, `unpaid request: ${challenge}`);
    if (challenge.status !== 402) {
      const msg = await safeText(challenge);
      let err: string | undefined;
      try {
        err = (JSON.parse(msg) as { error?: string }).error;
      } catch {
        // not JSON: classify by status alone
      }
      const kind: AskFailureKind =
        err === "no_compatible_miner" || err === "invalid_params" || err === "no_input_schema" || err === "intent_required"
          ? "incompatible"
          : challenge.status >= 500 ? "server_error" : "client_error";
      return fail(kind, `expected 402, got ${challenge.status}: ${msg}`, challenge.status);
    }
    const accept = findEscrowAccept(challenge.headers.get("payment-required"), await safeJson(challenge));
    if (!accept) return fail("mismatch", "the node offered no escrow scheme", 402);

    if (!this.opts.allowPreSeason && this.now() < SEASON_START) {
      return fail("preseason", "paid calls are refused before the season opens (Nov 1 UTC)");
    }
    if (!this.opts.signer) return fail("mismatch", "no signer configured");

    let signed;
    try {
      signed = await signEscrowPayment({
        accept,
        signer: this.opts.signer,
        expected: { caip2: this.opts.network.caip2, diamond: this.opts.network.diamond, maxUusdc: this.opts.maxUusdcPerCall },
        nowSec: Math.floor(this.now() / 1000),
        nonce: this.nonce(),
      });
    } catch (e) {
      if (e instanceof ChallengeMismatchError) return fail("mismatch", e.message, 402);
      throw e;
    }

    const paid = await post({ "X-PAYMENT": signed.header });
    if (typeof paid === "string") return fail(paid, `paid request: ${paid}`);
    if (paid.status === 402) {
      const reason = ((await safeJson(paid)) as { reason?: string; error?: string } | null);
      return fail("refused", `payment refused: ${reason?.reason ?? reason?.error ?? "no reason given"}`, 402);
    }
    if (!paid.ok) {
      const msg = await safeText(paid);
      return fail(paid.status >= 500 ? "server_error" : "client_error", `HTTP ${paid.status}: ${msg}`, paid.status);
    }
    const response = (await safeJson(paid)) as AskResponse | null;
    if (!response) return fail("server_error", "200 with a body that is not JSON", paid.status);
    return {
      ok: true,
      response,
      receipt: decodeReceipt(paid.headers.get("x-payment-response") ?? paid.headers.get("x-telegraph-receipt")),
      httpStatus: paid.status,
      amountUusdc: signed.amountUusdc,
      durationMs: this.now() - started,
      attempts,
    };
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.clone().json();
  } catch {
    return null;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 2000);
  } catch {
    return "";
  }
}
