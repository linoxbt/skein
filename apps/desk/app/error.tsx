"use client";
import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <section className="mx-auto max-w-[1100px] px-5 pb-24 pt-32 md:px-10">
      <p className="font-mono text-[12px] uppercase tracking-wider text-ink-2">Error</p>
      <h1 className="mt-4 text-[40px] font-medium leading-tight md:text-[64px]">Something broke.</h1>
      <p className="mt-4 max-w-xl text-[16px] text-ink-2">
        This page failed to load, usually a brief network or store problem.
        {error.digest ? <span className="mt-2 block font-mono text-[12px]">Reference: {error.digest}</span> : null}
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <button type="button" onClick={reset} className="btn btn-primary">Try again</button>
        <Link href="/" className="btn">The queue</Link>
      </div>
    </section>
  );
}
