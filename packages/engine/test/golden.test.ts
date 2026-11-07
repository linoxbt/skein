import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALL_ADAPTER_VERSIONS, canonicalJson } from "../src";

/**
 * Golden replay: every registered adapter version's output on a fixed set of
 * answers, recorded once. The helpers adapters share (pick, pickBool, the
 * word lists) are not versioned, so this is what stops an edit to them from
 * silently changing what a published version does. A new version adds lines;
 * an existing line must never change. Regenerate only for new versions:
 * GOLDEN_WRITE=1 (and review the diff: existing keys must be untouched).
 */
const TOKEN = "0x1111111111111111111111111111111111111111";
const POOL = "0x2222222222222222222222222222222222222222";
const ctx = { sourceGroup: "g", minerId: "1", receiptHash: `0x${"ab".repeat(32)}`, httpStatus: 200, subject: { chainId: 1, token: TOKEN }, pool: POOL };

const ANSWERS: Record<string, unknown> = {
  empty: {},
  garbage: "<html>",
  verdict_organic: { verdict: "organic", wash_volume_pct: 4 },
  verdict_wash: { result: { verdict: "wash_trading", wash_volume_pct: 71, confidence: 0.9 } },
  verdict_bot: { verdict: "bot" },
  verdict_comment: { verdict: "Comment" },
  matched_true: { matched: "yes" },
  matched_false: { matched: false, confidence: 0.95 },
  on_list_true: { on_list: true },
  liquidity: { liquidity_usd: 1_250_000 },
  gecko_other_pool: { data: { id: "eth_0x3333333333333333333333333333333333333333", attributes: { reserve_in_usd: "999" } } },
  holders: { holders_count: "48211" },
  top10: { top10_holders_pct: 0.42 },
  audit_clean: { result: { [TOKEN]: { is_honeypot: "0", is_open_source: "1", buy_tax: "0", sell_tax: "0" } } },
  audit_honeypot: { is_honeypot: "1", buy_tax: "0", sell_tax: "0.3" },
  audit_one_flag: { is_proxy: "0" },
  audit_no_tax: {
    code: 1,
    result: {
      [TOKEN]: {
        is_honeypot: "0", is_open_source: "1", is_mintable: "0", hidden_owner: "0", can_take_back_ownership: "0",
        owner_change_balance: "0", selfdestruct: "0", transfer_pausable: "0", is_proxy: "0", is_blacklisted: "0", transfer_tax: "",
      },
    },
  },
  audit_unverified: { code: 1, result: { [TOKEN]: { is_open_source: "0", buy_tax: "", sell_tax: "", holder_count: "202" } } },
  wash_quiet: { transfers: 0, window_blocks: 600, confidence: 0.5 },
  wash_native: { risk_label: "HIGH", risk_score: 0.644, round_trip_volume_share_percent: 76.79 },
  audit_other_token: { result: { "0x9999999999999999999999999999999999999999": { is_honeypot: "0", sell_tax: "0" } } },
};

const FILE = new URL("./fixtures/golden-adapters.json", import.meta.url);

function compute(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of ALL_ADAPTER_VERSIONS) {
    for (const [name, raw] of Object.entries(ANSWERS)) out[`${a.check}@${a.version} ${name}`] = canonicalJson(a.adapt(raw, ctx));
  }
  return Object.fromEntries(Object.entries(out).sort(([x], [y]) => x.localeCompare(y)));
}

describe("adapter golden replay", () => {
  it("every published adapter version still gives exactly its recorded output", () => {
    const now = compute();
    if (process.env.GOLDEN_WRITE === "1") {
      const prior = (() => {
        try {
          return JSON.parse(readFileSync(FILE, "utf8")) as Record<string, string>;
        } catch {
          return {};
        }
      })();
      for (const [k, v] of Object.entries(prior)) if (now[k] !== v) throw new Error(`refusing to rewrite recorded output ${k}`);
      writeFileSync(FILE, `${JSON.stringify(now, null, 1)}\n`);
    }
    const recorded = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, string>;
    for (const [k, v] of Object.entries(recorded)) expect(now[k], k).toBe(v);
    expect(Object.keys(now).filter((k) => !(k in recorded)), "new versions need GOLDEN_WRITE=1").toEqual([]);
  });
});
