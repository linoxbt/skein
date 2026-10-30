import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = ({ size = 24, ...p }: P) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "square" as const,
  strokeLinejoin: "miter" as const,
  "aria-hidden": true,
  ...p,
});

export const IconThreads = (p: P) => (
  <svg {...base(p)}><path d="M3 5c6 0 9 4 9 7s3 7 9 7" /><path d="M3 12h18" /><path d="M3 19c6 0 9-4 9-7s3-7 9-7" /><circle cx="12" cy="12" r="2" fill="currentColor" /></svg>
);
export const IconSplit = (p: P) => (
  <svg {...base(p)}><path d="M12 21V12" /><path d="M12 12 5 4" /><path d="M12 12l7-8" /><path d="M3 4h4M17 4h4" /></svg>
);
export const IconStop = (p: P) => (
  <svg {...base(p)}><path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z" /><path d="M8 12h8" /></svg>
);
export const IconReceipt = (p: P) => (
  <svg {...base(p)}><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z" /><path d="M9 8h6M9 12h6M9 16h3" /></svg>
);
export const IconReplay = (p: P) => (
  <svg {...base(p)}><path d="M4 12a8 8 0 1 0 3-6.2" /><path d="M4 3v5h5" /><path d="M10 9l5 3-5 3z" /></svg>
);
export const IconShield = (p: P) => (
  <svg {...base(p)}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></svg>
);
export const IconTerminal = (p: P) => (
  <svg {...base(p)}><rect x="3" y="4" width="18" height="16" /><path d="M7 9l3 3-3 3M12 15h5" /></svg>
);
export const IconBook = (p: P) => (
  <svg {...base(p)}><path d="M4 4h7a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4z" /><path d="M20 4h-5a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h5z" /></svg>
);
export const IconPulse = (p: P) => (
  <svg {...base(p)}><path d="M3 12h4l2-6 4 12 2-6h6" /></svg>
);
export const IconLedger = (p: P) => (
  <svg {...base(p)}><rect x="4" y="3" width="16" height="18" /><path d="M8 7h8M8 11h8M8 15h5" /></svg>
);
export const IconPolicy = (p: P) => (
  <svg {...base(p)}><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5" /><path d="M9 13l2 2 4-4" /></svg>
);
export const IconPlug = (p: P) => (
  <svg {...base(p)}><path d="M9 3v5M15 3v5" /><path d="M6 8h12v3a6 6 0 0 1-12 0z" /><path d="M12 17v4" /></svg>
);
export const IconPlus = (p: P) => (
  <svg {...base({ size: 14, ...p })} viewBox="0 0 14 14"><path d="M7 2v10M2 7h10" /></svg>
);
export const IconArrow = (p: P) => (
  <svg {...base(p)}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
export const IconMenu = (p: P) => (
  <svg {...base(p)}><path d="M4 8h16M4 16h16" /></svg>
);
export const IconClose = (p: P) => (
  <svg {...base(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>
);
export const IconCheck = (p: P) => (
  <svg {...base(p)}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);
export const IconCross = (p: P) => (
  <svg {...base(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>
);
