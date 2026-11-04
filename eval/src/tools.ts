// Helpers for building the labelled set (docs/guides/EVAL_SET.md). Free: no payments.
//
//   pnpm --filter @skein/eval eval-tools block-at <chain> <date>   the last block at or before a UTC time
//   pnpm --filter @skein/eval eval-tools check <cases.json>        validate the file and show its balance
//
// <chain> is ethereum, bsc, base, arbitrum or a chain id; <date> is ISO 8601
// (2024-03-01 or 2024-03-01T12:00:00Z). Public RPCs are used unless
// RPC_URL_<chainId> is set (e.g. RPC_URL_1).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { casesFileSchema } from "./cases";

const CHAINS: Record<string, number> = { ethereum: 1, eth: 1, bsc: 56, bnb: 56, base: 8453, arbitrum: 42161 };
// Endpoints that serve old block headers (many public ones prune history), first that answers wins.
const RPC: Record<number, string[]> = {
  1: ["https://eth.drpc.org", "https://rpc.flashbots.net", "https://eth-mainnet.public.blastapi.io"],
  56: ["https://bsc-dataseed.bnbchain.org", "https://bsc-dataseed1.defibit.io"],
  8453: ["https://mainnet.base.org", "https://base.drpc.org"],
  42161: ["https://arb1.arbitrum.io/rpc", "https://arbitrum.drpc.org"],
};

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      const body = (await res.json()) as { result?: T; error?: { message: string } };
      if (body.error) throw new Error(body.error.message);
      return body.result as T;
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
}

/** The highest block whose timestamp is at or before `at` (seconds), by binary search. */
export async function blockAt(url: string, at: number): Promise<{ number: number; timestamp: number }> {
  const ts = async (n: number) => Number((await rpc<{ timestamp: string }>(url, "eth_getBlockByNumber", [`0x${n.toString(16)}`, false])).timestamp);
  let hi = Number(await rpc<string>(url, "eth_blockNumber", []));
  if ((await ts(hi)) <= at) return { number: hi, timestamp: await ts(hi) };
  let lo = 1;
  if ((await ts(lo)) > at) throw new Error("that time is before the chain's first block");
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if ((await ts(mid)) <= at) lo = mid;
    else hi = mid;
  }
  return { number: lo, timestamp: await ts(lo) };
}

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
} else {
  console.error("commands: block-at <chain> <date> | check <cases.json>");
  process.exit(64);
}
