import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, random, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, F, THREAD_PATH } from "../theme";

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const ease = Easing.bezier(0.16, 1, 0.3, 1);
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);

export function useSpring(delay = 0, config: { damping?: number; stiffness?: number; mass?: number } = {}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping: 18, stiffness: 120, mass: 0.9, ...config } });
}

/** Loads the brand fonts from public/fonts (the same files the live site serves). */
export const FontFaces: React.FC = () => (
  <style>{`
    @font-face { font-family: 'Inter Tight'; font-weight: 300; src: url(${staticFile("fonts/inter-tight-latin-300-normal.woff2")}) format('woff2'); }
    @font-face { font-family: 'Inter Tight'; font-weight: 400; src: url(${staticFile("fonts/inter-tight-latin-400-normal.woff2")}) format('woff2'); }
    @font-face { font-family: 'Inter Tight'; font-weight: 500; src: url(${staticFile("fonts/inter-tight-latin-500-normal.woff2")}) format('woff2'); }
    @font-face { font-family: 'Space Grotesk'; font-weight: 500; src: url(${staticFile("fonts/space-grotesk-latin-500-normal.woff2")}) format('woff2'); }
    @font-face { font-family: 'JetBrains Mono'; font-weight: 400; src: url(${staticFile("fonts/jetbrains-mono-latin-400-normal.woff2")}) format('woff2'); }
    @font-face { font-family: 'JetBrains Mono'; font-weight: 500; src: url(${staticFile("fonts/jetbrains-mono-latin-500-normal.woff2")}) format('woff2'); }
  `}</style>
);

/** The site's hero: radial warp streaks in teal and grey, drifting outwards. */
export const Warp: React.FC<{ intensity?: number; speed?: number; seed?: string; hue?: string }> = ({ intensity = 1, speed = 1, seed = "w", hue = C.thread }) => {
  const frame = useCurrentFrame();
  const lines = Array.from({ length: 90 }, (_, i) => {
    const a = random(`${seed}a${i}`) * Math.PI * 2;
    const life = 90 + random(`${seed}l${i}`) * 120;
    const t = ((frame * speed + random(`${seed}o${i}`) * life) % life) / life;
    const r0 = 80 + t * t * 1300;
    const len = 30 + t * 260 * (0.4 + random(`${seed}k${i}`));
    const teal = random(`${seed}c${i}`) > 0.62;
    const x1 = 960 + Math.cos(a) * r0, y1 = 540 + Math.sin(a) * r0;
    const x2 = 960 + Math.cos(a) * (r0 + len), y2 = 540 + Math.sin(a) * (r0 + len);
    return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={teal ? hue : "#9aa6ae"} strokeWidth={teal ? 3.2 : 2} strokeLinecap="square" opacity={Math.min(1, t * 2.5) * (1 - t * 0.3) * (teal ? 0.95 : 0.45) * intensity} />;
  });
  return (
    <AbsoluteFill>
      <svg width="1920" height="1080">{lines}</svg>
      <AbsoluteFill style={{ background: "radial-gradient(circle at 50% 50%, rgba(242,184,75,0.10) 0, rgba(0,0,0,0) 18%)" }} />
    </AbsoluteFill>
  );
};

/** Vertical light bands, as on the Desk and Ledger heroes. */
export const Stripes: React.FC<{ opacity?: number }> = ({ opacity = 0.5 }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ opacity }}>
      {Array.from({ length: 26 }, (_, i) => {
        const w = 18 + random(`sw${i}`) * 70;
        const x = (i / 26) * 1920 + Math.sin(frame / 90 + i) * 12;
        const o = 0.08 + random(`so${i}`) * 0.22 + Math.sin(frame / 40 + i * 1.7) * 0.05;
        return <div key={i} style={{ position: "absolute", left: x, top: 0, width: w, height: 1080, background: `linear-gradient(180deg, rgba(46,230,200,${o}) 0%, rgba(8,117,101,${o * 0.6}) 60%, rgba(0,0,0,0) 100%)` }} />;
      })}
    </AbsoluteFill>
  );
};

/** Film grain and vignette over everything. */
export const Grain: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <svg width="1920" height="1080" style={{ position: "absolute", opacity: 0.07, mixBlendMode: "screen" }}>
        <filter id="n">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={frame % 12} />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="1920" height="1080" filter="url(#n)" />
      </svg>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)" }} />
    </AbsoluteFill>
  );
};

/** A mono tag, like the site's "[ → ] Verified" labels. */
export const Tag: React.FC<{ children: React.ReactNode; color?: string; delay?: number; light?: boolean; style?: React.CSSProperties }> = ({ children, color = C.thread, delay = 0, light, style }) => {
  const s = useSpring(delay);
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 12, fontFamily: F.mono, fontSize: 22, letterSpacing: "0.08em", textTransform: "uppercase", color: light ? C.ink2 : C.muted, opacity: s, transform: `translateY(${(1 - s) * 14}px)`, ...style }}>
      <span style={{ color }}>[ → ]</span>
      <span style={{ border: `1px solid ${light ? C.ink2 : C.edge}`, padding: "6px 12px", background: light ? "transparent" : "rgba(19,21,24,0.8)", color: light ? C.ink : C.text }}>{children}</span>
    </div>
  );
};

/** Big display type, revealed word by word from a mask. */
export const Words: React.FC<{ text: string; delay?: number; size?: number; color?: string; weight?: number; stagger?: number; style?: React.CSSProperties; accent?: string[]; accentColor?: string; align?: "left" | "center" }> = ({ text, delay = 0, size = 120, color = C.text, weight = 400, stagger = 3, style, accent = [], accentColor = C.thread, align = "left" }) => {
  const frame = useCurrentFrame();
  const words = text.split(" ");
  return (
    <div style={{ fontFamily: F.display, fontSize: size, fontWeight: weight, letterSpacing: "-0.045em", lineHeight: 1.0, color, display: "flex", flexWrap: "wrap", justifyContent: align === "center" ? "center" : "flex-start", columnGap: size * 0.24, ...style }}>
      {words.map((w, i) => {
        const p = interpolate(frame - delay - i * stagger, [0, 18], [0, 1], { ...clamp, easing: ease });
        const isAccent = accent.some((a) => w.toLowerCase().includes(a.toLowerCase()));
        return (
          <span key={i} style={{ display: "inline-block", overflow: "hidden", paddingBottom: size * 0.12, marginBottom: -size * 0.12 }}>
            <span style={{ display: "inline-block", transform: `translateY(${(1 - p) * 105}%)`, filter: `blur(${(1 - p) * 8}px)`, opacity: p, color: isAccent ? accentColor : undefined }}>{w}</span>
          </span>
        );
      })}
    </div>
  );
};

/** The Skein mark, drawn thread by thread, then the gold knot. */
export const Mark: React.FC<{ size?: number; delay?: number; drawFrames?: number; glow?: boolean }> = ({ size = 220, delay = 0, drawFrames = 34, glow = true }) => {
  const frame = useCurrentFrame();
  const knot = useSpring(delay + drawFrames, { damping: 9, stiffness: 160 });
  const offsets = [-1.6, 0, 1.6];
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" style={{ overflow: "visible", filter: glow ? `drop-shadow(0 0 ${size / 18}px rgba(46,230,200,0.55))` : undefined }}>
      {offsets.map((dx, i) => {
        const p = interpolate(frame - delay - i * 5, [0, drawFrames], [0, 1], { ...clamp, easing: easeInOut });
        return <path key={i} d={THREAD_PATH} transform={`translate(${dx} 0)`} fill="none" stroke={C.thread} strokeWidth={1.6} strokeLinecap="round" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - p} opacity={[0.45, 0.7, 1][i]} />;
      })}
      <circle cx="20.5" cy="22.3" r={2.6 * knot} fill={C.knot} style={{ filter: `drop-shadow(0 0 ${2 * knot}px rgba(242,184,75,0.9))` }} />
    </svg>
  );
};

/** A product window: square-cornered dark chrome with an address bar, holding a screenshot or video. */
export const Browser: React.FC<{ url: string; children: React.ReactNode; width?: number; height?: number; style?: React.CSSProperties }> = ({ url, children, width = 1600, height = 900, style }) => (
  <div style={{ width, height: height + 44, background: C.panel, border: `1px solid ${C.edge}`, boxShadow: "0 40px 120px rgba(0,0,0,0.7), 0 0 0 1px rgba(46,230,200,0.06)", overflow: "hidden", ...style }}>
    <div style={{ height: 44, display: "flex", alignItems: "center", gap: 10, padding: "0 16px", borderBottom: `1px solid ${C.edge}`, background: "#0d0f11" }}>
      {["#ff5d5d", "#f2b84b", "#3ddc84"].map((c) => <div key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c, opacity: 0.8 }} />)}
      <div style={{ marginLeft: 18, flex: 1, height: 28, display: "flex", alignItems: "center", gap: 10, padding: "0 14px", background: C.panel2, border: `1px solid ${C.edge}`, fontFamily: F.mono, fontSize: 16, color: C.muted }}>
        <span style={{ color: C.thread }}>●</span> {url}
      </div>
    </div>
    <div style={{ width, height, position: "relative", overflow: "hidden", background: "#000" }}>{children}</div>
  </div>
);

/** A screenshot with a slow camera move (Ken Burns): [zoom, focusX 0..1, focusY 0..1] to another. */
export const Shot: React.FC<{ src: string; from?: [number, number, number]; to?: [number, number, number]; dur: number; delay?: number; width?: number; height?: number; aspect?: number }> = ({ src, from = [1, 0.5, 0.5], to = [1.08, 0.5, 0.5], dur, delay = 0, width = 1600, height = 900, aspect = 0.5625 }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame - delay, [0, dur], [0, 1], { ...clamp, easing: easeInOut });
  const z = from[0] + (to[0] - from[0]) * p;
  const fx = from[1] + (to[1] - from[1]) * p;
  const fy = from[2] + (to[2] - from[2]) * p;
  const w = width * z, h = w * aspect;
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <Img src={staticFile(src)} style={{ position: "absolute", width: w, height: h, left: -(w - width) * fx, top: -(h - height) * fy }} />
    </div>
  );
};

/** A tall (full-page) screenshot scrolled from one position to another. */
export const Scroll: React.FC<{ src: string; imgH: number; imgW?: number; start: number; end: number; dur: number; delay?: number; width?: number; zoom?: number }> = ({ src, imgH, imgW = 3200, start, end, dur, delay = 0, width = 1600, zoom = 1 }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame - delay, [0, dur], [0, 1], { ...clamp, easing: easeInOut });
  const scale = (width / imgW) * zoom;
  const y = (start + (end - start) * p) * scale;
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <Img src={staticFile(src)} style={{ position: "absolute", width: imgW * scale, height: imgH * scale, left: (width - imgW * scale) / 2, top: -y }} />
    </div>
  );
};

/** Counts up to a value. */
export const Count: React.FC<{ to: number; delay?: number; dur?: number; decimals?: number; prefix?: string; suffix?: string; style?: React.CSSProperties }> = ({ to, delay = 0, dur = 30, decimals = 0, prefix = "", suffix = "", style }) => {
  const frame = useCurrentFrame();
  const v = interpolate(frame - delay, [0, dur], [0, to], { ...clamp, easing: ease });
  return <span style={style}>{prefix}{v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</span>;
};

/** Scene envelope: fades and lifts in, and blurs out at the end. */
export const Envelope: React.FC<{ dur: number; children: React.ReactNode; inFrames?: number; outFrames?: number }> = ({ dur, children, inFrames = 12, outFrames = 10 }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, inFrames, dur - outFrames, dur], [0, 1, 1, 0], clamp);
  const blur = interpolate(frame, [dur - outFrames, dur], [0, 10], clamp);
  const sc = interpolate(frame, [0, inFrames], [1.03, 1], { ...clamp, easing: ease });
  return <AbsoluteFill style={{ opacity: o, filter: blur ? `blur(${blur}px)` : undefined, transform: `scale(${sc})` }}>{children}</AbsoluteFill>;
};

/** A thin teal rule that draws across. */
export const Rule: React.FC<{ delay?: number; width?: number; color?: string }> = ({ delay = 0, width = 600, color = C.thread }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame - delay, [0, 24], [0, 1], { ...clamp, easing: ease });
  return <div style={{ width: width * p, height: 2, background: color, boxShadow: `0 0 18px ${color}` }} />;
};
