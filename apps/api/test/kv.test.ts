import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { DEV_KEY, simulatedApi } from "../src/simulated";

type Api = Awaited<ReturnType<typeof simulatedApi>>;
let api: Api;
let closed: Api;
const auth = { authorization: `Bearer ${DEV_KEY}`, "content-type": "application/json" };

beforeAll(async () => {
  api = await simulatedApi({ fast: true, env: {}, config: { kvKeyHashes: [createHash("sha256").update(DEV_KEY).digest("hex")] } });
  closed = await simulatedApi({ fast: true, env: {} });
});

const get = (a: Api, key: string) => a.app.request(`/v1/kv?key=${encodeURIComponent(key)}`, { headers: auth });
const put = (a: Api, key: string, value: unknown, h: Record<string, string>) =>
  a.app.request(`/v1/kv?key=${encodeURIComponent(key)}`, { method: "PUT", headers: { ...auth, ...h }, body: JSON.stringify({ value }) });

describe("key-value store", () => {
  it("creates once, replaces only at the etag it read, and refuses a lost race with 412", async () => {
    expect((await get(api, "desk/index")).status).toBe(404);
    const c1 = await put(api, "desk/index", { ids: [] }, { "if-none-match": "*" });
    expect(c1.status).toBe(200);
    const { etag } = (await c1.json()) as { etag: string };
    expect((await put(api, "desk/index", { ids: ["x"] }, { "if-none-match": "*" })).status).toBe(412);

    const read = (await (await get(api, "desk/index")).json()) as { value: unknown; etag: string };
    expect(read).toMatchObject({ value: { ids: [] }, etag });
    const u1 = await put(api, "desk/index", { ids: ["a"] }, { "if-match": etag });
    expect(u1.status).toBe(200);
    // A second writer still holding the old etag loses.
    expect((await put(api, "desk/index", { ids: ["b"] }, { "if-match": etag })).status).toBe(412);
    expect(((await (await get(api, "desk/index")).json()) as { value: unknown }).value).toEqual({ ids: ["a"] });
  });

  it("needs a precondition, a sane key and a value", async () => {
    expect((await put(api, "k", 1, {})).status).toBe(428);
    expect((await put(api, "bad key!", 1, { "if-none-match": "*" })).status).toBe(400);
    const noValue = await api.app.request("/v1/kv?key=k", { method: "PUT", headers: { ...auth, "if-none-match": "*" }, body: "{}" });
    expect(noValue.status).toBe(400);
  });

  it("is closed to keys not listed in KV_KEY_HASHES, and to anonymous callers", async () => {
    expect((await get(closed, "desk/index")).status).toBe(403);
    expect((await closed.app.request("/v1/kv?key=x")).status).toBe(402);
  });
});
