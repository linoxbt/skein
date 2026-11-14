"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { PageHero, Section } from "@skein/ui";
import { VerdictBadge } from "@/components/ui";
import { GraphWithPanel } from "@/components/VerdictView";
import { API, CHAINS, createVerdict, getBom, getPolicy, getQuote, getVerdict, listPolicies, short, SkeinError, usd, type Quote } from "@/lib/api";
import { checkBudget } from "@/lib/budget";
import { EMPTY, graphFromVerdict, liveReduce, type GraphState, type LiveEvent } from "@/lib/graph";
import { watchEvents } from "@/lib/stream";
import type { PolicyDoc, PolicySummary } from "@/lib/types";

interface LogLine {
  t: string;
  text: string;
  tone?: "gold" | "bad" | "muted";
}

const KEY_STORE = "skein.partnerKey";
const KEY_REQUEST = "https://github.com/linoxbt/skein/issues/new?template=partner-key.yml";
/** Shown until the API's list arrives; then the newest dex-list version replaces it. */
const DEFAULT_POLICY = "dex-list@0.2.0";

/** The newest version of a policy in the API's list, by semver. */
function newestOf(ps: readonly PolicySummary[], id: string): string | null {
  const num = (v: string) => v.split(".").map((x) => Number(x) || 0);
  const mine = ps.filter((p) => p.id === id).sort((a, b) => {
    const [x, y] = [num(a.version), num(b.version)];
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (y[i] ?? 0) - (x[i] ?? 0);
    return 0;
  });
  return mine[0]?.ref ?? null;
}
const label = (c: string) => c.replace(/_/g, " ");

function ConsoleInner() {
  const [policies, setPolicies] = useState<PolicySummary[]>([]);
  const [form, setForm] = useState({ chainId: 8453, token: "", policy: DEFAULT_POLICY, social: "", repo: "", budget: "", key: "" });
  const [graph, setGraph] = useState<GraphState>(EMPTY);
  const [log, setLog] = useState<LogLine[]>([]);
  const [verdictId, setVerdictId] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "refused" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  // The quote for the form as it stands: what a run would buy and cost, read before Run.
  const [quote, setQuote] = useState<{ key: string; q: Quote | null; error?: string } | null>(null);
  const [policyDoc, setPolicyDoc] = useState<PolicyDoc | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const params = useSearchParams();

  useEffect(() => {
    listPolicies()
      .then((ps) => {
        setPolicies(ps);
        // Start on the newest listing policy (what the API uses when none is named), unless one was already picked.
        const newest = newestOf(ps, "dex-list");
        if (newest) setForm((f) => (f.policy === DEFAULT_POLICY ? { ...f, policy: newest } : f));
      })
      .catch(() => {});
    try {
      const k = sessionStorage.getItem(KEY_STORE);
      if (k) setForm((f) => ({ ...f, key: k }));
    } catch {
      // storage unavailable: the key just isn't remembered
    }
    return () => {
      stopRef.current?.();
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  const push = (text: string, tone?: LogLine["tone"]) =>
    setLog((l) => [...l, { t: new Date().toISOString().slice(11, 19), text, ...(tone ? { tone } : {}) }]);

  /** A sealed verdict (cached, replayed, or found by polling): its whole graph at once. */
  const showSealed = useCallback(async (id: string) => {
    const v = await getVerdict(id);
    if ("status" in v) return false;
    const [bom, policy] = await Promise.all([getBom(id).catch(() => null), getPolicy(`${v.policy.id}@${v.policy.version}`).catch(() => null)]);
    setGraph(graphFromVerdict(v, bom, policy));
    setVerdictId(v.id);
    setPhase("done");
    return true;
  }, []);

  /** The stream dropped for good: poll the verdict until it is sealed (or fails). */
  const poll = useCallback(
    (id: string, tries = 0) => {
      if (pollRef.current) clearTimeout(pollRef.current);
      pollRef.current = setTimeout(async () => {
        try {
          if (await showSealed(id)) return push("sealed (read after the live stream dropped)", "muted");
          if (tries < 60) poll(id, tries + 1);
          else setPhase("error"), setError("still running after 3 minutes; open the verdict page later");
        } catch (e) {
          setPhase(e instanceof SkeinError && e.body.code === "BUDGET_TOO_LOW" ? "refused" : "error");
          setError(e instanceof SkeinError ? `${e.body.code}: ${e.body.message}` : String(e));
        }
      }, 3000);
    },
    [showSealed],
  );

  const watch = useCallback(
    (id: string, policy: PolicyDoc | null) => {
      stopRef.current?.();
      stopRef.current = watchEvents(`${API}/v1/verdicts/${encodeURIComponent(id)}/events`, {
        // Refused (429, 404, connection refused) or dropped for good: read the verdict instead.
        onLost: (why) => {
          push(`${why}; checking the verdict instead`, "muted");
          poll(id);
        },
        onEvent: (e: LiveEvent) => {
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
          if (e.type === "done") setPhase("done");
          if (e.type === "refused") {
            setPhase("refused");
            setError(`${e.payload.code}: ${e.payload.detail}`);
          }
          if (e.type === "error") {
            setPhase("error");
            setError(e.payload.message);
          }
        },
      });
    },
    [poll],
  );

  // The quote: re-read (debounced) whenever the token, chain or policy changes.
  const token = form.token.trim();
  const quoteKey = /^0x[0-9a-fA-F]{40}$/.test(token) ? `${form.chainId}:${token.toLowerCase()}:${form.policy}` : null;
  useEffect(() => {
    if (!quoteKey) return;
    let stale = false;
    const t = setTimeout(() => {
      getQuote({ chainId: form.chainId, token, policy: form.policy })
        .then((q) => !stale && setQuote({ key: quoteKey, q }))
        .catch((e) => !stale && setQuote({ key: quoteKey, q: null, error: e instanceof SkeinError ? `${e.body.code}: ${e.body.message}` : "the quote did not load" }));
    }, 500);
    return () => {
      stale = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey]);
  useEffect(() => {
    let stale = false;
    getPolicy(form.policy)
      .then((d) => !stale && setPolicyDoc(d))
      .catch(() => !stale && setPolicyDoc(null));
    return () => {
      stale = true;
    };
  }, [form.policy]);
  const currentQuote = quote && quote.key === quoteKey ? quote : null;
  const budget = checkBudget(form.budget, currentQuote?.q ?? null, policyDoc?.policy.required ?? []);

  // /console?id=vrd_…: attach to a verdict that is already running (or show it sealed).
  useEffect(() => {
    const id = params.get("id");
    if (!id || !/^vrd_[a-z0-9]+$/.test(id)) return;
    setVerdictId(id);
    setPhase("running");
    push(`following ${id}`, "muted");
    void (async () => {
      try {
        const v = await getVerdict(id);
        if (!("status" in v)) {
          await showSealed(id);
          return;
        }
        watch(id, null);
      } catch (e) {
        setPhase("error");
        setError(e instanceof SkeinError ? `${e.body.code}: ${e.body.message}` : String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(ev: React.FormEvent) {
    ev.preventDefault();
    // A browser cannot pay: without a key, say how to buy instead of sending a request that can only come back 402.
    if (!form.key.trim()) {
      setError("A paid verdict needs a partner key here. Request one (free during the hackathon), or pay per verdict from your own code: see the note under the key field. Nothing was bought.");
      setPhase("refused");
      return;
    }
    // Refused here, before any request: a malformed budget, or one below what the required checks are quoted at.
    if (!budget.ok) {
      setError(budget.error);
      setPhase("refused");
      return;
    }
    if (currentQuote?.q && !currentQuote.q.ok && currentQuote.q.refusal) {
      setError(`${currentQuote.q.refusal.code}: ${currentQuote.q.refusal.detail} (from the quote; nothing was bought)`);
      setPhase("refused");
      return;
    }
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
      const policy = policyDoc?.ref === form.policy ? policyDoc : await getPolicy(form.policy).catch(() => null);
      const context: Record<string, unknown> = {};
      if (form.social) context.socialHandle = form.social;
      if (form.repo) context.repoUrl = form.repo;
      const res = await createVerdict(form.key, {
        subject: { chainId: form.chainId, token: form.token.trim() },
        policy: form.policy,
        ...(Object.keys(context).length ? { context } : {}),
        ...(budget.value !== undefined ? { budgetUsdcMax: budget.value } : {}),
        mode: "async",
      });
      if ("verdict" in res) {
        // Served from cache or replayed: no live run to watch, so show the sealed verdict whole.
        push(`served from cache: ${res.verdict}`, "muted");
        await showSealed(res.id);
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
                  {(policies.length ? policies.map((p) => p.ref) : [DEFAULT_POLICY]).map((r) => (
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
                <input
                  className="field"
                  inputMode="decimal"
                  placeholder="0.20"
                  value={form.budget}
                  aria-invalid={!budget.ok}
                  aria-describedby="budget-note"
                  onChange={(e) => setForm({ ...form, budget: e.target.value })}
                />
              </label>
            </div>
            <label className="block">
              <span className={label2}>repo url</span>
              <input className="field" placeholder="https://github.com/org/repo (optional)" value={form.repo} onChange={(e) => setForm({ ...form, repo: e.target.value })} />
            </label>
            <label className="block">
              <span className={label2}>partner key</span>
              <input className="field" type="password" autoComplete="off" placeholder="sk_part_…" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} />
            </label>
            {!form.key ? (
              <p className="font-mono text-[12px] leading-relaxed text-muted">
                No key? The quote is free, as is every verdict page. To buy one:{" "}
                <a className="text-thread underline underline-offset-4" href={KEY_REQUEST}>request a partner key</a> (free during the hackathon), or pay 0.25 USDC a verdict
                with no account, through Telegraph or x402, from your own code (<Link className="text-thread underline underline-offset-4" href="/tutorial#telegraph">how</Link>).
              </p>
            ) : null}
            <QuoteBox quote={currentQuote} pending={!!quoteKey && !currentQuote} required={policyDoc?.policy.required ?? []} />
            <p id="budget-note" className={`font-mono text-[12px] ${!budget.ok ? "text-reject" : budget.warning ? "text-knot" : "text-muted"}`} aria-live="polite">
              {!budget.ok ? budget.error : (budget.warning ?? "Budget caps upstream spend. Leave it empty for the policy's own cap.")}
            </p>
            <button type="submit" disabled={running || !budget.ok} className="btn btn-primary w-full">
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
          <ol tabIndex={0} aria-label="Live log" className="max-h-80 space-y-1 overflow-auto p-5 font-mono text-[13px]" aria-live="polite">
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

/** The quote for the token in the form: cost, and which checks can be bought right now. */
function QuoteBox({ quote, pending, required }: { quote: { q: Quote | null; error?: string } | null; pending: boolean; required: readonly string[] }) {
  const head = "mb-2 block font-mono text-[12px] uppercase tracking-wider text-muted";
  if (!quote && !pending) return null;
  return (
    <div className="border border-line bg-bg p-4 font-mono text-[12px]" aria-live="polite" data-testid="quote">
      <span className={head}>quote</span>
      {!quote ? (
        <p className="text-muted">Pricing every check from live floors…</p>
      ) : !quote.q ? (
        <p className="text-reject">{quote.error}</p>
      ) : (
        <>
          {quote.q.ok ? (
            <p>
              Estimated upstream <span className="text-knot">{usd(quote.q.upstreamUsdc ?? 0)}</span>
              <span className="text-muted"> · verdict price {usd(quote.q.priceUsdc)}</span>
            </p>
          ) : (
            <p className="text-reject">Would be refused: {quote.q.refusal?.code} · {quote.q.refusal?.detail}</p>
          )}
          <ul className="mt-3 space-y-1">
            {(quote.q.checks ?? []).map((c) => (
              <li key={c.check} className="flex justify-between gap-3">
                <span>
                  <span className="text-thread">●</span> {label(c.check)}
                  <span className="text-muted">{required.includes(c.check) ? " · required" : " · optional"}</span>
                </span>
                <span className="text-knot">{usd(c.quoteUsdc)}</span>
              </li>
            ))}
            {(quote.q.dropped ?? []).map((d) => (
              <li key={d.check} className="flex justify-between gap-3 text-muted">
                <span>
                  <span className="text-reject">○</span> {label(d.check)}
                  {required.includes(d.check) ? " · required" : ""}
                </span>
                <span>not available: {d.reason.toLowerCase().replace(/_/g, " ")}</span>
              </li>
            ))}
          </ul>
        </>
      )}
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
