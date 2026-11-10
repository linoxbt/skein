# Load and concurrency test

Two API replicas on one PostgreSQL database, every runtime query as the
restricted role `skein_app`, each replica with a fake Telegraph node:
simulated miner answers with realistic latency (0.2–3.5 s per check), nothing
paid. Run with `apps/api/scripts/loadtest.ts` (header for usage).

Latest run: 2026-11-10T15:47:22.290Z.

| Phase | Requests | Statuses | p50 ms | p95 ms | p99 ms | Wall s | Req/s |
|---|---:|---|---:|---:|---:|---:|---:|
| A. 400 paid verdicts at once (20 keys, 2 replicas) | 400 | 200×400 | 14265 | 14522 | 14813 | 15.9 | 25.2 |
| B. idempotency storm: 25 keys × 8 identical requests | 200 | 200×25, 202×175 | 200 | 3202 | 3930 | 4.3 | 47 |
| C. spend-cap race: 40 at once on a 0.30 USDC cap | 40 | 200×30, 429 RATE_LIMITED×10 | 399 | 3397 | 3569 | 3.6 | 11.2 |
| D. 600 public reads at once | 600 | 200×600 | 347 | 441 | 443 | 0.5 | 1327.5 |

**Money:** 1509 paid purchases, 15.09 USDC, every one matched to a
charge on the node (1509 charges in all). The key with a 0.30 USDC daily cap spent
0.16 USDC across 40 simultaneous requests.

**Invariants**

- ✅ no 5xx responses
- ✅ every paid purchase matches a charge on the node
- ✅ spend ledger equals the purchases
- ✅ idempotency: one run per key under the storm
- ✅ idempotency: all 8 copies got the same verdict
- ✅ spend cap held under the race (≤ 0.30 USDC)

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
