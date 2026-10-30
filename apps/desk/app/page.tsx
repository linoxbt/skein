"use client";
import Link from "next/link";
import { Lead, PageHero, Section } from "@/components/Section";
import { Stripes } from "@/components/Stripes";
import { ago, short, useApplications, usd, VCOLOR_LIGHT } from "@/lib/client";
import { CHAINS, columnOf, type Application, type Column } from "@/lib/types";

const COLUMNS: [Column, string, string][] = [
  ["incoming", "Incoming", "The agent is buying a verdict"],
  ["shortlist", "Shortlist", "APPROVE → commercial terms"],
  ["analyst", "Analyst queue", "ESCALATE, ABSTAIN or a refusal"],
  ["declined", "Declined", "REJECT → a letter goes out"],
];

function Card({ a }: { a: Application }) {
  const d = a.decision;
  return (
    <Link href={`/a/${a.id}`} className="group block bg-paper p-4 transition-colors hover:bg-[#fbfcfc]">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 truncate text-[17px]">{a.project}</h3>
        <span className="shrink-0 font-mono text-[11px] text-ink-2">{ago(a.receivedAt)}</span>
      </div>
      <div className="mt-1 font-mono text-[12px] text-ink-2">
        {CHAINS[a.subject.chainId]} · {short(a.subject.token)}
      </div>
      <div className="mt-4 flex items-end justify-between gap-3">
        {d ? (
          <span className="font-mono text-[12px] uppercase tracking-wider" style={{ color: d.verdict ? VCOLOR_LIGHT[d.verdict] : "var(--color-ink-2)" }}>
            {d.verdict ?? `refused · ${d.refusal?.code ?? ""}`}
          </span>
        ) : (
          <span className="pending inline-flex items-center gap-2 font-mono text-[12px] uppercase tracking-wider text-thread-deep">
            <span className="h-2 w-2 bg-thread-deep" aria-hidden />
            {a.status === "buying" ? "buying verdict" : "received"}
          </span>
        )}
        {d ? <span className="font-mono text-[12px] text-ink-2">{d.seconds}s · {d.receipts} receipts</span> : null}
      </div>
    </Link>
  );
}

export default function Queue() {
  const { state, error } = useApplications();
  const apps = state?.applications ?? [];
  const decided = apps.filter((a) => a.decision);
  const paid = decided.reduce((s, a) => s + (a.decision?.paidUsdc ?? 0), 0);
  const upstream = decided.reduce((s, a) => s + (a.decision?.upstreamUsdc ?? 0), 0);
  const secs = decided.map((a) => a.decision!.seconds).sort((x, y) => x - y);
  const median = secs.length ? secs[Math.floor(secs.length / 2)]! : null;
  const by = (c: Column) => apps.filter((a) => columnOf(a) === c);

  return (
    <>
      <PageHero
        compact
        tag="Skein Desk · Halyard Exchange (fictional)"
        title={<>The listing queue<br />that decides itself.</>}
        sub="Every application is decided by an agent: it buys one Skein verdict for the token and applies the exchange's rule. Analysts only see what Skein escalates."
        background={<Stripes seed={27} className="opacity-35" />}
        actions={
          <>
            <Link href="/apply" className="btn btn-primary">File an application</Link>
            <Link href="/log" className="btn btn-light">Decision log</Link>
          </>
        }
      />

      <Section tone="dark" inner="pb-16 pt-6">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-4">
          {(
            [
              ["applications", state ? String(apps.length) : "—", false],
              ["decided by the agent", state ? String(decided.length) : "—", false],
              ["paid per decision", decided.length ? usd(paid / decided.length) : "—", true],
              ["median time to decide", median !== null ? `${median}s` : "—", false],
            ] as [string, string, boolean][]
          ).map(([label, value, gold]) => (
            <div key={label} className="min-w-0 border-t border-edge pt-4">
              <div className="font-mono text-[12px] uppercase tracking-wider text-muted">{label}</div>
              <div className="display mt-3 truncate text-[44px] md:text-[64px]" style={gold ? { color: "var(--color-knot)" } : undefined}>{value}</div>
            </div>
          ))}
        </div>
        <p className="mt-8 font-mono text-[12px] text-muted">
          {error
            ? "The desk is unreachable."
            : state?.agent === "offline"
              ? "Agent offline: no Skein key is configured, so applications wait in Incoming."
              : `Agent online · paying with a Skein partner key (free during the hackathon) · evidence behind each decision: ${decided.length ? usd(upstream / decided.length) : "—"} of paid Telegraph inputs`}
        </p>
      </Section>

      <Section tone="mist" inner="py-16 md:py-24">
        <Lead tag="The queue" />
        <div className="grid gap-px bg-rule md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map(([key, title, note]) => {
            const list = by(key);
            return (
              <section key={key} aria-label={title} className="flex min-h-[320px] flex-col bg-mist">
                <header className="flex items-baseline justify-between gap-3 border-b border-rule p-4">
                  <div>
                    <h2 className="text-[20px]">{title}</h2>
                    <p className="font-mono text-[12px] text-ink-2">{note}</p>
                  </div>
                  <span className="display text-[36px]">{list.length}</span>
                </header>
                <div className="flex-1 space-y-px p-px">
                  {list.length ? list.map((a) => <Card key={a.id} a={a} />) : <p className="p-4 text-[14px] text-ink-2">{state ? "Empty." : "Loading…"}</p>}
                </div>
              </section>
            );
          })}
        </div>
      </Section>

      <Section tone="paper" inner="py-20 md:py-28">
        <Lead tag="The house rule" />
        <h2 className="statement max-w-4xl text-[36px] md:text-[56px]">Four verdicts, three actions. The agent never overrides Skein.</h2>
        <ul className="mt-12">
          {(
            [
              ["APPROVE", "Shortlist", "Moves to commercial terms. The evidence link goes with it."],
              ["REJECT", "Decline", "A letter goes to the project with every reason and the verify link."],
              ["ESCALATE", "Analyst queue", "A brief names the conflict and the risks still open."],
              ["ABSTAIN", "Analyst queue", "Skein refused to guess: the brief names the missing check."],
            ] as const
          ).map(([v, action, line], i) => (
            <li key={v}>
              <div className="grid grid-cols-1 gap-2 py-6 md:grid-cols-[180px_320px_1fr] md:items-baseline md:gap-8">
                <span className="font-mono text-[14px] uppercase tracking-wider" style={{ color: VCOLOR_LIGHT[v] }}>{v}</span>
                <span className="statement text-[28px] md:text-[36px]">→ {action}</span>
                <span className="text-ink-2">{line}</span>
              </div>
              {i < 3 ? <div className="rule-dots" /> : null}
            </li>
          ))}
        </ul>
      </Section>

      <section className="relative overflow-hidden bg-bg">
        <Stripes seed={41} className="opacity-25" />
        <div className="relative mx-auto grid max-w-[1400px] gap-12 px-5 py-24 md:px-10 md:py-32 lg:grid-cols-2 lg:items-center">
          <div>
            <span className="tag tag-dark">Fork it</span>
            <h2 className="display mt-6 text-[44px] md:text-[72px]">A whole desk in one call.</h2>
            <p className="mt-6 max-w-xl text-[18px] text-muted">
              Skein Desk is open source and talks to Skein only through <code className="font-mono">@skein/sdk</code>. Swap the house rule, keep the receipts.
            </p>
            <a href="https://github.com/linoxbt/skein/tree/main/apps/desk" className="btn btn-light mt-10">Read the source</a>
          </div>
          <figure className="min-w-0 border border-edge bg-panel">
            <figcaption className="border-b border-edge px-4 py-3 font-mono text-[12px] text-muted">agent.ts · the decision</figcaption>
            <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-relaxed">{`const v = await skein.verdict({
  subject: { chainId: 8453, token },
  idempotencyKey: \`desk-\${app.id}\`,
});

const action = {
  APPROVE: "shortlist",
  REJECT: "decline",
  ESCALATE: "analyst",
  ABSTAIN: "analyst",
}[v.verdict];`}</pre>
          </figure>
        </div>
      </section>
    </>
  );
}
