"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { CornerCard } from "@/components/ui";
import { GraphWithPanel, VerdictHeader, VerdictTabs } from "@/components/VerdictView";
import { useVerdict } from "@/lib/useVerdict";

export default function VerdictPage() {
  const { id } = useParams<{ id: string }>();
  const { v, bom, graph, error, running } = useVerdict(id);
  const [copied, setCopied] = useState(false);
  if (error) return <CornerCard className="text-reject">{error}</CornerCard>;
  if (running) return <CornerCard>This verdict is still running. <Link className="text-thread" href={`/console?watch=${id}`}>Watch it live</Link>.</CornerCard>;
  if (!v || !graph) return <div className="text-muted">Loading…</div>;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <VerdictHeader v={v} />
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-sm border border-line px-3 py-1.5 text-[12px] hover:border-thread"
            onClick={() => {
              void navigator.clipboard?.writeText(window.location.href);
              setCopied(true);
            }}
          >
            {copied ? "Link copied" : "Share"}
          </button>
          <Link href={`/verify?id=${v.id}`} className="rounded-sm border border-thread px-3 py-1.5 text-[12px] text-thread">
            Verify
          </Link>
        </div>
      </div>
      <GraphWithPanel state={graph} verdictId={v.id} />
      <VerdictTabs v={v} bom={bom ?? null} />
    </div>
  );
}
