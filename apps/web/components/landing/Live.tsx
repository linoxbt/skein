"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { GraphWithPanel, VerdictHeader } from "@/components/VerdictView";
import { sharedLedger, sharedStatus, type Ledger, type Status } from "@/lib/api";
import { useVerdict } from "@/lib/useVerdict";

/** Live numbers from the API: what the network offers right now, and what Skein has served. */
export function LiveNumbers() {
  const [s, setS] = useState<Status | null>(null);
  const [l, setL] = useState<Ledger | null>(null);
  useEffect(() => {
    // Shared with the nav and the latest verdict below: one request each per page.
    sharedStatus().then(setS).catch(() => {});
    sharedLedger().then(setL).catch(() => {});
  }, []);
  const miners = s ? s.intents.reduce((a, i) => a + i.activeMiners, 0) : null;
  const live = s ? s.intents.filter((i) => i.intent && i.activeMiners > 0).length : null;
  const verdicts = l ? Object.values(l.verdicts).reduce((a, b) => a + b, 0) : null;
  const cells: [string, string, boolean?][] = [
    ["checks live on Telegraph", live === null ? "—" : `${live}/${s!.intents.length}`],
    ["miners Skein can buy from", miners === null ? "—" : String(miners)],
    ["verdicts served", verdicts === null ? "—" : String(verdicts)],
    ["upstream receipts", l ? String(l.receipts) : "—"],
    ["mean upstream cost per verdict", l && verdicts ? `$${(l.upstreamSpendUsdc / verdicts).toFixed(3)}` : "—", true],
  ];
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-5">
      {cells.map(([label, value, gold]) => (
        <div key={label} className="min-w-0 border-t border-edge pt-4">
          <div className={`display truncate text-[48px] md:text-[72px] ${gold ? "text-knot" : ""}`}>{value}</div>
          <div className="mt-2 font-mono text-[13px] text-muted">{label}</div>
        </div>
      ))}
      {s ? (
        <p className="col-span-2 font-mono text-[12px] text-muted lg:col-span-5">
          Read live from {s.network === "simulated" ? "the local simulated node" : "the Telegraph testnet node"} · catalogue {new Date(s.catalogueFetchedAt).toUTCString()}
          {s.preSeason ? " · the season has not opened: paid calls are refused" : ""}
        </p>
      ) : null}
    </div>
  );
}

export function LatestVerdict() {
  const [id, setId] = useState<string | null | undefined>(undefined);
  const [down, setDown] = useState(false);
  useEffect(() => {
    sharedLedger()
      .then((l) => setId(l.recent[0]?.id ?? null))
      .catch(() => {
        setDown(true);
        setId(null);
      });
  }, []);
  const { v, graph, error } = useVerdict(id ?? undefined);
  if (id === undefined || (id && !v && !error)) return <div className="h-40" />;
  if (!id || !v || !graph) {
    const [title, line] = down || error
      ? ["The Skein API is not answering.", "The latest verdict will show here when it is back. Nothing on this page is made up to fill the gap."]
      : ["No verdict has been served yet.", "The first one shows here, live, the moment it is sealed."];
    return (
      <div className="grid gap-8 border border-edge bg-panel p-8 md:grid-cols-[1fr_auto] md:items-center md:p-12">
        <div>
          <div className="display text-[40px] md:text-[56px]">{title}</div>
          <p className="mt-4 max-w-xl text-muted">{line}</p>
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
