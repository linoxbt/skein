import { readFileSync } from "node:fs";
import { reproduce } from "@skein/engine";
import { getPolicy } from "@skein/policies";
import { TelegraphClient, TESTNET, viemSigner } from "@skein/telegraph";
import { FakeNode, type Behaviour } from "@skein/telegraph/testing";
import { describe, expect, it } from "vitest";
import {
  availability,
  catalogueFromSnapshot,
  knownLists,
  runVerdict,
  screenAddresses,
  sdnSnapshot,
  sdnSnapshotStatus,
  SHIPPED_SDN_SNAPSHOTS,
  type Catalogue,
  type PipelineEvent,
  type PoolResolver,
  type VerdictDeps,
} from "../src";

const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const SEASON = Date.parse("2026-11-03T10:00:00Z");
const snapshot = JSON.parse(readFileSync(new URL("../../telegraph/snapshots/2026-10-30.json", import.meta.url), "utf8"));
const catalogue = catalogueFromSnapshot(snapshot);
const subject = { chainId: 8453, token: "0x4200000000000000000000000000000000000006" };
const context = { socialHandle: "project", deployer: "0x1111111111111111111111111111111111111111" };
const pool: PoolResolver = { resolve: async () => "0xd0b53d9277642d899df5c87a3966a349a798f224" };

const CLEAN: Record<string, unknown> = {
  "200001": { code: 1, result: { [subject.token]: { is_honeypot: "0", is_open_source: "1", is_mintable: "0", buy_tax: "0", sell_tax: "0" } } },
  "78021": { on_list: false, entity: "0x1111111111111111111111111111111111111111" },
  "7373": { liquidity_usd: 4_500_000 },
  "9002": { holders_count: 120_000 },
  "7302": { holders_count: 120_000 },
  "7378": { verdict: "organic", wash_volume_pct: 3 },
  "7457": { verdict: "human" },
};

function harness(over: Record<string, Behaviour> = {}) {
  const node = new FakeNode({
    nowSec: () => Math.floor(SEASON / 1000),
    respond: (minerId) => over[minerId] ?? { kind: "answer", result: CLEAN[minerId] ?? {}, resultShape: minerId === "200001" ? "raw" : "intent" },
  });
  const client = new TelegraphClient({ network: TESTNET, signer: viemSigner(KEY), fetch: node.fetch, maxUusdcPerCall: 50_000, now: () => SEASON });
  const events: PipelineEvent[] = [];
  const deps: VerdictDeps & { client: TelegraphClient } = { client, catalogue, priceUusdc: 250_000, resolver: pool, onEvent: (e: PipelineEvent) => void events.push(e), now: () => new Date(SEASON) };
  return { node, deps, events };
}

const dex = () => getPolicy("dex-list@0.1.0").policy;

describe("runVerdict, end to end against a fake node", () => {
  it("a clean token: six pinned purchases, every receipt in the BOM, APPROVE, reproducible", async () => {
    const { node, deps, events } = harness();
    const run = await runVerdict({ policy: dex(), subject, context }, deps);
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.verdict.decision.verdict).toBe("APPROVE");
    expect(run.purchases.map((p) => [p.check, p.minerId, p.pinned])).toEqual([
      ["contract_audit", "200001", true],
      ["holder_count", "9002", true],
      ["liquidity_depth", "7373", true],
      ["sanctions", "78021", true],
      ["social_bots", "7457", true],
      ["wash_trading", "7378", true],
    ]);
    expect(node.charges).toHaveLength(6);
    expect(run.verdict.bom.items).toBe(6);
    expect(new Set(run.stored.receipts)).toEqual(new Set(node.charges.map((c) => c.receiptHash)));
    expect(run.purchases.reduce((a, p) => a + p.amountUusdc, 0)).toBe(60_000);
    // VerifyWire, ChainWire and TradeWire are one operator: one independence group.
    expect(run.purchases.filter((p) => p.sourceGroup === "margyn.workers.dev").map((p) => p.check)).toEqual([
      "liquidity_depth", "social_bots", "wash_trading",
    ]);
    expect(reproduce(run.stored, dex())).toMatchObject({ ok: true });
    expect(events[0]!.type).toBe("plan");
    expect(events.at(-1)!.type).toBe("decision");
    expect(events.filter((e) => e.type === "purchase")).toHaveLength(6);
  });

  it("an OFAC SDN deployer: REJECT on the address screen, the name screen not bought, reproducible", async () => {
    const listed = Object.keys(sdnSnapshot().addresses)[0]!;
    const { node, deps } = harness();
    const run = await runVerdict({ policy: dex(), subject, context: { ...context, deployer: listed } }, deps);
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.verdict.decision.verdict).toBe("REJECT");
    expect(run.verdict.decision.reasons[0]!.code).toBe("BLOCKER_SANCTIONS_FAIL");
    expect(run.purchases.map((p) => p.check)).not.toContain("sanctions");
    expect(node.charges).toHaveLength(5);
    const f = run.verdict.findings.find((x) => x.check === "sanctions")!;
    expect(f).toMatchObject({ status: "FAIL", confidence: 1, notes: ["ofac_sdn_address_match"] });
    expect(f.evidence?.matches).toEqual([expect.objectContaining({ field: "deployer", address: listed })]);
    expect(f.evidence?.listSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(reproduce(run.stored, dex())).toMatchObject({ ok: true });
  });

  it("the address screen matches exactly, in any letter case, and nothing else", () => {
    const listed = Object.keys(sdnSnapshot().addresses)[0]!;
    expect(screenAddresses({ token: listed.toUpperCase().replace("0X", "0x") })).toHaveLength(sdnSnapshot().addresses[listed]!.length);
    expect(screenAddresses({ token: subject.token, deployer: context.deployer, empty: undefined })).toEqual([]);
    expect(screenAddresses({ deployer: `${listed.slice(0, -1)}${listed.endsWith("0") ? "1" : "0"}` })).toEqual([]);
  });

  it("the conflict: audit PASS but wash trading FAIL -> ESCALATE", async () => {
    const { deps } = harness({ "7378": { kind: "answer", result: { verdict: "wash_trading", wash_volume_pct: 72 } } });
    const run = await runVerdict({ policy: dex(), subject, context }, deps);
    expect(run.ok && run.verdict.decision.verdict).toBe("ESCALATE");
    expect(run.ok && run.verdict.decision.reasons[0]!.code).toBe("MARKET_INTEGRITY_CONFLICT");
  });

  it("the refusal: sanctions times out -> ABSTAIN naming it; the possibly-billed call is counted, never retried", async () => {
    const { node, deps } = harness({ "78021": { kind: "hang" } });
    const policy = dex();
    policy.budget.per_check_timeout_ms.sanctions = 40;
    const run = await runVerdict({ policy, subject, context }, deps);
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.verdict.decision.verdict).toBe("ABSTAIN");
    expect(run.verdict.decision.reasons[0]).toMatchObject({ code: "MISSING_REQUIRED_CHECK", check: "sanctions" });
    const s = run.purchases.find((p) => p.check === "sanctions")!;
    // X-PAYMENT was sent, so the node may bill it: recorded at the signed amount, not retried.
    expect(s).toMatchObject({ amountUusdc: 10_000, attempts: 1, billing: "unknown" });
    expect(s.receiptHash).toBeUndefined();
    expect(s.error).toMatch(/^timeout/);
    expect(node.charges).toHaveLength(5);
    expect(run.verdict.bom.items).toBe(5);
  });

  it("garbage from a miner becomes UNKNOWN, never a pass", async () => {
    const { deps } = harness({ "7373": { kind: "answer", result: "<html>rate limited</html>", resultShape: "raw" } });
    const run = await runVerdict({ policy: dex(), subject, context }, deps);
    expect(run.ok && run.verdict.findings.find((f) => f.check === "liquidity_depth")?.status).toBe("UNKNOWN");
    expect(run.ok && run.verdict.decision.verdict).toBe("ABSTAIN");
  });

  it("no pool found: a required check cannot be bought, so nothing is bought (UPSTREAM_UNAVAILABLE)", async () => {
    const { node, deps } = harness();
    const asked: string[] = [];
    const ask = deps.client.ask.bind(deps.client);
    deps.client.ask = async (req, opts) => (asked.push(opts.minerId ?? ""), ask(req, opts));
    const run = await runVerdict({ policy: dex(), subject, context }, { ...deps, resolver: { resolve: async () => null } });
    expect(run.ok).toBe(false);
    expect(!run.ok && run.plan.refusal).toMatchObject({ code: "UPSTREAM_UNAVAILABLE", checks: ["liquidity_depth"], detail: expect.stringMatching(/no_pool_found/) });
    expect(node.charges).toHaveLength(0);
    expect(asked).toEqual([]);
  });

  it("a required check whose only allowlisted miner is Skein's own is refused before any purchase", async () => {
    const { node, deps } = harness();
    deps.excludeMinerIds = ["200001"];
    const run = await runVerdict({ policy: dex(), subject, context }, deps);
    expect(!run.ok && run.plan.refusal).toMatchObject({ code: "UPSTREAM_UNAVAILABLE", checks: ["contract_audit"] });
    expect(node.charges).toHaveLength(0);
  });

  it("an OFAC SDN deployer still rejects when a required check cannot be bought", async () => {
    const listed = Object.keys(sdnSnapshot().addresses)[0]!;
    const { deps } = harness();
    const run = await runVerdict({ policy: dex(), subject, context: { ...context, deployer: listed } }, { ...deps, resolver: { resolve: async () => null } });
    expect(run.ok && run.verdict.decision.verdict).toBe("REJECT");
    expect(run.ok && reproduce(run.stored, dex(), { knownLists: knownLists() }).ok).toBe(true);
  });

  it("sanctions goes to the OFAC screen in its native form", async () => {
    const seen: Record<string, unknown>[] = [];
    const { deps } = harness();
    const ask = deps.client.ask.bind(deps.client);
    deps.client.ask = async (req, opts) => {
      if (opts.minerId === "78021") seen.push(req as Record<string, unknown>);
      return ask(req, opts);
    };
    await runVerdict({ policy: dex(), subject, context }, deps);
    expect(seen).toEqual([{ method: "GET", endpoint: "/query", payload: { entity: context.deployer } }]);
  });

  it("falls through to the next allowlisted miner when one refuses before payment", async () => {
    const { node, deps } = harness();
    const ask = deps.client.ask.bind(deps.client);
    deps.client.ask = async (req, opts) =>
      opts.minerId === "7373"
        ? { ok: false, kind: "incompatible", error: "no_compatible_miner", httpStatus: 503, durationMs: 1, attempts: 1, paidUusdc: 0, billing: "none" }
        : ask(req, opts);
    const run = await runVerdict({ policy: dex(), subject, context }, deps);
    const liq = run.ok ? run.purchases.find((p) => p.check === "liquidity_depth")! : null;
    expect(liq).toMatchObject({ minerId: "72006", skipped: ["7373"] });
    expect(node.charges.filter((c) => c.minerId === "7373")).toHaveLength(0);
  });

  it("falls through when a miner fails before payment (a 503 'try again later'), at no cost", async () => {
    const { node, deps } = harness();
    const ask = deps.client.ask.bind(deps.client);
    deps.client.ask = async (req, opts) =>
      opts.minerId === "9002"
        ? { ok: false, kind: "server_error", error: "expected 402, got 503: could not route this question now", httpStatus: 503, durationMs: 1, attempts: 2, paidUusdc: 0, billing: "none" }
        : ask(req, opts);
    const run = await runVerdict({ policy: dex(), subject, context }, deps);
    const hc = run.ok ? run.purchases.filter((p) => p.check === "holder_count") : [];
    expect(hc).toHaveLength(1);
    expect(hc[0]).toMatchObject({ minerId: "7302", skipped: ["9002"] });
    expect(node.charges.filter((c) => c.minerId === "9002")).toHaveLength(0);
    expect(run.ok && run.verdict.findings.find((f) => f.check === "holder_count")?.status).toBe("PASS");
  });

  it("optional checks without context are not bought", async () => {
    const { node, deps } = harness();
    const run = await runVerdict({ policy: dex(), subject, context: {} }, deps);
    expect(node.charges.map((c) => c.minerId)).not.toContain("7457");
    expect(run.ok && run.verdict.findings.find((f) => f.check === "social_bots")?.notes).toEqual(["no_social_handle"]);
  });

  it("cex-standard is refused before any purchase while holder concentration has no intent", async () => {
    const { node, deps } = harness();
    const run = await runVerdict({ policy: getPolicy("cex-standard@0.1.0").policy, subject, context }, deps);
    expect(run.ok).toBe(false);
    expect(!run.ok && run.plan.refusal).toMatchObject({ code: "UPSTREAM_UNAVAILABLE", checks: ["holder_concentration"] });
    expect(node.charges).toHaveLength(0);
  });

  it("a budget below the quote is refused before any purchase", async () => {
    const { node, deps } = harness();
    const run = await runVerdict({ policy: dex(), subject, context, budgetUusdc: 30_000 }, deps);
    expect(!run.ok && run.plan.refusal.code).toBe("BUDGET_TOO_LOW");
    expect(node.charges).toHaveLength(0);
  });
});

describe("a paid answer that cannot be used", () => {
  it("buys the next allowlisted miner after the first round, and the check is answered", async () => {
    const { node, deps } = harness({ "9002": { kind: "answer", result: { holders_count: null }, resultShape: "intent" } });
    const run = await runVerdict({ policy: dex(), subject, context }, deps);
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.purchases.filter((p) => p.check === "holder_count").map((p) => p.minerId)).toEqual(["9002", "7302"]);
    expect(node.charges.map((c) => c.minerId).filter((m) => m === "9002" || m === "7302")).toEqual(["9002", "7302"]);
    const hc = run.verdict.findings.filter((f) => f.check === "holder_count");
    expect(hc.map((f) => f.status).sort()).toEqual(["PASS", "UNKNOWN"]);
    expect(run.verdict.decision.verdict).toBe("APPROVE");
    expect(run.verdict.bom.items).toBe(7);
    expect(run.purchases.reduce((a, p) => a + p.amountUusdc, 0)).toBeLessThanOrEqual(run.plan.capUusdc);
    expect(reproduce(run.stored, dex())).toMatchObject({ ok: true });
  });

  it("does not retry when the cap has nothing to spare", async () => {
    const { node, deps } = harness({ "9002": { kind: "answer", result: { holders_count: null }, resultShape: "intent" } });
    const probe = await runVerdict({ policy: dex(), subject, context }, harness().deps);
    const exact = probe.ok ? probe.plan.estimateUusdc : 0;
    const run = await runVerdict({ policy: dex(), subject, context, budgetUusdc: exact }, deps);
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.purchases.filter((p) => p.check === "holder_count").map((p) => p.minerId)).toEqual(["9002"]);
    expect(node.charges.map((c) => c.minerId)).not.toContain("7302");
    expect(run.verdict.findings.find((f) => f.check === "holder_count")).toMatchObject({ status: "UNKNOWN", notes: ["missing_holders_count"] });
  });

  it("does not retry an answer that was usable", async () => {
    const { node, deps } = harness();
    await runVerdict({ policy: dex(), subject, context }, deps);
    expect(node.charges).toHaveLength(6);
  });
});

describe("runVerdict spend safety", () => {
  it("never lets the 402s spend past the verdict's cap: each ask is capped at its allotment", async () => {
    const { deps } = harness();
    const caps: number[] = [];
    const ask = deps.client.ask.bind(deps.client);
    deps.client.ask = async (req, opts) => {
      caps.push(opts.maxUusdc ?? Infinity);
      return ask(req, opts);
    };
    const run = await runVerdict({ policy: dex(), subject, context }, deps);
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(caps.every((c) => Number.isFinite(c))).toBe(true);
    expect(caps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(run.plan.capUusdc);
  });

  it("holds daily spend before each payment and settles what was spent", async () => {
    const { deps } = harness();
    let held = 0;
    let settled = 0;
    deps.spend = {
      async reserve(u) {
        held += u;
        return { settle: async (spent) => void (settled += spent) };
      },
    };
    const run = await runVerdict({ policy: dex(), subject, context }, deps);
    expect(run.ok && run.purchases.reduce((a, p) => a + p.amountUusdc, 0)).toBe(settled);
    expect(settled).toBeLessThanOrEqual(held);
  });

  it("refuses to buy a check once the daily reservation is refused", async () => {
    const { node, deps } = harness();
    deps.spend = { reserve: async () => null };
    const run = await runVerdict({ policy: dex(), subject, context }, deps);
    expect(node.charges).toHaveLength(0);
    expect(run.ok && run.verdict.findings.find((f) => f.check === "sanctions")?.notes).toEqual(["daily_cap_reached"]);
  });

  it("persists each purchase before the verdict is sealed", async () => {
    const { deps } = harness();
    const written: string[] = [];
    let sealedBefore = false;
    deps.onPurchase = async (p) => void written.push(p.check);
    deps.onEvent = (e) => {
      if (e.type === "decision") sealedBefore = written.length > 0;
    };
    const run = await runVerdict({ policy: dex(), subject, context }, deps);
    expect(written.sort()).toEqual(run.ok ? run.purchases.map((p) => p.check).sort() : []);
    expect(sealedBefore).toBe(true);
  });

  it("an exception during one purchase does not lose the others", async () => {
    const { node, deps } = harness();
    const ask = deps.client.ask.bind(deps.client);
    deps.client.ask = async (req, opts) => {
      if (opts.minerId === "9002") throw new Error("signer exploded");
      return ask(req, opts);
    };
    const run = await runVerdict({ policy: dex(), subject, context }, deps);
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.purchases.find((p) => p.check === "holder_count")?.error).toMatch(/exception: signer exploded/);
    expect(run.purchases.filter((p) => p.billing === "paid")).toHaveLength(node.charges.length);
  });

  it("does not route a check with no live allowlisted miner", async () => {
    const { node, deps } = harness();
    const run = await runVerdict({ policy: dex(), subject, context: { ...context, repoUrl: "https://github.com/a/b" } }, deps);
    // The allowlisted code-review miners registered after this 2026-10-30 fake node, so here it is UNAVAILABLE, never bought from whoever /ask routes to.
    expect(run.ok && run.verdict.findings.find((f) => f.check === "code_review")).toBeFalsy();
    expect(node.charges.every((c) => c.minerId !== "")).toBe(true);
  });

  it("a receipt that does not check out is paid for but not evidence", async () => {
    const { deps } = harness();
    const ask = deps.client.ask.bind(deps.client);
    deps.client.ask = async (req, opts) => {
      const out = await ask(req, opts);
      return opts.minerId === "9002" && out.ok ? { ...out, receiptProblems: ["receipt payer 0xbb, expected 0xaa"] } : out;
    };
    const run = await runVerdict({ policy: dex(), subject, context }, deps);
    if (!run.ok) throw new Error("plan refused");
    const hc = run.purchases.find((p) => p.check === "holder_count")!;
    expect(hc).toMatchObject({ billing: "paid", amountUusdc: 10_000 });
    expect(hc.receiptHash).toBeUndefined();
    expect(run.verdict.findings.find((f) => f.check === "holder_count")?.status).toBe("ERROR");
    expect(run.stored.receipts).not.toContain(undefined);
  });

  it("checks each paid answer's signal on the node", async () => {
    const { deps } = harness();
    const run = await runVerdict({ policy: dex(), subject, context }, deps);
    expect(run.ok && run.purchases.filter((p) => p.billing === "paid").every((p) => p.signalStatus === "verified")).toBe(true);
  });
});

describe("self exclusion", () => {
  it("never buys from Skein's own registrations", async () => {
    const { node, deps } = harness();
    deps.excludeMinerIds = ["7373"];
    const run = await runVerdict({ policy: dex(), subject, context }, deps);
    expect(node.charges.map((c) => c.minerId)).not.toContain("7373");
    expect(run.ok && run.purchases.find((p) => p.check === "liquidity_depth")?.minerId).toBe("72006");
  });
});

describe("the network's record of a paid answer (audit M1)", () => {
  it("an answer the node attributes to another miner is paid for, recorded, and an ERROR", async () => {
    const { deps } = harness();
    deps.client.verifySignal = async (_h, expect_) => (expect_?.minerId === "9002" ? "mismatch" : "verified");
    const run = await runVerdict({ policy: dex(), subject, context }, deps);
    if (!run.ok) throw new Error("plan refused");
    const hc = run.purchases.find((p) => p.check === "holder_count")!;
    expect(hc).toMatchObject({ billing: "paid", signalStatus: "mismatch", error: expect.stringMatching(/^signal_mismatch/) });
    expect(hc.receiptHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(run.verdict.findings.find((f) => f.check === "holder_count")?.status).toBe("ERROR");
    expect(run.verdict.decision.verdict).toBe("ABSTAIN");
    expect(reproduce(run.stored, dex()).ok).toBe(true);
  });

  it("a node 404 for the signal is kept, with its status", async () => {
    const { deps } = harness();
    deps.client.verifySignal = async () => "missing";
    const run = await runVerdict({ policy: dex(), subject, context }, deps);
    expect(run.ok && run.verdict.decision.verdict).toBe("APPROVE");
    expect(run.ok && run.purchases.every((p) => p.signalStatus === "missing" && !p.error)).toBe(true);
  });

  it("an answer with no signal hash at all is an ERROR", async () => {
    const { deps } = harness();
    const ask = deps.client.ask.bind(deps.client);
    deps.client.ask = async (req, opts) => {
      const out = await ask(req, opts);
      return opts.minerId === "7378" && out.ok ? { ...out, response: { ...out.response, signal_hash: undefined } } : out;
    };
    const run = await runVerdict({ policy: dex(), subject, context }, deps);
    expect(run.ok && run.purchases.find((p) => p.check === "wash_trading")?.error).toMatch(/^no_signal_hash/);
    expect(run.ok && run.verdict.findings.find((f) => f.check === "wash_trading")?.status).toBe("ERROR");
  });
});

describe("bill of materials and deadlines", () => {
  it("records each receipt's timestamp and payer (spec section 4), and replay is unchanged by them", async () => {
    const { node, deps } = harness();
    const run = await runVerdict({ policy: dex(), subject, context }, deps);
    if (!run.ok) throw new Error("plan refused");
    for (const p of run.purchases) {
      expect(p.receiptTimestamp).toBe(Math.floor(SEASON / 1000));
      expect(p.payer).toBe(node.charges[0]!.payer);
    }
    expect(reproduce(run.stored, dex())).toMatchObject({ ok: true });
  });

  it("passes the verdict's one deadline to every ask", async () => {
    const { deps } = harness();
    const seen: (number | undefined)[] = [];
    const ask = deps.client.ask.bind(deps.client);
    deps.client.ask = async (req, opts) => (seen.push(opts.deadline), ask(req, opts));
    const t0 = Date.now();
    await runVerdict({ policy: dex(), subject, context }, { ...deps, deadlineMs: 30_000 });
    expect(seen.length).toBeGreaterThan(0);
    for (const d of seen) expect(d).toBeGreaterThanOrEqual(t0 + 30_000 - 5);
    expect(new Set(seen).size).toBe(1);
  });

  it("marks every intent ask skein-depth 1, so a Skein miner downstream never buys again (spec section 9)", async () => {
    const { deps } = harness();
    const seen: Record<string, unknown>[] = [];
    const ask = deps.client.ask.bind(deps.client);
    deps.client.ask = async (req, opts) => (seen.push(req as Record<string, unknown>), ask(req, opts));
    const run = await runVerdict({ policy: dex(), subject, context }, deps);
    expect(run.ok).toBe(true);
    const intentAsks = seen.filter((r) => "intent" in r);
    expect(intentAsks.length).toBeGreaterThan(0);
    for (const r of intentAsks) expect(r.context).toMatchObject({ "skein-depth": "1" });
    // A native request carries only the fields its miner declares.
    for (const r of seen.filter((x) => "endpoint" in x)) expect(JSON.stringify(r)).not.toContain("skein-depth");
  });

  it("a spend settlement that throws is logged, and the paid purchase is still recorded (audit M3)", async () => {
    const { node, deps } = harness();
    const logged: string[] = [];
    deps.log = (msg) => void logged.push(msg);
    deps.spend = { reserve: async () => ({ settle: async () => Promise.reject(new Error("db down")) }) };
    const written: string[] = [];
    deps.onPurchase = async (p) => void written.push(p.check);
    const run = await runVerdict({ policy: dex(), subject, context }, deps);
    expect(run.ok).toBe(true);
    expect(written).toHaveLength(6);
    expect(node.charges).toHaveLength(6);
    expect(logged).toHaveLength(6);
    expect(run.ok && run.verdict.decision.verdict).toBe("APPROVE");
  });

  it("groups a pinned answer by the miner Skein chose, whatever id the node reports (audit L7)", async () => {
    const { deps } = harness();
    const ask = deps.client.ask.bind(deps.client);
    deps.client.ask = async (req, opts) => {
      const out = await ask(req, opts);
      return opts.minerId === "7373" && out.ok ? { ...out, response: { ...out.response, miner_id: "424242" } } : out;
    };
    const run = await runVerdict({ policy: dex(), subject, context }, deps);
    const liq = run.ok ? run.purchases.find((p) => p.check === "liquidity_depth")! : null;
    expect(liq).toMatchObject({ minerId: "424242", sourceGroup: "margyn.workers.dev" });
  });
});

describe("paid asks per verdict (audit L1)", () => {
  it("never passes ten, retries included", async () => {
    // dex-list@0.2.0 with a repo and every answer unreadable: seven first answers, and four checks with a second miner.
    const cat: Catalogue = structuredClone(catalogue);
    const cr = (id: string) => ({ id, slug: id, name: id, base_url: "https://codewire.margyn.workers.dev", supported_intents: ["CODE_REVIEW_GENERAL"], activation_status: "active", min_price_usdc: 10_000 });
    cat.minersByIntent.CODE_REVIEW_GENERAL = [...(cat.minersByIntent.CODE_REVIEW_GENERAL ?? []), cr("1900999004"), cr("7310045")];
    const { node, deps } = harness(Object.fromEntries(["200001", "78021", "9002", "7302", "7373", "72006", "7378", "7457", "1900999004", "7310045"].map((m) => [m, { kind: "answer" as const, result: { nothing: 1 } }])));
    const run = await runVerdict({ policy: getPolicy("dex-list@0.2.0").policy, subject, context: { ...context, repoUrl: "https://github.com/a/b" } }, { ...deps, catalogue: cat });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.purchases.filter((p) => p.billing !== "none")).toHaveLength(10);
    expect(node.charges).toHaveLength(10);
  });
});

describe("planning on the miners Skein would buy from (audit H8)", () => {
  it("counts allowlisted, live, priced miners that are not Skein itself", () => {
    const all = availability(catalogue);
    const pinned = availability(catalogue, { pinned: true });
    expect(all.CODE_REVIEW_GENERAL!.minerCount).toBeGreaterThan(0);
    expect(pinned.CODE_REVIEW_GENERAL!.minerCount).toBe(0); // no allowlisted code reviewer on 2026-10-30
    expect(pinned.LIQUIDITY_DEPTH_VERIFY_GENERAL!.minerCount).toBe(2);
    expect(availability(catalogue, { pinned: true, excludeMinerIds: ["7373"] }).LIQUIDITY_DEPTH_VERIFY_GENERAL!.minerCount).toBe(1);
    expect(availability(catalogue, { pinned: true, allowRouted: ["code_review"] }).CODE_REVIEW_GENERAL!.minerCount).toBe(all.CODE_REVIEW_GENERAL!.minerCount);
    // A floor that is not whole micro-USDC (0.01 read as dollars) is not planned on.
    const cat: Catalogue = structuredClone(catalogue);
    cat.minersByIntent.SMART_CONTRACT_AUDIT_GENERAL = cat.minersByIntent.SMART_CONTRACT_AUDIT_GENERAL!.map((m) => (m.id === "200001" ? { ...m, min_price_usdc: 0.01 } : m));
    expect(availability(cat, { pinned: true }).SMART_CONTRACT_AUDIT_GENERAL!.minerCount).toBe(0);
  });
});

describe("the OFAC snapshot (audit M2)", () => {
  it("reports its age against the staleness threshold", () => {
    const fetched = sdnSnapshot().fetched;
    expect(sdnSnapshotStatus(new Date(`${fetched}T12:00:00Z`))).toMatchObject({ ageDays: 0, stale: false, maxAgeDays: 14 });
    const later = new Date(Date.parse(`${fetched}T00:00:00Z`) + 15 * 86_400_000);
    expect(sdnSnapshotStatus(later)).toMatchObject({ ageDays: 15, stale: true });
  });
  it("the shipped snapshot is listed, so verdicts citing it keep replaying after a refresh", () => {
    expect(SHIPPED_SDN_SNAPSHOTS).toContain(sdnSnapshot().sourceSha256);
    expect(knownLists()[sdnSnapshot().list]).toContain(sdnSnapshot().sourceSha256);
  });
});
