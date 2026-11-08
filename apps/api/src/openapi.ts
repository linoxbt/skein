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
          "Idempotent per Idempotency-Key: a retry with the same key and body returns the same run and is never charged twice. mode=async answers 202 at once; follow /v1/verdicts/{id}/events.\n\n" +
          "Without a partner key, when the deployment has x402 on, this route takes x402 (v1, scheme exact) payment: an unpaid request gets 402 with { x402Version, accepts }, and a request with an X-PAYMENT header (a signed EIP-3009 USDC authorization) is verified by the facilitator before anything is bought. The payment settles only once a verdict is sealed (a cache hit included), and the 200 carries X-PAYMENT-RESPONSE. Refusals and failures are not settled. The payment itself is the idempotency key: a retry with the same X-PAYMENT replays the run and never settles twice. x402 is sync only.",
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
                  policy: { type: "string", examples: ["dex-list@0.2.0", "agent-pretrade@0.2.0"] },
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
          "202": { description: "Accepted (async): { id, status }" },
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
        responses: { "200": { description: "{ ok, checks, signals, problems }" }, "404": error },
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
    "/v1/ledger": { get: { summary: "The public spend ledger", responses: { "200": { description: "Totals" } } } },
    "/v1/webhooks": {
      get: { summary: "The caller's active webhook (never its secret)", security: [{ partnerKey: [] }], responses: { "200": { description: "{ webhook: { url, createdAt } | null }" }, "401": error } },
      post: {
        summary: "Register (or replace) the caller's webhook. The signing secret is shown once.",
        description: "Deliveries are POSTs with X-Skein-Signature: sha256=HMAC_SHA256(secret, body) and X-Skein-Event (verdict.done, verdict.refused). The URL must be public https; it is checked again before each delivery, and redirects are not followed.",
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
