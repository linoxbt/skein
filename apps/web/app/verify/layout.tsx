import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Verify a verdict",
  description: "Check any Skein verdict: its signature, its receipts on Telegraph, and a replay of its decision.",
  openGraph: { title: "Verify a verdict · Skein", description: "Check any Skein verdict: its signature, its receipts on Telegraph, and a replay of its decision." },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
