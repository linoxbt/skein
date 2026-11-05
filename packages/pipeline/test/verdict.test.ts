import { readFileSync } from "node:fs";
import { reproduce } from "@skein/engine";
import { getPolicy } from "@skein/policies";
import { TelegraphClient, TESTNET, viemSigner } from "@skein/telegraph";
import { FakeNode, type Behaviour } from "@skein/telegraph/testing";
import { describe, expect, it } from "vitest";
import { catalogueFromSnapshot, runVerdict, type PipelineEvent, type PoolResolver, type VerdictDeps } from "../src";

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
      ["holder_count", "7302", true],
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
      "holder_count", "liquidity_depth", "social_bots", "wash_trading",
    ]);
    expect(reproduce(run.stored, dex())).toMatchObject({ ok: true });
    expect(events[0]!.type).toBe("plan");
    expect(events.at(-1)!.type).toBe("decision");
    expect(events.filter((e) => e.type === "purchase")).toHaveLength(6);
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

  it("no pool found: liquidity is not bought, and the verdict abstains", async () => {
    const { node, deps } = harness();
    const run = await runVerdict({ policy: dex(), subject, context }, { ...deps, resolver: { resolve: async () => null } });
    expect(run.ok && run.verdict.decision.openRisks).toContain("liquidity_depth UNAVAILABLE");
    expect(node.charges.map((c) => c.minerId)).not.toContain("7373");
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
      if (opts.minerId === "7302") throw new Error("signer exploded");
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
      return opts.minerId === "7302" && out.ok ? { ...out, receiptProblems: ["receipt payer 0xbb, expected 0xaa"] } : out;
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
