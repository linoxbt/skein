"use client";
import { useEffect, useState } from "react";
import { Lead, PageHero, Section } from "@/components/site/Section";
import { Stripes } from "@/components/site/Stripes";
import { getPolicy, listPolicies } from "@/lib/api";
import type { PolicyDoc, PolicySummary } from "@/lib/types";

const label = (c: string) => c.replace(/_/g, " ");
const fmt = (n: number) => (Math.abs(n) >= 1000 ? n.toLocaleString("en-US") : String(n));

export default function PoliciesPage() {
  const [list, setList] = useState<PolicySummary[]>([]);
  const [docs, setDocs] = useState<Record<string, PolicyDoc>>({});
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    listPolicies()
      .then(async (l) => {
        setList(l);
        const all = await Promise.all(l.map((p) => getPolicy(p.ref)));
        setDocs(Object.fromEntries(all.map((d) => [d.ref, d])));
        setOpen((o) => o ?? l.find((p) => p.id === "dex-list")?.ref ?? l[0]?.ref ?? null);
      })
      .catch(() => {});
  }, []);
  const doc = open ? docs[open] : undefined;
  const maxW = doc ? Math.max(...Object.values(doc.policy.weights), 0.01) : 1;

  return (
    <>
      <PageHero
        compact
        tag="Policies"
        title={<>The rules,<br />in the open.</>}
        sub="A policy says which checks are required, what blocks a listing, where the thresholds sit and how much a verdict may spend. Published versions never change: an edit is a new version, locked by its SHA-256."
        background={<Stripes seed={5} className="opacity-40" />}
      />

      <Section tone="dark" inner="pb-20">
        <div className="grid gap-px bg-edge md:grid-cols-3">
          {list.map((p) => {
            const d = docs[p.ref];
            const active = open === p.ref;
            return (
              <button key={p.ref} type="button" onClick={() => setOpen(p.ref)} aria-pressed={active} className={`flex flex-col items-start p-6 text-left transition-colors md:p-8 ${active ? "bg-panel-2" : "bg-panel hover:bg-panel-2"}`}>
                <span className={`font-mono text-[12px] ${active ? "text-thread" : "text-muted"}`}>v{p.version}</span>
                <span className="display mt-3 text-[40px] md:text-[48px]">{p.id}</span>
                <span className="mt-3 line-clamp-3 text-[14px] text-muted">{p.description}</span>
                {d ? (
                  <span className="mt-6 grid w-full grid-cols-3 gap-2 border-t border-edge pt-4 font-mono text-[12px]">
                    <span><span className="block text-muted">required</span>{d.policy.required.length}</span>
                    <span><span className="block text-muted">approve</span>&lt;{d.policy.decision?.approve_below_risk_bps}</span>
                    <span><span className="block text-muted">reject</span>≥{d.policy.decision?.reject_above_risk_bps}</span>
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </Section>

      {doc ? (
        <>
          <Section tone="paper" inner="py-20 md:py-28">
            <Lead tag={doc.ref} />
            <h2 className="display mt-4 text-[48px] md:text-[96px]">{doc.policy.id}</h2>
            <div className="mt-14 grid gap-16 lg:grid-cols-2">
              <div>
                <h3 className="font-mono text-[13px] uppercase tracking-wider text-ink-2">Blockers: any one is REJECT</h3>
                <ul className="mt-4">
                  {(doc.policy.blockers ?? []).map((b, i) => (
                    <li key={i} className="flex items-center justify-between border-b border-rule py-4">
                      <span className="statement text-[24px]">{label(b.check)}</span>
                      <span className="font-mono text-[13px] text-reject">{b.status}{b.minSeverity !== undefined ? ` · sev ≥ ${b.minSeverity}` : ""}</span>
                    </li>
                  ))}
                </ul>
                <h3 className="mt-12 font-mono text-[13px] uppercase tracking-wider text-ink-2">Thresholds</h3>
                <table className="mt-4 w-full font-mono text-[13px]">
                  <thead className="text-left text-ink-2"><tr><th className="py-2 font-normal">check</th><th className="font-normal">field</th><th className="font-normal">warn</th><th className="font-normal">fail</th></tr></thead>
                  <tbody>
                    {Object.entries(doc.policy.thresholds ?? {}).map(([c, t]) => (
                      <tr key={c} className="border-t border-rule">
                        <td className="py-3 uppercase">{label(c)}</td>
                        <td className="text-ink-2">{t.field}</td>
                        <td>{t.fail > t.warn ? ">" : "<"} {fmt(t.warn)}</td>
                        <td className="text-reject">{t.fail > t.warn ? ">" : "<"} {fmt(t.fail)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <h3 className="font-mono text-[13px] uppercase tracking-wider text-ink-2">Weights</h3>
                <ul className="mt-4 space-y-4">
                  {[...doc.policy.required, ...doc.policy.optional].map((c) => {
                    const w = doc.policy.weights[c] ?? 0;
                    const req = doc.policy.required.includes(c);
                    return (
                      <li key={c}>
                        <div className="flex justify-between font-mono text-[13px]">
                          <span className="uppercase">{label(c)} <span className="text-ink-2">· {req ? "required" : "optional"}</span></span>
                          <span>{w.toFixed(2)}</span>
                        </div>
                        <div className="mt-2 h-2 bg-mist">
                          <div className="h-2" style={{ width: `${(w / maxW) * 100}%`, background: req ? "var(--color-thread-deep)" : "var(--color-ink-2)" }} />
                        </div>
                        {w === 0 ? <p className="mt-1 font-mono text-[11px] text-ink-2">blocker only: its absence is an ABSTAIN</p> : null}
                      </li>
                    );
                  })}
                </ul>
                <h3 className="mt-12 font-mono text-[13px] uppercase tracking-wider text-ink-2">Contradictions: ESCALATE</h3>
                <ul className="mt-4 space-y-2">
                  {doc.policy.conflicts.map((c) => (
                    <li key={c.code} className="bg-mist p-4">
                      <div className="font-mono text-[13px] text-knot-deep">{c.code}</div>
                      <div className="mt-1 text-[15px]">{c.detail}</div>
                    </li>
                  ))}
                </ul>
                <dl className="mt-12 grid grid-cols-2 gap-6 font-mono text-[13px]">
                  <div><dt className="text-ink-2">min coverage</dt><dd className="display mt-1 text-[40px]">{Math.round((doc.policy.decision?.min_coverage ?? 0) * 100)}%</dd></div>
                  <div><dt className="text-ink-2">min confidence</dt><dd className="display mt-1 text-[40px]">{Math.round((doc.policy.decision?.min_confidence ?? 0) * 100)}%</dd></div>
                  <div><dt className="text-ink-2">budget per verdict</dt><dd className="display mt-1 text-[40px] text-knot-deep">${doc.policy.budget?.max_usdc.toFixed(2)}</dd></div>
                </dl>
              </div>
            </div>
          </Section>
          <Section tone="dark" inner="py-16">
            <div className="flex flex-wrap items-center justify-between gap-4 font-mono text-[12px] text-muted">
              <span>{doc.ref}.yaml</span>
              <span className="break-all">sha256 {doc.sha256}</span>
            </div>
            <pre className="mt-4 max-h-[560px] overflow-auto border border-edge bg-panel p-6 font-mono text-[13px] leading-relaxed text-[#c9d1d6]">{doc.yaml}</pre>
          </Section>
        </>
      ) : null}
    </>
  );
}
