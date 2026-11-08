import { describe, expect, it, vi } from "vitest";
import { Alerts } from "../src/alerts";

describe("alerts", () => {
  it("posts once per key per window, Slack and Discord shaped, and again after it clears", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const sent: { url: string; body: { text: string; content: string } }[] = [];
    let t = 0;
    const a = new Alerts({
      url: "https://hooks.example.com/alert",
      repeatMs: 1000,
      now: () => t,
      fetch: (async (url: string, init: RequestInit) => {
        sent.push({ url, body: JSON.parse(String(init.body)) });
        return new Response(null, { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(await a.raise("wallet", "purchaser wallet low")).toBe(true);
    expect(await a.raise("wallet", "purchaser wallet low")).toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toEqual({ text: "[skein-api] purchaser wallet low", content: "[skein-api] purchaser wallet low" });
    t = 1500;
    expect(await a.raise("wallet", "still low")).toBe(true);
    a.clear("wallet");
    expect(await a.raise("wallet", "low again")).toBe(true);
    expect(sent).toHaveLength(3);
  });

  it("logs only, without a URL, and never throws when delivery fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await new Alerts().raise("cap", "80% of the cap")).toBe(true);
    const failing = new Alerts({ url: "https://hooks.example.com/x", fetch: (async () => { throw new Error("down"); }) as unknown as typeof fetch });
    expect(await failing.raise("cap", "x")).toBe(true);
  });
});
