import { describe, expect, it, vi } from "vitest";
import { guarded, isStoreFailure } from "../lib/http";

describe("route guard", () => {
  it("turns a store that does not answer into a JSON 503", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await guarded("test", async () => {
      throw new Error("blobs list index: no answer in 8000 ms");
    });
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ error: { code: "STORE_UNAVAILABLE" } });
  });

  it("turns anything else into a JSON 500, and passes answers through", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await guarded("test", async () => {
      throw new TypeError("x is undefined");
    });
    expect(r.status).toBe(500);
    expect(await r.json()).toMatchObject({ error: { code: "INTERNAL" } });
    const ok = await guarded("test", async () => new Response("fine"));
    expect(await ok.text()).toBe("fine");
  });

  it("knows a store failure when it sees one", () => {
    expect(isStoreFailure(new Error("blobs get agent/last_error: no answer in 8000 ms"))).toBe(true);
    expect(isStoreFailure(new Error("bad application id"))).toBe(false);
  });
});
