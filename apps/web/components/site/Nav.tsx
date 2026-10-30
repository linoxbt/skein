"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getStatus } from "@/lib/api";
import { Mark } from "../ui";
import { IconBook, IconClose, IconLedger, IconMenu, IconPlus, IconPulse, IconTerminal } from "./Icons";

type Item = { href: string; label: string; note: string };
const NETWORK: Item[] = [
  { href: "/status", label: "Status", note: "Live intents and miners" },
  { href: "/ledger", label: "Ledger", note: "Verdicts, spend and receipts" },
  { href: "/policies", label: "Policies", note: "Versioned listing rules" },
];

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="grid h-6 w-6 place-items-center bg-panel-2 text-muted transition-colors group-hover:text-thread">{children}</span>;
}

export function Nav() {
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const [network, setNetwork] = useState(false);
  const [label, setLabel] = useState<string | null>(null);
  const netRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getStatus()
      .then((s) => setLabel(s.network === "simulated" ? "Simulated" : s.network === "eip155:11155111" ? "Testnet" : s.network))
      .catch(() => setLabel("Offline"));
  }, []);
  useEffect(() => {
    setOpen(false);
    setNetwork(false);
  }, [path]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (netRef.current && !netRef.current.contains(e.target as Node)) setNetwork(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const link = "group inline-flex items-center gap-2 text-[15px] transition-colors";

  return (
    <>
      <header className="fixed inset-x-3 top-3 z-50 md:inset-x-5 md:top-5">
        <div className="flex h-14 items-center gap-6 bg-panel/95 px-3 backdrop-blur md:h-16 md:px-4">
          <Link href="/" className="flex items-center gap-2 pr-2" aria-label="Skein home">
            <Mark size={28} />
            <span className="font-brand text-[22px] font-medium lowercase tracking-[-0.02em]">skein</span>
          </Link>
          <nav aria-label="Primary" className="hidden flex-1 items-center justify-center gap-7 lg:flex">
            <Link href="/how-it-works" className={`${link} ${active("/how-it-works") ? "text-thread" : "text-text hover:text-thread"}`}>
              How it works <Chip><IconPlus /></Chip>
            </Link>
            <Link href="/console" className={`${link} ${active("/console") ? "text-thread" : "text-text hover:text-thread"}`}>
              Console <Chip><IconTerminal size={14} /></Chip>
            </Link>
            <Link href="/verify" className={`${link} ${active("/verify") ? "text-thread" : "text-text hover:text-thread"}`}>
              Verify <Chip><IconPlus /></Chip>
            </Link>
            <div ref={netRef} className="relative">
              <button
                type="button"
                aria-expanded={network}
                onClick={() => setNetwork((v) => !v)}
                className={`${link} ${NETWORK.some((n) => active(n.href)) ? "text-thread" : "text-text hover:text-thread"}`}
              >
                Network <Chip><IconPulse size={14} /></Chip>
              </button>
              {network ? (
                <div className="absolute left-1/2 top-11 w-72 -translate-x-1/2 border border-edge bg-panel p-2 shadow-2xl">
                  {NETWORK.map((n) => (
                    <Link key={n.href} href={n.href} className="flex items-start gap-3 p-3 hover:bg-panel-2">
                      <span className="mt-0.5 text-thread"><IconLedger size={18} /></span>
                      <span>
                        <span className="block text-[15px]">{n.label}</span>
                        <span className="block text-[13px] text-muted">{n.note}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
            <Link href="/docs" className={`${link} ${active("/docs") ? "text-thread" : "text-text hover:text-thread"}`}>
              Integrate <Chip><IconBook size={14} /></Chip>
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {label ? (
              <span className="hidden items-center gap-2 font-mono text-[12px] text-muted sm:inline-flex" title="Network the API reports">
                <span className={`h-1.5 w-1.5 ${label === "Simulated" ? "bg-knot" : label === "Offline" ? "bg-reject" : "bg-thread"}`} aria-hidden />
                {label === "Simulated" ? "Simulated · not evidence" : label === "Testnet" ? "Telegraph testnet" : label}
              </span>
            ) : null}
            <Link href="/console" className="btn btn-primary hidden !h-10 !px-5 !text-[15px] md:inline-flex">
              Run a verdict
            </Link>
            <button type="button" className="grid h-10 w-10 place-items-center bg-panel-2 lg:hidden" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              {open ? <IconClose size={20} /> : <IconMenu size={20} />}
            </button>
          </div>
        </div>
      </header>
      {open ? (
        <div className="fixed inset-0 z-40 overflow-y-auto bg-bg px-5 pb-10 pt-24 lg:hidden">
          <nav aria-label="Mobile" className="flex flex-col">
            {[
              ["/how-it-works", "How it works"],
              ["/console", "Console"],
              ["/verify", "Verify"],
              ["/status", "Status"],
              ["/ledger", "Ledger"],
              ["/policies", "Policies"],
              ["/docs", "Integrate"],
            ].map(([href, l]) => (
              <Link key={href} href={href!} className="display border-b border-edge py-4 text-[40px]">
                {l}
              </Link>
            ))}
          </nav>
          <Link href="/console" className="btn btn-primary mt-8 w-full">Run a verdict</Link>
        </div>
      ) : null}
    </>
  );
}
