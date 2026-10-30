"use client";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { CornerCard, VerdictBadge } from "@/components/ui";
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

  const field = "w-full rounded-sm border border-line bg-surface-2 px-2 py-1.5 text-[14px] outline-none focus:border-thread";
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-sans text-[28px] font-medium">Console</h1>
        <p className="text-muted">Paste any EVM token. Skein plans the checks, buys each one through Telegraph, and shows every thread as it lands.</p>
      </div>
      <form onSubmit={run} className="corner-card grid gap-3 p-4 sm:grid-cols-6">
        <label className="sm:col-span-1">
          <span className="mb-1 block text-[12px] text-muted">chain</span>
          <select className={field} value={form.chainId} onChange={(e) => setForm({ ...form, chainId: Number(e.target.value) })}>
            {Object.entries(CHAINS).map(([id, name]) => (
              <option key={id} value={id}>{name} ({id})</option>
            ))}
          </select>
        </label>
        <label className="sm:col-span-3">
          <span className="mb-1 block text-[12px] text-muted">token address</span>
          <input className={field} required pattern="^0x[0-9a-fA-F]{40}$" placeholder="0x…" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} />
        </label>
        <label className="sm:col-span-2">
          <span className="mb-1 block text-[12px] text-muted">policy</span>
          <select className={field} value={form.policy} onChange={(e) => setForm({ ...form, policy: e.target.value })}>
            {(policies.length ? policies.map((p) => p.ref) : ["dex-list@0.1.0"]).map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
        <label className="sm:col-span-2">
          <span className="mb-1 block text-[12px] text-muted">social handle (optional)</span>
          <input className={field} placeholder="project" value={form.social} onChange={(e) => setForm({ ...form, social: e.target.value })} />
        </label>
        <label className="sm:col-span-2">
          <span className="mb-1 block text-[12px] text-muted">repo url (optional)</span>
          <input className={field} placeholder="https://github.com/org/repo" value={form.repo} onChange={(e) => setForm({ ...form, repo: e.target.value })} />
        </label>
        <label className="sm:col-span-1">
          <span className="mb-1 block text-[12px] text-muted">budget USDC</span>
          <input className={field} inputMode="decimal" placeholder="0.20" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} />
        </label>
        <label className="sm:col-span-1">
          <span className="mb-1 block text-[12px] text-muted">partner key</span>
          <input className={field} type="password" required autoComplete="off" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} />
        </label>
        <div className="flex items-center gap-4 sm:col-span-6">
          <button type="submit" disabled={phase === "running"} className="rounded-sm border border-thread px-4 py-1.5 text-thread hover:bg-surface-2 disabled:opacity-50">
            {phase === "running" ? "Running…" : "Run verdict"}
          </button>
          {verdictId && phase === "done" ? (
            <Link href={`/v/${verdictId}`} className="text-thread hover:underline">Open verdict {verdictId} →</Link>
          ) : null}
          {graph.verdict ? <VerdictBadge verdict={graph.verdict.verdict} /> : null}
        </div>
      </form>
      {error ? <CornerCard className="text-reject">{error}</CornerCard> : null}
      {graph.nodes.length ? <GraphWithPanel state={graph} live={phase === "running"} {...(verdictId ? { verdictId } : {})} /> : null}
      {log.length ? (
        <CornerCard>
          <div className="mb-2 text-[12px] uppercase tracking-wider text-muted">live log</div>
          <ol className="max-h-72 space-y-0.5 overflow-auto text-[12px]" aria-live="polite">
            {log.map((l, i) => (
              <li key={i} className={l.tone === "gold" ? "text-knot" : l.tone === "bad" ? "text-reject" : l.tone === "muted" ? "text-muted" : ""}>
                <span className="text-muted">{l.t}</span> {l.text}
              </li>
            ))}
          </ol>
        </CornerCard>
      ) : null}
    </div>
  );
}

export default function ConsolePage() {
  return (
    <Suspense>
      <ConsoleInner />
    </Suspense>
  );
}
