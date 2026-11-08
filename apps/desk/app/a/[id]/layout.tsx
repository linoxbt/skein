import type { Metadata } from "next";

export const metadata: Metadata = { title: "Application", description: "One listing application: its Skein verdict, the checks behind it and the decision." };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
