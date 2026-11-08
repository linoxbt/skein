import type { Metadata } from "next";

export const metadata: Metadata = { title: "Decision log", description: "Every decision the Desk's agent has made, with its verdict and reasons." };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
