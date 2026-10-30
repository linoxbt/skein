"use client";
import { useState, type ReactNode } from "react";
import type { Status, Verdict } from "@/lib/types";

export const STATUS_COLOR: Record<string, string> = {
  PASS: "var(--color-approve)",
  WARN: "var(--color-escalate)",
  FAIL: "var(--color-reject)",
  UNKNOWN: "var(--color-abstain)",
  UNAVAILABLE: "var(--color-abstain)",
  ERROR: "var(--color-abstain)",
  SKIPPED: "var(--color-abstain)",
  PENDING: "var(--color-line)",
};

export const VERDICT_COLOR: Record<Verdict, string> = {
  APPROVE: "var(--color-approve)",
  REJECT: "var(--color-reject)",
  ESCALATE: "var(--color-escalate)",
  ABSTAIN: "var(--color-abstain)",
};

export function CornerCard({ children, className = "", as: As = "div" }: { children: ReactNode; className?: string; as?: "div" | "section" | "article" }) {
  return <As className={`corner-card p-4 ${className}`}>{children}</As>;
}

export function VerdictBadge({ verdict, size = "md" }: { verdict: Verdict; size?: "md" | "lg" }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-sm border px-2 font-sans font-medium tracking-wide ${size === "lg" ? "py-1 text-[20px]" : "py-0.5 text-[12px]"}`}
      style={{ color: VERDICT_COLOR[verdict], borderColor: VERDICT_COLOR[verdict] }}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: VERDICT_COLOR[verdict] }} aria-hidden />
      {verdict}
    </span>
  );
}

export function StatusDot({ status }: { status: Status | "PENDING" | "SKIPPED" }) {
  const hollow = status === "PENDING" || status === "UNKNOWN" || status === "UNAVAILABLE" || status === "ERROR";
  return (
    <span
      aria-hidden
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={hollow ? { border: `1px solid ${STATUS_COLOR[status]}` } : { background: STATUS_COLOR[status] }}
    />
  );
}

export function NetworkPill({ network }: { network: string }) {
  const simulated = network === "simulated";
  const label = simulated ? "Simulated · not evidence" : network === "eip155:11155111" || network === "testnet" ? "Telegraph testnet" : network;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[12px]"
      style={{ borderColor: simulated ? "var(--color-escalate)" : "var(--color-line)", color: simulated ? "var(--color-escalate)" : "var(--color-muted)" }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: simulated ? "var(--color-escalate)" : "var(--color-thread)" }} aria-hidden />
      {label}
    </span>
  );
}

export function StatTile({ label, value, gold = false }: { label: string; value: ReactNode; gold?: boolean }) {
  return (
    <CornerCard className="min-w-0">
      <div className="text-[12px] uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 truncate font-sans text-[28px] font-medium" style={{ color: gold ? "var(--color-knot)" : undefined }}>
        {value}
      </div>
    </CornerCard>
  );
}

export function ReceiptChip({ hash, href }: { hash: string | null | undefined; href?: string }) {
  const [copied, setCopied] = useState(false);
  if (!hash) return <span className="text-muted">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <code className="text-[12px]" title={hash}>
        {hash.slice(0, 10)}…{hash.slice(-6)}
      </code>
      <button
        type="button"
        className="text-[12px] text-muted hover:text-thread"
        onClick={() => {
          void navigator.clipboard?.writeText(hash);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        aria-label="Copy hash"
      >
        {copied ? "copied" : "copy"}
      </button>
      {href ? (
        <a className="text-[12px] text-thread hover:underline" href={href}>
          verify
        </a>
      ) : null}
    </span>
  );
}

export function JsonPane({ value }: { value: unknown }) {
  return (
    <pre className="max-h-[480px] overflow-auto rounded-sm border border-line bg-bg p-3 text-[12px] leading-relaxed text-muted">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** The mark: three threads wound into an S, tied off in one gold knot. */
export function Mark({ size = 22 }: { size?: number }) {
  const s = "M6 7c0-3 3-4 7-4s7 1.5 7 4.5S16 12 12.5 13 5 15.5 5 19s3.5 4.5 7.5 4.5c2.5 0 4.5-.6 5.5-1.6";
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden>
      <g fill="none" stroke="var(--color-thread)" strokeLinecap="round" strokeWidth="1.6">
        <path d={s} transform="translate(-1.6 0)" opacity="0.45" />
        <path d={s} opacity="0.7" />
        <path d={s} transform="translate(1.6 0)" />
      </g>
      <circle cx="20.5" cy="22.3" r="2.6" fill="var(--color-knot)" />
    </svg>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: readonly T[]; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-line">
      {tabs.map((t) => (
        <button
          key={t}
          role="tab"
          aria-selected={value === t}
          type="button"
          onClick={() => onChange(t)}
          className={`-mb-px border-b px-3 py-2 text-[12px] uppercase tracking-wider ${value === t ? "border-thread text-text" : "border-transparent text-muted hover:text-text"}`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
