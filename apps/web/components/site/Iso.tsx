/**
 * Isometric line drawings for the four stages. Line art on dark panels,
 * a single teal accent each, gold only for the knot.
 */
const S = "#3b434b";
const T = "#2ee6c8";
const G = "#f2b84b";

// Isometric projection of (x, y, z) unit-grid coordinates.
const P = (x: number, y: number, z = 0) => [160 + (x - y) * 26, 120 + (x + y) * 15 - z * 30] as const;
const pt = (x: number, y: number, z = 0) => P(x, y, z).join(",");

function Grid({ n = 4 }: { n?: number }) {
  const lines = [];
  for (let i = 0; i <= n; i++) {
    lines.push(<line key={`a${i}`} x1={P(i, 0)[0]} y1={P(i, 0)[1]} x2={P(i, n)[0]} y2={P(i, n)[1]} stroke={S} />);
    lines.push(<line key={`b${i}`} x1={P(0, i)[0]} y1={P(0, i)[1]} x2={P(n, i)[0]} y2={P(n, i)[1]} stroke={S} />);
  }
  return <g transform="translate(0,-10)">{lines}</g>;
}

function Box({ x, y, z = 0, h = 1, accent = false }: { x: number; y: number; z?: number; h?: number; accent?: boolean }) {
  const c = accent ? T : S;
  const top = [pt(x, y, z + h), pt(x + 1, y, z + h), pt(x + 1, y + 1, z + h), pt(x, y + 1, z + h)].join(" ");
  const left = [pt(x, y + 1, z), pt(x, y + 1, z + h), pt(x + 1, y + 1, z + h), pt(x + 1, y + 1, z)].join(" ");
  const right = [pt(x + 1, y, z), pt(x + 1, y, z + h), pt(x + 1, y + 1, z + h), pt(x + 1, y + 1, z)].join(" ");
  return (
    <g fill="#0b0d0f" stroke={c} strokeWidth="1">
      <polygon points={left} />
      <polygon points={right} />
      <polygon points={top} fill={accent ? "rgba(46,230,200,0.12)" : "#0b0d0f"} />
    </g>
  );
}

export function IsoPlan() {
  const nodes: [number, number, boolean][] = [[0.5, 0.5, true], [1.5, 2.5, false], [2.5, 1.5, true], [3.5, 3.5, false], [3.5, 0.5, true], [0.5, 3.5, false]];
  return (
    <svg viewBox="0 0 320 240" className="h-full w-full" aria-hidden>
      <Grid />
      {nodes.map(([x, y, on], i) => {
        const [cx, cy] = P(x, y);
        return <g key={i}><circle cx={cx} cy={cy - 10} r="5" fill="#0b0d0f" stroke={on ? T : S} />{on ? <circle cx={cx} cy={cy - 10} r="1.8" fill={T} /> : null}</g>;
      })}
      <path d={`M${P(0.5, 0.5)[0]},${P(0.5, 0.5)[1] - 10} L${P(2.5, 1.5)[0]},${P(2.5, 1.5)[1] - 10} L${P(3.5, 0.5)[0]},${P(3.5, 0.5)[1] - 10}`} fill="none" stroke={T} strokeDasharray="3 4" />
      <rect x="20" y="196" width="92" height="18" fill="none" stroke={S} />
      <text x="28" y="209" fontFamily="var(--font-mono)" fontSize="9" fill="#8b979f">quote $0.06</text>
    </svg>
  );
}

export function IsoBuy() {
  const [ox, oy] = P(2, 2, 1);
  const targets: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4], [2, -1], [-1, 2]];
  return (
    <svg viewBox="0 0 320 240" className="h-full w-full" aria-hidden>
      <Grid />
      {targets.map(([x, y], i) => {
        const [tx, ty] = P(x, y);
        return <g key={i}><line x1={ox} y1={oy - 10} x2={tx} y2={ty - 10} stroke={i % 2 ? S : T} strokeDasharray={i % 2 ? "2 4" : undefined} /><rect x={tx - 4} y={ty - 14} width="8" height="8" fill="#0b0d0f" stroke={i % 2 ? S : T} /></g>;
      })}
      <g transform="translate(0,-10)"><Box x={1.5} y={1.5} h={1} accent /></g>
      <text x="196" y="40" fontFamily="var(--font-mono)" fontSize="9" fill="#8b979f">X-PAYMENT · escrow</text>
    </svg>
  );
}

export function IsoDecide() {
  return (
    <svg viewBox="0 0 320 240" className="h-full w-full" aria-hidden>
      <Grid />
      <g transform="translate(0,-10)">
        <Box x={0.5} y={2} h={0.6} />
        <Box x={1.5} y={2} h={1.4} />
        <Box x={2.5} y={2} h={0.9} accent />
        <Box x={0.5} y={0.5} h={2.1} />
      </g>
      <line x1="40" y1="64" x2="280" y2="64" stroke={T} strokeDasharray="4 4" />
      <text x="40" y="56" fontFamily="var(--font-mono)" fontSize="9" fill={T}>reject ≥ 6500 bps</text>
      <line x1="40" y1="150" x2="280" y2="150" stroke={S} strokeDasharray="4 4" />
      <text x="40" y="164" fontFamily="var(--font-mono)" fontSize="9" fill="#8b979f">approve &lt; 2500 bps</text>
    </svg>
  );
}

export function IsoSeal() {
  const leaves = [40, 90, 140, 190, 240, 290];
  return (
    <svg viewBox="0 0 320 240" className="h-full w-full" aria-hidden>
      {leaves.map((x, i) => <g key={x}><rect x={x - 14} y={170} width="28" height="18" fill="#0b0d0f" stroke={i === 2 ? T : S} /><text x={x - 10} y={182} fontFamily="var(--font-mono)" fontSize="7" fill="#8b979f">0x{(i * 37 + 11).toString(16)}</text></g>)}
      {[65, 165, 265].map((x, i) => <g key={x}><line x1={x - 25} y1={170} x2={x} y2={130} stroke={S} /><line x1={x + 25} y1={170} x2={x} y2={130} stroke={i === 1 ? T : S} /><rect x={x - 10} y={118} width="20" height="12" fill="#0b0d0f" stroke={i === 1 ? T : S} /></g>)}
      <line x1={65} y1={118} x2={160} y2={78} stroke={S} /><line x1={165} y1={118} x2={160} y2={78} stroke={T} /><line x1={265} y1={118} x2={160} y2={78} stroke={S} />
      <circle cx="160" cy="62" r="16" fill="rgba(242,184,75,0.15)" stroke={G} />
      <circle cx="160" cy="62" r="5" fill={G} />
      <text x="186" y="66" fontFamily="var(--font-mono)" fontSize="9" fill={G}>bom root</text>
    </svg>
  );
}
