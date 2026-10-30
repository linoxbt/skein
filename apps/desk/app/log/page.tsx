"use client";
import Link from "next/link";
import { Lead, PageHero, Section } from "@/components/Section";
import { Stripes } from "@/components/Stripes";
import { short, useApplications, usd, VCOLOR_LIGHT } from "@/lib/client";
import { CHAINS } from "@/lib/types";

export default function Log() {
  const { state } = useApplications(5000);
  const rows = (state?.applications ?? []).filter((a) => a.decision).sort((a, b) => b.decision!.at.localeCompare(a.decision!.at));
  const paid = rows.reduce((s, a) => s + a.decision!.paidUsdc, 0);
  const upstream = rows.reduce((s, a) => s + a.decision!.upstreamUsdc, 0);
  return (
    <>
      <PageHero
        compact
        tag="Decision log"
        title={<>Every decision,<br />with its receipt.</>}
        sub="What the agent did, why, what it paid and what evidence stood behind it. Append-only: a decision is never rewritten."
        background={<Stripes seed={33} className="opacity-30" />}
      />
      <Section tone="dark" inner="pb-16 pt-6">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-4">
          {(
            [
              ["decisions", String(rows.length)],
              ["desk paid", usd(paid)],
              ["evidence behind them", usd(upstream)],
              ["cost per decision", rows.length ? usd(paid / rows.length) : "—"],
            ] as [string, string][]
          ).map(([k, v], i) => (
            <div key={k} className="min-w-0 border-t border-edge pt-4">
              <div className="font-mono text-[12px] uppercase tracking-wider text-muted">{k}</div>
              <div className="display mt-3 truncate text-[44px] md:text-[64px]" style={i === 3 ? { color: "var(--color-knot)" } : undefined}>{v}</div>
            </div>
          ))}
        </div>
      </Section>
      <Section tone="paper" inner="py-16 md:py-24">
        <Lead tag="Log" />
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead className="font-mono text-[12px] uppercase tracking-wider text-ink-2">
                <tr className="border-b border-rule">
                  <th className="py-3 font-normal">when</th>
                  <th className="font-normal">application</th>
                  <th className="font-normal">verdict</th>
                  <th className="font-normal">action</th>
                  <th className="font-normal">paid</th>
                  <th className="font-normal">evidence</th>
                  <th className="font-normal">receipts</th>
                  <th className="font-normal">time</th>
                  <th className="font-normal">verdict hash</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const d = a.decision!;
                  return (
                    <tr key={a.id} className="border-b border-rule align-top">
                      <td className="py-4 pr-4 font-mono text-[12px] text-ink-2">{new Date(d.at).toLocaleString()}</td>
                      <td className="pr-4 py-4">
                        <Link href={`/a/${a.id}`} className="underline-offset-4 hover:underline">{a.project}</Link>
                        <div className="font-mono text-[12px] text-ink-2">{CHAINS[a.subject.chainId]} · {short(a.subject.token)}</div>
                      </td>
                      <td className="py-4 pr-4 font-mono text-[12px] uppercase tracking-wider" style={{ color: d.verdict ? VCOLOR_LIGHT[d.verdict] : undefined }}>{d.verdict ?? d.refusal?.code}</td>
                      <td className="py-4 pr-4">{d.action}</td>
                      <td className="py-4 pr-4 font-mono text-[13px]">{usd(d.paidUsdc)}</td>
                      <td className="py-4 pr-4 font-mono text-[13px]">{usd(d.upstreamUsdc)}</td>
                      <td className="py-4 pr-4 font-mono text-[13px]">{d.receipts}</td>
                      <td className="py-4 pr-4 font-mono text-[13px]">{d.seconds}s</td>
                      <td className="py-4 font-mono text-[12px] text-ink-2">{d.verdictHash ? short(d.verdictHash) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="frame-dots p-10 text-center md:p-16">
            <p className="statement text-[30px] md:text-[44px]">{state ? "No decisions yet." : "Loading…"}</p>
            <Link href="/apply" className="btn btn-ink mt-8">File the first application</Link>
          </div>
        )}
      </Section>
    </>
  );
}
