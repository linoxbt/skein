// Load and concurrency test: two API replicas on one real Postgres, each with
// a fake Telegraph node (simulated answers and latency, nothing paid), and
// every runtime query running as the production role skein_app.
//
//   LOADTEST_DATABASE_URL=postgresql://postgres:…@127.0.0.1:5432/skein \
//     npx tsx scripts/loadtest.ts [--report ../../docs/LOADTEST.md]
//
// Four phases, then invariants checked against the database:
//   A. 400 paid verdicts at once, 20 partner keys, spread across both replicas
//   B. an idempotency storm: 25 keys, each sent 8 times at once to both replicas
//   C. a spend-cap race: 40 verdicts at once against a key with a 0.30 USDC cap
//   D. 600 public reads at once (status, ledger, verdicts, quote)
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { schema } from "@skein/db";
import { createApp } from "../src/app";
import { connectForRuntime } from "../src/db";
import { simulatedApi } from "../src/simulated";

const url = process.env.LOADTEST_DATABASE_URL;
if (!url) throw new Error("set LOADTEST_DATABASE_URL to an empty Postgres database (owner credentials)");
const reportPath = process.argv.includes("--report") ? process.argv[process.argv.indexOf("--report") + 1] : undefined;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const hexToken = (i: number, tag: string) => `0x${createHash("sha256").update(`${tag}:${i}`).digest("hex").slice(0, 38)}a${i % 10}`.slice(0, 42);

// Two replicas: separate pools and services, one database, both as skein_app.
const r1 = await connectForRuntime(url);
const r2 = await connectForRuntime(url);
if (r1.role !== "skein_app" || r2.role !== "skein_app") throw new Error(`replicas are not running as skein_app (${r1.role}, ${r2.role})`);
const cfg = { dailyCapUusdc: 1_000_000_000, syncTimeoutMs: 60_000 };
const A = await simulatedApi({ db: r1.db, env: {}, config: cfg });
const B = await simulatedApi({ db: r2.db, env: {}, config: cfg });
const apps = [A.app, B.app];
const owner = (await import("pg")).default;
const ownerPool = new owner.Pool({ connectionString: url, max: 4 });

// Partner keys: 20 roomy ones and one with a 0.30 USDC daily cap.
const keys = Array.from({ length: 20 }, () => `sk_load_${randomBytes(12).toString("hex")}`);
// The storm's 25 groups each get their own key: idempotency is per key, and a fresh key keeps the
// per-key rate limit (30 a minute) from refusing copies before they reach the idempotency claim.
const stormKeys = Array.from({ length: 25 }, () => `sk_load_storm_${randomBytes(12).toString("hex")}`);
const tight = `sk_load_tight_${randomBytes(12).toString("hex")}`;
await r1.db.insert(schema.consumers).values([
  ...keys.map((k, i) => ({ name: `load ${i}`, kind: "team" as const, apiKeyHash: sha(k), dailyCapUusdc: 100_000_000 })),
  ...stormKeys.map((k, i) => ({ name: `storm ${i}`, kind: "team" as const, apiKeyHash: sha(k), dailyCapUusdc: 100_000_000 })),
  { name: "load tight", kind: "team" as const, apiKeyHash: sha(tight), dailyCapUusdc: 300_000 },
]);

type Hit = { status: number; ms: number; id?: string; code?: string };
async function verdict(i: number, key: string, idem: string, token: string): Promise<Hit> {
  const t0 = performance.now();
  const res = await apps[i % 2]!.request("/v1/verdicts", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}`, "idempotency-key": idem, "x-forwarded-for": `10.0.${i % 250}.${(i * 7) % 250}` },
    body: JSON.stringify({ subject: { chainId: 8453, token } }),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; error?: { code: string } };
  return { status: res.status, ms: performance.now() - t0, ...(body.id ? { id: body.id } : {}), ...(body.error ? { code: body.error.code } : {}) };
}
async function read(i: number, path: string): Promise<Hit> {
  const t0 = performance.now();
  const res = await apps[i % 2]!.request(path, { headers: { "x-forwarded-for": `10.1.${i % 250}.${(i * 3) % 250}` } });
  await res.arrayBuffer();
  return { status: res.status, ms: performance.now() - t0 };
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!) : 0;
};
const codes = (hs: Hit[]) => Object.entries(hs.reduce<Record<string, number>>((m, h) => ((m[`${h.status}${h.code ? ` ${h.code}` : ""}`] = (m[`${h.status}${h.code ? ` ${h.code}` : ""}`] ?? 0) + 1), m), {})).map(([k, v]) => `${k}×${v}`).join(", ");
const summary = (name: string, hs: Hit[], wallMs: number) => ({
  phase: name,
  requests: hs.length,
  statuses: codes(hs),
  p50: pct(hs.map((h) => h.ms), 50),
  p95: pct(hs.map((h) => h.ms), 95),
  p99: pct(hs.map((h) => h.ms), 99),
  wallS: +(wallMs / 1000).toFixed(1),
  perS: +(hs.length / (wallMs / 1000)).toFixed(1),
});
const phase = async (name: string, jobs: (() => Promise<Hit>)[]) => {
  const t0 = performance.now();
  const hs = await Promise.all(jobs.map((j) => j()));
  return { hs, s: summary(name, hs, performance.now() - t0) };
};

console.log("phase A: 400 verdicts at once");
const pA = await phase("A. 400 paid verdicts at once (20 keys, 2 replicas)", Array.from({ length: 400 }, (_, i) => () => verdict(i, keys[i % 20]!, `a-${i}`, hexToken(i, "a"))));
console.log("phase B: idempotency storm");
const pB = await phase("B. idempotency storm: 25 keys × 8 identical requests", Array.from({ length: 200 }, (_, i) => () => verdict(i, stormKeys[i % 25]!, `b-${i % 25}`, hexToken(i % 25, "b"))));
console.log("phase C: spend-cap race");
const pC = await phase("C. spend-cap race: 40 at once on a 0.30 USDC cap", Array.from({ length: 40 }, (_, i) => () => verdict(i, tight, `c-${i}`, hexToken(i, "c"))));
const anId = pA.hs.find((h) => h.id)?.id ?? "vrd_x";
const reads = ["/v1/status", "/v1/ledger", `/v1/verdicts/${anId}`, `/v1/verdicts/${anId}/bom`, "/v1/quote?chain=8453&token=0x4200000000000000000000000000000000000006", "/v1/policies"];
console.log("phase D: 600 reads");
const pD = await phase("D. 600 public reads at once", Array.from({ length: 600 }, (_, i) => () => read(i, reads[i % reads.length]!)));

// Invariants, from the database and both fake nodes.
const q = async <T>(sql: string, p: unknown[] = []) => (await ownerPool.query(sql, p)).rows as T[];
const charges = [...A.node.charges, ...B.node.charges];
const chargedReceipts = new Set(charges.map((c) => c.receiptHash));
const purchases = await q<{ receipt_hash: string | null; amount_uusdc: string; run_id: string }>(`SELECT receipt_hash, amount_uusdc, verdict_id AS run_id FROM purchases WHERE amount_uusdc > 0`);
const unmatched = purchases.filter((p) => !p.receipt_hash || !chargedReceipts.has(p.receipt_hash)).length;
const [ledger] = await q<{ s: string }>(`SELECT coalesce(sum(amount_uusdc), 0) AS s FROM spend_ledger WHERE kind = 'purchase'`);
const purchaseSum = purchases.reduce((s, p) => s + Number(p.amount_uusdc), 0);
const bIds = new Map<number, Set<string>>();
pB.hs.forEach((h, i) => {
  if (!h.id) return;
  const set = bIds.get(i % 25) ?? new Set();
  set.add(h.id);
  bIds.set(i % 25, set);
});
const [bRuns] = await q<{ n: string }>(
  `SELECT count(*) AS n FROM verdict_runs r JOIN consumers c ON c.id = r.consumer_id WHERE c.name LIKE 'storm %'`,
);
const [tightSpend] = await q<{ s: string }>(
  `SELECT coalesce(sum(p.amount_uusdc), 0) AS s FROM purchases p JOIN verdict_runs r ON r.id = p.verdict_id JOIN consumers c ON c.id = r.consumer_id WHERE c.api_key_hash = $1`,
  [sha(tight)],
);
const all = [...pA.hs, ...pB.hs, ...pC.hs, ...pD.hs];
const invariants = {
  "no 5xx responses": all.filter((h) => h.status >= 500).length === 0,
  "every paid purchase matches a charge on the node": unmatched === 0,
  "spend ledger equals the purchases": Number(ledger!.s) === purchaseSum,
  "idempotency: one run per key under the storm": Number(bRuns!.n) === 25,
  "idempotency: all 8 copies got the same verdict": [...bIds.values()].every((s) => s.size === 1),
  "spend cap held under the race (≤ 0.30 USDC)": Number(tightSpend!.s) <= 300_000,
};
const out = {
  ranAt: new Date().toISOString(),
  database: "PostgreSQL (local), runtime role skein_app, 2 API replicas",
  phases: [pA.s, pB.s, pC.s, pD.s],
  money: { nodeCharges: charges.length, paidPurchases: purchases.length, purchaseUsdc: purchaseSum / 1e6, tightKeySpentUsdc: Number(tightSpend!.s) / 1e6 },
  invariants,
};
console.log(JSON.stringify(out, null, 2));

if (reportPath) {
  const row = (p: ReturnType<typeof summary>) => `| ${p.phase} | ${p.requests} | ${p.statuses} | ${p.p50} | ${p.p95} | ${p.p99} | ${p.wallS} | ${p.perS} |`;
  writeFileSync(
    reportPath,
    `# Load and concurrency test

Two API replicas on one PostgreSQL database, every runtime query as the
restricted role \`skein_app\`, each replica with a fake Telegraph node:
simulated miner answers with realistic latency (0.2–3.5 s per check), nothing
paid. Run with \`apps/api/scripts/loadtest.ts\` (header for usage).

Latest run: ${out.ranAt}.

| Phase | Requests | Statuses | p50 ms | p95 ms | p99 ms | Wall s | Req/s |
|---|---:|---|---:|---:|---:|---:|---:|
${out.phases.map(row).join("\n")}

**Money:** ${out.money.paidPurchases} paid purchases, ${out.money.purchaseUsdc.toFixed(2)} USDC, every one matched to a
charge on the node (${out.money.nodeCharges} charges in all). The key with a 0.30 USDC daily cap spent
${out.money.tightKeySpentUsdc.toFixed(2)} USDC across 40 simultaneous requests.

**Invariants**

${Object.entries(invariants).map(([k, v]) => `- ${v ? "✅" : "❌"} ${k}`).join("\n")}

**Reading the numbers**

- **Harness limit.** Both replicas and both fake nodes share one Node process
  and one CPU. Phase A is CPU-bound there: most of the time goes on secp256k1.
  The API signs each payment, which is real work at a few ms per check. The
  fake node verifies each signature, which is harness work.
- **What the phases show.** The latencies show how the system queues under a
  400-verdict burst, not single-verdict speed. A single verdict takes about
  2–4 s with these simulated miners.
- **Profiling fixes.** Profiling this test removed two real costs: policies
  parsed per request, and attestations re-signed per request.
- **Phase B.** Copies that arrive while the original is still running get
  202 with the run's id. Copies after it finishes get the same verdict back.
- **Phase C.** The 429s are the per-key daily cap refusing work it cannot pay
  for. Runs admitted near the cap can still finish as ABSTAIN when a purchase
  would cross it.
- **Network.** Latency is measured in-process. Production adds network time
  to the caller and to Telegraph.
`,
  );
  console.log(`report written to ${reportPath}`);
}
await Promise.all([r1.pool.end(), r2.pool.end(), ownerPool.end()]);
process.exit(Object.values(invariants).every(Boolean) ? 0 : 1);
