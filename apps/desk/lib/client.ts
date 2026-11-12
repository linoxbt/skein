"use client";
import { useEffect, useState } from "react";
import type { Verdict } from "@skeinlabs/sdk";
import type { Summary } from "./store";

export const VCOLOR: Record<Verdict, string> = {
  APPROVE: "var(--color-approve)",
  REJECT: "var(--color-reject)",
  ESCALATE: "var(--color-escalate)",
  ABSTAIN: "var(--color-abstain)",
};
export const VCOLOR_LIGHT: Record<Verdict, string> = {
  APPROVE: "var(--color-approve-deep)",
  REJECT: "var(--color-reject-deep)",
  ESCALATE: "var(--color-knot-deep)",
  ABSTAIN: "var(--color-abstain-deep)",
};

export const short = (h: string, n = 6) => `${h.slice(0, n + 2)}…${h.slice(-4)}`;
export const usd = (n: number) => `$${n.toFixed(n > 0 && n < 0.1 ? 3 : 2)}`;
export const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : new Date(iso).toLocaleDateString();
};

/**
 * The queue, polled while the tab is visible. Polling only reads: the agent
 * moves the queue on intake and on its scheduled run. The board is shared
 * for a few seconds server-side, so polling faster would show nothing newer.
 */
export function useApplications(intervalMs = 10_000) {
  const [state, setState] = useState<{ agent: "online" | "offline" | "misconfigured"; rail: "apiKey" | "telegraph"; lastError?: { at: string; code: string }; applications: Summary[] } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (live && !document.hidden) timer = setTimeout(load, intervalMs);
    };
    const load = async () => {
      try {
        // The default cache mode: no request header that would make the CDN skip its short-lived copy.
        const r = await fetch("/api/applications");
        if (!r.ok) throw new Error(String(r.status));
        if (live) {
          setState(await r.json());
          setError(false);
        }
      } catch {
        if (live) setError(true);
      }
      schedule();
    };
    // A hidden tab stops polling; it catches up as soon as it is shown again.
    const onVisibility = () => (document.hidden ? clearTimeout(timer) : void load());
    document.addEventListener("visibilitychange", onVisibility);
    void load();
    return () => {
      live = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);
  return { state, error };
}
