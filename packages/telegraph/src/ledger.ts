/**
 * The caller's escrow account as the node sees it (GET /v1/ledger/account/{address}).
 * Since the 2026-11-17 Diamond, the chain holds deposits and withdrawals and
 * the node's ledger roots hold charges and credits; the node joins the two.
 * `available` is what asks may still spend and is the figure the node checks.
 * Amounts are micro-USDC.
 */
export interface EscrowAccount {
  deposited: number;
  balance: number;
  available: number;
  /** Billed but not yet in a ledger root. */
  unbilled: number;
  /** A pending withdrawal request, if any ("none" otherwise). */
  withdrawal: string;
}

const uusdc = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : Number.NaN;
  if (!Number.isFinite(n)) throw new Error(`escrow account: not an amount: ${String(v).slice(0, 40)}`);
  return n;
};

export async function escrowAccount(nodeUrl: string, address: string, fetchImpl: typeof fetch = fetch): Promise<EscrowAccount> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("escrow account: bad address");
  const res = await fetchImpl(`${nodeUrl.replace(/\/$/, "")}/v1/ledger/account/${address}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`escrow account: node answered ${res.status}`);
  const b = (await res.json()) as Record<string, unknown> & { request?: { status?: unknown } };
  return {
    deposited: uusdc(b.deposited),
    balance: uusdc(b.balance),
    available: uusdc(b.available),
    unbilled: uusdc(b.unbilled ?? "0"),
    withdrawal: typeof b.request?.status === "string" ? b.request.status : "none",
  };
}
