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

export function networkFromEnv(env: Record<string, string | undefined> = process.env): NetworkConfig {
  const chainId = env.TELEGRAPH_CHAIN_ID ? Number(env.TELEGRAPH_CHAIN_ID) : TESTNET.chainId;
  return {
    nodeUrl: env.TELEGRAPH_NODE_URL || TESTNET.nodeUrl,
    caip2: env.TELEGRAPH_CAIP2 || `eip155:${chainId}`,
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
