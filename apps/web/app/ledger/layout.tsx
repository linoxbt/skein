import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ledger",
  description: "Skein's public spend ledger: every upstream purchase, receipt and cost.",
  openGraph: { title: "Ledger · Skein", description: "Skein's public spend ledger: every upstream purchase, receipt and cost." },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
