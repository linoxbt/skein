/**
 * The public API, described for tools and people: served at GET /v1/openapi.json.
 * A test (openapi.test.ts) checks every route the app registers is described here.
 */
const error = { $ref: "#/components/responses/Error" };
const verdictId = { name: "id", in: "path", required: true, schema: { type: "string", pattern: "^vrd_[a-z0-9]+$" } };

export const OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "Skein API",
    version: "1.0.0",
    description:
      "Token listing verdicts. Skein buys ranked checks from miners on the Telegraph network, fuses them under a published, immutable policy, and returns a signed verdict (APPROVE, REJECT, ESCALATE or ABSTAIN) with reasons, cost and a receipt for every paid input. Every error has the shape { error: { code, message, requestId } }, and every response carries X-Request-Id.",
  },
  servers: [{ url: "https://api.skeinlabs.site" }],
  components: {
    securitySchemes: { partnerKey: { type: "http", scheme: "bearer", description: "A Skein partner API key (sk_part_…)." } },
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: { code: { type: "string", examples: ["INVALID_REQUEST", "NOT_FOUND", "RATE_LIMITED", "DAILY_CAP_REACHED"] }, message: { type: "string" }, requestId: { type: "string" }, details: {} },
          },
        },
      },
      Subject: { type: "object", required: ["chainId", "token"], properties: { chainId: { type: "integer", enum: [1, 56, 8453, 42161] }, token: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" } } },
      Context: {
        type: "object",
        additionalProperties: false,
        properties: {
          treasuryAddresses: { type: "array", maxItems: 5, items: { type: "string" } },
          deployer: { type: "string" },
          repoUrl: { type: "string", format: "uri", description: "github.com or gitlab.com" },
          socialHandle: { type: "string" },
          pool: { type: "string", description: "A pool address (20 bytes) or a Uniswap v4 pool id (32 bytes)." },
        },
      },
      Verdict: {
        type: "object",
        description: "A sealed verdict. attestation is an EIP-191 signature by the attester published at /v1/status.",
        properties: {
          id: { type: "string" },
          verdict: { type: "string", enum: ["APPROVE", "REJECT", "ESCALATE", "ABSTAIN"] },
          riskBps: { type: "integer" },
          confidenceBps: { type: "integer" },
          coverage: { type: "number" },
          summary: { type: "string" },
          reasons: { type: "array", items: { type: "object" } },
          openRisks: { type: "array", items: { type: "string" } },
          findings: { type: "array", items: { type: "object" } },
          policy: { type: "object", properties: { id: { type: "string" }, version: { type: "string" }, sha256: { type: "string" } } },
          subject: { $ref: "#/components/schemas/Subject" },
          cost: { type: "object" },
          bom: { type: "object", properties: { root: { type: "string" }, items: { type: "integer" } } },
          verdictHash: { type: "string" },
          attestation: { type: "object" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
    },
    responses: { Error: { description: "An error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } } },
  },
  paths: {
    "/healthz": { get: { summary: "The process is up", responses: { "200": { description: "ok" } } } },
    "/readyz": { get: { summary: "The database answers", responses: { "200": { description: "ready" }, "503": error } } },
    "/v1/openapi.json": { get: { summary: "This document", responses: { "200": { description: "OpenAPI 3.1" } } } },
    "/v1/verdicts": {
      post: {
        summary: "Buy a verdict",
        description:
          "Idempotent per Idempotency-Key for 24 hours: a retry with the same key and body returns the same run and is never charged twice. A run that ended in a failure that may clear (VERDICT_FAILED, LOST, UPSTREAM_UNAVAILABLE, DAILY_CAP_REACHED, RATE_LIMITED, MARGIN_GUARD, WALLET_EMPTY) does not hold its key: the retry runs again. mode=async answers 202 at once; follow /v1/verdicts/{id}/events. A sync request still running after SYNC_TIMEOUT_MS (25 s) answers 202 { id, status: running, timedOut: true } (until 2026-11-12 this was 504 TIMEOUT); poll the id. Identical concurrent requests share one purchase.\n\n" +
          "Without a partner key, when the deployment has x402 on, this route takes x402 (v1, scheme exact) payment: an unpaid request gets 402 with { x402Version, accepts }. A request with an X-PAYMENT header (a signed EIP-3009 USDC authorization for exactly the price, from an EOA) is checked, verified by the facilitator, refused before payment where it can be (spend caps, an empty purchaser wallet, a plan that cannot be bought: 'nothing was charged'), then settled before anything is bought; the answer carries X-PAYMENT-RESPONSE and X-Skein-Payment. Pricing: an answered verdict costs the price; an ABSTAIN costs its upstream spend and the rest is owed back; a refusal or failure after settlement is owed back in full (or retried with the same X-PAYMENT within 24 hours at no extra cost). Refunds owed are listed at /v1/ledger and sent by the operator. The payment is the idempotency key: a retry with the same X-PAYMENT replays the run, never verified or settled again. Per payer: X402_PAYER_PER_MINUTE requests a minute, X402_PAYER_DAILY_MAX verdicts a UTC day.",
        security: [{ partnerKey: [] }, {}],
        parameters: [
          { name: "Idempotency-Key", in: "header", required: false, description: "Required with a partner key; with x402 the payment authorization is the key.", schema: { type: "string", maxLength: 128 } },
          { name: "X-PAYMENT", in: "header", required: false, description: "x402 payment payload, base64 JSON (only without a partner key).", schema: { type: "string" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["subject"],
                properties: {
                  subject: { $ref: "#/components/schemas/Subject" },
                  policy: { type: "string", examples: ["dex-list@0.2.0", "agent-pretrade@0.3.0"] },
                  context: { $ref: "#/components/schemas/Context" },
                  budgetUsdcMax: { type: "number", maximum: 10 },
                  mode: { type: "string", enum: ["sync", "async"], default: "sync" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "The verdict", content: { "application/json": { schema: { $ref: "#/components/schemas/Verdict" } } } },
          "202": { description: "Accepted (async, or sync past its time): { id, status: running, events, timedOut? }" },
          "402": { description: "Payment required: { x402Version: 1, accepts: [PaymentRequirements], error } when x402 is on; otherwise the usual error body" },
          "400": error, "401": error, "409": error, "429": error, "503": error,
        },
      },
    },
    "/v1/verdicts/{id}": { get: { summary: "A verdict, or the state of a run", parameters: [verdictId], responses: { "200": { description: "The verdict", content: { "application/json": { schema: { $ref: "#/components/schemas/Verdict" } } } }, "202": { description: "Still running" }, "404": error } } },
    "/v1/verdicts/{id}/bom": { get: { summary: "The bill of materials: every purchase, its miner, receipt and cost", parameters: [verdictId], responses: { "200": { description: "The BOM" }, "404": error } } },
    "/v1/verdicts/{id}/events": { get: { summary: "Server-sent events: plan, purchases, findings, decision, done", parameters: [verdictId], responses: { "200": { description: "text/event-stream" }, "404": error } } },
    "/v1/verify": {
      post: {
        summary: "Re-check a verdict: replay adapters and policy, rebuild the Merkle root, check the receipts and the signature",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["id"], properties: { id: { type: "string" } } } } } },
        responses: {
          "200": {
            description:
              "{ ok, checks: { adaptersRerun, policyRerun, verdictHashRecomputes, bomRootRebuilt, engineVersion, decisionMatches, receiptsMatch, policyFile, signals, attestation, attestationSignature, attestationMatchesVerdict, attestationSigner }, signals, verdictHash, bomRoot, receipts, problems, attester, publishedAttester, attestation (the stored one: signedAt, atSeal), policy { ref, sha256, url }, inputs (the stored record reproduce() ran on, raw answers included) }. The attestation is the one stored when the verdict was sealed; a verdict sealed before 2026-11-12 was signed on its first read (atSeal false).",
          },
          "404": error,
        },
      },
    },
    "/v1/policies": { get: { summary: "Every published policy, with its file hash", responses: { "200": { description: "The policies" } } } },
    "/v1/policies/{ref}": { get: { summary: "One policy (id or id@version)", parameters: [{ name: "ref", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "The policy" }, "404": error } } },
    "/v1/quote": {
      get: {
        summary: "What a verdict would buy and cost, before buying",
        parameters: [
          { name: "chain", in: "query", required: true, schema: { type: "integer" } },
          { name: "token", in: "query", required: true, schema: { type: "string" } },
          { name: "policy", in: "query", schema: { type: "string" } },
        ],
        responses: { "200": { description: "The plan and its cost" }, "400": error },
      },
    },
    "/v1/status": { get: { summary: "Network, wallet, caps, attester and each check's miners", responses: { "200": { description: "Status" } } } },
    "/v1/miner/requests/{id}": {
      get: {
        summary: "What /miner/verdict answered the Telegraph call that carried this request_id",
        description:
          "A Telegraph caller may send request_id (16-64 characters of [A-Za-z0-9_-]; use a random UUID) in its params, its body or its context. The answer is recorded under it for 30 days. status: answered (verdictId set), pending (the answer was DEADLINE and the run is still buying; poll again), abstained (code says why). Public, like the verdicts.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", pattern: "^[A-Za-z0-9_-]{16,64}$" } }],
        responses: { "200": { description: "{ requestId, status, verdictId, verdict?, code?, runId?, answeredAt }" }, "400": error, "404": error },
      },
    },
    "/v1/ledger": {
      get: {
        summary: "The public spend ledger",
        description: "All-time totals: verdicts, upstream spend, receipts, miners; revenueOwedUsdc (Telegraph answers at the floor, ABSTAIN included), revenueSettledUsdc (x402, gross), refundsOwedUsdc and refundsSentUsdc. Stability, abstain causes, byDay (verdicts and upstream spend per UTC day) and minersByCheck (distinct miners paid per check) cover the last 30 days (windowDays).",
        responses: { "200": { description: "Totals" } },
      },
    },
    "/v1/webhooks": {
      get: { summary: "The caller's active webhook (never its secret)", security: [{ partnerKey: [] }], responses: { "200": { description: "{ webhook: { url, createdAt } | null }" }, "401": error } },
      post: {
        summary: "Register (or replace) the caller's webhook. The signing secret is shown once.",
        description:
          "Deliveries are POSTs with X-Skein-Event (verdict.completed or verdict.refused), X-Skein-Timestamp: <unix seconds>, and X-Skein-Signature: sha256=<hex HMAC_SHA256(secret, timestamp + '.' + raw body)>; refuse a timestamp more than 300 s from your clock, which stops replays (@skeinlabs/sdk verifyWebhook does both). The body is { event: 'verdict.completed' | 'verdict.refused', legacyEvent: 'verdict.done' | 'verdict.refused', status: 'done' | 'refused', runId, ... }. Until 2026-11-12 X-Skein-Signature signed the body alone and the done event was verdict.done. The URL must be public https; it is checked again before each delivery, and redirects are not followed.",
        security: [{ partnerKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["url"], properties: { url: { type: "string", format: "uri" } } } } } },
        responses: { "201": { description: "{ url, secret, signature, events }" }, "400": error, "401": error, "429": error },
      },
      delete: { summary: "Turn the caller's webhook off", security: [{ partnerKey: [] }], responses: { "200": { description: "{ deleted: boolean }" }, "401": error } },
    },
    "/v1/kv": {
      get: {
        summary: "Read one value from the caller's key-value namespace (first-party apps only: KV_KEY_HASHES)",
        security: [{ partnerKey: [] }],
        parameters: [{ name: "key", in: "query", required: true, schema: { type: "string", pattern: "^[A-Za-z0-9/_.:-]{1,200}$" } }],
        responses: { "200": { description: "{ key, value, etag }" }, "403": error, "404": error },
      },
      put: {
        summary: "Write one value, conditionally: If-None-Match: * creates, If-Match: <etag> replaces",
        security: [{ partnerKey: [] }],
        parameters: [{ name: "key", in: "query", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["value"], properties: { value: {} } } } } },
        responses: { "200": { description: "{ key, etag }" }, "403": error, "412": error, "428": error },
      },
    },
    "/miner/verdict": {
      post: {
        summary: "Telegraph's miner endpoint (FRAUD_RISK_GENERAL). Called by the network's dispatcher only.",
        parameters: [{ name: "X-Skein-Miner-Key", in: "header", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "{ risk_level, risk_score, signals, summary, verdict, … }" }, "401": error, "503": error },
      },
    },
  },
} as const;
