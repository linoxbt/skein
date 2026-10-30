"use client";
import { useEffect, useState } from "react";
import type { Verdict } from "@skein/sdk";
import type { Application } from "./types";

export const VCOLOR: Record<Verdict, string> = {
  APPROVE: "var(--color-approve)",
  REJECT: "var(--color-reject)",
  ESCALATE: "var(--color-escalate)",
  ABSTAIN: "var(--color-abstain)",
};
export const VCOLOR_LIGHT: Record<Verdict, string> = {
  APPROVE: "#138a4b",
  REJECT: "#c93030",
  ESCALATE: "var(--color-knot-deep)",
  ABSTAIN: "#5b6670",
};

export const short = (h: string, n = 6) => `${h.slice(0, n + 2)}…${h.slice(-4)}`;
export const usd = (n: number) => `$${n.toFixed(n > 0 && n < 0.1 ? 3 : 2)}`;
export const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : new Date(iso).toLocaleDateString();
};

/** The queue, polled. Each poll also nudges the agent to settle open applications. */
export function useApplications(intervalMs = 3000) {
  const [state, setState] = useState<{ agent: "online" | "offline"; applications: Application[] } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const r = await fetch("/api/applications", { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        if (live) {
          setState(await r.json());
          setError(false);
        }
      } catch {
        if (live) setError(true);
      }
      if (live) timer = setTimeout(load, intervalMs);
    };
    void load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [intervalMs]);
  return { state, error };
}
