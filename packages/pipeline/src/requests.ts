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
      // The listing question, not a generic review: a link alone got a style review.
      // The intent's one input is `code` ("the code to review, or a link to the change").
      return ctx.repoUrl
        ? {
            ok: true,
            req: {
              intent,
              params: {
                code:
                  `${ctx.repoUrl}\n\nReview this repository for a token listing decision (${token} on ${chain}). ` +
                  "Cover: commit history (age, cadence, gaps, rewritten history); contributor authenticity " +
                  "(established accounts or new, duplicated or anonymous ones; a single author); code copied or " +
                  "forked without credit; and security issues in the token or deployment code. " +
                  "Answer Approve, Comment or Request changes, with findings.",
              },
            },
          }
        : { ok: false, note: "no_repo_url" };
    case "holder_concentration":
      return { ok: false, note: "no_live_intent" };
  }
}

/**
 * Re-shapes a canonical ask for a miner that only takes its native request:
 * canonical params (and context, where params lack a field) are renamed to
 * the miner's own; unmapped ones are dropped. Fixed native params and the
 * node's acknowledge_warnings flag are added where the allowlist sets them.
 */
export function forCandidate(req: AskRequest, cand: Pick<MinerCandidate, "native">): AskRequest {
  if (!cand.native || !("intent" in req) || (!req.params && !req.context)) return req;
  const payload: Record<string, unknown> = { ...cand.native.fixed };
  // Params first, then context for anything the intent's params do not carry (a chain, say).
  for (const [canonical, value] of [...Object.entries(req.context ?? {}), ...Object.entries(req.params ?? {})]) {
    const native = cand.native.params[canonical];
    if (native) payload[native] = value;
  }
  return {
    method: cand.native.method,
    endpoint: cand.native.endpoint,
    payload,
    ...(cand.native.acknowledgeWarnings ? { acknowledge_warnings: true as const } : {}),
  };
}

/**
 * The loop guard's outbound half (spec section 9): every intent ask Skein makes
 * carries skein-depth 1 in its context, so a Skein miner reached through the
 * network (its own registration, or a composite that resells Skein) answers it
 * from cache or refuses, instead of buying again. Native requests (a miner's own
 * endpoint and payload) carry only the fields that miner declares, so the
 * marker cannot travel there; self-exclusion by registration id covers them.
 */
export const SKEIN_DEPTH_KEY = "skein-depth";

export function withDepthMarker(req: AskRequest): AskRequest {
  if (!("intent" in req)) return req;
  return { ...req, context: { ...(req.context ?? {}), [SKEIN_DEPTH_KEY]: "1" } };
}

