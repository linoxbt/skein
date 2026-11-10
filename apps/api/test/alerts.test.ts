import { describe, expect, it, vi } from "vitest";
import { Alerts } from "../src/alerts";
import { simulatedApi } from "../src/simulated";

const recorder = () => {
  const sent: { url: string; body: string; headers: Record<string, string> }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, body: String(init.body), headers: (init.headers ?? {}) as Record<string, string> });
    return new Response(null, { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { sent, fetch };
};

describe("alerts", () => {
  it("posts once per episode, repeats after the window, and sends one recovery", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { sent, fetch } = recorder();
    let t = 0;
    const a = new Alerts({ url: "https://hooks.slack.com/services/x", repeatMs: 1000, now: () => t, fetch });
    expect(await a.raise("wallet", "purchaser wallet low")).toBe(true);
    expect(await a.raise("wallet", "purchaser wallet low")).toBe(false);
    expect(JSON.parse(sent[0]!.body).text).toBe("🔴 skein-api · wallet: purchaser wallet low");
    t = 1500;
    expect(await a.raise("wallet", "still low")).toBe(true);
    expect(await a.clear("wallet", "topped up")).toBe(true);
    expect(JSON.parse(sent[2]!.body).text).toBe("✅ skein-api · wallet: topped up");
    expect(await a.clear("wallet")).toBe(false);
    expect(sent).toHaveLength(3);
  });

  it("two replicas sharing the database send one alert between them", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const api = await simulatedApi({ fast: true, env: {} });
    const pg = (api.db as unknown as { $client: { query(s: string, p?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> } }).$client;
    const { sent, fetch } = recorder();
    const a = new Alerts({ url: "https://ntfy.sh/skein-test", db: pg, fetch });
    const b = new Alerts({ url: "https://ntfy.sh/skein-test", db: pg, fetch });
    await Promise.all([a.raise("cap", "80% of cap"), b.raise("cap", "80% of cap"), a.raise("cap", "80% of cap")]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.headers.Priority).toBe("high");
  });

  it("logs only, without a URL, and never throws when delivery fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await new Alerts().raise("cap", "80% of the cap")).toBe(true);
    const failing = new Alerts({ url: "https://hooks.slack.com/services/x", fetch: (async () => { throw new Error("down"); }) as unknown as typeof fetch });
    expect(await failing.raise("cap", "x")).toBe(true);
  });
});
