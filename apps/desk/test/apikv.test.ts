import { createHash } from "node:crypto";
import { DEV_KEY, simulatedApi } from "@skein/api/simulated";
import { beforeAll, describe, expect, it } from "vitest";
import { apiKV, mutate, Store } from "../lib/store";

let kv: ReturnType<typeof apiKV>;

beforeAll(async () => {
  const api = await simulatedApi({ fast: true, env: {}, config: { kvKeyHashes: [createHash("sha256").update(DEV_KEY).digest("hex")] } });
  const inProcess = ((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(api.app.fetch(new Request(String(input), init)))) as typeof fetch;
  kv = apiKV("http://skein.test", DEV_KEY, inProcess);
});

describe("the Desk's store on Skein's /v1/kv", () => {
  it("keeps the KV contract: absent is null, create once, update only at the etag read", async () => {
    expect(await kv.get("t/a")).toBeNull();
    expect(await kv.create("t/a", { n: 1 })).toBe(true);
    expect(await kv.create("t/a", { n: 2 })).toBe(false);
    const cur = await kv.get<{ n: number }>("t/a");
    expect(cur?.value).toEqual({ n: 1 });
    expect(await kv.update("t/a", { n: 2 }, cur!.etag)).toBe(true);
    expect(await kv.update("t/a", { n: 3 }, cur!.etag)).toBe(false);
    expect((await kv.get<{ n: number }>("t/a"))?.value).toEqual({ n: 2 });
  });

  it("counts concurrent writers exactly, through mutate's etag retries", async () => {
    await Promise.all(Array.from({ length: 6 }, () => mutate<number>(kv, "t/counter", (n) => (n ?? 0) + 1)));
    expect((await kv.get<number>("t/counter"))?.value).toBe(6);
  });

  it("runs the Desk's own Store: an empty board lists nothing", async () => {
    expect(await new Store(kv).list()).toEqual([]);
  });

  it("reports a store that cannot answer as a store failure", async () => {
    const down = apiKV("http://skein.test", DEV_KEY, (async () => new Response("nope", { status: 502 })) as unknown as typeof fetch);
    await expect(down.get("x")).rejects.toThrow(/^store get x: HTTP 502/);
  });
});
