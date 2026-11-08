"use client";
import Link from "next/link";
import { useEffect } from "react";

/** A page that failed to render: say so, offer a retry, never a blank screen. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <section className="relative min-h-[70vh] overflow-hidden bg-bg">
      <div className="relative mx-auto max-w-[1400px] px-5 pb-24 pt-40 md:px-10">
        <span className="tag tag-dark">Error</span>
        <h1 className="display mt-6 text-[48px] md:text-[96px]">Something broke.</h1>
        <p className="mt-6 max-w-xl text-[16px] text-muted">
          This page failed to load. It is usually a brief network or API problem.
          {error.digest ? <span className="mt-2 block font-mono text-[12px]">Reference: {error.digest}</span> : null}
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <button type="button" onClick={reset} className="btn btn-primary">Try again</button>
          <Link href="/status" className="btn">Service status</Link>
        </div>
      </div>
    </section>
  );
}
