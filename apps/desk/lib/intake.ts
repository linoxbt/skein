import { createHash } from "node:crypto";
import { agentReady, CollisionError, LINKISH, parseApplication, PROJECT, receive, tick, type AgentDeps, type ApplicationInput } from "./agent";
import type { Application, Origin } from "./types";

/**
 * The agent's own intake: with nobody filing anything, the Desk files fresh
 * token launches from public feeds as applications (source "agent") and buys
 * their verdicts like any other. Bounded and idempotent:
 *  - at most `daily` a UTC day, spread over the day (one slot opens every
 *    24/daily hours), counted with an atomic counter, so the escrow lasts;
 *  - one application per run, and each token once: its application id is
 *    derived from the token and the store creates an id only once, so two
 *    runs at the same moment cannot file it twice (the loser gives its slot back);
 *  - only the chains and address shape the form itself accepts.
 * Feeds:
 *  - dexscreener: the latest token profiles (projects that just set up their
 *    DexScreener page, the nearest public thing to a listing application),
 *    https://api.dexscreener.com/token-profiles/latest/v1, named through
 *    /tokens/v1/{chain}/{addresses};
 *  - sniper: Skein's own sniper feed of Base launches it saw in the last day.
 */
export type Feed = Origin["feed"];

export interface Candidate {
  chainId: number;
  token: string;
  project: string;
  social?: string;
  origin: Origin;
}

const DEX_CHAINS: Record<string, number> = { ethereum: 1, base: 8453, bsc: 56, arbitrum: 42161 };
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO = /^0x0{40}$/;
const DEXSCREENER = "https://api.dexscreener.com";
export const SNIPER_FEED_URL = process.env.DESK_SNIPER_FEED_URL ?? "https://sniper-production-bea6.up.railway.app/feed.json";

/** A GET that never throws, never waits long and never reads a huge body: null on any failure. */
async function getJson(url: string, fetchImpl: typeof fetch, ms = 8_000): Promise<unknown> {
  try {
    const r = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(ms) });
    if (!r.ok) return null;
    const text = await r.text();
    return text.length > 2_000_000 ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

/** A name fit for the public board (the form's own rule), or a plain fallback. */
export function projectName(name: unknown, symbol: unknown, token: string): string {
  for (const raw of [name, symbol]) {
    if (typeof raw !== "string") continue;
    const clean = raw.normalize("NFKC").replace(/[^\p{L}\p{N} .&'_-]/gu, " ").replace(/\s+/g, " ").trim().replace(/^[^\p{L}\p{N}]+/u, "").slice(0, 48).trim();
    if (clean && PROJECT.test(clean) && !LINKISH.test(clean)) return clean;
  }
  return `Token ${token.slice(0, 8)}`;
}

function xHandle(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  const m = /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/(\w{1,30})\/?(?:\?.*)?$/i.exec(url.trim());
  return m && !/^(i|home|intent|search|share)$/i.test(m[1]!) ? m[1] : undefined;
}

export async function dexscreenerCandidates(fetchImpl: typeof fetch = fetch): Promise<Candidate[]> {
  const profiles = await getJson(`${DEXSCREENER}/token-profiles/latest/v1`, fetchImpl);
  if (!Array.isArray(profiles)) return [];
  const evm = profiles
    .map((p) => p as { chainId?: unknown; tokenAddress?: unknown; url?: unknown; links?: { type?: unknown; url?: unknown }[] })
    .filter((p) => typeof p.chainId === "string" && p.chainId in DEX_CHAINS && typeof p.tokenAddress === "string" && ADDRESS.test(p.tokenAddress) && !ZERO.test(p.tokenAddress))
    .slice(0, 30);
  // Profiles carry no name: look the tokens up, one call per chain.
  const names = new Map<string, { name?: unknown; symbol?: unknown }>();
  for (const chain of new Set(evm.map((p) => p.chainId as string))) {
    const addrs = evm.filter((p) => p.chainId === chain).map((p) => p.tokenAddress as string);
    const pairs = await getJson(`${DEXSCREENER}/tokens/v1/${chain}/${addrs.join(",")}`, fetchImpl);
    for (const pair of Array.isArray(pairs) ? pairs : []) {
      const base = (pair as { baseToken?: { address?: unknown; name?: unknown; symbol?: unknown } }).baseToken;
      if (typeof base?.address === "string" && !names.has(base.address.toLowerCase())) names.set(base.address.toLowerCase(), base);
    }
  }
  return evm.map((p) => {
    const token = p.tokenAddress as string;
    const n = names.get(token.toLowerCase());
    const social = Array.isArray(p.links) ? p.links.map((l) => (l?.type === "twitter" ? xHandle(l.url) : undefined)).find(Boolean) : undefined;
    const url = typeof p.url === "string" && p.url.startsWith("https://dexscreener.com/") ? p.url.slice(0, 200) : undefined;
    return { chainId: DEX_CHAINS[p.chainId as string]!, token, project: projectName(n?.name, n?.symbol, token), ...(social ? { social } : {}), origin: { feed: "dexscreener" as const, ...(url ? { url } : {}) } };
  });
}

export async function sniperCandidates(fetchImpl: typeof fetch = fetch, now = new Date()): Promise<Candidate[]> {
  const feed = (await getJson(SNIPER_FEED_URL, fetchImpl)) as { decisions?: unknown } | null;
  if (!Array.isArray(feed?.decisions)) return [];
  const out: Candidate[] = [];
  for (const raw of feed.decisions.slice(0, 200)) {
    const d = raw as { token?: unknown; name?: unknown; symbol?: unknown; seenAt?: unknown; marketUrl?: unknown };
    if (typeof d.token !== "string" || !ADDRESS.test(d.token) || ZERO.test(d.token)) continue;
    // Launches it saw in the last day only: the intake files fresh launches, not old ones.
    const seen = typeof d.seenAt === "string" ? Date.parse(d.seenAt) : NaN;
    if (!(now.getTime() - seen < 24 * 3600_000)) continue;
    // The sniper watches Base; its market link names the chain.
    const chain = typeof d.marketUrl === "string" ? /^https:\/\/dexscreener\.com\/([a-z]+)\//.exec(d.marketUrl)?.[1] : "base";
    const chainId = chain ? DEX_CHAINS[chain] : undefined;
    if (!chainId) continue;
    out.push({ chainId, token: d.token, project: projectName(d.name, d.symbol, d.token), origin: { feed: "sniper", ...(typeof d.marketUrl === "string" && d.marketUrl.startsWith("https://dexscreener.com/") ? { url: d.marketUrl.slice(0, 200) } : {}) } });
  }
  return out;
}

const SOURCES: Record<Feed, (f: typeof fetch, now: Date) => Promise<Candidate[]>> = { dexscreener: dexscreenerCandidates, sniper: sniperCandidates };

export function feedsFromEnv(v = process.env.DESK_AUTO_SOURCES): Feed[] {
  const list = (v ?? "dexscreener,sniper").split(",").map((s) => s.trim()).filter((s): s is Feed => s in SOURCES);
  return list.length ? list : ["dexscreener", "sniper"];
}

/** The id the agent's application for a token gets: the same token always maps to the same id. */
export function autoId(chainId: number, token: string): string {
  return `app_a${createHash("sha256").update(`${chainId}:${token.toLowerCase()}`).digest("hex").slice(0, 23)}`;
}

/** How many of today's `daily` slots are open at `now`: one at 00:00 UTC, then one every 24/daily hours. */
export function slotsOpen(daily: number, now: Date): number {
  const ms = now.getTime() - Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.min(daily, Math.floor((daily * ms) / 86_400_000) + 1);
}

export interface IntakeResult {
  filed: Application | null;
  reason: "off" | "budget" | "no new launches" | "filed";
}

export async function intake(deps: AgentDeps, opts: { daily: number; feeds?: Feed[]; fetch?: typeof fetch }): Promise<IntakeResult> {
  const daily = Math.floor(opts.daily);
  if (!(daily > 0) || !agentReady(deps)) return { filed: null, reason: "off" };
  const now = deps.now?.() ?? new Date();
  const counter = `auto/${now.toISOString().slice(0, 10)}`;
  const open = slotsOpen(daily, now);
  // One read decides whether there is anything to do: no feed is fetched while the budget is spent.
  if ((await deps.store.count(counter)) >= open) return { filed: null, reason: "budget" };

  const fetchImpl = opts.fetch ?? fetch;
  const lists = await Promise.all((opts.feeds ?? feedsFromEnv()).map((f) => SOURCES[f](fetchImpl, now).catch(() => [] as Candidate[])));
  const onBoard = new Set((await deps.store.list()).map((s) => `${s.subject.chainId}:${s.subject.token.toLowerCase()}`));
  const seen = new Set<string>();
  for (const c of lists.flat()) {
    const key = `${c.chainId}:${c.token.toLowerCase()}`;
    if (seen.has(key) || onBoard.has(key)) continue;
    seen.add(key);
    const input: ApplicationInput = { project: c.project, chainId: c.chainId, token: c.token, ...(c.social ? { social: c.social } : {}) };
    try {
      parseApplication(input);
    } catch {
      continue;
    }
    const id = autoId(c.chainId, c.token);
    if (await deps.store.get(id)) continue;
    if (!(await deps.store.take(counter, open))) return { filed: null, reason: "budget" };
    try {
      return { filed: await receive(deps, input, "agent", { id, origin: c.origin }), reason: "filed" };
    } catch (e) {
      // Another run filed this token first: give the slot back and try the next one.
      await deps.store.refund(counter).catch(() => {});
      if (e instanceof CollisionError) continue;
      throw e;
    }
  }
  return { filed: null, reason: "no new launches" };
}

/** One scheduled run of the agent: file what the intake finds, then settle everything open. */
export async function runAgent(deps: AgentDeps, opts: { budgetMs: number; daily: number; feeds?: Feed[]; fetch?: typeof fetch }) {
  const filed = await intake(deps, opts).catch((e) => (console.error("intake:", e), { filed: null, reason: "error" as const }));
  const settled = await tick(deps, opts.budgetMs);
  return { intake: { reason: filed.reason, ...(filed.filed ? { id: filed.filed.id } : {}) }, ...settled };
}
