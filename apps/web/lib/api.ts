import type { ApiError, Bom, PolicyDoc, PolicySummary, VerdictObject } from "./types";

export const API = (process.env.NEXT_PUBLIC_SKEIN_API ?? "http://localhost:8787").replace(/\/$/, "");

export class SkeinError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { cache: "no-store", ...init });
  const json = (await res.json().catch(() => null)) as { error?: ApiError } | null;
  if (!res.ok && res.status !== 202) {
    throw new SkeinError(res.status, json?.error ?? { code: `HTTP_${res.status}`, message: res.statusText });
  }
  return json as T;
}

export const getVerdict = (id: string) => call<VerdictObject | { id: string; status: "running" }>(`/v1/verdicts/${encodeURIComponent(id)}`);
export const getBom = (id: string) => call<Bom>(`/v1/verdicts/${encodeURIComponent(id)}/bom`);
export const getPolicy = (ref: string) => call<PolicyDoc>(`/v1/policies/${encodeURIComponent(ref)}`);
export const listPolicies = () => call<PolicySummary[]>("/v1/policies");
/** The API's own replay (POST /v1/verify). Newer builds add checks; every key in `checks` is shown. */
export interface VerifyReport {
  id: string;
  ok: boolean;
  checks: Record<string, boolean>;
  verdictHash: { stored: string; recomputed: string };
  bomRoot: { stored: string; recomputed: string };
  receipts: string[];
  problems: string[];
  attester?: string;
  /** The Telegraph node's own record of each paid answer (GET /engine/v1/signal/{hash}). */
  signals?: { verified: number; missing: number; mismatch: number; unchecked: number };
  [extra: string]: unknown;
}
export const verify = (id: string) =>
  call<VerifyReport>("/v1/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });

export interface IntentStatus {
  check: string;
  intent: string | null;
  activeMiners: number;
  /** Purchases of this intent over the last 24 h (absent when there were none). */
  calls24h?: number;
  errorRate24h?: number | null;
  p50Ms?: number | null;
  p95Ms?: number | null;
}

export interface Status {
  network: string;
  node: string;
  preSeason: boolean;
  payer: string | null;
  /** The address that signs every verdict (EIP-191). */
  attester?: string | null;
  payerUsdcBalance?: number | null;
  payerEscrowUsdc?: number | null;
  walletAlert?: boolean;
  capAlert?: boolean;
  catalogueFetchedAt: string;
  intents: IntentStatus[];
  spentTodayUsdc: number;
  dailyCapUsdc: number;
  errorsLastHour?: number;
  probeAt?: string | null;
  backupAt?: string | null;
  alertsOpen?: { key: string; since: string | null }[];
  quality?: { windowHours: number; verdicts: number; abstain: number; abstainFailed: number; purchases: number; purchaseErrors: number };
  [extra: string]: unknown;
}
export const getStatus = () => call<Status>("/v1/status");

export interface Ledger {
  network: string;
  verdicts: Record<string, number>;
  upstreamSpendUsdc: number;
  receipts: number;
  minersUsed: number;
  recent: { id: string; verdict: string; createdAt: string }[];
  /** The latest verdict that is not ABSTAIN (newer API builds; null when there is none). */
  latestDecided?: { id: string; verdict: string; createdAt: string } | null;
  /** The same mix over rolling windows (absent on older API builds). */
  last24h?: Record<string, number>;
  last72h?: Record<string, number>;
  abstain?: { total: number; last7d: number; causes: { code: string; check: string; status: string; note: string; n: number; last7d: number }[] };
  /** What verdicts sold are owed to Skein, and what has settled (newer API builds). */
  revenueOwedUsdc?: number;
  revenueSettledUsdc?: number;
  stability?: { definition: string; byEngine: { engine: string; pairs: number; same: number; rate: number | null }[] };
  /** Verdicts per UTC day, where the API reports them. */
  byDay?: { day: string; verdicts?: Record<string, number>; n?: number; upstreamUsdc?: number }[];
  /** Distinct miners paid per check, where the API reports them. */
  minersByCheck?: Record<string, number>;
  [extra: string]: unknown;
}
export const getLedger = () => call<Ledger>("/v1/ledger");

/** GET /v1/quote: what a verdict would buy and cost, before buying. */
export interface Quote {
  subject: { chainId: number; token: string };
  policy: string;
  priceUsdc: number;
  pricing?: string;
  ok: boolean;
  upstreamUsdc?: number;
  checks?: { check: string; intent: string; quoteUsdc: number }[];
  dropped?: { check: string; reason: string }[];
  refusal?: { code: string; detail: string; checks?: string[] };
}
export const getQuote = (q: { chainId: number; token: string; policy: string }) =>
  call<Quote>(`/v1/quote?${new URLSearchParams({ chain: String(q.chainId), token: q.token, policy: q.policy })}`);

/** The API's own OpenAPI document. */
export const getOpenApi = () => call<Record<string, unknown>>("/v1/openapi.json");

export function createVerdict(
  key: string,
  body: { subject: { chainId: number; token: string }; policy: string; context?: Record<string, unknown>; budgetUsdcMax?: number; mode: "async" },
) {
  return call<{ id: string; status: "running" } | VerdictObject>("/v1/verdicts", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}`, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify(body),
  });
}

export const CHAINS: Record<number, string> = { 1: "Ethereum", 8453: "Base", 56: "BNB", 42161: "Arbitrum" };
export const short = (h: string | null | undefined, n = 6) => (h ? `${h.slice(0, n + 2)}…${h.slice(-4)}` : "—");
export const usd = (n: number) => `$${n.toFixed(n < 0.1 ? 3 : 2)}`;

/**
 * One request per resource for every component on a page: the nav, the
 * landing counters and the latest verdict all read /v1/status or /v1/ledger,
 * and share the answer for a few seconds. A failure is not kept.
 */
const sharedCalls = new Map<string, { at: number; p: Promise<unknown> }>();
export function shared<T>(key: string, fn: () => Promise<T>, ttlMs = 10_000): Promise<T> {
  const hit = sharedCalls.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.p as Promise<T>;
  const p = fn();
  sharedCalls.set(key, { at: Date.now(), p });
  p.catch(() => {
    if (sharedCalls.get(key)?.p === p) sharedCalls.delete(key);
  });
  return p;
}
export const sharedStatus = () => shared("status", getStatus);
export const sharedLedger = () => shared("ledger", getLedger);
