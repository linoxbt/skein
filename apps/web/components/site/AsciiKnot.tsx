/**
 * The knot drawn in type: a ring filled with the four verdicts, one character
 * per cell, a few cells lit in teal. Pure function of its size, so it renders
 * identically on server and client.
 */
const WORDS = "APPROVE // REJECT // ESCALATE // ABSTAIN // ";

export function AsciiKnot({ cols = 96, rows = 44 }: { cols?: number; rows?: number }) {
  const lines: { text: string; lit: number[] }[] = [];
  let k = 0;
  for (let y = 0; y < rows; y++) {
    let line = "";
    const lit: number[] = [];
    for (let x = 0; x < cols; x++) {
      // Characters are ~2x taller than wide: squash x to keep the ring round.
      const nx = (x - cols / 2) / (cols / 2);
      const ny = (y - rows / 2) / (rows / 2);
      const d = Math.hypot(nx, ny);
      // A ring, plus three threads entering it from the left.
      const ring = d > 0.55 && d < 0.92;
      const thread = nx < -0.5 && [-0.42, 0, 0.42].some((t) => Math.abs(ny - t - Math.sin(nx * 5) * 0.06) < 0.045);
      if (ring || thread) {
        line += WORDS[k % WORDS.length];
        if ((x * 7 + y * 13) % 53 === 0) lit.push(x);
        k++;
      } else {
        line += " ";
      }
    }
    lines.push({ text: line, lit });
  }
  return (
    <pre className="select-none overflow-hidden text-center font-mono text-[7px] leading-[9px] text-[#3c6f66] sm:text-[9px] sm:leading-[12px] md:text-[11px] md:leading-[14px]" aria-hidden>
      {lines.map((l, i) => (
        <div key={i}>
          {l.lit.length === 0
            ? l.text
            : [...l.text].map((c, x) => (l.lit.includes(x) && c !== " " ? <span key={x} className="text-thread">{c}</span> : c))}
        </div>
      ))}
    </pre>
  );
}
