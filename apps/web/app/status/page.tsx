"use client";
import { useEffect, useState } from "react";
import { CornerCard } from "@/components/ui";
import { getStatus, type Status } from "@/lib/api";

export default function StatusPage() {
  const [s, setS] = useState<Status | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    getStatus().then(setS).catch(() => setErr(true));
  }, []);
  if (err) return <CornerCard className="text-reject">The Skein API is unreachable.</CornerCard>;
  if (!s) return <div className="text-muted">Loading…</div>;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-sans text-[28px] font-medium">Status</h1>
        <p className="text-muted">
          {s.network} · node {s.node} · catalogue read {new Date(s.catalogueFetchedAt).toLocaleString()}
          {s.preSeason ? " · pre-season: paid calls are refused until Nov 1 (UTC)" : ""}
        </p>
      </div>
      <CornerCard className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-[12px]">
          <thead className="text-muted">
            <tr><th className="py-1 font-normal">check</th><th className="font-normal">intent</th><th className="font-normal">active miners</th><th className="font-normal">state</th></tr>
          </thead>
          <tbody>
            {s.intents.map((i) => (
              <tr key={i.check} className="border-t border-line">
                <td className="py-1.5 uppercase">{i.check.replace(/_/g, " ")}</td>
                <td><code>{i.intent ?? "none live"}</code></td>
                <td>{i.activeMiners}</td>
                <td style={{ color: i.intent && i.activeMiners > 0 ? "var(--color-approve)" : "var(--color-reject)" }}>{i.intent && i.activeMiners > 0 ? "available" : "unavailable"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CornerCard>
      <p className="text-[12px] text-muted">Latency percentiles and 24 h error rates per intent arrive with the first paid traffic.</p>
    </div>
  );
}
