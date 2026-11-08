import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Status",
  description: "Live state of Skein's API, the Telegraph network and each check's miners.",
  openGraph: { title: "Status · Skein", description: "Live state of Skein's API, the Telegraph network and each check's miners." },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
