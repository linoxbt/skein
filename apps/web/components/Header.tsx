"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getStatus } from "@/lib/api";
import { Mark, NetworkPill } from "./ui";

const NAV = [
  ["/console", "Console"],
  ["/verify", "Verify"],
  ["/policies", "Policies"],
  ["/ledger", "Ledger"],
  ["/status", "Status"],
  ["/docs", "Integrate"],
] as const;

export function Header() {
  const path = usePathname();
  const [network, setNetwork] = useState<string | null>(null);
  useEffect(() => {
    getStatus().then((s) => setNetwork(s.network)).catch(() => setNetwork("api unreachable"));
  }, []);
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="flex items-center gap-2" aria-label="Skein home">
          <Mark />
          <span className="font-sans text-[20px] font-medium lowercase tracking-[-0.02em]">skein</span>
        </Link>
        <nav className="flex flex-1 flex-wrap gap-x-4 gap-y-1 text-[12px] uppercase tracking-wider">
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} className={path?.startsWith(href) ? "text-thread" : "text-muted hover:text-text"}>
              {label}
            </Link>
          ))}
        </nav>
        {network ? <NetworkPill network={network} /> : null}
      </div>
    </header>
  );
}
