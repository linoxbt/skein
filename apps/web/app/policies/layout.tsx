import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Policies",
  description: "The published, immutable policies Skein fuses checks under, with their hashes.",
  openGraph: { title: "Policies · Skein", description: "The published, immutable policies Skein fuses checks under, with their hashes." },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
