// Helpers for building the labelled set (docs/guides/EVAL_SET.md). Free: no payments.
//
//   pnpm --filter @skein/eval eval-tools block-at <chain> <date>   the last block at or before a UTC time
//   pnpm --filter @skein/eval eval-tools check <cases.json>        validate the file and show its balance
//   pnpm --filter @skein/eval eval-tools good-from-coingecko <candidates.json> <out.json>
//       the good group, by rule: listed on two or more of Binance, Coinbase, Kraken
//       and OKX per CoinGecko, contract on the target chain per CoinGecko, and an
//       ERC-20 contract at that address on-chain. Basis: current_state.
//   pnpm --filter @skein/eval eval-tools bad-from-candidates <candidates.json> <out.json>
//       the bad group from researched incidents: each candidate's address must hold
//       an ERC-20 contract whose on-chain symbol matches its source. Basis: current_state.
//   pnpm --filter @skein/eval eval-tools prospective <out.json> [sniper URL] [since ISO]
//       the prospective set: launches the sniper checked at least 72 hours ago,
//       labelled by what happened after the verdict (the rule is in labelOutcome).
//       Existing cases are never changed; new ones are appended.
//
// <chain> is ethereum, bsc, base, arbitrum or a chain id; <date> is ISO 8601
// (2024-03-01 or 2024-03-01T12:00:00Z). Public RPCs are used unless
// RPC_URL_<chainId> is set (e.g. RPC_URL_1).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { casesFileSchema } from "./cases";
import { decodeSymbol, labelOutcome, OUTCOME_HOURS, PROSPECTIVE_SINCE, prospectiveId, splitFor, type Outcome } from "./label";
import { blockAt, rpc } from "./chain";

const CHAINS: Record<string, number> = { ethereum: 1, eth: 1, bsc: 56, bnb: 56, base: 8453, arbitrum: 42161 };
// Endpoints that serve old block headers (many public ones prune history), first that answers wins.
const RPC: Record<number, string[]> = {
  1: ["https://eth.drpc.org", "https://rpc.flashbots.net", "https://eth-mainnet.public.blastapi.io"],
  56: ["https://bsc-dataseed.bnbchain.org", "https://bsc-dataseed1.defibit.io"],
  8453: ["https://mainnet.base.org", "https://base.drpc.org"],
  42161: ["https://arb1.arbitrum.io/rpc", "https://arbitrum.drpc.org"],
};

const cwd = process.env.INIT_CWD ?? process.cwd();
const [cmd, a, b] = process.argv.slice(2);

if (cmd === "block-at") {
  const chainId = CHAINS[(a ?? "").toLowerCase()] ?? Number(a);
  const urls = process.env[`RPC_URL_${chainId}`] ? [process.env[`RPC_URL_${chainId}`]!] : RPC[chainId];
  const at = Date.parse(b ?? "");
  if (!urls || !Number.isFinite(at)) throw new Error("usage: eval-tools block-at <ethereum|bsc|base|arbitrum> <ISO date>");
  let blk: { number: number; timestamp: number } | undefined;
  let last: unknown;
  for (const url of urls) {
    try {
      blk = await blockAt(url, Math.floor(at / 1000));
      break;
    } catch (e) {
      last = e;
      if (/before the chain/.test(String(e))) throw e;
    }
  }
  if (!blk) throw new Error(`no RPC could answer (set RPC_URL_${chainId}): ${(last as Error)?.message}`);
  console.log(JSON.stringify({ chainId, at: new Date(at).toISOString(), asOfBlock: blk.number, blockTime: new Date(blk.timestamp * 1000).toISOString() }));
} else if (cmd === "check") {
  if (!a) throw new Error("usage: eval-tools check <cases.json>");
  const parsed = casesFileSchema.safeParse(JSON.parse(readFileSync(resolve(cwd, a), "utf8")));
  if (!parsed.success) {
    for (const i of parsed.error.issues) console.log(`✗ ${i.path.join(".") || "(file)"}: ${i.message}`);
    process.exit(1);
  }
  const { kind, cases } = parsed.data;
  const count = (f: (c: (typeof cases)[number]) => string) => cases.reduce<Record<string, number>>((m, c) => ((m[f(c)] = (m[f(c)] ?? 0) + 1), m), {});
  console.log(`✓ ${cases.length} cases, kind "${kind}"`);
  console.log("  by label:", JSON.stringify(count((c) => c.label)));
  console.log("  by split:", JSON.stringify(count((c) => c.split)));
  console.log("  by chain:", JSON.stringify(count((c) => String(c.chainId))));
  console.log("  label x split:", JSON.stringify(count((c) => `${c.label}/${c.split}`)));
  const warn: string[] = [];
  if (kind !== "labelled") warn.push(`kind is "${kind}": the report refuses to present example files as results`);
  for (const c of cases) if (c.label === "bad" && !c.labelEventAt) warn.push(`${c.id}: a bad case should say when the rug or report happened (labelEventAt)`);
  const seen = new Map<string, string>();
  for (const c of cases) {
    const k = `${c.chainId}:${c.token.toLowerCase()}`;
    if (seen.has(k)) warn.push(`${c.id}: same token as ${seen.get(k)}`);
    seen.set(k, c.id);
  }
  const holdout = cases.filter((c) => c.split === "holdout").length;
  if (cases.length >= 30 && Math.abs(holdout / cases.length - 1 / 3) > 0.1) warn.push(`holdout is ${holdout} of ${cases.length}; the plan is about one third (30 of 90)`);
  for (const w of warn) console.log(`! ${w}`);
  if (!warn.length) console.log("✓ no warnings");
} else if (cmd !== "good-from-coingecko" && cmd !== "prospective" && cmd !== "bad-from-candidates") {
  console.error("commands: block-at <chain> <date> | check <cases.json> | good-from-coingecko <candidates.json> <out.json> | prospective <out.json> [sniper URL] [since]");
  process.exit(64);
}

const PLATFORMS: Record<string, { chainId: number; short: string }> = {
  ethereum: { chainId: 1, short: "eth" },
  "binance-smart-chain": { chainId: 56, short: "bsc" },
  base: { chainId: 8453, short: "base" },
  "arbitrum-one": { chainId: 42161, short: "arb" },
};
const MAJORS = ["binance", "gdax", "kraken", "okex"] as const;
const MAJOR_NAME: Record<string, string> = { binance: "Binance", gdax: "Coinbase", kraken: "Kraken", okex: "OKX" };


async function firstRpc<T>(chainId: number, method: string, params: unknown[]): Promise<T> {
  const urls = process.env[`RPC_URL_${chainId}`] ? [process.env[`RPC_URL_${chainId}`]!] : RPC[chainId]!;
  let last: unknown;
  for (const u of urls) {
    try {
      return await rpc<T>(u, method, params);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

async function cg<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.coingecko.com/api/v3${path}`, { headers: { accept: "application/json" } });
    if (res.status === 429 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 20_000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`coingecko ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }
}

if ((cmd as string) === "good-from-coingecko") {
  if (!a || !b) throw new Error("usage: eval-tools good-from-coingecko <candidates.json> <out.json>");
  const { candidates } = JSON.parse(readFileSync(resolve(cwd, a), "utf8")) as { candidates: { id: string; chains: string[] }[] };
  const collected = new Date().toISOString();
  const heads: Record<number, number> = {};
  const cases: unknown[] = [];
  const dropped: string[] = [];
  for (const c of candidates) {
    const coin = await cg<{ id: string; symbol: string; name: string; platforms: Record<string, string> }>(
      `/coins/${c.id}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false`,
    );
    await new Promise((r) => setTimeout(r, 2500));
    const t = await cg<{ tickers: { market: { identifier: string } }[] }>(`/coins/${c.id}/tickers?exchange_ids=${MAJORS.join(",")}`);
    await new Promise((r) => setTimeout(r, 2500));
    const majors = MAJORS.filter((m) => t.tickers.some((x) => x.market.identifier === m));
    if (majors.length < 2) {
      dropped.push(`${c.id}: on ${majors.map((m) => MAJOR_NAME[m]).join(", ") || "no"} major exchange(s)`);
      continue;
    }
    for (const platform of c.chains) {
      const chain = PLATFORMS[platform];
      const token = coin.platforms[platform]?.toLowerCase();
      if (!chain || !token || !/^0x[0-9a-f]{40}$/.test(token)) {
        dropped.push(`${c.id} on ${platform}: CoinGecko gives no contract there`);
        continue;
      }
      const code = await firstRpc<string>(chain.chainId, "eth_getCode", [token, "latest"]);
      const sym = code && code !== "0x" ? await firstRpc<string>(chain.chainId, "eth_call", [{ to: token, data: "0x95d89b41" }, "latest"]).catch(() => "0x") : "0x";
      if (!code || code === "0x" || sym === "0x") {
        dropped.push(`${c.id} on ${platform}: no ERC-20 contract at ${token}`);
        continue;
      }
      heads[chain.chainId] ??= Number(await firstRpc<string>(chain.chainId, "eth_blockNumber", []));
      const id = `good-${c.id}-${chain.short}`.replace(/[^a-z0-9-]/g, "-").slice(0, 64);
      cases.push({
        id,
        chainId: chain.chainId,
        token,
        label: "good",
        basis: "current_state",
        labelSourceUrl: `https://www.coingecko.com/en/coins/${coin.id}`,
        asOfBlock: heads[chain.chainId],
        split: splitFor(id),
        notes: `${coin.name} (${coin.symbol.toUpperCase()}). Markets on ${majors.map((m) => MAJOR_NAME[m]).join(", ")} per CoinGecko, ${collected.slice(0, 10)}; contract from CoinGecko's ${platform} entry.`,
      });
    }
  }
  writeFileSync(resolve(cwd, b), `${JSON.stringify({ kind: "labelled", cases }, null, 1)}\n`);
  console.log(`${cases.length} good cases written to ${b}`);
  if (dropped.length) console.log(`dropped:\n  ${dropped.join("\n  ")}`);
}

if ((cmd as string) === "prospective") {
  if (!a) throw new Error("usage: eval-tools prospective <out.json> [sniper URL] [since ISO]");
  const sniper = (b ?? "https://sniper-production-bea6.up.railway.app").replace(/\/$/, "");
  const since = process.argv[5] ?? PROSPECTIVE_SINCE;
  const out = resolve(cwd, a);
  const file = existsSync(out) ? (JSON.parse(readFileSync(out, "utf8")) as { kind: string; cases: { id: string; token: string }[] }) : { kind: "labelled", cases: [] };
  const known = new Set(file.cases.map((c) => c.token.toLowerCase()));
  const now = Date.now();
  const res = await fetch(`${sniper}/checked.json?since=${encodeURIComponent(since)}`);
  if (!res.ok) throw new Error(`${sniper}/checked.json: HTTP ${res.status}`);
  const { tokens } = (await res.json()) as {
    tokens: { token: string; status: string; verdictId?: string | null; verdict?: string | null; checkedAt?: string | null; priceAtCheck?: number | null; liquidityAtCheck?: number | null; marketUrl?: string | null; symbol?: string | null }[];
  };
  const due = tokens.filter((t) => {
    const ok = t.status === "decided" && t.verdictId && t.checkedAt && Date.parse(t.checkedAt) >= Date.parse(since) && now - Date.parse(t.checkedAt) >= OUTCOME_HOURS * 3_600_000 && !known.has(t.token.toLowerCase());
    // One case per token, even if the sniper checked it twice.
    if (ok) known.add(t.token.toLowerCase());
    return ok;
  });
  // Market data now, from DEX Screener (30 tokens a call); the deepest Base pair per token.
  const market = new Map<string, { price: number | null; liquidity: number; url: string | null }>();
  for (let i = 0; i < due.length; i += 30) {
    const batch = due.slice(i, i + 30).map((t) => t.token.toLowerCase());
    const r = await fetch(`https://api.dexscreener.com/tokens/v1/base/${batch.join(",")}`);
    if (!r.ok) throw new Error(`dexscreener: HTTP ${r.status}`);
    for (const p of (await r.json()) as { baseToken: { address: string }; priceUsd?: string; liquidity?: { usd?: number }; url?: string }[]) {
      const t = p.baseToken.address.toLowerCase();
      if (!batch.includes(t)) continue;
      const liq = p.liquidity?.usd ?? 0;
      if ((market.get(t)?.liquidity ?? -1) >= liq) continue;
      market.set(t, { price: p.priceUsd ? Number(p.priceUsd) : null, liquidity: liq, url: p.url ?? null });
    }
  }
  const labelledAt = new Date(now).toISOString();
  let skipped = 0;
  const urls = process.env.RPC_URL_8453 ? [process.env.RPC_URL_8453] : RPC[8453]!;
  for (const t of due) {
    const token = t.token.toLowerCase();
    const m = market.get(token);
    const o: Outcome = { priceAtCheck: t.priceAtCheck ?? null, priceNow: m?.price ?? null, liquidityAtCheck: t.liquidityAtCheck ?? null, liquidityNow: m ? m.liquidity : null };
    const { label, why } = labelOutcome(o);
    let blk: { number: number } | null = null;
    for (const url of urls) {
      blk = await blockAt(url, Math.floor(Date.parse(t.checkedAt!) / 1000)).catch((e: Error) => (console.warn(`block lookup for ${token} via ${url}: ${e.message}`), null));
      if (blk) break;
    }
    // No node answered: leave this launch for tomorrow's run rather than fail every other one.
    if (!blk) {
      known.delete(token);
      skipped++;
      continue;
    }
    const id = prospectiveId(token);
    const fmt = (v: number | null) => (v === null ? "none" : String(Number(v.toPrecision(4))));
    file.cases.push({
      id,
      chainId: 8453,
      token,
      label,
      basis: "prospective",
      labelSourceUrl: t.marketUrl?.startsWith("https://") ? t.marketUrl : `https://dexscreener.com/base/${token}`,
      labelEventAt: labelledAt,
      asOfBlock: blk.number,
      split: splitFor(id),
      verdictId: t.verdictId!,
      notes:
        `${t.symbol ?? "?"}: verdict ${t.verdict ?? "?"} bought ${t.checkedAt} by the sniper. At labelling (${labelledAt.slice(0, 16)}Z): ` +
        `price ${fmt(o.priceAtCheck)} -> ${fmt(o.priceNow)}, liquidity ${fmt(o.liquidityAtCheck)} -> ${fmt(o.liquidityNow)} USD. ${label}: ${why}.`,
    } as unknown as { id: string; token: string });
  }
  writeFileSync(out, `${JSON.stringify(file, null, 1)}\n`);
  const tally = (l: string) => due.filter((t) => labelOutcome({ priceAtCheck: t.priceAtCheck ?? null, priceNow: market.get(t.token.toLowerCase())?.price ?? null, liquidityAtCheck: t.liquidityAtCheck ?? null, liquidityNow: market.get(t.token.toLowerCase())?.liquidity ?? null }).label === l).length;
  const waiting = tokens.filter((t) => t.status === "decided" && t.checkedAt && Date.parse(t.checkedAt) >= Date.parse(since) && now - Date.parse(t.checkedAt) < OUTCOME_HOURS * 3_600_000).length;
  console.log(`${due.length - skipped} new prospective cases (of ${due.length} due: bad ${tally("bad")}, ambiguous ${tally("ambiguous")}; ${skipped} left for the next run, no block found); ${waiting} more checked since ${since} are not ${OUTCOME_HOURS} h old yet`);
}

const SHORT: Record<number, string> = { 1: "eth", 56: "bsc", 8453: "base", 42161: "arb" };

if ((cmd as string) === "bad-from-candidates") {
  if (!a || !b) throw new Error("usage: eval-tools bad-from-candidates <candidates.json> <out.json>");
  const { candidates } = JSON.parse(readFileSync(resolve(cwd, a), "utf8")) as {
    candidates: { chainId: number; token: string; symbol: string; type: string; eventAt: string; sourceUrl: string; evidence: string; exclude?: string }[];
  };
  const heads: Record<number, number> = {};
  const cases: unknown[] = [];
  const dropped: string[] = [];
  for (const c of candidates) {
    if (c.exclude) {
      dropped.push(`${c.symbol} ${c.token}: excluded (${c.exclude})`);
      continue;
    }
    const code = await firstRpc<string>(c.chainId, "eth_getCode", [c.token, "latest"]).catch(() => "0x");
    const sym = code && code !== "0x" ? decodeSymbol(await firstRpc<string>(c.chainId, "eth_call", [{ to: c.token, data: "0x95d89b41" }, "latest"]).catch(() => "0x")) : null;
    if (!code || code === "0x") {
      dropped.push(`${c.symbol} ${c.token}: no contract on chain ${c.chainId}`);
      continue;
    }
    const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!sym || norm(sym) !== norm(c.symbol)) {
      dropped.push(`${c.symbol} ${c.token}: on-chain symbol is ${sym === null ? "unreadable" : JSON.stringify(sym)}, not ${c.symbol}`);
      continue;
    }
    heads[c.chainId] ??= Number(await firstRpc<string>(c.chainId, "eth_blockNumber", []));
    const id = `bad-${norm(c.symbol).slice(0, 16) || "token"}-${SHORT[c.chainId]}-${c.token.slice(2, 8)}`;
    const eventAt = /^\d{4}-\d{2}-\d{2}$/.test(c.eventAt) ? `${c.eventAt}T00:00:00Z` : c.eventAt.replace(/\.\d+Z$/, "Z");
    cases.push({
      id,
      chainId: c.chainId,
      token: c.token,
      label: "bad",
      basis: "current_state",
      labelSourceUrl: c.sourceUrl,
      labelEventAt: new Date(eventAt).toISOString(),
      asOfBlock: heads[c.chainId],
      split: splitFor(id),
      notes: `${sym} (${c.type}). ${c.evidence}`.slice(0, 500),
    });
  }
  writeFileSync(resolve(cwd, b), `${JSON.stringify({ kind: "labelled", cases }, null, 1)}\n`);
  console.log(`${cases.length} bad cases written to ${b}`);
  if (dropped.length) console.log(`dropped:\n  ${dropped.join("\n  ")}`);
}
