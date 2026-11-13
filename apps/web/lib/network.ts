/**
 * The network label every screen shows (spec section 11: "every screen
 * labels the network"). The site only ever talks to the Telegraph testnet,
 * so the label is there before /v1/status answers, and stays when it does
 * not; the API's answer only refines it (a local simulated node, say).
 */
export interface NetworkLabel {
  /** Below 640 px. */
  short: string;
  /** From 640 px. */
  long: string;
  tone: "live" | "simulated" | "offline" | "pending";
}

/** CAIP-2 ids Skein meets, by name. */
const CAIP2: Record<string, string> = {
  "eip155:11155111": "Telegraph testnet (Sepolia)",
  "eip155:84532": "Base Sepolia testnet",
  "eip155:1": "Ethereum mainnet",
  "eip155:8453": "Base mainnet",
  "eip155:56": "BNB Chain mainnet",
  "eip155:42161": "Arbitrum One mainnet",
};

/** The default, before (or without) an answer from the API. */
export const STATIC_NETWORK: NetworkLabel = { short: "Testnet", long: "Telegraph testnet", tone: "pending" };

/** A readable name for what the API reports as its network: a CAIP-2 id, "testnet" or "simulated". */
export function networkName(network: string): string {
  if (CAIP2[network]) return CAIP2[network];
  if (network === "testnet") return "Telegraph testnet";
  if (network === "simulated") return "Simulated (local fake node)";
  const m = /^eip155:(\d+)$/.exec(network);
  return m ? `EVM chain ${m[1]} (${network})` : network;
}

/** The pill's label for a /v1/status answer: `undefined` while it is in flight, `null` when it failed. */
export function networkLabel(network: string | null | undefined): NetworkLabel {
  if (network === undefined) return STATIC_NETWORK;
  if (network === null) return { short: "Testnet", long: "Telegraph testnet · API unreachable", tone: "offline" };
  if (network === "simulated") return { short: "Simulated", long: "Simulated · not evidence", tone: "simulated" };
  if (network === "eip155:11155111" || network === "testnet") return { short: "Testnet", long: CAIP2["eip155:11155111"]!, tone: "live" };
  const name = networkName(network);
  return { short: name.split(" (")[0]!, long: name, tone: "live" };
}
