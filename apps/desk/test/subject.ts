/**
 * The Telegraph wire subject ("base:0x…", or "eip155:<id>:0x…" for an unnamed
 * chain, as the plan-B miner YAML declares it), read back into the API's
 * { chainId, token } so a test can play Skein's miner on the simulated API.
 */
const CHAINS: Record<string, number> = { ethereum: 1, bsc: 56, base: 8453, arbitrum: 42161 };

export function subjectFromWire(subject: unknown): { chainId: number; token: string } {
  if (typeof subject !== "string") throw new Error(`expected the wire subject string, got ${JSON.stringify(subject)}`);
  const parts = subject.split(":");
  const token = parts.pop()!;
  const chainId = parts[0] === "eip155" ? Number(parts[1]) : CHAINS[parts[0] ?? ""];
  if (!chainId) throw new Error(`unknown chain in ${subject}`);
  return { chainId, token };
}
