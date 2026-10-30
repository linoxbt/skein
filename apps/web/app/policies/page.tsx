"use client";
import { useEffect, useState } from "react";
import { CornerCard } from "@/components/ui";
import { getPolicy, listPolicies } from "@/lib/api";
import type { PolicyDoc, PolicySummary } from "@/lib/types";

export default function PoliciesPage() {
  const [list, setList] = useState<PolicySummary[]>([]);
  const [open, setOpen] = useState<PolicyDoc | null>(null);
  useEffect(() => {
    listPolicies().then((l) => {
      setList(l);
      if (l[0]) void getPolicy(l[0].ref).then(setOpen);
    });
  }, []);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-sans text-[28px] font-medium">Policies</h1>
        <p className="text-muted">Versioned and immutable once published: a change is a new version, locked by SHA-256.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <ul className="space-y-2">
          {list.map((p) => (
            <li key={p.ref}>
              <button type="button" onClick={() => void getPolicy(p.ref).then(setOpen)} className={`corner-card w-full p-3 text-left ${open?.ref === p.ref ? "border-thread" : ""}`}>
                <div className="font-sans text-[16px]">{p.id}</div>
                <div className="text-[12px] text-muted">v{p.version} · sha256 {p.sha256.slice(0, 12)}…</div>
              </button>
            </li>
          ))}
        </ul>
        {open ? (
          <CornerCard className="min-w-0 space-y-3">
            <div className="font-sans text-[20px]">{open.ref}</div>
            {open.policy.description ? <p className="text-muted">{open.policy.description}</p> : null}
            <div className="text-[12px]"><span className="text-muted">required:</span> {open.policy.required.join(", ")}</div>
            <div className="text-[12px]"><span className="text-muted">optional:</span> {open.policy.optional.join(", ") || "—"}</div>
            <pre className="overflow-auto rounded-sm border border-line bg-bg p-3 text-[12px] leading-relaxed">{open.yaml}</pre>
          </CornerCard>
        ) : null}
      </div>
    </div>
  );
}
