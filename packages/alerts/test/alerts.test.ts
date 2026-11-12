import { PGlite } from "@electric-sql/pglite";
import { MIGRATIONS_DIR } from "@skein/db";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { Alerter, beat, deliver, kindOf, lastBeat, parseDestinations, SharedAlertState } from "../src/index";

let pg: PGlite;
beforeAll(async () => {
  pg = new PGlite();
  await migrate(drizzle(pg), { migrationsFolder: MIGRATIONS_DIR });
});

function recorder() {
  const sent: { url: string; headers: Record<string, string>; body: string }[] = [];
  const f: typeof fetch = async (u, init) => {
    sent.push({ url: String(u), headers: (init?.headers ?? {}) as Record<string, string>, body: String(init?.body) });
    return new Response("ok");
  };
  return { sent, f };
}

describe("destinations", () => {
  it("recognises ntfy, Slack and Discord, and ignores anything that is not https", () => {
    expect(kindOf("https://ntfy.sh/skein-x")).toBe("ntfy");
    expect(kindOf("https://hooks.slack.com/services/T/B/x")).toBe("slack");
    expect(kindOf("https://discord.com/api/webhooks/1/x")).toBe("discord");
    expect(kindOf("https://example.com/hook")).toBe("json");
    expect(parseDestinations(" https://ntfy.sh/a , http://plain.example , https://discord.com/api/webhooks/1/x ")).toEqual(["https://ntfy.sh/a", "https://discord.com/api/webhooks/1/x"]);
  });

  it("sends each destination its own format", async () => {
    const { sent, f } = recorder();
    const n = await deliver(["https://ntfy.sh/t", "https://hooks.slack.com/services/x", "https://discord.com/api/webhooks/1/x"], { key: "api", title: "API down", message: "HTTP 503", level: "failing" }, f);
    expect(n).toBe(3);
    expect(sent[0]!.headers.Title).toContain("API down");
    expect(sent[0]!.headers.Priority).toBe("high");
    expect(sent[0]!.body).toBe("HTTP 503");
    expect(JSON.parse(sent[1]!.body).text).toContain("API down: HTTP 503");
    expect(JSON.parse(sent[2]!.body).content).toContain("API down: HTTP 503");
  });

  it("never throws when a destination is down", async () => {
    const f: typeof fetch = async () => {
      throw new Error("network down");
    };
    expect(await deliver(["https://ntfy.sh/t"], { key: "k", title: "t", message: "m", level: "info" }, f)).toBe(0);
  });

  it("never throws on a malformed destination or a fetch that throws at once, and cuts long bodies (audit L10)", async () => {
    const bodies: string[] = [];
    const ok: typeof fetch = async (_u, init) => (bodies.push(String(init?.body)), new Response(null));
    const sync = (() => { throw new Error("sync"); }) as unknown as typeof fetch;
    // "https://" passes the https filter but is not a URL: kindOf throws inside deliver.
    await expect(deliver(["https://", "https://hooks.slack.com/x"], { key: "k", title: "t", message: "m", level: "failing" }, ok)).resolves.toBe(1);
    await expect(deliver(["https://ntfy.sh/t"], { key: "k", title: "t", message: "m", level: "failing" }, sync)).resolves.toBe(0);
    await deliver(["https://ntfy.sh/t"], { key: "k", title: "t", message: `HTTP 502: ${"x".repeat(50_000)}`, level: "failing" }, ok);
    expect(bodies.at(-1)!.length).toBeLessThan(1_600);
  });
});

describe("shared state", () => {
  it("lets exactly one of many concurrent callers send, repeats only after the window, and recovers once", async () => {
    const s = new SharedAlertState(pg);
    const firsts = await Promise.all(Array.from({ length: 8 }, () => s.start("wallet", 3_600_000, "low")));
    expect(firsts.filter(Boolean)).toHaveLength(1);
    expect(await s.start("wallet", 3_600_000, "still low")).toBe(false); // within the window
    expect(await s.start("wallet", 0, "still low")).toBe(true); // window passed
    expect((await s.failing()).map((x) => x.key)).toContain("wallet");
    expect(await s.stop("wallet")).toBe(true);
    expect(await s.stop("wallet")).toBe(false); // recovery sent once
    expect(await s.start("wallet", 3_600_000, "low again")).toBe(true); // a new episode alerts at once
  });

  it("two alerters on one database (two replicas) send one alert and one recovery between them", async () => {
    const { sent, f } = recorder();
    const a = new Alerter({ url: "https://ntfy.sh/t", service: "skein-api", db: pg, fetch: f });
    const b = new Alerter({ url: "https://ntfy.sh/t", service: "skein-api", db: pg, fetch: f });
    await Promise.all([a.raise("cap", "80% of cap"), b.raise("cap", "80% of cap")]);
    expect(sent).toHaveLength(1);
    await Promise.all([a.clear("cap"), b.clear("cap")]);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.headers.Tags).toBe("white_check_mark");
  });

  it("works without a database (one process)", async () => {
    const { sent, f } = recorder();
    let now = 0;
    const a = new Alerter({ url: "https://ntfy.sh/t", service: "x", fetch: f, now: () => now, repeatMs: 1000 });
    expect(await a.raise("k", "m")).toBe(true);
    expect(await a.raise("k", "m")).toBe(false);
    now = 2000;
    expect(await a.raise("k", "m")).toBe(true);
    expect(await a.clear("k")).toBe(true);
    expect(await a.clear("k")).toBe(false);
    expect(sent).toHaveLength(3);
  });
});

describe("heartbeats", () => {
  it("records and reads the last run of a job", async () => {
    expect(await lastBeat(pg, "backup")).toBeNull();
    await beat(pg, "backup", "postgres/skein-x.dump");
    const at = await lastBeat(pg, "backup");
    expect(Date.now() - at!.getTime()).toBeLessThan(60_000);
  });
});
