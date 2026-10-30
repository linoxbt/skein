"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CornerCard, StatTile } from "@/components/ui";
import { GraphWithPanel, VerdictHeader } from "@/components/VerdictView";
import { getLedger, type Ledger } from "@/lib/api";
import { useVerdict } from "@/lib/useVerdict";

export default function Landing() {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  useEffect(() => {
    getLedger().then(setLedger).catch(() => setUnreachable(true));
  }, []);
  const latest = ledger?.recent[0]?.id;
  const { v, graph } = useVerdict(latest);
  const total = ledger ? Object.values(ledger.verdicts).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="space-y-10">
      <section className="space-y-4 pt-6">
        <h1 className="font-sans text-[44px] font-medium leading-tight tracking-[-0.02em]">
          One request. <span className="text-thread">Every thread.</span>
        </h1>
        <p className="max-w-2xl text-[16px] text-muted">
          Skein answers one question: is this token fit to list, and what is blocking approval? It buys ranked checks from other Telegraph
          miners, fuses them with fixed rules, and returns APPROVE, REJECT, ESCALATE or ABSTAIN with reasons, the risks still open, the cost,
          and a receipt for every input.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/console" className="rounded-sm border border-thread px-4 py-2 text-thread hover:bg-surface-2">Run a verdict</Link>
          <Link href="/docs" className="rounded-sm border border-line px-4 py-2 hover:border-thread">Integrate</Link>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="verdicts served" value={ledger ? total : "—"} />
        <StatTile label="upstream receipts" value={ledger ? ledger.receipts : "—"} />
        <StatTile label="mean upstream cost" gold value={ledger && total ? `$${(ledger.upstreamSpendUsdc / total).toFixed(3)}` : "—"} />
      </section>

      <section className="space-y-4">
        <div className="text-[12px] uppercase tracking-wider text-muted">latest real verdict</div>
        {unreachable ? <CornerCard className="text-muted">The Skein API is unreachable right now.</CornerCard> : null}
        {ledger && !latest ? (
          <CornerCard className="text-muted">
            No verdicts yet. Paid inputs start on Nov 1, when the Telegraph season opens. <Link className="text-thread" href="/console">Open the console</Link>.
          </CornerCard>
        ) : null}
        {v && graph ? (
          <>
            <VerdictHeader v={v} />
            <GraphWithPanel state={graph} verdictId={v.id} />
            <Link href={`/v/${v.id}`} className="text-thread hover:underline">Open the full verdict →</Link>
          </>
        ) : null}
      </section>
    </div>
  );
}
