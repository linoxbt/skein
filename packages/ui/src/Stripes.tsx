/**
 * The immersive band: vertical threads in teal and black, drifting slowly.
 * Deterministic (seeded), so server and client render the same.
 */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const PALETTE = ["#00110e", "#002b24", "#004a3e", "#0a7a68", "#0fa88f", "#2ee6c8", "#8af5e3", "#000000", "#000000", "#001a15"];

export function stripeGradient(seed = 7, bands = 64) {
  const rnd = seeded(seed);
  const stops: string[] = [];
  let x = 0;
  for (let i = 0; i < bands; i++) {
    const width = 0.4 + rnd() * 2.6;
    const color = PALETTE[Math.floor(rnd() * PALETTE.length)]!;
    stops.push(`${color} ${x.toFixed(2)}%`, `${color} ${(x + width).toFixed(2)}%`);
    x += width;
    if (x >= 100) break;
  }
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

export function Stripes({ seed = 7, className = "" }: { seed?: number; className?: string }) {
  const g = stripeGradient(seed);
  return (
    <div className={`absolute inset-0 overflow-hidden ${className}`} aria-hidden>
      <div className="animate-drift motion-safe-only flex h-full w-[200%]">
        <div className="h-full w-1/2" style={{ background: g, filter: "blur(1.5px)" }} />
        <div className="h-full w-1/2" style={{ background: g, filter: "blur(1.5px)" }} />
      </div>
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60" />
    </div>
  );
}
