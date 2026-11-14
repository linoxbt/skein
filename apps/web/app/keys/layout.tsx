import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Get an API key",
  description: "Sign in with your wallet and get a Skein API key: one signature, no transaction, no gas.",
  openGraph: { title: "Get an API key · Skein", description: "Sign in with your wallet and get a Skein API key: one signature, no transaction, no gas." },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
