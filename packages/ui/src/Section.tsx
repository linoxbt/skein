import type { ReactNode } from "react";

const TONES = {
  dark: "bg-bg text-text",
  panel: "bg-panel text-text",
  paper: "bg-paper text-ink",
  mist: "bg-mist text-ink",
} as const;

export function Section({
  tone = "dark",
  children,
  className = "",
  inner = "",
  id,
}: {
  tone?: keyof typeof TONES;
  children: ReactNode;
  className?: string;
  inner?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`${TONES[tone]} ${className}`}>
      <div className={`mx-auto max-w-[1400px] px-5 md:px-10 ${inner}`}>{children}</div>
    </section>
  );
}

/** The dark band every page opens with: tag, a display title, a line, actions, and an optional visual. */
export function PageHero({
  tag,
  title,
  sub,
  actions,
  aside,
  background,
  compact = false,
}: {
  tag: string;
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  aside?: ReactNode;
  background?: ReactNode;
  compact?: boolean;
}) {
  return (
    <section className="relative overflow-hidden bg-bg">
      {background ? <div className="pointer-events-none absolute inset-0">{background}</div> : null}
      <div className={`relative mx-auto grid max-w-[1400px] gap-10 px-5 md:px-10 ${compact ? "pb-14 pt-32 md:pt-40" : "pb-20 pt-36 md:pb-28 md:pt-48"} ${aside ? "lg:grid-cols-[1.1fr_0.9fr] lg:items-end" : ""}`}>
        <div className="rise">
          <span className="tag tag-dark">{tag}</span>
          <h1 className={`display mt-6 ${compact ? "text-[48px] md:text-[88px]" : "text-[56px] md:text-[112px]"}`}>{title}</h1>
          {sub ? <p className="mt-6 max-w-2xl text-[18px] text-muted md:text-[20px]">{sub}</p> : null}
          {actions ? <div className="mt-10 flex flex-wrap gap-0">{actions}</div> : null}
        </div>
        {aside ? <div className="rise" style={{ animationDelay: "120ms" }}>{aside}</div> : null}
      </div>
    </section>
  );
}

/** Small heading row: a mono tag on the left gutter, content on the right (as the "[ → ]  Skein is" rows). */
export function Lead({ tag, children, dark = false }: { tag: string; children?: ReactNode; dark?: boolean }) {
  return (
    <div className="flex items-center gap-6 py-6">
      <span className={`font-mono text-[13px] ${dark ? "text-muted" : "text-ink-2"}`}>[ → ]</span>
      <span className={`tag ${dark ? "tag-dark" : ""}`}>{tag}</span>
      {children}
    </div>
  );
}
