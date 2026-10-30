import { readFileSync } from "node:fs";
import { reproduce } from "@skein/engine";
import { getPolicy } from "@skein/policies";
import { TelegraphClient, TESTNET, viemSigner } from "@skein/telegraph";
import { FakeNode, type Behaviour } from "@skein/telegraph/testing";
import { describe, expect, it } from "vitest";
import { catalogueFromSnapshot, runVerdict, type PipelineEvent, type PoolResolver } from "../src";

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
  const deps = { client, catalogue, priceUusdc: 250_000, resolver: pool, onEvent: (e: PipelineEvent) => events.push(e), now: () => new Date(SEASON) };
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

  it("the refusal: sanctions times out -> ABSTAIN naming it, billed only for what answered", async () => {
    const { node, deps } = harness({ "78021": { kind: "hang" } });
    const policy = dex();
    policy.budget.per_check_timeout_ms.sanctions = 40;
    const run = await runVerdict({ policy, subject, context }, deps);
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.verdict.decision.verdict).toBe("ABSTAIN");
    expect(run.verdict.decision.reasons[0]).toMatchObject({ code: "MISSING_REQUIRED_CHECK", check: "sanctions" });
    const s = run.purchases.find((p) => p.check === "sanctions")!;
    expect(s).toMatchObject({ amountUusdc: 0, attempts: 2 });
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
        ? { ok: false, kind: "incompatible", error: "no_compatible_miner", httpStatus: 503, durationMs: 1, attempts: 1 }
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
