"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { IconArrow } from "@skein/ui";
import { Lead, PageHero, Section } from "@skein/ui";
import { Stripes } from "@skein/ui";
import { StatTile, VERDICT_COLOR, VERDICT_COLOR_LIGHT } from "@/components/ui";
import { getLedger, getStatus, type Ledger, type Status } from "@/lib/api";
import type { Verdict } from "@/lib/types";

const ORDER: Verdict[] = ["APPROVE", "ESCALATE", "ABSTAIN", "REJECT"];
const MEANING: Record<Verdict, string> = {
  APPROVE: "fit to list",
  ESCALATE: "a human should look",
  ABSTAIN: "not enough evidence",
  REJECT: "do not list",
};

export default function LedgerPage() {
  const [l, setL] = useState<Ledger | null>(null);
  const [s, setS] = useState<Status | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    getLedger().then(setL).catch(() => setErr(true));
    getStatus().then(setS).catch(() => {});
  }, []);
  const total = l ? Object.values(l.verdicts).reduce((a, b) => a + b, 0) : 0;
  const dash = (v: unknown) => (l ? String(v) : "—");

  return (
    <>
      <PageHero
        compact
        tag="Ledger"
        title={<>Every verdict.<br />Every cent.</>}
        sub="What Skein has served and what it paid upstream for it, counted from the append-only store. Nothing here is edited after the fact."
        background={<Stripes seed={8} className="opacity-35" />}
        aside={
          <div className="border border-edge bg-panel/90 p-6 font-mono text-[13px]">
            <div className="text-muted">network</div>
            <div className="mt-1 text-[16px]">{l?.network ?? (err ? "unreachable" : "…")}</div>
            <div className="rule-dots-dark my-5" />
            <div className="text-muted">purchaser wallet</div>
            <div className="mt-1 break-all text-[15px]">{s?.payer ?? "not configured"}</div>
            <div className="rule-dots-dark my-5" />
            <div className="text-muted">spent today</div>
            <div className="mt-1 text-[16px]">
              <span className="text-knot">${s ? s.spentTodayUsdc.toFixed(2) : "—"}</span>
              <span className="text-muted"> of ${s ? s.dailyCapUsdc.toFixed(2) : "—"} cap</span>
            </div>
          </div>
        }
      />

      <Section tone="dark" inner="pb-24 pt-6">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-4">
          <StatTile label="verdicts served" value={dash(total)} />
          <StatTile label="upstream spend" gold value={l ? `$${l.upstreamSpendUsdc.toFixed(2)}` : "—"} />
          <StatTile label="receipts" value={dash(l?.receipts)} />
          <StatTile label="miners paid" value={dash(l?.minersUsed)} />
        </div>
        {err ? <p className="mt-10 font-mono text-[13px] text-reject">The Skein API is unreachable; these numbers will fill in when it answers.</p> : null}
      </Section>

      {/* The mix: one bar, four colours. */}
      <Section tone="paper" inner="py-20 md:py-28">
        <Lead tag="Verdict mix" />
        <h2 className="statement mt-2 max-w-4xl text-[36px] md:text-[60px]">
          {total ? <>{total} verdict{total === 1 ? "" : "s"}, decided by the same eight rules.</> : <>No verdicts yet. The mix fills in as they land.</>}
        </h2>
        <div className="mt-12 flex h-16 w-full bg-mist" role="img" aria-label="Share of each verdict">
          {total
            ? ORDER.map((v) => {
                const n = l?.verdicts[v] ?? 0;
                return n ? <div key={v} style={{ width: `${(n / total) * 100}%`, background: VERDICT_COLOR[v] }} title={`${v}: ${n}`} /> : null;
              })
            : null}
        </div>
        <ul className="mt-10 grid gap-px bg-rule sm:grid-cols-2 lg:grid-cols-4">
          {ORDER.map((v) => {
            const n = l?.verdicts[v] ?? 0;
            return (
              <li key={v} className="bg-paper p-6">
                <div className="flex items-center gap-3 font-mono text-[13px] uppercase tracking-wider" style={{ color: VERDICT_COLOR_LIGHT[v] }}>
                  <span className="h-3 w-3" style={{ background: VERDICT_COLOR[v] }} aria-hidden />
                  {v}
                </div>
                <div className="display mt-5 text-[56px]">{l ? n : "—"}</div>
                <div className="mt-1 text-ink-2">
                  {MEANING[v]}
                  {total ? <span className="font-mono text-[13px]"> · {Math.round((n / total) * 100)}%</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
        {l?.last72h ? <RecentMix label="Last 72 hours" mix={l.last72h} /> : null}
        {l?.last24h ? <RecentMix label="Last 24 hours" mix={l.last24h} /> : null}
        {l?.abstain?.causes.length ? (
          <div className="mt-14">
            <Lead tag="Why verdicts abstained" />
            <p className="mt-2 max-w-3xl text-ink-2">
              An ABSTAIN names the required check that had no real answer, and is charged at upstream cost only. Most of the total comes from
              the first days on the network, before the fixes recorded in docs/DECISIONS.md (L24, Nov 7); the windows above show the rate now.
            </p>
            <table className="mt-6 w-full max-w-4xl font-mono text-[13px]">
              <thead>
                <tr className="text-left text-ink-2">
                  <th className="py-2 pr-4 font-normal">check</th>
                  <th className="py-2 pr-4 font-normal">status</th>
                  <th className="py-2 pr-4 font-normal">why</th>
                  <th className="py-2 pr-4 text-right font-normal">all time</th>
                  <th className="py-2 text-right font-normal">last 7 days</th>
                </tr>
              </thead>
              <tbody>
                {l.abstain.causes.slice(0, 8).map((c) => (
                  <tr key={`${c.check}-${c.status}-${c.note}`} className="border-t border-rule">
                    <td className="py-2 pr-4">{c.check || "coverage"}</td>
                    <td className="py-2 pr-4">{c.status || "—"}</td>
                    <td className="py-2 pr-4 text-ink-2">{c.note.replace(/_/g, " ") || "—"}</td>
                    <td className="py-2 pr-4 text-right">{c.n}</td>
                    <td className="py-2 text-right">{c.last7d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Section>

      {/* Recent verdicts. */}
      <Section tone="mist" inner="py-20 md:py-28">
        <Lead tag="Recent" />
        {l?.recent.length ? (
          <ol className="mt-4">
            {l.recent.map((r, i) => (
              <li key={r.id}>
                <Link href={`/v/${r.id}`} className="group grid grid-cols-[auto_1fr_auto] items-center gap-4 py-5 md:grid-cols-[160px_1fr_220px_auto] md:gap-8">
                  <span className="font-mono text-[13px] uppercase tracking-wider" style={{ color: VERDICT_COLOR_LIGHT[r.verdict as Verdict] }}>
                    {r.verdict}
                  </span>
                  <span className="min-w-0 truncate font-mono text-[14px] md:text-[16px]">{r.id}</span>
                  <span className="hidden font-mono text-[13px] text-ink-2 md:block">{new Date(r.createdAt).toLocaleString()}</span>
                  <span className="grid h-10 w-10 place-items-center bg-ink text-white transition-transform group-hover:translate-x-1">
                    <IconArrow size={18} />
                  </span>
                </Link>
                {i < l.recent.length - 1 ? <div className="rule-dots" /> : null}
              </li>
            ))}
          </ol>
        ) : (
          <div className="frame-dots mt-4 p-10 text-center md:p-16">
            <p className="statement text-[30px] md:text-[44px]">Nothing served yet.</p>
            <p className="mt-3 text-ink-2">Run one in the console and it appears here with its receipts.</p>
            <Link href="/console" className="btn btn-ink mt-8">Run a verdict</Link>
          </div>
        )}
      </Section>

      {/* Registration. */}
      <section className="relative overflow-hidden bg-bg">
        <Stripes seed={31} className="opacity-25" />
        <div className="relative mx-auto grid max-w-[1400px] gap-10 px-5 py-24 md:grid-cols-[1fr_auto] md:items-end md:px-10 md:py-32">
          <div>
            <span className="tag tag-dark">Miner registration</span>
            <h2 className="display mt-6 text-[44px] md:text-[80px]">Registers Nov 1.</h2>
            <p className="mt-6 max-w-2xl text-[18px] text-muted">
              The Skein miner ID and its on-chain registration appear here once the season opens. Until then the client refuses every paid call, so the spend above stays at zero.
            </p>
          </div>
          <Link href="/status" className="btn btn-light">Network status</Link>
        </div>
      </section>
    </>
  );
}

/** One line: a window's verdict counts and its ABSTAIN rate. */
function RecentMix({ label, mix }: { label: string; mix: Record<string, number> }) {
  const n = ORDER.reduce((a, v) => a + (mix[v] ?? 0), 0);
  if (!n) return null;
  return (
    <p className="mt-6 font-mono text-[13px] text-ink-2">
      <span className="text-ink">{label}:</span> {n} verdicts ·{" "}
      {ORDER.map((v) => `${v} ${mix[v] ?? 0}`).join(" · ")} · ABSTAIN rate {Math.round(((mix.ABSTAIN ?? 0) / n) * 100)}%
    </p>
  );
}
