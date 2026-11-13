/**
 * Network settings. Defaults are the testnet values from the docs' Addresses
 * page (read 2026-10-30); every one can be overridden from the environment,
 * and the purchaser refuses a 402 challenge that disagrees with them.
 */
export interface NetworkConfig {
  nodeUrl: string;
  /** CAIP-2 id of the chain the escrow lives on, e.g. eip155:11155111. */
  caip2: string;
  chainId: number;
  diamond: string;
  usdc: string;
  rpcUrl: string;
}

export const TESTNET: Readonly<NetworkConfig> = {
  nodeUrl: "https://devnode.telegraphprotocol.com",
  caip2: "eip155:11155111",
  chainId: 11155111,
  diamond: "0x3624EB012B5E998BB57B6bE6C9Cfc9c4bc5eb99b",
  usdc: "0xcc194e1a843B658526D0D5C431f670028582Ae17",
  rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
};

/**
 * Chains Skein may pay on without saying so: public testnets, where USDC is
 * minted for free. Ethereum Sepolia is the Telegraph testnet; the others are
 * the testnets of chains Telegraph may move to.
 */
export const TESTNET_CHAIN_IDS: ReadonlySet<number> = new Set([
  11155111, // Ethereum Sepolia
  17000, // Holesky
  560048, // Hoodi
  84532, // Base Sepolia
  421614, // Arbitrum Sepolia
  11155420, // OP Sepolia
  97, // BNB Smart Chain testnet
  80002, // Polygon Amoy
]);

export class NetworkConfigError extends Error {
  readonly code = "NETWORK_CONFIG";
}

/**
 * The network from the environment, checked: TELEGRAPH_CHAIN_ID must be a
 * positive integer, TELEGRAPH_CAIP2 must name the same chain, and a chain
 * that is not a known testnet (real money) is refused unless
 * TELEGRAPH_ALLOW_MAINNET=1 says so on purpose. A typo can otherwise turn a
 * testnet purchaser into a mainnet one, or a NaN chain id into "eip155:NaN".
 */
export function networkFromEnv(env: Record<string, string | undefined> = process.env): NetworkConfig {
  const raw = env.TELEGRAPH_CHAIN_ID?.trim();
  if (raw && !/^[1-9]\d{0,15}$/.test(raw)) throw new NetworkConfigError(`TELEGRAPH_CHAIN_ID must be a positive integer, not "${raw.slice(0, 40)}"`);
  const chainId = raw ? Number(raw) : TESTNET.chainId;
  if (!Number.isSafeInteger(chainId)) throw new NetworkConfigError(`TELEGRAPH_CHAIN_ID ${raw} is out of range`);
  const caip2 = env.TELEGRAPH_CAIP2 || `eip155:${chainId}`;
  if (caip2 !== `eip155:${chainId}`) throw new NetworkConfigError(`TELEGRAPH_CAIP2 ${caip2} is not chain ${chainId}`);
  if (!TESTNET_CHAIN_IDS.has(chainId) && env.TELEGRAPH_ALLOW_MAINNET !== "1") {
    throw new NetworkConfigError(`chain ${chainId} is not a known testnet; set TELEGRAPH_ALLOW_MAINNET=1 to pay on it`);
  }
  for (const [name, v] of [["TELEGRAPH_DIAMOND", env.TELEGRAPH_DIAMOND], ["TELEGRAPH_USDC", env.TELEGRAPH_USDC]] as const) {
    if (v && !/^0x[0-9a-fA-F]{40}$/.test(v)) throw new NetworkConfigError(`${name} must be a 20-byte 0x address`);
  }
  return {
    nodeUrl: env.TELEGRAPH_NODE_URL || TESTNET.nodeUrl,
    caip2,
    chainId,
    diamond: env.TELEGRAPH_DIAMOND || TESTNET.diamond,
    usdc: env.TELEGRAPH_USDC || TESTNET.usdc,
    rpcUrl: env.RPC_URL || TESTNET.rpcUrl,
  };
}

/**
 * The event period starts on Nov 1 (UTC). Paid calls before it would be
 * presented as event activity, which the rules forbid, so the client refuses
 * them unless explicitly told it is a pre-season test.
 */
export const SEASON_START = Date.parse("2026-11-01T00:00:00Z");
