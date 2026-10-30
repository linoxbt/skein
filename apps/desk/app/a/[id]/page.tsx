"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Lead, Section } from "@/components/Section";
import { Stripes } from "@/components/Stripes";
import { short, usd, VCOLOR } from "@/lib/client";
import { CHAINS, columnOf, type Application } from "@/lib/types";

const SKEIN_WEB = process.env.NEXT_PUBLIC_SKEIN_WEB_URL ?? "https://skein-web.netlify.app";
const COLUMN_LABEL = { incoming: "Incoming", shortlist: "Shortlisted", analyst: "Analyst queue", declined: "Declined" } as const;

export default function ApplicationPage() {
  const { id } = useParams<{ id: string }>();
  const [a, setA] = useState<Application | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let live = true;
    let t: ReturnType<typeof setTimeout>;
    const load = async () => {
      const r = await fetch(`/api/applications/${id}`, { cache: "no-store" }).catch(() => null);
      if (!live) return;
      if (r?.status === 404) return setMissing(true);
      const j = r?.ok ? ((await r.json()) as Application) : null;
      if (j) setA(j);
      if (!j || j.status !== "decided") t = setTimeout(load, 2000);
    };
    void load();
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [id]);

  const d = a?.decision;
  return (
    <>
      <section className="relative overflow-hidden bg-bg">
        <Stripes seed={d?.verdict === "REJECT" ? 3 : 17} className="opacity-30" />
        <div className="relative mx-auto max-w-[1400px] px-5 pb-16 pt-32 md:px-10 md:pt-44">
          <div className="flex flex-wrap gap-2">
            <span className="tag tag-dark">{a ? COLUMN_LABEL[columnOf(a)] : "Application"}</span>
            {a ? <span className="tag tag-dark">{a.source === "webhook" ? "via webhook" : "via form"}</span> : null}
          </div>
          <h1 className="display mt-6 text-[48px] md:text-[96px]">{missing ? "Not found." : (a?.project ?? "Loading…")}</h1>
          {a ? (
            <p className="mt-4 break-all font-mono text-[13px] text-muted">
              {CHAINS[a.subject.chainId]} · {a.subject.token} · received {new Date(a.receivedAt).toLocaleString()}
            </p>
          ) : null}
          {a && !d ? (
            <p className="pending mt-10 font-mono text-[15px] text-thread">
              {a.status === "buying" ? `Buying a verdict${a.verdictId ? ` (${a.verdictId})` : ""}…` : "Waiting for the agent…"}
            </p>
          ) : null}
          {d ? (
            <div className="mt-10">
              <div className="display text-[64px] md:text-[128px]" style={{ color: d.verdict ? VCOLOR[d.verdict] : "var(--color-muted)" }}>
                {d.verdict ?? "Refused"}
              </div>
              <p className="statement mt-4 max-w-4xl text-[24px] text-[#c9d1d6] md:text-[34px]">{d.summary}</p>
            </div>
          ) : null}
        </div>
      </section>

      {d ? (
        <>
          <Section tone="dark" inner="pb-20">
            <div className="grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-5">
              {(
                [
                  ["action", d.action === "shortlist" ? "Shortlist" : d.action === "decline" ? "Decline" : "Analyst"],
                  ["decided in", `${d.seconds}s`],
                  ["desk paid", usd(d.paidUsdc)],
                  ["evidence bought", usd(d.upstreamUsdc)],
                  ["receipts", String(d.receipts)],
                ] as [string, string][]
              ).map(([k, v], i) => (
                <div key={k} className="min-w-0 border-t border-edge pt-4">
                  <div className="font-mono text-[12px] uppercase tracking-wider text-muted">{k}</div>
                  <div className="display mt-3 truncate text-[40px] md:text-[56px]" style={i === 2 ? { color: "var(--color-knot)" } : undefined}>{v}</div>
                </div>
              ))}
            </div>
          </Section>

          <Section tone="paper" inner="py-20 md:py-28">
            <Lead tag={d.action === "decline" ? "The letter" : d.action === "shortlist" ? "The note" : "The brief"} />
            <pre className="whitespace-pre-wrap break-words border-l-4 border-thread-deep bg-mist p-6 font-mono text-[14px] leading-relaxed md:p-10 md:text-[15px]">{d.letter}</pre>
          </Section>

          <Section tone="mist" inner="py-20 md:py-24">
            <Lead tag="Evidence" />
            <dl className="grid gap-px bg-rule md:grid-cols-2">
              {(
                [
                  ["verdict", d.verdictId ?? "none (refused)"],
                  ["verdict hash", d.verdictHash ? short(d.verdictHash, 10) : "—"],
                  ["paid with", d.rail === "telegraph" ? "a Telegraph escrow payment" : d.rail === "apiKey" ? "a Skein partner key" : "nothing (refused)"],
                  ["receipt", d.receiptHash ? short(d.receiptHash, 10) : d.rail === "apiKey" ? "upstream receipts are in the verdict's bill of materials" : "—"],
                  ["network", d.network ?? "—"],
                  ["list price", d.listPriceUsdc ? usd(d.listPriceUsdc) : "—"],
                ] as [string, string][]
              ).map(([k, v]) => (
                <div key={k} className="bg-mist p-6">
                  <dt className="font-mono text-[12px] uppercase tracking-wider text-ink-2">{k}</dt>
                  <dd className="mt-2 break-all text-[17px]">{v}</dd>
                </div>
              ))}
            </dl>
            {d.verdictId ? (
              <div className="mt-8 flex flex-wrap">
                <a href={`${SKEIN_WEB}/v/${d.verdictId}`} className="btn btn-ink">Open the verdict on Skein</a>
                <a href={`${SKEIN_WEB}/verify?id=${d.verdictId}`} className="btn btn-light border border-rule">Verify it</a>
              </div>
            ) : null}
          </Section>
        </>
      ) : null}

      <Section tone="dark" inner="py-16">
        <Link href="/" className="btn btn-ghost">← Back to the queue</Link>
      </Section>
    </>
  );
}
