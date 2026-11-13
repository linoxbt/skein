import React from "react";
import { AbsoluteFill, Img, interpolate, OffthreadVideo, random, staticFile, useCurrentFrame } from "remotion";
import { C, F, THREAD_PATH } from "../theme";
import { clamp, ease, easeInOut, useSpring } from "../ui";
import { FPS } from "../theme";
import { SCENES } from "./tl";

/** A 3D stage: the child tilts and dollies between two camera poses over `dur` frames. */
export const Stage3D: React.FC<{
  children: React.ReactNode; dur: number; delay?: number;
  from?: { rx?: number; ry?: number; rz?: number; z?: number; x?: number; y?: number; s?: number };
  to?: { rx?: number; ry?: number; rz?: number; z?: number; x?: number; y?: number; s?: number };
  perspective?: number; style?: React.CSSProperties;
}> = ({ children, dur, delay = 0, from = {}, to = {}, perspective = 2200, style }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame - delay, [0, dur], [0, 1], { ...clamp, easing: easeInOut });
  const v = (k: keyof typeof from, d: number) => (from[k] ?? d) + ((to[k] ?? from[k] ?? d) - (from[k] ?? d)) * p;
  return (
    <AbsoluteFill style={{ perspective, alignItems: "center", justifyContent: "center", ...style }}>
      <div style={{ transformStyle: "preserve-3d", transform: `translate3d(${v("x", 0)}px, ${v("y", 0)}px, ${v("z", 0)}px) rotateX(${v("rx", 0)}deg) rotateY(${v("ry", 0)}deg) rotateZ(${v("rz", 0)}deg) scale(${v("s", 1)})` }}>{children}</div>
    </AbsoluteFill>
  );
};

/** A recorded clip, from `start` seconds, optionally sped up. */
export const Clip: React.FC<{ src: string; start?: number; rate?: number; width?: number; height?: number; style?: React.CSSProperties }> = ({ src, start = 0, rate = 1, width = 1600, height = 900, style }) => (
  <OffthreadVideo src={staticFile(src)} startFrom={Math.round(start * FPS)} playbackRate={rate} muted style={{ width, height, objectFit: "cover", ...style }} />
);

/** Product window chrome around a screenshot or clip. */
export const Win: React.FC<{ url: string; children: React.ReactNode; width?: number; height?: number; live?: boolean; style?: React.CSSProperties }> = ({ url, children, width = 1600, height = 900, live, style }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ width, height: height + 46, background: C.panel, border: `1px solid ${C.edge}`, boxShadow: "0 60px 160px rgba(0,0,0,0.85), 0 0 0 1px rgba(46,230,200,0.08), 0 0 120px rgba(46,230,200,0.06)", overflow: "hidden", ...style }}>
      <div style={{ height: 46, display: "flex", alignItems: "center", gap: 10, padding: "0 16px", borderBottom: `1px solid ${C.edge}`, background: "#0b0d0f" }}>
        {["#ff5d5d", "#f2b84b", "#3ddc84"].map((c) => <div key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c, opacity: 0.75 }} />)}
        <div style={{ marginLeft: 18, flex: 1, height: 28, display: "flex", alignItems: "center", gap: 10, padding: "0 14px", background: C.panel2, border: `1px solid ${C.edge}`, fontFamily: F.mono, fontSize: 16, color: C.muted }}>
          <span style={{ color: C.thread }}>●</span> {url}
        </div>
        {live && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: F.mono, fontSize: 15, letterSpacing: "0.12em", color: C.reject }}>
            <span style={{ width: 10, height: 10, borderRadius: 5, background: C.reject, opacity: 0.5 + 0.5 * Math.sin(frame / 5) }} /> LIVE
          </div>
        )}
      </div>
      <div style={{ width, height, position: "relative", overflow: "hidden", background: "#000" }}>{children}</div>
    </div>
  );
};

/** A static screenshot that fills its box, with a slow push. */
export const Pic: React.FC<{ src: string; dur: number; delay?: number; from?: [number, number, number]; to?: [number, number, number]; width?: number; height?: number; aspect?: number }> = ({ src, dur, delay = 0, from = [1, 0.5, 0.5], to = [1.06, 0.5, 0.5], width = 1600, height = 900, aspect = 0.5625 }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame - delay, [0, dur], [0, 1], { ...clamp, easing: easeInOut });
  const z = from[0] + (to[0] - from[0]) * p, fx = from[1] + (to[1] - from[1]) * p, fy = from[2] + (to[2] - from[2]) * p;
  const w = width * z, h = w * aspect;
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <Img src={staticFile(src)} style={{ position: "absolute", width: w, height: h, left: -(w - width) * fx, top: -(h - height) * fy }} />
    </div>
  );
};

/** A highlight box drawn around a region, with a label. Coordinates are in the parent's pixels. */
export const Callout: React.FC<{ x: number; y: number; w: number; h: number; label?: string; delay: number; color?: string; side?: "top" | "bottom" | "right" | "left"; out?: number }> = ({ x, y, w, h, label, delay, color = C.thread, side = "top", out }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame - delay, [0, 16], [0, 1], { ...clamp, easing: ease });
  const o = out === undefined ? 1 : interpolate(frame, [out, out + 10], [1, 0], clamp);
  const per = 2 * (w + h);
  const lab = useSpring(delay + 8);
  const pos: React.CSSProperties = side === "top" ? { left: x, top: y - 52 } : side === "bottom" ? { left: x, top: y + h + 12 } : side === "right" ? { left: x + w + 16, top: y } : { right: 1920 - x + 16, top: y };
  return (
    <>
      <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible", opacity: o }} width={1} height={1}>
        <rect x={x} y={y} width={w} height={h} fill={`${color}14`} stroke={color} strokeWidth={3} strokeDasharray={per} strokeDashoffset={per * (1 - p)} style={{ filter: `drop-shadow(0 0 10px ${color})` }} />
      </svg>
      {label && (
        <div style={{ position: "absolute", ...pos, opacity: lab * o, transform: `translateY(${(1 - lab) * 10}px)`, fontFamily: F.mono, fontSize: 22, letterSpacing: "0.06em", color: C.ink, background: color, padding: "8px 14px", whiteSpace: "nowrap" }}>{label}</div>
      )}
    </>
  );
};

/** A rubber stamp that slams in. */
export const Stamp: React.FC<{ text: string; delay: number; color: string; size?: number; rotate?: number; style?: React.CSSProperties }> = ({ text, delay, color, size = 120, rotate = -6, style }) => {
  const frame = useCurrentFrame();
  const t = frame - delay;
  const s = interpolate(t, [0, 5, 9], [2.4, 0.94, 1], { ...clamp, easing: ease });
  const o = interpolate(t, [0, 3], [0, 1], clamp);
  return (
    <div style={{ display: "inline-block", fontFamily: F.display, fontWeight: 500, fontSize: size, letterSpacing: "-0.03em", color, border: `${size / 18}px solid ${color}`, padding: `${size * 0.08}px ${size * 0.25}px`, transform: `rotate(${rotate}deg) scale(${s})`, opacity: o, textShadow: `0 0 ${size / 4}px ${color}66`, boxShadow: `0 0 ${size / 2}px ${color}33, inset 0 0 ${size / 3}px ${color}22`, background: "rgba(0,0,0,0.35)", ...style }}>{text}</div>
  );
};

/** Text with an RGB split that jitters for `len` frames after `delay`. */
export const Glitch: React.FC<{ children: React.ReactNode; delay: number; len?: number; style?: React.CSSProperties }> = ({ children, delay, len = 10, style }) => {
  const frame = useCurrentFrame();
  const t = frame - delay;
  const on = t >= 0 && t < len;
  const j = (k: string) => (on ? (random(`${k}${frame}`) - 0.5) * 26 : 0);
  return (
    <div style={{ position: "relative", ...style }}>
      {on && <div style={{ position: "absolute", inset: 0, color: "#ff2a6d", transform: `translate(${j("a")}px, ${j("b") / 3}px)`, mixBlendMode: "screen", opacity: 0.8 }}>{children}</div>}
      {on && <div style={{ position: "absolute", inset: 0, color: C.thread, transform: `translate(${j("c")}px, ${j("d") / 3}px)`, mixBlendMode: "screen", opacity: 0.8 }}>{children}</div>}
      <div style={{ position: "relative", transform: on ? `translateX(${j("e") / 2}px) skewX(${j("f") / 6}deg)` : undefined }}>{children}</div>
    </div>
  );
};

/** A full-frame flash on an impact. */
export const Flash: React.FC<{ at: number; color?: string; peak?: number; len?: number }> = ({ at, color = "#ffffff", peak = 0.5, len = 10 }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame - at, [0, 1, len], [0, peak, 0], clamp);
  return o > 0 ? <AbsoluteFill style={{ background: color, opacity: o, mixBlendMode: "screen", pointerEvents: "none" }} /> : null;
};

/** Shakes its children after each hit, decaying. */
export const Shake: React.FC<{ hits: number[]; amp?: number; children: React.ReactNode }> = ({ hits, amp = 14, children }) => {
  const frame = useCurrentFrame();
  let dx = 0, dy = 0;
  for (const h of hits) {
    const t = frame - h;
    if (t < 0 || t > 14) continue;
    const k = amp * Math.exp(-t / 4);
    dx += (random(`x${h}${frame}`) - 0.5) * 2 * k;
    dy += (random(`y${h}${frame}`) - 0.5) * 2 * k;
  }
  return <AbsoluteFill style={{ transform: `translate(${dx}px, ${dy}px)` }}>{children}</AbsoluteFill>;
};

/** The brand transition: teal threads sweep across the frame, covering the cut at `mid`. */
export const ThreadWipe: React.FC<{ mid: number; len?: number; dir?: 1 | -1 }> = ({ mid, len = 16, dir = 1 }) => {
  const frame = useCurrentFrame();
  const t = (frame - (mid - len / 2)) / len;
  if (t < 0 || t > 1) return null;
  const lines = Array.from({ length: 22 }, (_, i) => {
    const y = (i / 22) * 1080 + random(`ty${i}`) * 40;
    const delay = random(`td${i}`) * 0.3;
    const p = Math.min(1, Math.max(0, (t - delay) / 0.7));
    const x = dir === 1 ? -600 + p * 3200 : 2520 - p * 3200;
    const h = 6 + random(`th${i}`) * 46;
    const col = random(`tc${i}`) > 0.75 ? C.knot : random(`tc2${i}`) > 0.5 ? C.thread : C.threadDeep;
    return <div key={i} style={{ position: "absolute", top: y, left: x, width: 900, height: h, background: `linear-gradient(${dir === 1 ? 90 : 270}deg, rgba(0,0,0,0), ${col} 60%, #fff)`, opacity: 0.9, filter: "blur(1px)" }} />;
  });
  const cover = interpolate(t, [0.25, 0.5, 0.75], [0, 1, 0], clamp);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {lines}
      <AbsoluteFill style={{ background: "#000", opacity: cover * 0.9 }} />
    </AbsoluteFill>
  );
};

/** Drifting teal particles at three depths. */
export const Dust: React.FC<{ n?: number; opacity?: number; seed?: string }> = ({ n = 60, opacity = 0.6, seed = "d" }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ opacity, pointerEvents: "none" }}>
      {Array.from({ length: n }, (_, i) => {
        const z = random(`${seed}z${i}`);
        const x = (random(`${seed}x${i}`) * 2200 + frame * (0.2 + z * 0.9)) % 2200 - 140;
        const y = (random(`${seed}y${i}`) * 1200 - frame * (0.1 + z * 0.4) + 1200 * 4) % 1200 - 60;
        const r = 1.2 + z * 4;
        return <div key={i} style={{ position: "absolute", left: x, top: y, width: r * 2, height: r * 2, borderRadius: r, background: z > 0.85 ? C.knot : C.thread, opacity: 0.15 + z * 0.55, filter: `blur(${(1 - z) * 2.5}px)` }} />;
      })}
    </AbsoluteFill>
  );
};

/** A soft coloured light. */
export const Glow: React.FC<{ x?: number; y?: number; r?: number; color?: string; opacity?: number }> = ({ x = 960, y = 540, r = 700, color = C.thread, opacity = 0.18 }) => (
  <AbsoluteFill style={{ background: `radial-gradient(circle at ${x}px ${y}px, ${color} 0, rgba(0,0,0,0) ${r}px)`, opacity, pointerEvents: "none" }} />
);

/** Mono label. */
export const Mono: React.FC<{ children: React.ReactNode; size?: number; color?: string; style?: React.CSSProperties }> = ({ children, size = 22, color = C.muted, style }) => (
  <div style={{ fontFamily: F.mono, fontSize: size, letterSpacing: "0.08em", textTransform: "uppercase", color, ...style }}>{children}</div>
);

/** Types text out from `delay`, `cps` characters a second, with a block cursor. */
export const Type: React.FC<{ text: string; delay: number; cps?: number; style?: React.CSSProperties; cursor?: boolean }> = ({ text, delay, cps = 40, style, cursor = true }) => {
  const frame = useCurrentFrame();
  const n = Math.max(0, Math.floor(((frame - delay) / FPS) * cps));
  const done = n >= text.length;
  return (
    <span style={{ whiteSpace: "pre", ...style }}>
      {text.slice(0, n)}
      {cursor && !done && frame >= delay && <span style={{ background: C.thread, color: C.thread }}>▌</span>}
    </span>
  );
};

/** The Skein mark at any size, drawn from `delay`. */
export const BigMark: React.FC<{ size: number; delay: number; draw?: number }> = ({ size, delay, draw = 40 }) => {
  const frame = useCurrentFrame();
  const knot = useSpring(delay + draw, { damping: 8, stiffness: 170 });
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" style={{ overflow: "visible", filter: `drop-shadow(0 0 ${size / 16}px rgba(46,230,200,0.6))` }}>
      {[-1.6, 0, 1.6].map((dx, i) => {
        const p = interpolate(frame - delay - i * 6, [0, draw], [0, 1], { ...clamp, easing: easeInOut });
        return <path key={i} d={THREAD_PATH} transform={`translate(${dx} 0)`} fill="none" stroke={C.thread} strokeWidth={1.6} strokeLinecap="round" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - p} opacity={[0.45, 0.7, 1][i]} />;
      })}
      <circle cx="20.5" cy="22.3" r={2.6 * knot} fill={C.knot} style={{ filter: `drop-shadow(0 0 ${3 * knot}px rgba(242,184,75,0.95))` }} />
    </svg>
  );
};

/** A code card with a title bar and lightly tinted code, typed out. */
export const CodeCard: React.FC<{ title: string; code: string; delay: number; width?: number; cps?: number; accent?: string }> = ({ title, code, delay, width = 760, cps = 90, accent = C.thread }) => {
  const s = useSpring(delay, { damping: 16 });
  return (
    <div style={{ width, background: "rgba(11,13,15,0.96)", border: `1px solid ${C.edge}`, boxShadow: `0 40px 100px rgba(0,0,0,0.7), 0 0 0 1px ${accent}22`, opacity: s, transform: `translateY(${(1 - s) * 40}px) scale(${0.96 + s * 0.04})` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: `1px solid ${C.edge}`, fontFamily: F.mono, fontSize: 18, letterSpacing: "0.08em", textTransform: "uppercase", color: accent }}>
        <span>[ → ]</span><span style={{ color: C.text }}>{title}</span>
      </div>
      <pre style={{ margin: 0, padding: "18px 22px", fontFamily: F.mono, fontSize: 21, lineHeight: 1.55, color: "#c9d3d9", minHeight: 40 }}>
        <Type text={code} delay={delay + 6} cps={cps} />
      </pre>
    </div>
  );
};

/** Burned-in captions: the narration in short phrases, word-timed. */
const FIX: Record<string, string> = { scane: "Skein", skane: "Skein", skein: "Skein", scan: "Skein", minor: "miner", merkel: "Merkle", route: "root", claud: "Claude", x402: "x402", "-drome": "drome", base: "Base", arbitrum: "Arbitrum", telegraph: "Telegraph", exchanges: "exchange's", api: "API", sdk: "SDK", mcp: "MCP" };
type Line = { from: number; to: number; text: string };
const LINES: Line[] = (() => {
  const out: Line[] = [];
  for (const s of SCENES) {
    let cur: { w: string; s: number; e: number }[] = [];
    const flush = () => {
      if (!cur.length) return;
      let text = cur.map((w) => w.w).join(" ");
      text = text.replace(/\baero -drome\b/i, "Aerodrome").replace(/U \.S\./g, "US").replace(/addressed by address/i, "address by address").replace(/skeinlabs \.site/i, "skeinlabs.site").replace(/Merkel route/i, "Merkle root").replace(/best -ranked/i, "best-ranked").replace(/\brest call\b/i, "REST call");
      text = text.split(" ").map((w) => { const k = w.toLowerCase().replace(/[^a-z0-9-]/g, ""); const fix = FIX[k]; return fix ? w.replace(new RegExp(k, "i"), fix) : w; }).join(" ");
      out.push({ from: s.from + s.voFrom + Math.round(cur[0]!.s * FPS), to: s.from + s.voFrom + Math.round(cur[cur.length - 1]!.e * FPS) + 6, text });
      cur = [];
    };
    for (const w of s.words) {
      cur.push(w);
      const len = cur.map((x) => x.w).join(" ").length;
      if (/[.,?!]$/.test(w.w) && len > 18) flush();
      else if (len > 46) flush();
    }
    flush();
  }
  for (let i = 0; i < out.length - 1; i++) out[i]!.to = Math.min(out[i]!.to, out[i + 1]!.from);
  return out;
})();

export const Captions: React.FC = () => {
  const frame = useCurrentFrame();
  const l = LINES.find((x) => frame >= x.from && frame < x.to);
  if (!l) return null;
  const o = interpolate(frame, [l.from, l.from + 4, l.to - 4, l.to], [0, 1, 1, 0], clamp);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 46, pointerEvents: "none" }}>
      <div style={{ opacity: o, fontFamily: F.display, fontSize: 34, fontWeight: 400, letterSpacing: "-0.01em", color: "#ffffff", background: "rgba(0,0,0,0.62)", padding: "10px 22px", maxWidth: 1400, textAlign: "center", textShadow: "0 2px 8px rgba(0,0,0,0.6)" }}>{l.text.replace(/^\w/, (c) => c.toUpperCase())}</div>
    </AbsoluteFill>
  );
};
