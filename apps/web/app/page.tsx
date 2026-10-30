import Link from "next/link";
import { AsciiKnot } from "@/components/site/AsciiKnot";
import { IconArrow, IconReceipt, IconReplay, IconSplit, IconStop, IconThreads } from "@/components/site/Icons";
import { IsoBuy, IsoDecide, IsoPlan, IsoSeal } from "@/components/site/Iso";
import { Marquee } from "@/components/site/Marquee";
import { Lead, Section } from "@/components/site/Section";
import { Stripes } from "@/components/site/Stripes";
import { ThreadBurst } from "@/components/site/ThreadBurst";
import { LatestVerdict, LiveNumbers } from "@/components/landing/Live";

const INTENTS = [
  "SMART_CONTRACT_AUDIT",
  "SANCTIONS_SCREENING_MATCH",
  "LIQUIDITY_DEPTH_VERIFY",
  "WASH_TRADING_DETECTION",
  "TOKEN_HOLDER_COUNT",
  "SOCIAL_BOT_DETECTION",
  "CODE_REVIEW",
];

const IS: [string, string, typeof IconThreads][] = [
  ["Composite by design", "Seven independent checks, bought from ranked miners, fused into one decision.", IconThreads],
  ["Escalates on conflict", "Clean code over a manipulated market is a contradiction, not an average.", IconSplit],
  ["Refuses without evidence", "A required check that never answered means ABSTAIN, and it names the check.", IconStop],
  ["Receipted end to end", "Every paid input carries its Telegraph receipt; the verdict carries their Merkle root.", IconReceipt],
  ["Deterministic and replayable", "Same findings, same policy, same hash. Anyone can recompute it.", IconReplay],
];

const STAGES: [string, string, string, string, () => React.JSX.Element, string][] = [
  ["01", "Plan the purchase", "Load the policy, check which intents are live, price every input from live floors, and refuse before spending if the budget is short.", "Planner", IsoPlan, "left"],
  ["02", "Buy every thread", "Pay each pinned miner from escrow in parallel. A miner that refuses before payment costs nothing; the next one is tried.", "Telegraph escrow", IsoBuy, "right"],
  ["03", "Decide by rules", "Blockers first, then missing evidence, then risk, then contradictions. No language model decides anything.", "Decision engine", IsoDecide, "left"],
  ["04", "Seal the evidence", "Hash the findings and the decision; root every receipt in a Merkle tree. Append-only, replayable, verifiable.", "Bill of materials", IsoSeal, "right"],
];

export default function Landing() {
  return (
    <>
      {/* Hero: every thread converging into one knot. */}
      <section className="relative h-[100svh] min-h-[640px] overflow-hidden bg-bg">
        <div className="absolute inset-0">
          <ThreadBurst />
        </div>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.55),transparent_60%)]" />
        <div className="relative flex h-full flex-col items-center justify-center px-5 text-center">
          <h1 className="display rise text-[56px] sm:text-[88px] lg:text-[128px]">
            One request.
            <br />
            Every thread.
          </h1>
          <p className="rise mt-6 max-w-xl text-[18px] text-[#c9d1d6] md:text-[21px]" style={{ animationDelay: "120ms" }}>
            Skein is the listing verdict for tokens: ranked Telegraph intelligence, fused by rules, sealed with receipts.
          </p>
        </div>
        <div className="absolute inset-x-0 bottom-10 flex justify-center md:bottom-16">
          <div className="rise flex" style={{ animationDelay: "240ms" }}>
            <Link href="/console" className="btn btn-primary">Run a verdict</Link>
            <Link href="/how-it-works" className="btn btn-light">How it works</Link>
          </div>
        </div>
      </section>

      {/* What Skein buys, live on Telegraph. */}
      <Section tone="paper" inner="py-16 md:py-24">
        <p className="statement mb-12 text-center text-[24px] md:text-[30px]">Every input is bought from a ranked Telegraph miner</p>
        <Marquee
          items={INTENTS.map((i) => (
            <span key={i} className="font-mono text-[18px] tracking-tight text-[#9aa3ab] md:text-[22px]">
              {i}
              <span className="text-[#c7cdd2]">_GENERAL</span>
            </span>
          ))}
        />
      </Section>

      {/* The statement. */}
      <Section tone="paper" inner="pb-24 pt-8 md:pb-40 md:pt-16">
        <span className="tag">Listing, rebuilt for autonomous buyers</span>
        <p className="statement mt-8 text-[36px] md:text-[64px] lg:text-[76px]">
          A listing review takes weeks. An agent deciding whether to buy has seconds. Both need the same seven checks, and nobody trusts a black-box score.{" "}
          <span className="text-[#9aa3ab]">Skein buys every check, shows every receipt, and refuses when the evidence is missing.</span>
        </p>
      </Section>

      {/* Skein is */}
      <section className="bg-paper text-ink">
        <div className="mx-auto max-w-[1400px] px-5 md:px-10">
          <Lead tag="Skein is" />
        </div>
      </section>
      <Section tone="mist" inner="py-6 md:pl-[300px]">
        <ul>
          {IS.map(([title, line, Icon], i) => (
            <li key={title}>
              <div className="group grid grid-cols-[1fr_auto] items-center gap-6 py-6 md:py-8">
                <div>
                  <h3 className="statement text-[30px] md:text-[48px]">{title}</h3>
                  <p className="mt-2 max-w-xl text-[16px] text-ink-2">{line}</p>
                </div>
                <span className="grid h-14 w-14 place-items-center bg-thread-deep text-white transition-colors group-hover:bg-ink md:h-16 md:w-16">
                  <Icon size={30} />
                </span>
              </div>
              {i < IS.length - 1 ? <div className="rule-dots" /> : null}
            </li>
          ))}
        </ul>
      </Section>

      {/* The pipeline, in an immersive band of threads. */}
      <section className="relative overflow-hidden bg-bg">
        <Stripes seed={11} />
        <div className="relative mx-auto max-w-[1400px] px-5 py-24 md:px-10 md:py-40">
          <h2 className="display max-w-4xl text-[48px] md:text-[96px]">The pipeline every verdict runs</h2>
          <div className="relative mt-20 space-y-16 md:space-y-28">
            <div className="absolute left-1/2 top-0 hidden h-full border-l border-dotted border-white/40 md:block" aria-hidden />
            {STAGES.map(([n, title, body, part, Art, side]) => (
              <article key={n} className={`relative w-full max-w-[480px] border border-edge bg-panel ${side === "right" ? "md:ml-auto" : "md:ml-[8%]"}`}>
                <header className="flex items-center gap-3 border-b border-edge p-4">
                  <span className="grid h-9 w-9 place-items-center border border-edge font-mono text-[14px]">{n}</span>
                  <h3 className="font-mono text-[15px]">{title}</h3>
                </header>
                <div className="h-56 border-b border-edge px-4">
                  <Art />
                </div>
                <p className="p-5 text-[15px] text-muted">{body}</p>
                <footer className="flex items-center gap-3 border-t border-edge p-4">
                  <span className="grid h-9 w-9 place-items-center border border-edge bg-bg text-thread"><IconThreads size={18} /></span>
                  <span className="text-[17px] text-muted">{part}</span>
                </footer>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Live. */}
      <Section tone="dark" inner="py-24 md:py-36">
        <Lead tag="Live from the network" dark />
        <h2 className="display mt-6 max-w-5xl text-[44px] md:text-[80px]">Nothing on this page is a mock-up.</h2>
        <div className="mt-16">
          <LiveNumbers />
        </div>
        <div className="mt-24">
          <LatestVerdict />
        </div>
      </Section>

      {/* The knot, in type. */}
      <section className="overflow-hidden bg-bg py-10 md:py-16">
        <AsciiKnot />
        <p className="mt-10 text-center font-mono text-[13px] text-muted">four answers · one knot · every thread accounted for</p>
      </section>

      {/* Who it is for. */}
      <section className="bg-paper text-ink">
        <div className="mx-auto max-w-[1400px] px-5 py-20 md:px-10 md:py-32">
          <div className="grid md:grid-cols-2">
            {(
              [
                ["For listing desks", ["Triage the queue: analysts only see ESCALATE.", "Read the reasons and the risks still open, not a score.", "Show compliance every receipt behind a decision.", "Re-verify any verdict months later, byte for byte."]],
                ["For trading agents", ["Gate a buy: no APPROVE, no trade.", "Pay per verdict through Telegraph, no account.", "Get ABSTAIN instead of a guess when evidence is missing.", "Spend caps refuse before a single cent is spent."]],
              ] as [string, string[]][]
            ).map(([title, items]) => (
              <div key={title} className="frame-dots p-4 md:p-6">
                <h2 className="statement py-12 text-center text-[36px] md:py-20 md:text-[48px]">{title}</h2>
                <ul className="space-y-2">
                  {items.map((it) => (
                    <li key={it} className="flex items-center gap-4 bg-mist px-6 py-6 text-[17px] md:text-[19px]">
                      <span className="h-2.5 w-2.5 shrink-0 bg-thread-deep" aria-hidden />
                      {it}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Get started. */}
      <Section tone="mist" inner="py-20 md:py-32">
        <span className="tag !bg-paper">Get started</span>
        <div className="mt-10 grid gap-px bg-rule md:grid-cols-2">
          {(
            [
              ["Run a verdict", "Paste a token, watch every thread land.", "/console"],
              ["Integrate", "One HTTP call, or one paid Telegraph request.", "/docs"],
              ["Verify", "Recompute any verdict from its raw answers.", "/verify"],
              ["Read the rules", "Versioned policies, immutable once published.", "/policies"],
            ] as [string, string, string][]
          ).map(([title, line, href]) => (
            <Link key={href} href={href} className="group flex items-end justify-between gap-6 bg-mist p-6 transition-colors hover:bg-paper md:p-10">
              <div>
                <h3 className="display text-[40px] md:text-[60px]">{title}</h3>
                <p className="mt-3 text-ink-2">{line}</p>
              </div>
              <span className="grid h-12 w-12 shrink-0 place-items-center bg-ink text-white transition-transform group-hover:translate-x-1">
                <IconArrow />
              </span>
            </Link>
          ))}
        </div>
      </Section>
    </>
  );
}
