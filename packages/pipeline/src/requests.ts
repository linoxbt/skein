import { SUPPORTED_CHAINS, type Check, type Subject } from "@skein/engine";
import type { AskRequest, MinerCandidate } from "@skein/telegraph";

export interface VerdictContext {
  treasuryAddresses?: string[];
  deployer?: string;
  repoUrl?: string;
  socialHandle?: string;
  /** Main pool address; resolved automatically when absent. */
  pool?: string;
}

export type BuiltRequest = { ok: true; req: AskRequest } | { ok: false; note: string };

/**
 * Builds the ask for one check from the subject and context. Requests use the
 * canonical intent + params form wherever the live intent has a request
 * schema; SMART_CONTRACT_AUDIT has none, so it sends a question plus context.
 */
export function buildRequest(check: Check, intent: string, subject: Subject, ctx: VerdictContext & { pool?: string }): BuiltRequest {
  const chain = SUPPORTED_CHAINS[subject.chainId]!;
  const token = subject.token;
  switch (check) {
    case "contract_audit":
      return {
        ok: true,
        req: {
          intent,
          query: `Token security audit of the ERC-20 contract ${token} on ${chain} (chain id ${subject.chainId}): honeypot, taxes, owner privileges, proxy, mint.`,
          context: { chain_id: String(subject.chainId), contract_addresses: token },
        },
      };
    case "holder_count":
      return { ok: true, req: { intent, params: { token, chain } } };
    case "wash_trading":
      return { ok: true, req: { intent, params: { subject: token }, context: { chain, token } } };
    case "liquidity_depth":
      return ctx.pool
        ? { ok: true, req: { intent, params: { pool: ctx.pool, chain } } }
        : { ok: false, note: "no_pool_found" };
    case "sanctions": {
      // The intent screens a name; the deployer (or first treasury address,
      // or the contract itself) is sent as that name. Address matching is unverified.
      const target = ctx.deployer ?? ctx.treasuryAddresses?.[0] ?? token;
      return { ok: true, req: { intent, params: { name: target.toLowerCase() } } };
    }
    case "social_bots":
      return ctx.socialHandle
        ? { ok: true, req: { intent, params: { account: ctx.socialHandle } } }
        : { ok: false, note: "no_social_handle" };
    case "code_review":
      return ctx.repoUrl
        ? { ok: true, req: { intent, params: { code: ctx.repoUrl } } }
        : { ok: false, note: "no_repo_url" };
    case "holder_concentration":
      return { ok: false, note: "no_live_intent" };
  }
}

/**
 * Re-shapes a canonical ask for a miner that only takes its native request:
 * canonical params are renamed to the miner's own; unmapped ones are dropped.
 */
export function forCandidate(req: AskRequest, cand: Pick<MinerCandidate, "native">): AskRequest {
  if (!cand.native || !("intent" in req) || !req.params) return req;
  const payload: Record<string, unknown> = {};
  for (const [canonical, value] of Object.entries(req.params)) {
    const native = cand.native.params[canonical];
    if (native) payload[native] = value;
  }
  return { method: cand.native.method, endpoint: cand.native.endpoint, payload };
}
