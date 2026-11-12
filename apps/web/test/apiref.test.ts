import { describe, expect, it } from "vitest";
import { deref, operations } from "../lib/openapi";

const doc = {
  openapi: "3.1.0",
  components: { schemas: { Subject: { type: "object", properties: { chainId: { type: "integer" } } }, Loop: { $ref: "#/components/schemas/Loop" } } },
  paths: {
    "/v1/quote": { get: { summary: "Quote", parameters: [{ name: "chain", in: "query", required: true, schema: { type: "integer" } }] } },
    "/v1/verdicts": { post: { summary: "Buy", requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Subject" } } } } } },
  },
};

describe("API reference renderer", () => {
  it("lists every operation in document order, with local refs inlined", () => {
    const ops = operations(doc);
    expect(ops.map((o) => `${o.method} ${o.path}`)).toEqual(["GET /v1/quote", "POST /v1/verdicts"]);
    expect(ops[1]!.requestBody?.content?.["application/json"]?.schema).toEqual(doc.components.schemas.Subject);
  });

  it("stops at a cycle instead of looping", () => {
    expect(deref(doc, { $ref: "#/components/schemas/Loop" })).toEqual({ $ref: "#/components/schemas/Loop" });
  });
});
