import type { Metadata } from "next";
import Link from "next/link";
import { ExampleGraph } from "@/components/landing/Example";
import { Lead, PageHero, Section } from "@/components/site/Section";
import { Stripes } from "@/components/site/Stripes";

export const metadata: Metadata = { title: "How it works" };

const TABLE: [string, string, string, string][] = [
  ["01", "A blocker hits", "A sanctions match, or a critical audit failure, decides on its own evidence.", "REJECT"],
  ["02", "A required check has no answer", "Timed out, unavailable or unreadable: Skein names it rather than guess.", "ABSTAIN"],
  ["03", "Coverage below the policy minimum", "Too little of the policy's weight was actually answered.", "ABSTAIN"],
  ["04", "Risk at or above the reject line", "Weighted risk over the answered checks crosses the policy threshold.", "REJECT"],
  ["05", "A contradiction fires", "Clean code with a wash-traded market; deep liquidity held by insiders.", "ESCALATE"],
  ["06", "A required check failed", "One failed required check never reaches APPROVE, however low the risk.", "ESCALATE"],
  ["07", "Low risk and enough confidence", "Every required check answered, risk under the approve line.", "APPROVE"],
  ["08", "Anything else", "The review band: a person should look.", "ESCALATE"],
];

const COLOR: Record<string, string> = { REJECT: "var(--color-reject)", ABSTAIN: "var(--color-abstain)", ESCALATE: "var(--color-knot-deep)", APPROVE: "var(--color-thread-deep)" };

export default function HowItWorks() {
  return (
    <>
      <PageHero
        tag="How it works"
        title={<>Rules decide.<br />Receipts prove.</>}
        sub="Skein buys each check from a ranked Telegraph miner, normalises every answer into a finding, and runs a fixed decision table. No language model decides anything; the same findings always give the same verdict and the same hash."
        background={<Stripes seed={3} className="opacity-60" />}
        actions={<><Link href="/console" className="btn btn-primary">Run one</Link><Link href="/policies" className="btn btn-light">Read the policies</Link></>}
      />

      <Section tone="paper" inner="py-20 md:py-28">
        <Lead tag="The decision table" />
        <p className="statement mt-6 max-w-5xl text-[32px] md:text-[56px]">Evaluated top to bottom. The first row that matches is the verdict.</p>
        <ol className="mt-14">
          {TABLE.map(([n, cond, line, verdict], i) => (
            <li key={n}>
              <div className="grid grid-cols-[auto_1fr] items-start gap-x-6 gap-y-3 py-7 md:grid-cols-[80px_1fr_200px] md:items-center">
                <span className="font-mono text-[14px] text-ink-2">{n}</span>
                <div>
                  <h3 className="statement text-[26px] md:text-[38px]">{cond}</h3>
                  <p className="mt-1 text-ink-2">{line}</p>
                </div>
                <span className="col-start-2 inline-flex w-fit items-center gap-2 font-mono text-[14px] uppercase tracking-wider md:col-start-3 md:justify-self-end" style={{ color: COLOR[verdict] }}>
                  <span className="h-3 w-3" style={{ background: COLOR[verdict] }} aria-hidden />
                  {verdict}
                </span>
              </div>
              {i < TABLE.length - 1 ? <div className="rule-dots" /> : null}
            </li>
          ))}
        </ol>
      </Section>

      <Section tone="mist" inner="py-20 md:py-28">
        <Lead tag="Scoring" />
        <div className="mt-8 grid gap-px bg-rule md:grid-cols-3">
          {(
            [
              ["Risk", "risk = status_risk × severity_multiplier", "PASS 0, WARN 0.5, FAIL 1, scaled 0.6 / 0.8 / 1 / 1 by severity. Weighted over the answered checks."],
              ["Coverage", "coverage = answered weight ÷ policy weight", "Required and optional together. A required check with no answer is an ABSTAIN regardless."],
              ["Confidence", "coverage × agreement × mean confidence", "Agreement drops 25% per contradiction. A blocker carries the blocking finding's own confidence."],
            ] as [string, string, string][]
          ).map(([title, formula, line]) => (
            <div key={title} className="bg-mist p-8">
              <h3 className="display text-[44px]">{title}</h3>
              <code className="mt-6 block bg-paper p-4 font-mono text-[13px]">{formula}</code>
              <p className="mt-4 text-ink-2">{line}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section tone="dark" inner="py-20 md:py-32">
        <Lead tag="An example, drawn" dark />
        <h2 className="display mt-6 max-w-4xl text-[44px] md:text-[80px]">Six threads, one knot.</h2>
        <p className="mt-6 max-w-2xl text-muted">
          An illustration, not a real verdict. The audit passes, but wash trading fails, so the gold arc marks a market-integrity conflict. A weighted average would have approved this token; Skein escalates it. Select a thread to read its receipt card.
        </p>
        <div className="mt-14">
          <ExampleGraph />
        </div>
      </Section>

      <Section tone="paper" inner="py-20 md:py-28">
        <div className="grid gap-16 md:grid-cols-2">
          <div>
            <Lead tag="Independence" />
            <h2 className="statement mt-4 text-[36px] md:text-[52px]">Five answers from one API are one opinion.</h2>
            <p className="mt-6 text-ink-2">
              Skein groups miners by operator and data source, read from each miner&apos;s base URL. Checks answered by the same family share one weight: the largest of theirs, split between them. On the live network four of the strongest candidates run on one operator, so this matters from the first verdict.
            </p>
          </div>
          <div>
            <Lead tag="Refusal" />
            <h2 className="statement mt-4 text-[36px] md:text-[52px]">ABSTAIN is a feature.</h2>
            <p className="mt-6 text-ink-2">
              A refusal that names what is missing is worth more to a listing desk than a confident guess. If a required check times out, the verdict says so, names the check, and charges only for the inputs that answered.
            </p>
          </div>
        </div>
      </Section>
    </>
  );
}
