import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { API } from "@/lib/api";

type Params = Promise<{ id: string }>;

/**
 * What the API says about a verdict id: its summary, "missing", or null when
 * it cannot tell. One lookup per request, shared by the metadata and the layout.
 */
const lookup = cache(async (id: string): Promise<{ verdict: string; summary: string; subject: { chainId: number; token: string } } | "missing" | null> => {
  if (!/^vrd_[a-z0-9]{6,40}$/.test(id)) return "missing";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const r = await Promise.race([
      fetch(`${API}/v1/verdicts/${encodeURIComponent(id)}`, { cache: "no-store" }),
      new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("timeout")), 4_000))),
    ]);
    if (r.status === 404) return "missing";
    if (!r.ok) return null;
    const v = (await r.json()) as { verdict?: string; summary?: string; subject?: { chainId: number; token: string } };
    return v.verdict && v.subject ? { verdict: v.verdict, summary: v.summary ?? "", subject: v.subject } : null;
  } catch {
    return null; // the API is slow or down: let the page load and report it
  } finally {
    clearTimeout(timer);
  }
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const v = await lookup(id);
  if (!v || v === "missing") return { title: "Verdict", robots: { index: false } };
  const title = `${v.verdict} · ${v.subject.token.slice(0, 10)}…`;
  return { title, description: v.summary, openGraph: { title: `${title} · Skein`, description: v.summary }, robots: { index: false } };
}

/** An unknown id is answered 404 by middleware.ts; this is a second line, should a request get past it. */
export default async function Layout({ children, params }: { children: React.ReactNode; params: Params }) {
  const { id } = await params;
  if ((await lookup(id)) === "missing") notFound();
  return children;
}
