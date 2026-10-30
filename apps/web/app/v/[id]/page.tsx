"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Lead, Section } from "@/components/site/Section";
import { Stripes } from "@/components/site/Stripes";
import { StatTile } from "@/components/ui";
import { GraphWithPanel, VerdictHeader, VerdictTabs } from "@/components/VerdictView";
import { usd } from "@/lib/api";
import { useVerdict } from "@/lib/useVerdict";

export default function VerdictPage() {
  const { id } = useParams<{ id: string }>();
  const { v, bom, graph, error, running } = useVerdict(id);
  const [copied, setCopied] = useState(false);

  if (error || running || !v || !graph) {
    return (
      <section className="relative min-h-[70vh] overflow-hidden bg-bg">
        <Stripes seed={21} className="opacity-30" />
        <div className="relative mx-auto max-w-[1400px] px-5 pb-24 pt-40 md:px-10">
          <span className="tag tag-dark">Verdict</span>
          <h1 className="display mt-6 text-[48px] md:text-[96px]">
            {error ? "Not found." : running ? "Still running." : "Loading…"}
          </h1>
          {error ? <p className="mt-6 font-mono text-[13px] text-muted">{error}</p> : null}
          {running ? (
            <Link href="/console" className="btn btn-primary mt-10">Watch it in the console</Link>
          ) : null}
        </div>
      </section>
    );
  }

  const billed = bom?.lines.filter((l) => l.billed).length ?? v.bom.items;
  return (
    <>
      <section className="relative overflow-hidden bg-bg">
        <div className="relative mx-auto max-w-[1400px] px-5 pb-16 pt-36 md:px-10 md:pt-44">
          <VerdictHeader v={v} size="xl" />
          <div className="mt-10 flex flex-wrap">
            <Link href={`/verify?id=${v.id}`} className="btn btn-primary">Verify this verdict</Link>
            <button
              type="button"
              className="btn btn-light"
              onClick={() => {
                void navigator.clipboard?.writeText(window.location.href);
                setCopied(true);
              }}
            >
              {copied ? "Link copied" : "Share"}
            </button>
          </div>
        </div>
      </section>

      <Section tone="dark" inner="pb-16">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-3 lg:grid-cols-6">
          <StatTile label="risk" value={`${v.riskBps}`} />
          <StatTile label="confidence" value={`${Math.round(v.confidenceBps / 100)}%`} />
          <StatTile label="coverage" value={`${Math.round(v.coverage * 100)}%`} />
          <StatTile label="upstream cost" gold value={usd(v.cost.upstreamUsdc)} />
          <StatTile label="receipts" value={billed} />
          <StatTile label="seconds" value={(v.durationMs / 1000).toFixed(1)} />
        </div>
      </Section>

      <Section tone="dark" inner="pb-20">
        <div className="border border-edge bg-panel p-4 md:p-8">
          <Lead tag="Exploded view" dark />
          <GraphWithPanel state={graph} verdictId={v.id} />
        </div>
      </Section>

      <Section tone="dark" inner="pb-24">
        <VerdictTabs v={v} bom={bom ?? null} />
      </Section>

      <Section tone="paper" inner="py-20 md:py-28">
        <div className="grid items-end gap-10 md:grid-cols-[1fr_auto]">
          <div>
            <span className="tag">Don&apos;t trust this page</span>
            <p className="statement mt-6 max-w-4xl text-[32px] md:text-[56px]">
              Recompute it. Every finding re-derives from its raw paid answer; the hash and the Merkle root must match byte for byte.
            </p>
          </div>
          <Link href={`/verify?id=${v.id}`} className="btn btn-ink">Verify {v.id.slice(0, 10)}…</Link>
        </div>
      </Section>
    </>
  );
}
