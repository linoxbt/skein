import Link from "next/link";
import { Stripes } from "@skein/ui";

export const metadata = { title: "Not found" };

/** Any URL with no page, and verdict ids that do not exist (app/v/[id]/layout.tsx). */
export default function NotFound() {
  return (
    <section className="relative min-h-[70vh] overflow-hidden bg-bg">
      <Stripes seed={7} className="opacity-30" />
      <div className="relative mx-auto max-w-[1400px] px-5 pb-24 pt-40 md:px-10">
        <span className="tag tag-dark">404</span>
        <h1 className="display mt-6 text-[48px] md:text-[96px]">Not found.</h1>
        <p className="mt-6 max-w-xl text-[16px] text-muted">There is nothing at this address. A verdict link may have a typo in its id.</p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/" className="btn btn-primary">Home</Link>
          <Link href="/console" className="btn">Run a verdict</Link>
          <Link href="/verify" className="btn">Verify a verdict</Link>
        </div>
      </div>
    </section>
  );
}
