"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { GraphWithPanel, VerdictHeader } from "@/components/VerdictView";
import { getLedger, getStatus, type Ledger, type Status } from "@/lib/api";
import { useVerdict } from "@/lib/useVerdict";

/** Live numbers from the API: what the network offers right now, and what Skein has served. */
export function LiveNumbers() {
  const [s, setS] = useState<Status | null>(null);
  const [l, setL] = useState<Ledger | null>(null);
  useEffect(() => {
    getStatus().then(setS).catch(() => {});
    getLedger().then(setL).catch(() => {});
  }, []);
  const miners = s ? s.intents.reduce((a, i) => a + i.activeMiners, 0) : null;
  const live = s ? s.intents.filter((i) => i.intent && i.activeMiners > 0).length : null;
  const verdicts = l ? Object.values(l.verdicts).reduce((a, b) => a + b, 0) : null;
  const cells: [string, string, boolean?][] = [
    ["checks live on Telegraph", live === null ? "—" : `${live}/${s!.intents.length}`],
    ["miners Skein can buy from", miners === null ? "—" : String(miners)],
    ["verdicts served", verdicts === null ? "—" : String(verdicts)],
    ["upstream receipts", l ? String(l.receipts) : "—"],
  ];
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-4">
      {cells.map(([label, value]) => (
        <div key={label} className="border-t border-edge pt-4">
          <div className="display text-[56px] md:text-[88px]">{value}</div>
          <div className="mt-2 font-mono text-[13px] text-muted">{label}</div>
        </div>
      ))}
      {s ? (
        <p className="col-span-2 font-mono text-[12px] text-muted lg:col-span-4">
          Read live from {s.network === "simulated" ? "the local simulated node" : "the Telegraph testnet node"} · catalogue {new Date(s.catalogueFetchedAt).toUTCString()}
          {s.preSeason ? " · paid calls open Nov 1 (UTC)" : ""}
        </p>
      ) : null}
    </div>
  );
}

export function LatestVerdict() {
  const [id, setId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    getLedger()
      .then((l) => setId(l.recent[0]?.id ?? null))
      .catch(() => setId(null));
  }, []);
  const { v, graph } = useVerdict(id ?? undefined);
  if (id === undefined) return <div className="h-40" />;
  if (!id || !v || !graph) {
    return (
      <div className="grid gap-8 border border-edge bg-panel p-8 md:grid-cols-[1fr_auto] md:items-center md:p-12">
        <div>
          <div className="display text-[40px] md:text-[56px]">The first real verdict lands Nov 1.</div>
          <p className="mt-4 max-w-xl text-muted">Paid Telegraph inputs open when the season does. Until then, every number on this page is read live, and nothing here is simulated.</p>
        </div>
        <Link href="/console" className="btn btn-primary">Open the console</Link>
      </div>
    );
  }
  return (
    <div className="space-y-8">
      <VerdictHeader v={v} />
      <GraphWithPanel state={graph} verdictId={v.id} />
      <Link href={`/v/${v.id}`} className="btn btn-ghost">Open the full verdict</Link>
    </div>
  );
}
