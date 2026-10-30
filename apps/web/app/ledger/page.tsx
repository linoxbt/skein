"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CornerCard, StatTile, VerdictBadge } from "@/components/ui";
import { getLedger, getStatus, type Ledger, type Status } from "@/lib/api";
import type { Verdict } from "@/lib/types";

export default function LedgerPage() {
  const [l, setL] = useState<Ledger | null>(null);
  const [s, setS] = useState<Status | null>(null);
  useEffect(() => {
    getLedger().then(setL).catch(() => {});
    getStatus().then(setS).catch(() => {});
  }, []);
  const total = l ? Object.values(l.verdicts).reduce((a, b) => a + b, 0) : 0;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-sans text-[28px] font-medium">Ledger</h1>
        <p className="text-muted">What Skein has served and spent, with every upstream receipt counted. Network: {l?.network ?? "—"}.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="verdicts" value={l ? total : "—"} />
        <StatTile label="upstream spend" gold value={l ? `$${l.upstreamSpendUsdc.toFixed(2)}` : "—"} />
        <StatTile label="receipts" value={l?.receipts ?? "—"} />
        <StatTile label="miners used" value={l?.minersUsed ?? "—"} />
      </div>
      <CornerCard>
        <div className="mb-2 text-[12px] uppercase tracking-wider text-muted">verdict mix</div>
        <div className="flex flex-wrap gap-4">
          {(["APPROVE", "ESCALATE", "ABSTAIN", "REJECT"] as Verdict[]).map((v) => (
            <span key={v} className="inline-flex items-center gap-2"><VerdictBadge verdict={v} /> {l?.verdicts[v] ?? 0}</span>
          ))}
        </div>
      </CornerCard>
      <CornerCard>
        <div className="mb-2 text-[12px] uppercase tracking-wider text-muted">recent</div>
        {l?.recent.length ? (
          <ul className="divide-y divide-line text-[12px]">
            {l.recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                <VerdictBadge verdict={r.verdict as Verdict} />
                <Link className="text-thread hover:underline" href={`/v/${r.id}`}>{r.id}</Link>
                <span className="text-muted">{new Date(r.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">No verdicts yet.</p>
        )}
      </CornerCard>
      <CornerCard className="text-[12px]">
        <div className="mb-2 uppercase tracking-wider text-muted">miner registration</div>
        <p>Not registered yet. Registration ID and on-chain status will show here once Skein registers on Nov 1.</p>
        <p className="mt-1 text-muted">Purchaser wallet: <code>{s?.payer ?? "not configured"}</code> · spent today ${s?.spentTodayUsdc.toFixed(2) ?? "—"} of ${s?.dailyCapUsdc.toFixed(2) ?? "—"}</p>
      </CornerCard>
    </div>
  );
}
