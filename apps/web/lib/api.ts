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

export const getVerdict = (id: string) => call<VerdictObject | { id: string; status: "running" }>(`/v1/verdicts/${id}`);
export const getBom = (id: string) => call<Bom>(`/v1/verdicts/${id}/bom`);
export const getPolicy = (ref: string) => call<PolicyDoc>(`/v1/policies/${encodeURIComponent(ref)}`);
export const listPolicies = () => call<PolicySummary[]>("/v1/policies");
export const verify = (id: string) =>
  call<{
    id: string;
    ok: boolean;
    checks: Record<string, boolean>;
    verdictHash: { stored: string; recomputed: string };
    bomRoot: { stored: string; recomputed: string };
    receipts: string[];
    problems: string[];
  }>("/v1/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });

export interface Status {
  network: string;
  node: string;
  preSeason: boolean;
  payer: string | null;
  catalogueFetchedAt: string;
  intents: { check: string; intent: string | null; activeMiners: number }[];
  spentTodayUsdc: number;
  dailyCapUsdc: number;
}
export const getStatus = () => call<Status>("/v1/status");

export interface Ledger {
  network: string;
  verdicts: Record<string, number>;
  upstreamSpendUsdc: number;
  receipts: number;
  minersUsed: number;
  recent: { id: string; verdict: string; createdAt: string }[];
}
export const getLedger = () => call<Ledger>("/v1/ledger");

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
