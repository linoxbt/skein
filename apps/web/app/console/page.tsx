"use client";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { PageHero, Section } from "@/components/site/Section";
import { VerdictBadge } from "@/components/ui";
import { GraphWithPanel } from "@/components/VerdictView";
import { API, CHAINS, createVerdict, getPolicy, listPolicies, short, SkeinError } from "@/lib/api";
import { EMPTY, liveReduce, type GraphState, type LiveEvent } from "@/lib/graph";
import type { PolicyDoc, PolicySummary } from "@/lib/types";

interface LogLine {
  t: string;
  text: string;
  tone?: "gold" | "bad" | "muted";
}

const KEY_STORE = "skein.partnerKey";
const label = (c: string) => c.replace(/_/g, " ");

function ConsoleInner() {
  const [policies, setPolicies] = useState<PolicySummary[]>([]);
  const [form, setForm] = useState({ chainId: 8453, token: "", policy: "dex-list@0.1.0", social: "", repo: "", budget: "", key: "" });
  const [graph, setGraph] = useState<GraphState>(EMPTY);
  const [log, setLog] = useState<LogLine[]>([]);
  const [verdictId, setVerdictId] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "refused" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    listPolicies().then(setPolicies).catch(() => {});
    try {
      const k = sessionStorage.getItem(KEY_STORE);
      if (k) setForm((f) => ({ ...f, key: k }));
    } catch {
      // storage unavailable: the key just isn't remembered
    }
    return () => esRef.current?.close();
  }, []);

  const push = (text: string, tone?: LogLine["tone"]) =>
    setLog((l) => [...l, { t: new Date().toISOString().slice(11, 19), text, ...(tone ? { tone } : {}) }]);

  const watch = useCallback((id: string, policy: PolicyDoc | null) => {
    esRef.current?.close();
    const es = new EventSource(`${API}/v1/verdicts/${id}/events`);
    esRef.current = es;
    const on = (type: LiveEvent["type"]) =>
      es.addEventListener(type, (m) => {
        const e = { type, payload: JSON.parse((m as MessageEvent).data) } as LiveEvent;
        setGraph((g) => liveReduce(g, e, policy));
        if (e.type === "plan") push(`plan: ${e.payload.purchases?.length ?? 0} checks to buy${e.payload.dropped?.length ? `, ${e.payload.dropped.length} not bought` : ""}`, "muted");
        if (e.type === "purchase")
          push(
            e.payload.error
              ? `${label(e.payload.check)} · ${e.payload.minerName ?? e.payload.minerId ?? "routed"} · ${e.payload.error}`
              : `${label(e.payload.check)} · ${e.payload.minerName ?? e.payload.minerId} · $${(e.payload.amountUusdc / 1e6).toFixed(2)} · receipt ${short(e.payload.receiptHash)}`,
            e.payload.error ? "bad" : "gold",
          );
        if (e.type === "finding") push(`  ${label(e.payload.check)} → ${e.payload.status}${e.payload.metric ? ` (${e.payload.metric} ${e.payload.value})` : ""}`, "muted");
        if (e.type === "decision") push(`decision: ${e.payload.decision.verdict} · risk ${e.payload.decision.riskBps} bps · hash ${short(e.payload.verdictHash)}`);
        if (e.type === "done") {
          setPhase("done");
          es.close();
        }
        if (e.type === "refused") {
          setPhase("refused");
          setError(`${e.payload.code}: ${e.payload.detail}`);
          es.close();
        }
        if (e.type === "error") {
          setPhase("error");
          setError(e.payload.message);
          es.close();
        }
      });
    (["plan", "purchase", "finding", "decision", "done", "refused", "error"] as const).forEach(on);
  }, []);

  async function run(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    setLog([]);
    setGraph(EMPTY);
    setVerdictId(null);
    try {
      sessionStorage.setItem(KEY_STORE, form.key);
    } catch {
      // ignore
    }
    setPhase("running");
    try {
      const policy = await getPolicy(form.policy).catch(() => null);
      const context: Record<string, unknown> = {};
      if (form.social) context.socialHandle = form.social;
      if (form.repo) context.repoUrl = form.repo;
      const res = await createVerdict(form.key, {
        subject: { chainId: form.chainId, token: form.token.trim() },
        policy: form.policy,
        ...(Object.keys(context).length ? { context } : {}),
        ...(form.budget ? { budgetUsdcMax: Number(form.budget) } : {}),
        mode: "async",
      });
      if ("verdict" in res) {
        // Served from cache or replayed: no live run to watch.
        push(`served from cache: ${res.verdict}`, "muted");
        setVerdictId(res.id);
        setPhase("done");
        return;
      }
      setVerdictId(res.id);
      push(`verdict ${res.id} started`, "muted");
      watch(res.id, policy);
    } catch (e) {
      setPhase("error");
      setError(e instanceof SkeinError ? `${e.body.code}: ${e.body.message}` : String(e));
    }
  }

  const EXAMPLES: [string, number, string][] = [
    ["WETH · Base", 8453, "0x4200000000000000000000000000000000000006"],
    ["USDC · Base", 8453, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"],
    ["PEPE · Ethereum", 1, "0x6982508145454Ce325dDbE47a25d4ec3d2311933"],
    ["ARB · Arbitrum", 42161, "0x912CE59144191C1204E64559FE8253a0e49E6548"],
  ];
  const label2 = "mb-2 block font-mono text-[12px] uppercase tracking-wider text-muted";
  const running = phase === "running";
  const answered = graph.nodes.filter((n) => n.status !== "PENDING" && n.status !== "UNAVAILABLE").length;

  return (
    <>
      <PageHero
        compact
        tag="Console"
        title="Run a verdict"
        sub="Paste any EVM token. Skein plans the checks, buys each one from a ranked Telegraph miner, and draws every thread as its receipt lands."
      />
      <Section tone="dark" inner="pb-24">
        <div className="grid gap-px bg-edge lg:grid-cols-[420px_1fr]">
          <form onSubmit={run} className="space-y-5 bg-panel p-6 md:p-8" aria-label="Verdict request">
            <div>
              <span className={label2}>examples</span>
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map(([name, chain, token]) => (
                  <button key={name} type="button" onClick={() => setForm((f) => ({ ...f, chainId: chain, token }))} className="bg-panel-2 px-3 py-1.5 font-mono text-[12px] text-muted hover:text-thread">
                    {name}
                  </button>
                ))}
              </div>
            </div>
            <label className="block">
              <span className={label2}>token address</span>
              <input className="field" required pattern="^0x[0-9a-fA-F]{40}$" placeholder="0x…" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} />
            </label>
            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className={label2}>chain</span>
                <select className="field" value={form.chainId} onChange={(e) => setForm({ ...form, chainId: Number(e.target.value) })}>
                  {Object.entries(CHAINS).map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={label2}>policy</span>
                <select className="field" value={form.policy} onChange={(e) => setForm({ ...form, policy: e.target.value })}>
                  {(policies.length ? policies.map((p) => p.ref) : ["dex-list@0.1.0"]).map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className={label2}>social handle</span>
                <input className="field" placeholder="optional" value={form.social} onChange={(e) => setForm({ ...form, social: e.target.value })} />
              </label>
              <label className="block">
                <span className={label2}>budget usdc</span>
                <input className="field" inputMode="decimal" placeholder="0.20" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} />
              </label>
            </div>
            <label className="block">
              <span className={label2}>repo url</span>
              <input className="field" placeholder="https://github.com/org/repo (optional)" value={form.repo} onChange={(e) => setForm({ ...form, repo: e.target.value })} />
            </label>
            <label className="block">
              <span className={label2}>partner key</span>
              <input className="field" type="password" required autoComplete="off" placeholder="sk_part_…" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} />
            </label>
            <button type="submit" disabled={running} className="btn btn-primary w-full">
              {running ? `Buying… ${answered}/${graph.nodes.filter((n) => n.status !== "UNAVAILABLE").length || "…"}` : "Run verdict"}
            </button>
            <p className="font-mono text-[11px] leading-relaxed text-muted">
              Keys are free for hackathon partners and stay in this tab only. Every verdict is stored, receipted and public by id.
            </p>
          </form>

          <div className="min-w-0 bg-bg p-4 md:p-8">
            {error ? <div className="mb-6 border border-reject/50 bg-reject/10 p-4 font-mono text-[13px] text-reject">{error}</div> : null}
            {graph.nodes.length ? (
              <GraphWithPanel state={graph} live={running} {...(verdictId ? { verdictId } : {})} />
            ) : (
              <div className="grid h-full min-h-[420px] place-items-center border border-dashed border-edge p-8 text-center">
                <div>
                  <div className="display text-[40px] text-muted md:text-[56px]">Waiting for a token.</div>
                  <p className="mt-3 font-mono text-[12px] text-muted">The Exploded View draws here, one thread per paid input.</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-px border border-edge bg-panel">
          <div className="flex items-center justify-between border-b border-edge px-5 py-3 font-mono text-[12px] text-muted">
            <span>live log</span>
            <span>{verdictId ?? "idle"}</span>
          </div>
          <ol className="max-h-80 space-y-1 overflow-auto p-5 font-mono text-[13px]" aria-live="polite">
            {log.map((l, i) => (
              <li key={i} className={l.tone === "gold" ? "text-knot" : l.tone === "bad" ? "text-reject" : l.tone === "muted" ? "text-muted" : ""}>
                <span className="text-muted">{l.t}</span> {l.text}
              </li>
            ))}
            <li className="text-thread"><span className="blink">▌</span></li>
          </ol>
        </div>

        {phase === "done" && verdictId ? (
          <div className="mt-px flex flex-col items-start justify-between gap-6 border border-edge bg-panel p-6 md:flex-row md:items-center md:p-10">
            <div className="flex flex-wrap items-center gap-4">
              {graph.verdict ? <VerdictBadge verdict={graph.verdict.verdict} size="lg" /> : null}
              <span className="display text-[32px] md:text-[44px]">Sealed and stored.</span>
            </div>
            <Link href={`/v/${verdictId}`} className="btn btn-primary">Open verdict {verdictId.slice(0, 12)}…</Link>
          </div>
        ) : null}
      </Section>
    </>
  );
}

export default function ConsolePage() {
  return (
    <Suspense>
      <ConsoleInner />
    </Suspense>
  );
}
