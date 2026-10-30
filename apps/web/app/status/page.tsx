"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Lead, PageHero, Section } from "@/components/site/Section";
import { Stripes } from "@/components/site/Stripes";
import { StatTile } from "@/components/ui";
import { getStatus, type Status } from "@/lib/api";

const WHAT: Record<string, string> = {
  contract_audit: "Known vulnerability patterns, owner powers, upgradeability.",
  sanctions: "The deployer and top holders against sanctions lists.",
  holder_concentration: "Share of supply held by the top wallets.",
  holder_count: "How many distinct wallets hold the token.",
  liquidity_depth: "Depth of the main pool at ±2%.",
  wash_trading: "Self-trades and circular volume on the main pool.",
  social_bots: "Bot share among the project's social followers.",
  code_review: "A review of the verified source, where there is one.",
};

export default function StatusPage() {
  const [s, setS] = useState<Status | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    getStatus().then(setS).catch(() => setErr(true));
  }, []);

  const live = s ? s.intents.filter((i) => i.intent && i.activeMiners > 0) : [];
  const miners = s ? s.intents.reduce((a, i) => a + i.activeMiners, 0) : 0;
  const headline = err ? "Unreachable." : !s ? "Checking…" : live.length === s.intents.length ? "All threads live." : `${live.length} of ${s.intents.length} threads live.`;

  return (
    <>
      <PageHero
        compact
        tag="Status"
        title={headline}
        sub={
          err
            ? "The Skein API did not answer. Verdicts cannot run until it does."
            : "Which checks Skein can buy right now, read from the Telegraph intent catalogue. A check with no live miner is reported as missing, never guessed."
        }
        background={<Stripes seed={14} className="opacity-30" />}
      />

      <Section tone="dark" inner="pb-24 pt-6">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-4">
          <StatTile label="checks live" value={s ? `${live.length}/${s.intents.length}` : "—"} />
          <StatTile label="miners to buy from" value={s ? miners : "—"} />
          <StatTile label="spent today" gold value={s ? `$${s.spentTodayUsdc.toFixed(2)}` : "—"} />
          <StatTile label="daily cap" value={s ? `$${s.dailyCapUsdc.toFixed(0)}` : "—"} />
        </div>
      </Section>

      {/* The threads, one row each. */}
      <Section tone="paper" inner="py-20 md:py-28">
        <Lead tag="Threads" />
        {s ? (
          <ol className="mt-4">
            {s.intents.map((i, n) => {
              const up = Boolean(i.intent && i.activeMiners > 0);
              return (
                <li key={i.check}>
                  <div className="grid grid-cols-[1fr_auto] items-center gap-6 py-6 md:grid-cols-[60px_1fr_1fr_auto] md:gap-8 md:py-8">
                    <span className="hidden font-mono text-[14px] text-ink-2 md:block">{String(n + 1).padStart(2, "0")}</span>
                    <div className="min-w-0">
                      <h3 className="statement text-[28px] capitalize md:text-[40px]">{i.check.replace(/_/g, " ")}</h3>
                      <p className="mt-1 text-ink-2">{WHAT[i.check] ?? ""}</p>
                      <code className="mt-2 block break-all font-mono text-[12px] text-ink-2 md:hidden">{i.intent ?? "no live intent"}</code>
                    </div>
                    <div className="hidden min-w-0 md:block">
                      <code className="block break-all font-mono text-[13px]">{i.intent ?? "no live intent"}</code>
                      <span className="font-mono text-[12px] text-ink-2">{i.activeMiners} active miner{i.activeMiners === 1 ? "" : "s"}</span>
                    </div>
                    <span className={`inline-flex h-10 items-center gap-2 px-3 font-mono text-[12px] uppercase tracking-wider ${up ? "bg-thread-deep text-white" : "bg-mist text-reject"}`}>
                      <span className={`h-2 w-2 ${up ? "bg-white" : "bg-reject"}`} aria-hidden />
                      {up ? "live" : "missing"}
                    </span>
                  </div>
                  {n < s.intents.length - 1 ? <div className="rule-dots" /> : null}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="py-10 text-ink-2">{err ? "No data." : "Reading the catalogue…"}</p>
        )}
      </Section>

      {/* Network details. */}
      <Section tone="mist" inner="py-20 md:py-28">
        <Lead tag="Network" />
        <dl className="mt-4 grid gap-px bg-rule md:grid-cols-2">
          {(
            [
              ["network", s ? (s.network === "simulated" ? "simulated (local fake node)" : s.network) : "—"],
              ["node", s?.node ?? "—"],
              ["catalogue read", s ? new Date(s.catalogueFetchedAt).toUTCString() : "—"],
              ["season", s ? (s.preSeason ? "pre-season: paid calls refused until Nov 1 (UTC)" : "open") : "—"],
              ["purchaser wallet", s ? (s.payer ?? "not configured") : "—"],
              ["spend", s ? `$${s.spentTodayUsdc.toFixed(2)} of $${s.dailyCapUsdc.toFixed(2)} today` : "—"],
            ] as [string, string][]
          ).map(([k, v]) => (
            <div key={k} className="bg-mist p-6 md:p-8">
              <dt className="font-mono text-[12px] uppercase tracking-wider text-ink-2">{k}</dt>
              <dd className="mt-2 break-all text-[17px] md:text-[19px]">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 font-mono text-[12px] text-ink-2">Latency percentiles and 24 h error rates per intent arrive with the first paid traffic.</p>
      </Section>

      <section className="bg-bg">
        <div className="mx-auto grid max-w-[1400px] gap-8 px-5 py-20 md:grid-cols-[1fr_auto] md:items-center md:px-10 md:py-28">
          <p className="statement max-w-3xl text-[30px] md:text-[48px]">A missing thread never becomes a guess. The verdict names it and abstains.</p>
          <Link href="/how-it-works" className="btn btn-primary">Read the rules</Link>
        </div>
      </section>
    </>
  );
}
