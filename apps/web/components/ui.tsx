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

/** For verdict words on paper and mist (each at least 4.5:1 there). */
export const VERDICT_COLOR_LIGHT: Record<Verdict, string> = {
  APPROVE: "var(--color-approve-deep)",
  REJECT: "var(--color-reject-deep)",
  ESCALATE: "var(--color-knot-deep)",
  ABSTAIN: "var(--color-abstain-deep)",
};

export const VERDICT_COLOR: Record<Verdict, string> = {
  APPROVE: "var(--color-approve)",
  REJECT: "var(--color-reject)",
  ESCALATE: "var(--color-escalate)",
  ABSTAIN: "var(--color-abstain)",
};

/**
 * The signature card (spec section 11): a 1 px line border with 10 px corner
 * brackets in the thread colour at 60%, solid on hover.
 */
export function CornerCard({ children, className = "", as: As = "div" }: { children: ReactNode; className?: string; as?: "div" | "section" | "article" }) {
  return <As className={`corner-card border border-line bg-surface p-5 ${className}`}>{children}</As>;
}

export function VerdictBadge({ verdict, size = "md" }: { verdict: Verdict; size?: "md" | "lg" }) {
  return (
    <span
      className={`inline-flex items-center gap-2 border font-mono uppercase tracking-wider ${size === "lg" ? "px-3 py-1.5 text-[14px]" : "px-2 py-0.5 text-[11px]"}`}
      style={{ color: VERDICT_COLOR[verdict], borderColor: VERDICT_COLOR[verdict] }}
    >
      <span className="h-2 w-2" style={{ background: VERDICT_COLOR[verdict] }} aria-hidden />
      {verdict}
    </span>
  );
}

export function StatusDot({ status }: { status: Status | "PENDING" | "SKIPPED" }) {
  const hollow = status === "PENDING" || status === "UNKNOWN" || status === "UNAVAILABLE" || status === "ERROR";
  return (
    <span
      aria-hidden
      className="inline-block h-2 w-2 shrink-0"
      style={hollow ? { border: `1px solid ${STATUS_COLOR[status]}` } : { background: STATUS_COLOR[status] }}
    />
  );
}

export function StatTile({ label, value, gold = false, light = false }: { label: string; value: ReactNode; gold?: boolean; light?: boolean }) {
  return (
    <div className={`min-w-0 border-t pt-4 ${light ? "border-ink" : "border-edge"}`}>
      <div className={`font-mono text-[12px] uppercase tracking-wider ${light ? "text-ink-2" : "text-muted"}`}>{label}</div>
      <div className="display mt-3 truncate text-[44px] md:text-[64px]" style={{ color: gold ? (light ? "var(--color-knot-deep)" : "var(--color-knot)") : undefined }}>
        {value}
      </div>
    </div>
  );
}

export function ReceiptChip({ hash, href }: { hash: string | null | undefined; href?: string }) {
  const [copied, setCopied] = useState<"idle" | "ok" | "failed">("idle");
  if (!hash) return <span className="text-muted">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <code className="font-mono text-[12px]" title={hash}>
        {hash.slice(0, 10)}…{hash.slice(-6)}
      </code>
      <button
        type="button"
        className="text-[12px] text-muted hover:text-thread"
        onClick={async () => {
          setCopied((await copyText(hash)) ? "ok" : "failed");
          setTimeout(() => setCopied("idle"), 1600);
        }}
        aria-label="Copy hash"
      >
        <span aria-live="polite">{copied === "ok" ? "copied" : copied === "failed" ? "copy failed" : "copy"}</span>
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
    <pre className="max-h-[520px] overflow-auto border border-edge bg-bg p-4 font-mono text-[12px] leading-relaxed text-muted">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** The mark: three threads wound into an S, tied off in one gold knot. */
export { Mark } from "@skein/ui";

/** The ids a tab and its panel share (`tabIds("verdict", "json").panel` is "verdict-panel-json"). */
export const tabIds = (prefix: string, tab: string) => {
  const slug = tab.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return { tab: `${prefix}-tab-${slug}`, panel: `${prefix}-panel-${slug}` };
};

/**
 * A tab list (WAI-ARIA tabs pattern): arrow keys, Home and End move between
 * tabs, only the selected tab is in the tab order, and the selected tab names
 * the panel it controls. The caller renders that one panel with
 * role="tabpanel", id tabIds(prefix, value).panel and aria-labelledby
 * tabIds(prefix, value).tab.
 */
export function Tabs<T extends string>({ tabs, value, onChange, idPrefix }: { tabs: readonly T[]; value: T; onChange: (t: T) => void; idPrefix: string }) {
  const move = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.indexOf(value);
    const next = e.key === "ArrowRight" ? (i + 1) % tabs.length : e.key === "ArrowLeft" ? (i - 1 + tabs.length) % tabs.length : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next]!);
    document.getElementById(tabIds(idPrefix, tabs[next]!).tab)?.focus();
  };
  return (
    <div role="tablist" className="flex gap-0 overflow-x-auto" onKeyDown={move}>
      {tabs.map((t) => {
        const ids = tabIds(idPrefix, t);
        return (
          <button
            key={t}
            id={ids.tab}
            role="tab"
            aria-selected={value === t}
            // Only the selected tab's panel is rendered, so only it is named.
            {...(value === t ? { "aria-controls": ids.panel } : {})}
            tabIndex={value === t ? 0 : -1}
            type="button"
            onClick={() => onChange(t)}
            className={`h-11 shrink-0 px-5 font-mono text-[13px] uppercase tracking-wider transition-colors ${value === t ? "bg-thread text-[#001510]" : "bg-panel-2 text-muted hover:text-text"}`}
          >
            {t}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Copies text and says what really happened: "copied" only when the
 * clipboard accepted it, "copy failed" when it refused or does not exist
 * (an insecure origin, a denied permission).
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
