"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Lead, PageHero, Section } from "@skein/ui";
import { Stripes } from "@skein/ui";
import { StatTile } from "@/components/ui";
import { getStatus, type IntentStatus, type Status } from "@/lib/api";
import { networkName } from "@/lib/network";

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

const ms = (n: number | null | undefined) => (typeof n === "number" ? (n >= 10_000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`) : "—");
const pct = (n: number | null | undefined) => (typeof n === "number" ? `${(n * 100).toFixed(n > 0 && n < 0.1 ? 1 : 0)}%` : "—");
const usdc = (n: number | null | undefined) => (typeof n === "number" ? `$${n.toFixed(2)}` : "—");
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toUTCString() : "never");

/** The OFAC SDN snapshot Skein screens locally, if this API build reports it (any key naming sdn or ofac). */
function sdnEntries(s: Status): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(s)) {
    if (!/sdn|ofac/i.test(k) || v === null || v === undefined) continue;
    if (typeof v === "object" && !Array.isArray(v)) {
      for (const [kk, vv] of Object.entries(v as Record<string, unknown>)) out.push([`${k} · ${kk}`, typeof vv === "object" ? JSON.stringify(vv) : String(vv)]);
    } else out.push([k, String(v)]);
  }
  return out;
}

/** Latency and failure over the last 24 h, from Skein's own purchase log. */
function Health({ i }: { i: IntentStatus }) {
  if (!i.calls24h) return <span className="font-mono text-[12px] text-ink-2">no purchases in 24 h</span>;
  const bad = typeof i.errorRate24h === "number" && i.errorRate24h > 0.2;
  return (
    <span className="block font-mono text-[12px] text-ink-2">
      p50 {ms(i.p50Ms)} · p95 {ms(i.p95Ms)} · <span className={bad ? "text-reject-deep" : ""}>errors {pct(i.errorRate24h)}</span> · {i.calls24h} calls / 24 h
    </span>
  );
}

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
        {s && (s.walletAlert || s.capAlert || (s.alertsOpen?.length ?? 0) > 0) ? (
          <ul className="mt-10 space-y-2 font-mono text-[13px]" role="status">
            {s.walletAlert ? <li className="border border-reject/50 bg-reject/10 p-3 text-reject">Escrow low: {usdc(s.payerEscrowUsdc)} left to pay miners with.</li> : null}
            {s.capAlert ? <li className="border border-knot/50 bg-knot/10 p-3 text-knot">Past 80% of today&apos;s spend cap ({usdc(s.spentTodayUsdc)} of {usdc(s.dailyCapUsdc)}).</li> : null}
            {(s.alertsOpen ?? []).map((a) => (
              <li key={a.key} className="border border-reject/50 bg-reject/10 p-3 text-reject">
                Alert open: {a.key}{a.since ? ` since ${new Date(a.since).toUTCString()}` : ""}
              </li>
            ))}
          </ul>
        ) : null}
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
                      <span className="mt-1 block md:hidden"><Health i={i} /></span>
                    </div>
                    <div className="hidden min-w-0 md:block">
                      <code className="block break-all font-mono text-[13px]">{i.intent ?? "no live intent"}</code>
                      <span className="font-mono text-[12px] text-ink-2">{i.activeMiners} active miner{i.activeMiners === 1 ? "" : "s"}</span>
                      <Health i={i} />
                    </div>
                    <span className={`inline-flex h-10 items-center gap-2 px-3 font-mono text-[12px] uppercase tracking-wider ${up ? "bg-thread-deep text-white" : "bg-mist text-reject-deep"}`}>
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
              ["network", s ? `${networkName(s.network)}${s.network.includes(":") ? ` · ${s.network}` : ""}` : "—"],
              ["node", s?.node ?? "—"],
              ["catalogue read", s ? new Date(s.catalogueFetchedAt).toUTCString() : "—"],
              ["season", s ? (s.preSeason ? "pre-season: the client refuses paid calls" : "open") : "—"],
              ["purchaser wallet", s ? (s.payer ?? "not configured") : "—"],
              ["escrow to pay miners", s ? `${usdc(s.payerEscrowUsdc)}${s.walletAlert ? " · low" : ""}` : "—"],
              ["attester (signs every verdict)", s ? (s.attester ?? "not configured: verdicts are unsigned") : "—"],
              ["spend", s ? `$${s.spentTodayUsdc.toFixed(2)} of $${s.dailyCapUsdc.toFixed(2)} today${s.capAlert ? " · past 80%" : ""}` : "—"],
              ["alerts open", s ? (s.alertsOpen?.length ? s.alertsOpen.map((a) => a.key).join(", ") : "none") : "—"],
              ["errors in the last hour", s && typeof s.errorsLastHour === "number" ? String(s.errorsLastHour) : "—"],
              ["last probe", s ? when(s.probeAt) : "—"],
              ["last backup", s ? when(s.backupAt) : "—"],
              ...(s?.quality
                ? ([[`last ${s.quality.windowHours} h`, `${s.quality.verdicts} verdicts, ${s.quality.abstain} ABSTAIN (${s.quality.abstainFailed} from failed purchases) · ${s.quality.purchases} purchases, ${s.quality.purchaseErrors} failed`]] as [string, string][])
                : []),
              ...(s ? sdnEntries(s) : []),
            ] as [string, string][]
          ).map(([k, v]) => (
            <div key={k} className="bg-mist p-6 md:p-8">
              <dt className="font-mono text-[12px] uppercase tracking-wider text-ink-2">{k}</dt>
              <dd className="mt-2 break-all text-[17px] md:text-[19px]">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 font-mono text-[12px] text-ink-2">Latency and error rates are Skein&apos;s own purchases per intent over the last 24 hours, from its purchase log.</p>
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
