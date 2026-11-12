import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cached, limiter } from "../lib/http";
import { Store } from "../lib/store";

describe("M19: the public board cannot run up the store", () => {
  const env = { ...process.env };
  let GET: (req: Request) => Promise<Response>;
  beforeAll(async () => {
    process.env.DESK_STORE = "memory";
    delete process.env.DESK_SKEIN_KEY;
    delete process.env.DESK_PAYER;
    ({ GET } = await import("../app/api/applications/route"));
  });
  afterAll(() => {
    process.env = env;
  });

  const get = (ip: string, q = "") => GET(new Request(`https://desk.test/api/applications${q}`, { headers: { "x-nf-client-connection-ip": ip } }));

  it("serves one board to every poll for a few seconds", async () => {
    const list = vi.spyOn(Store.prototype, "list");
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => get(`10.0.0.${i}`)));
    for (const r of rs) expect(r.status).toBe(200);
    expect(list).toHaveBeenCalledTimes(1);
    expect(await rs[0]!.json()).toMatchObject({ agent: "offline", rail: "apiKey", applications: [] });
    expect(rs[0]!.headers.get("netlify-cdn-cache-control")).toMatch(/s-maxage=5/);
    list.mockRestore();
  });

  it("limits each caller's reads", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 61; i++) codes.push((await get("192.0.2.7")).status);
    expect(codes.slice(0, 60).every((c) => c === 200)).toBe(true);
    expect(codes[60]).toBe(429);
    expect((await get("192.0.2.7", "?id=app_abcdef123")).status).toBe(429);
    // Someone else is not affected.
    expect((await get("192.0.2.8", "?id=app_abcdef123")).status).toBe(404);
  });
});

describe("cache and limiter", () => {
  it("reloads after the time to live, one load at a time", async () => {
    let loads = 0;
    const c = cached(1_000, async () => ++loads);
    expect(await Promise.all([c(0), c(0), c(10)])).toEqual([1, 1, 1]);
    expect(await c(Date.now() + 2_000)).toBe(2);
  });

  it("opens a new window after the old one", () => {
    const ok = limiter(2, 1_000);
    expect([ok("a", 0), ok("a", 1), ok("a", 2), ok("a", 1_001)]).toEqual([true, true, false, true]);
  });
});
