import { simulatedApi } from "@skein/api/simulated";
import { TelegraphClient, TESTNET, viemSigner } from "../src/telegraph";
import { FakeNode } from "@skein/telegraph/testing";
import { beforeAll, describe, expect, it } from "vitest";
import { canonicalContext, parseSse, Skein, SKEIN_INTENT, SkeinError, SpendCapError, type VerdictEvent } from "../src";

const TOKEN = "0x4200000000000000000000000000000000000006";
const CONFLICT = "0x420000000000000000000000000000000000000c";
const MINER_KEY = "miner-secret";
/** A fresh clean token per test, so the verdict cache never answers for another test. */
let n = 0;
const tok = () => `0x${(++n).toString(16).padStart(39, "0")}a`;

let api: Awaited<ReturnType<typeof simulatedApi>>;
const inProcess = (): typeof fetch => (input, init) => Promise.resolve(api.app.fetch(new Request(String(input), init)));
const skein = (o: Partial<ConstructorParameters<typeof Skein>[0]> = {}) =>
  new Skein({ apiUrl: "http://skein.test/v1", payer: { kind: "apiKey", key: api.key }, fetch: inProcess(), ...o });

beforeAll(async () => {
  api = await simulatedApi({ fast: true, env: {}, config: { minerAuthKey: MINER_KEY } });
});

describe("verdict() with a partner key", () => {
  it("buys, streams and returns the sealed verdict", async () => {
    const events: VerdictEvent["type"][] = [];
    const v = await skein().verdict({ subject: { chainId: 8453, token: tok() }, onEvent: (e) => events.push(e.type) });
    expect(v.verdict).toBe("APPROVE");
    expect(v.payment).toEqual({ rail: "apiKey" });
    expect(v.verdictHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(events[0]).toBe("plan");
    expect(events).toContain("purchase");
    expect(events.at(-1)).toBe("done");
    const report = await skein().verify(v.id);
    expect(report.ok).toBe(true);
    expect((await skein().bom(v.id)).root).toBe(v.bom.root);
  });

  it("sends a social handle and a repo under the API's names, so those checks are bought", async () => {
    // The Desk's shape: `social` and `repo`. Before canonicalContext the API refused it as an invalid body.
    const v = await skein().verdict({ subject: { chainId: 8453, token: tok() }, context: { social: "@base", repo: "https://github.com/base/node" } });
    expect(v.verdict).toBe("APPROVE");
    const checks = v.findings.map((f) => f.check);
    expect(checks).toContain("social_bots");
    // dex-list@0.2.0 (the latest dex-list) buys the code review when a repo is given.
    expect(v.policy).toMatchObject({ id: "dex-list", version: "0.2.0" });
    expect(checks).toContain("code_review");
    expect(canonicalContext({ social: "x", repo: "https://github.com/a/b", deployer: "" })).toEqual({ socialHandle: "x", repoUrl: "https://github.com/a/b" });
    expect(canonicalContext({})).toBeUndefined();
  });

  it("escalates the market-integrity conflict", async () => {
    const v = await skein().verdict({ subject: { chainId: 8453, token: CONFLICT } });
    expect(v.verdict).toBe("ESCALATE");
    expect(v.conflicts).toContain("MARKET_INTEGRITY_CONFLICT");
  });

  it("returns the original verdict for a reused idempotency key", async () => {
    const token = tok();
    const a = await skein().verdict({ subject: { chainId: 8453, token }, idempotencyKey: "same" });
    const b = await skein().verdict({ subject: { chainId: 8453, token }, idempotencyKey: "same" });
    expect(b.replayed).toBe(true);
    expect(b.id).toBe(a.id);
  });

  it("refuses before paying when the quote is above the cap", async () => {
    const before = api.node.charges.length;
    const err = await skein({ maxUsdcPerCall: 0.000001 }).verdict({ subject: { chainId: 8453, token: TOKEN } }).catch((e) => e);
    expect(err).toBeInstanceOf(SkeinError);
    expect(["SPEND_CAP", "BUDGET_TOO_LOW"]).toContain(err.code);
    expect(api.node.charges.length).toBe(before);
  });

  it("raises SpendCapError when Skein's price is above the cap", async () => {
    const s = skein({ maxUsdcPerCall: 0.2 });
    expect((await s.quote({ subject: { chainId: 8453, token: TOKEN } })).priceUsdc).toBe(0.25);
    await expect(s.verdict({ subject: { chainId: 8453, token: tok() } })).rejects.toBeInstanceOf(SpendCapError);
  });

  it("types API errors", async () => {
    const bad = skein({ payer: { kind: "apiKey", key: "sk_part_wrong" } });
    await expect(bad.verdict({ subject: { chainId: 8453, token: TOKEN } })).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    await expect(skein().verdict({ subject: { chainId: 999, token: TOKEN } })).rejects.toMatchObject({ code: "INVALID_SUBJECT", status: 400 });
    await expect(skein({ payer: undefined }).verdict({ subject: { chainId: 8453, token: TOKEN } })).rejects.toMatchObject({ code: "NO_PAYER" });
  });

  it("retries a 503 and a dropped connection on reads", async () => {
    let calls = 0;
    const flaky: typeof fetch = (input, init) => {
      calls++;
      if (calls === 1) return Promise.reject(new TypeError("fetch failed"));
      if (calls === 2) return Promise.resolve(new Response(JSON.stringify({ error: { code: "OOPS", message: "x" } }), { status: 502 }));
      return inProcess()(input, init);
    };
    const s = skein({ fetch: flaky });
    const q = await s.quote({ subject: { chainId: 8453, token: TOKEN } });
    expect(q.ok).toBe(true);
    expect(calls).toBe(3);
  });
});

describe("verdict() through Telegraph", () => {
  it("pays one ask and returns the verdict with its receipt", async () => {
    // A node that routes Skein's intent to the API's miner endpoint, as Telegraph will.
    const asks: Record<string, unknown>[] = [];
    const node = new FakeNode({
      priceUusdc: 150_000,
      respond: async (minerId, body) => {
        asks.push(body);
        const res = await api.app.request("/miner/verdict", {
          method: "POST",
          headers: { "content-type": "application/json", "x-skein-miner-key": MINER_KEY },
          body: JSON.stringify(body.params),
        });
        return { kind: "answer", result: await res.json() };
      },
    });
    const client = new TelegraphClient({ network: TESTNET, signer: viemSigner(`0x${"55".repeat(32)}`), fetch: node.fetch, maxUusdcPerCall: 200_000, allowPreSeason: true });
    const token = tok();
    const v = await skein({ payer: { kind: "telegraph", client, minerId: "skein" } }).verdict({ subject: { chainId: 8453, token } });
    expect(asks[0]).toMatchObject({ intent: SKEIN_INTENT, params: { chain: "base", token } });
    expect(v.verdict).toBe("APPROVE");
    expect(v.channel).toBe("telegraph");
    expect(v.payment).toMatchObject({ rail: "telegraph", minerId: "skein", amountUsdc: 0.15 });
    expect(node.charges).toHaveLength(1);
    expect(v.payment.rail === "telegraph" && v.payment.receiptHash).toBe(node.charges[0]!.receiptHash);
  });

  it("does not pay above the client's per-call cap", async () => {
    const node = new FakeNode({ priceUusdc: 900_000, respond: () => ({ kind: "answer", result: {} }) });
    const client = new TelegraphClient({ network: TESTNET, signer: viemSigner(`0x${"55".repeat(32)}`), fetch: node.fetch, maxUusdcPerCall: 300_000, allowPreSeason: true });
    const err = await skein({ payer: { kind: "telegraph", client } }).verdict({ subject: { chainId: 8453, token: TOKEN } }).catch((e) => e);
    expect(err).toBeInstanceOf(SkeinError);
    expect(err.code).toMatch(/^TELEGRAPH_/);
    expect(node.charges).toHaveLength(0);
  });
});

describe("stream()", () => {
  it("replays a finished verdict's events", async () => {
    const v = await skein().verdict({ subject: { chainId: 8453, token: tok() } });
    const types: string[] = [];
    for await (const e of skein().stream(v.id)) types.push(e.type);
    expect(types[0]).toBe("plan");
    expect(types.at(-1)).toBe("done");
  });

  it("parses multi-line data, comments and CRLF", async () => {
    const text = ": hello\r\nevent: a\r\ndata: {\"x\":\r\ndata: 1}\r\nid: 7\r\n\r\nevent: b\ndata: 2\n\n";
    const body = new Response(text).body!;
    const out = [];
    for await (const e of parseSse(body)) out.push(e);
    expect(out).toEqual([{ event: "a", data: '{"x":\n1}', id: "7" }, { event: "b", data: "2", id: "7" }]);
  });
});

describe("submit() and wait()", () => {
  it("returns an id at once and waits for the seal separately", async () => {
    const started = await skein().submit({ subject: { chainId: 8453, token: tok() } });
    expect("status" in started && started.status).toBe("running");
    const v = await skein().wait((started as { id: string }).id);
    expect(v.verdict).toBe("APPROVE");
  });

  it("times out with the id when the verdict outlives the wait", async () => {
    const started = (await skein().submit({ subject: { chainId: 8453, token: `0x${"1".repeat(39)}c` }, context: { deployer: `0x${"2".repeat(39)}e` } })) as { id: string };
    const err = await skein().wait(started.id, { timeoutMs: 50 }).catch((e) => e);
    expect(err).toMatchObject({ code: "TIMEOUT", details: { id: started.id } });
    await skein().wait(started.id, { timeoutMs: 60_000 });
  }, 70_000);
});

describe("transport", () => {
  it("handles a CRLF split across chunks, and drops an unterminated final event", async () => {
    const enc = new TextEncoder();
    const chunks = ["event: a\r", "\ndata: 1\r", "\n\r", "\ndata: partial"];
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        c.close();
      },
    });
    const out = [];
    for await (const e of parseSse(body)) out.push(e);
    expect(out).toEqual([{ event: "a", data: "1" }]);
  });

  it("gives up on a hung request after requestTimeoutMs", async () => {
    const hang: typeof fetch = (_i, init) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
    const s = new Skein({ apiUrl: "http://x", fetch: hang, requestTimeoutMs: 30, retries: 0 });
    await expect(s.quote({ subject: { chainId: 8453, token: TOKEN } })).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("throws at once on a Retry-After longer than its retry budget (a daily cap)", async () => {
    let calls = 0;
    const capped: typeof fetch = async () => {
      calls++;
      return new Response(JSON.stringify({ error: { code: "RATE_LIMITED", message: "daily cap" } }), { status: 429, headers: { "retry-after": "40000" } });
    };
    const s = new Skein({ apiUrl: "http://x", fetch: capped });
    await expect(s.quote({ subject: { chainId: 8453, token: TOKEN } })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(calls).toBe(1);
  });
});

describe("Telegraph payer edge cases", () => {
  it("says what was paid when the miner answers without a verdict", async () => {
    const asker = { ask: async () => ({ ok: true as const, response: { miner_id: "skein", result: { verdict: "ABSTAIN", reasons: [{ code: "BUDGET_TOO_LOW" }] } }, receipt: { receipt_hash: `0x${"ab".repeat(32)}` }, amountUusdc: 150_000, durationMs: 1 }) };
    const err = await skein({ payer: { kind: "telegraph", client: asker } }).verdict({ subject: { chainId: 8453, token: tok() } }).catch((e) => e);
    expect(err).toMatchObject({ code: "TELEGRAPH_NO_VERDICT", payment: { amountUsdc: 0.15, billing: "paid" } });
  });

  it("reports a paid ask that failed as billing unknown", async () => {
    const asker = { ask: async () => ({ ok: false as const, kind: "timeout", error: "x", paidUusdc: 150_000, billing: "unknown" }) };
    const err = await skein({ payer: { kind: "telegraph", client: asker } }).verdict({ subject: { chainId: 8453, token: tok() } }).catch((e) => e);
    expect(err).toMatchObject({ code: "TELEGRAPH_TIMEOUT", payment: { amountUsdc: 0.15, billing: "unknown" } });
  });

  it("waits for a verdict the miner was still making at its deadline", async () => {
    const started = (await skein().submit({ subject: { chainId: 8453, token: tok() } })) as { id: string };
    const asker = { ask: async () => ({ ok: true as const, response: { miner_id: "skein", result: { verdict: "ABSTAIN", pending_id: started.id } }, receipt: null, amountUusdc: 150_000, durationMs: 1 }) };
    const v = await skein({ payer: { kind: "telegraph", client: asker } }).verdict({ subject: { chainId: 8453, token: tok() } });
    expect(v.id).toBe(started.id);
    expect(v.payment).toMatchObject({ rail: "telegraph", amountUsdc: 0.15 });
  });
});

describe("reads and webhooks", () => {
  it("lists policies, reads one, the status and the ledger", async () => {
    const s = skein();
    const ps = await s.policies();
    expect(ps.map((p) => p.ref ?? `${p.id}@${p.version}`)).toContain("dex-list@0.2.0");
    expect(await s.policy("agent-pretrade@0.2.0")).toBeTruthy();
    expect(await s.status()).toHaveProperty("network");
    expect(await s.ledger()).toBeTruthy();
  });

  it("sets, reads and deletes the partner's webhook, and needs a partner key for it", async () => {
    api.service.deps.lookup = async () => ["93.184.216.34"];
    const s = skein();
    const set = await s.setWebhook("https://hooks.example.com/sdk");
    expect(set.secret.length).toBeGreaterThan(20);
    expect(await s.webhook()).toMatchObject({ url: "https://hooks.example.com/sdk" });
    expect(await s.deleteWebhook()).toBe(true);
    expect(await s.webhook()).toBeNull();
    await expect(skein({ payer: { kind: "telegraph", client: {} as never } }).webhook()).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
  });
});
