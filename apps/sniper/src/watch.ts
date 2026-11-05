/**
 * New token pools on Base, read from the DEX factories' own creation events
 * (eth_getLogs over a public RPC, no key). Each event names two assets; the
 * new token is the one that is not a quote asset (native ETH, WETH, USDC).
 */
export const QUOTES = new Set([
  "0x0000000000000000000000000000000000000000", // native ETH (Uniswap v4)
  "0x4200000000000000000000000000000000000006", // WETH
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // USDC
]);

export interface Factory {
  dex: string;
  address: string;
  topic0: string;
  /** The pool's own 0x address, when the event names one (v4 pools are ids, not addresses). */
  pool(topics: string[], data: string): string | null;
}

const word = (data: string, i: number) => `0x${data.slice(2 + i * 64, 2 + (i + 1) * 64)}`;
const addr = (w: string) => `0x${w.slice(-40)}`.toLowerCase();

/** topic0 = keccak256 of each event signature (checked against live Base logs on 2026-11-05). */
export const FACTORIES: readonly Factory[] = [
  {
    dex: "uniswap-v2",
    address: "0x8909dc15e40173ff4699343b6eb8132c65e18ec6",
    topic0: "0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9", // PairCreated(address,address,address,uint256)
    pool: (_t, d) => addr(word(d, 0)),
  },
  {
    dex: "uniswap-v3",
    address: "0x33128a8fc17869897dce68ed026d694621f6fdfd",
    topic0: "0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118", // PoolCreated(address,address,uint24,int24,address)
    pool: (_t, d) => addr(word(d, 1)),
  },
  {
    dex: "aerodrome",
    address: "0x420dd381b31aef6683db6b902084cb0ffece40da",
    topic0: "0x2128d88d14c80cb081c1252a5acff7a264671bf199ce226b53788fb26065005e", // PoolCreated(address,address,bool,address,uint256)
    pool: (_t, d) => addr(word(d, 0)),
  },
  {
    dex: "uniswap-v4",
    address: "0x498581ff718922c3f8e6a244956af099b2652b2b",
    topic0: "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438", // Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)
    pool: () => null,
  },
];

export interface Launch {
  token: string;
  dex: string;
  pool: string | null;
  block: number;
  tx: string;
}

interface Log {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
}

/** Decodes one factory log into the launched token, or null for a pair of two quote assets or two new tokens. */
export function decodeLaunch(log: Log): Launch | null {
  const f = FACTORIES.find((x) => x.address === log.address.toLowerCase() && x.topic0 === log.topics[0]);
  if (!f) return null;
  // v2, v3 and Aerodrome index token0/token1 as topics 1 and 2; v4 indexes the pool id first.
  const [a, b] = f.dex === "uniswap-v4" ? [log.topics[2], log.topics[3]] : [log.topics[1], log.topics[2]];
  if (!a || !b) return null;
  const t0 = addr(a);
  const t1 = addr(b);
  const q0 = QUOTES.has(t0);
  const q1 = QUOTES.has(t1);
  if (q0 === q1) return null;
  return { token: q0 ? t1 : t0, dex: f.dex, pool: f.pool(log.topics, log.data), block: Number(log.blockNumber), tx: log.transactionHash };
}

export interface Chain {
  head(): Promise<number>;
  logs(from: number, to: number): Promise<Log[]>;
}

/** Base over JSON-RPC: one eth_getLogs for all four factories (addresses and topics are ORed). */
export function rpcChain(url: string): Chain {
  const call = async <T>(method: string, params: unknown[]): Promise<T> => {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(20_000) });
    const j = (await r.json()) as { result?: T; error?: { message: string } };
    if (j.error) throw new Error(`${method}: ${j.error.message}`);
    return j.result as T;
  };
  return {
    head: async () => Number(await call<string>("eth_blockNumber", [])),
    logs: (from, to) =>
      call<Log[]>("eth_getLogs", [
        { address: FACTORIES.map((f) => f.address), topics: [FACTORIES.map((f) => f.topic0)], fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` },
      ]),
  };
}

/** Follows the chain from where it left off, in bounded windows the public RPC accepts. */
export class Watcher {
  private next: number | null = null;
  constructor(
    private readonly chain: Chain,
    private readonly maxSpan = 250,
  ) {}

  async poll(): Promise<Launch[]> {
    const head = await this.chain.head();
    if (this.next === null) this.next = head - 30; // start a minute back on boot
    if (this.next > head) return [];
    const to = Math.min(head, this.next + this.maxSpan - 1);
    const logs = await this.chain.logs(this.next, to);
    this.next = to + 1;
    const seen = new Set<string>();
    return logs.map(decodeLaunch).filter((l): l is Launch => !!l && !seen.has(l.token) && (seen.add(l.token), true));
  }
}
