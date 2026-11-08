import Link from "next/link";

export const metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <section className="mx-auto max-w-[1100px] px-5 pb-24 pt-32 md:px-10">
      <p className="font-mono text-[12px] uppercase tracking-wider text-ink-2">404</p>
      <h1 className="mt-4 text-[40px] font-medium leading-tight md:text-[64px]">Not found.</h1>
      <p className="mt-4 max-w-xl text-[16px] text-ink-2">There is nothing at this address. An application link may have a typo in its id.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/" className="btn btn-primary">The queue</Link>
        <Link href="/apply" className="btn">Apply for a listing</Link>
      </div>
    </section>
  );
}
