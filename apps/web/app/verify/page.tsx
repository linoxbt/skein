"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { IconCheck, IconCross } from "@/components/site/Icons";
import { Lead, PageHero, Section } from "@/components/site/Section";
import { SkeinError, verify } from "@/lib/api";

type Report = Awaited<ReturnType<typeof verify>>;

const STEPS: [string, string, string][] = [
  ["adaptersRerun", "Answers re-read", "Each paid answer re-read by the adapter version recorded with it."],
  ["policyRerun", "Policy rerun", "The decision table rerun on those findings: same decision, same verdict hash."],
  ["bomRootRebuilt", "Receipts re-rooted", "The bill-of-materials Merkle root rebuilt from every receipt hash."],
  ["engineVersion", "Engine matched", "The engine version is the one that made the verdict."],
];

function VerifyInner() {
  const params = useSearchParams();
  const [id, setId] = useState(params.get("id") ?? "");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(target = id) {
    if (!target) return;
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      setReport(await verify(target.trim()));
    } catch (e) {
      setError(e instanceof SkeinError ? `${e.body.code}: ${e.body.message}` : String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const q = params.get("id");
    if (q) void run(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <PageHero
        compact
        tag="Verify"
        title={<>Don&apos;t trust.<br />Recompute.</>}
        sub="Give any verdict id. Skein replays it from the raw answers it paid for, without reading the stored decision, and shows each step."
        actions={
          <form
            className="flex w-full max-w-2xl flex-col sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              void run();
            }}
          >
            <input className="field !h-12 flex-1" placeholder="vrd_…" value={id} onChange={(e) => setId(e.target.value)} aria-label="Verdict id" />
            <button type="submit" disabled={busy} className="btn btn-primary">{busy ? "Recomputing…" : "Verify"}</button>
          </form>
        }
      />

      {error ? (
        <Section tone="dark" inner="pb-24">
          <div className="border border-reject/50 bg-reject/10 p-6 font-mono text-[14px] text-reject">{error}</div>
        </Section>
      ) : null}

      {report ? (
        <>
          <Section tone="paper" inner="py-16 md:py-24">
            <Lead tag={report.ok ? "Verified" : "Mismatch"} />
            <h2 className="display mt-4 text-[48px] md:text-[96px]" style={{ color: report.ok ? "var(--color-thread-deep)" : "var(--color-reject)" }}>
              {report.ok ? "Every step matches." : "Something changed."}
            </h2>
            <ol className="mt-12">
              {STEPS.map(([k, title, line], i) => {
                const ok = report.checks[k];
                return (
                  <li key={k} className="rise" style={{ animationDelay: `${i * 140}ms` }}>
                    <div className="grid grid-cols-[1fr_auto] items-center gap-6 py-6">
                      <div>
                        <h3 className="statement text-[28px] md:text-[44px]">{title}</h3>
                        <p className="mt-1 text-ink-2">{line}</p>
                      </div>
                      <span className={`grid h-14 w-14 place-items-center text-white ${ok ? "bg-thread-deep" : "bg-reject"}`} aria-label={ok ? "passed" : "failed"}>
                        {ok ? <IconCheck size={30} /> : <IconCross size={30} />}
                      </span>
                    </div>
                    {i < STEPS.length - 1 ? <div className="rule-dots" /> : null}
                  </li>
                );
              })}
            </ol>
          </Section>
          <Section tone="mist" inner="py-16 md:py-20">
            <div className="grid gap-px bg-rule md:grid-cols-2">
              {(
                [
                  ["verdict hash", report.verdictHash.stored, report.verdictHash.recomputed],
                  ["bom root", report.bomRoot.stored, report.bomRoot.recomputed],
                ] as [string, string, string][]
              ).map(([label, a, b]) => (
                <div key={label} className="bg-mist p-6 md:p-8">
                  <div className="font-mono text-[12px] uppercase tracking-wider text-ink-2">{label}</div>
                  <dl className="mt-4 space-y-3 font-mono text-[13px]">
                    <div><dt className="text-ink-2">stored</dt><dd className="break-all">{a}</dd></div>
                    <div><dt className="text-ink-2">recomputed</dt><dd className="break-all" style={{ color: a === b ? "var(--color-thread-deep)" : "var(--color-reject)" }}>{b}</dd></div>
                  </dl>
                </div>
              ))}
            </div>
            <p className="mt-6 font-mono text-[12px] text-ink-2">
              {report.receipts.length} receipts · <Link href={`/v/${report.id}`} className="underline">open the verdict</Link> · next: re-derive each signal hash against the Telegraph node.
            </p>
            {report.problems.length ? <ul className="mt-4 font-mono text-[13px] text-reject">{report.problems.map((p) => <li key={p}>{p}</li>)}</ul> : null}
          </Section>
        </>
      ) : !error ? (
        <Section tone="paper" inner="py-16 md:py-24">
          <Lead tag="What gets checked" />
          <ol className="mt-6">
            {STEPS.map(([k, title, line], i) => (
              <li key={k}>
                <div className="grid grid-cols-[60px_1fr] items-baseline gap-4 py-6">
                  <span className="font-mono text-[14px] text-ink-2">0{i + 1}</span>
                  <div>
                    <h3 className="statement text-[28px] md:text-[44px]">{title}</h3>
                    <p className="mt-1 text-ink-2">{line}</p>
                  </div>
                </div>
                {i < STEPS.length - 1 ? <div className="rule-dots" /> : null}
              </li>
            ))}
          </ol>
        </Section>
      ) : null}
    </>
  );
}

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyInner />
    </Suspense>
  );
}
