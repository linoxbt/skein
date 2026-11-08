import { describe, expect, it } from "vitest";
import { createReporter, framesOf, parseDsn } from "../src";

const DSN = "https://abc123public@o4500000.ingest.us.sentry.io/4500000000000001";

describe("DSN", () => {
  it("parses a Sentry DSN into the envelope endpoint and key", () => {
    expect(parseDsn(DSN)).toEqual({ envelopeUrl: "https://o4500000.ingest.us.sentry.io/api/4500000000000001/envelope/", publicKey: "abc123public", dsn: DSN });
    expect(parseDsn("https://key@glitchtip.example.com/sub/42")?.envelopeUrl).toBe("https://glitchtip.example.com/sub/api/42/envelope/");
    for (const bad of [undefined, "", "not a url", "https://host/1", "https://key@host/notanumber", "ftp://key@host/1"]) expect(parseDsn(bad)).toBeNull();
  });
});

describe("reporter", () => {
  it("does nothing without a DSN", async () => {
    const r = createReporter({ service: "t" });
    expect(r.enabled).toBe(false);
    expect(await r.capture(new Error("x"))).toBe(false);
  });

  it("sends one envelope per error with tags, stack and auth, and suppresses repeats for a minute", async () => {
    const sent: { url: string; headers: Record<string, string>; body: string }[] = [];
    let t = 1_800_000_000_000;
    const r = createReporter({
      dsn: DSN,
      service: "skein-api",
      release: "abc123",
      now: () => t,
      fetch: (async (url: string, init: RequestInit) => {
        sent.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
        return new Response(null, { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(r.enabled).toBe(true);
    const err = new TypeError("cannot read x of undefined");
    expect(await r.capture(err, { requestId: "req-1", route: "POST /v1/verdicts", attempt: 2 })).toBe(true);
    expect(await r.capture(new TypeError("cannot read x of undefined"))).toBe(false); // the same error, within a minute
    expect(sent).toHaveLength(1);
    const [header, item, event] = sent[0]!.body.split("\n").map((l) => JSON.parse(l));
    expect(sent[0]!.url).toBe("https://o4500000.ingest.us.sentry.io/api/4500000000000001/envelope/");
    expect(sent[0]!.headers["x-sentry-auth"]).toContain("sentry_key=abc123public");
    expect(header).toMatchObject({ event_id: event.event_id, dsn: DSN });
    expect(item).toMatchObject({ type: "event" });
    expect(event).toMatchObject({ level: "error", release: "abc123", tags: { service: "skein-api", requestId: "req-1", route: "POST /v1/verdicts" }, extra: { attempt: 2 } });
    expect(event.exception.values[0]).toMatchObject({ type: "TypeError", value: "cannot read x of undefined" });
    expect(event.exception.values[0].stacktrace.frames.length).toBeGreaterThan(0);
    t += 61_000;
    expect(await r.capture(new TypeError("cannot read x of undefined"))).toBe(true);
  });

  it("never throws when the service is down, and caps the rate", async () => {
    const down = createReporter({ dsn: DSN, service: "t", fetch: (async () => { throw new Error("offline"); }) as unknown as typeof fetch });
    expect(await down.capture(new Error("a"))).toBe(false);
    let n = 0;
    const ok = createReporter({ dsn: DSN, service: "t", now: () => 5, fetch: (async () => { n++; return new Response(null); }) as unknown as typeof fetch });
    for (let i = 0; i < 50; i++) await ok.capture(new Error(`distinct ${i}`));
    expect(n).toBe(30);
  });

  it("reads V8 stack frames, innermost last", () => {
    const frames = framesOf("Error: x\n    at inner (/app/a.js:10:5)\n    at /app/b.js:20:7");
    expect(frames).toEqual([{ filename: "/app/b.js", lineno: 20, colno: 7 }, { function: "inner", filename: "/app/a.js", lineno: 10, colno: 5 }]);
  });
});
