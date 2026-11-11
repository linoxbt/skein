// JSON-RPC helpers for the eval tools: one call with retries, and a block-by-time search.

export async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      const body = (await res.json()) as { result?: T; error?: { message: string } };
      if (body.error) throw new Error(body.error.message);
      // A rate-limited public node can answer 200 with no result: that is a failure, not an answer.
      if (body.result === undefined || body.result === null) throw new Error(`${url}: ${method} returned no result`);
      return body.result;
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
}

/**
 * The highest block whose timestamp is at or before `at` (seconds). It starts
 * from an estimate (the chain's recent block time), brackets the answer by
 * widening steps, then binary-searches the bracket: about a dozen calls,
 * not the ~30 a search from block 1 needs, which public nodes rate-limit.
 */
export async function blockAt(url: string, at: number): Promise<{ number: number; timestamp: number }> {
  const memo = new Map<number, number>();
  const ts = async (n: number) => {
    if (!memo.has(n)) memo.set(n, Number((await rpc<{ timestamp: string }>(url, "eth_getBlockByNumber", [`0x${n.toString(16)}`, false])).timestamp));
    return memo.get(n)!;
  };
  const head = Number(await rpc<string>(url, "eth_blockNumber", []));
  const headTs = await ts(head);
  if (headTs <= at) return { number: head, timestamp: headTs };
  const back = Math.max(1, head - 10_000);
  const blockTime = Math.max(0.05, (headTs - (await ts(back))) / (head - back));
  const guess = Math.min(head - 1, Math.max(1, Math.round(head - (headTs - at) / blockTime)));
  let lo = guess;
  let hi = guess + 1;
  for (let step = 64; (await ts(lo)) > at; step *= 4) {
    hi = lo;
    lo = Math.max(1, lo - step);
    if (lo === 1 && (await ts(1)) > at) throw new Error("that time is before the chain's first block");
  }
  for (let step = 64; hi < head && (await ts(hi)) <= at; step *= 4) {
    lo = hi;
    hi = Math.min(head, hi + step);
  }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if ((await ts(mid)) <= at) lo = mid;
    else hi = mid;
  }
  return { number: lo, timestamp: await ts(lo) };
}
