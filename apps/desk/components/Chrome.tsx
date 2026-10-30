"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { IconClose, IconMenu } from "./Icons";

export function Mark({ size = 22 }: { size?: number }) {
  const s = "M6 7c0-3 3-4 7-4s7 1.5 7 4.5S16 12 12.5 13 5 15.5 5 19s3.5 4.5 7.5 4.5c2.5 0 4.5-.6 5.5-1.6";
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden>
      <g fill="none" stroke="var(--color-thread)" strokeLinecap="round" strokeWidth="1.6">
        <path d={s} transform="translate(-1.6 0)" opacity="0.45" />
        <path d={s} opacity="0.7" />
        <path d={s} transform="translate(1.6 0)" />
      </g>
      <circle cx="20.5" cy="22.3" r="2.6" fill="var(--color-knot)" />
    </svg>
  );
}

const LINKS: [string, string][] = [
  ["/", "Queue"],
  ["/apply", "Apply"],
  ["/log", "Decision log"],
];

export function Nav() {
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const active = (href: string) => (href === "/" ? path === "/" || path.startsWith("/a/") : path.startsWith(href));
  return (
    <>
      <header className="fixed inset-x-3 top-3 z-50 md:inset-x-5 md:top-5">
        <div className="flex h-14 items-center gap-6 bg-panel/95 px-3 backdrop-blur md:h-16 md:px-4">
          <Link href="/" className="flex items-center gap-2 pr-2" aria-label="Skein Desk home">
            <Mark size={28} />
            <span className="font-brand text-[22px] font-medium lowercase tracking-[-0.02em]">skein</span>
            <span className="bg-panel-2 px-2 py-1 font-mono text-[12px] uppercase tracking-wider text-thread">desk</span>
          </Link>
          <nav aria-label="Primary" className="hidden flex-1 items-center justify-center gap-8 md:flex">
            {LINKS.map(([href, l]) => (
              <Link key={href} href={href} className={`text-[15px] transition-colors ${active(href) ? "text-thread" : "hover:text-thread"}`}>
                {l}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden font-mono text-[12px] text-muted lg:inline">Halyard Exchange · fictional</span>
            <Link href="/apply" className="btn btn-primary hidden !h-10 !px-5 !text-[15px] md:inline-flex">File an application</Link>
            <button type="button" className="grid h-10 w-10 place-items-center bg-panel-2 md:hidden" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              {open ? <IconClose size={20} /> : <IconMenu size={20} />}
            </button>
          </div>
        </div>
      </header>
      {open ? (
        <div className="fixed inset-0 z-40 bg-bg px-5 pt-24 md:hidden">
          <nav aria-label="Mobile" className="flex flex-col">
            {LINKS.map(([href, l]) => (
              <Link key={href} href={href} className="display border-b border-edge py-4 text-[40px]">{l}</Link>
            ))}
          </nav>
        </div>
      ) : null}
    </>
  );
}

export function Footer() {
  return (
    <footer className="bg-bg">
      <div className="mx-auto max-w-[1400px] px-5 pb-10 pt-20 md:px-10">
        <div className="grid gap-10 md:grid-cols-3">
          <div>
            <h3 className="mb-5 font-mono text-[13px] text-muted">Desk/</h3>
            <ul className="space-y-3 text-[15px]">
              <li><Link href="/" className="hover:text-thread">Queue</Link></li>
              <li><Link href="/apply" className="hover:text-thread">Apply</Link></li>
              <li><Link href="/log" className="hover:text-thread">Decision log</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="mb-5 font-mono text-[13px] text-muted">Skein/</h3>
            <ul className="space-y-3 text-[15px]">
              <li><a href="https://skein-web.netlify.app" className="hover:text-thread">The verdict service</a></li>
              <li><a href="https://skein-web.netlify.app/docs" className="hover:text-thread">Integrate</a></li>
              <li><a href="https://github.com/linoxbt/skein/tree/main/apps/desk" className="hover:text-thread">Fork the Desk</a></li>
            </ul>
          </div>
          <p className="text-[14px] text-muted">
            Halyard Exchange is fictional. Skein Desk is the reference consumer of Skein, built by the same team, and one consumer among several.
          </p>
        </div>
        <div className="mt-20 select-none font-brand text-[22vw] font-medium lowercase leading-[0.8] tracking-[-0.06em] text-panel-2 md:text-[16vw]" aria-hidden>
          desk
        </div>
        <div className="mt-8 flex flex-col justify-between gap-3 border-t border-edge pt-6 text-[13px] text-muted md:flex-row">
          <span>Risk evidence, not investment advice.</span>
          <span className="font-mono">Applications in. Decisions out.</span>
        </div>
      </div>
    </footer>
  );
}
