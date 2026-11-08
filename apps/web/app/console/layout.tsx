import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Console",
  description: "Run a Skein verdict on an EVM token and watch each paid check arrive.",
  openGraph: { title: "Console · Skein", description: "Run a Skein verdict on an EVM token and watch each paid check arrive." },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
