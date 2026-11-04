import type { ReactNode } from "react";

export function Marquee({ items }: { items: ReactNode[] }) {
  const row = (aria: boolean) => (
    <div className="flex shrink-0 items-center gap-16 pr-16" aria-hidden={aria}>
      {items.map((it, i) => (
        <div key={i} className="shrink-0">{it}</div>
      ))}
    </div>
  );
  return (
    <div className="relative overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_8%,black_92%,transparent)]">
      <div className="animate-marquee motion-safe-only flex w-max">
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}
