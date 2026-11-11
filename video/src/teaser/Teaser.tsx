import React from "react";
import { AbsoluteFill, Audio, interpolate, random, Sequence, staticFile, useCurrentFrame } from "remotion";
import { C, F, FPS } from "../theme";
import { clamp, ease, easeInOut, FontFaces, Grain, Stripes, Warp } from "../ui";
import sfxMeta from "../../public/v2/sfx-meta.json";
import data from "../v2/data.json";
import { BigMark, Dust, Flash, Glitch, Glow, Mono, Shake, Stamp, ThreadWipe, Type } from "../v2/kit";

/*
 * A wordless 42-second teaser cut to the music. The bed is Mixkit "No Warning"
 * (Michael Ramir C.), 110 BPM, edited on bar lines (public/v2/music/teaser-edit.wav):
 * the breakdown and build under the hook, the drop at the logo, the track's own
 * hard stop under the end card. Every scene starts on a bar; every hit on a beat.
 */
const BEAT = 0.5455, BAR = BEAT * 4;
const DROP = 8.728, END = 39.276;
export const TEASER_FRAMES = Math.round(42.6 * FPS);
/** Frame of beat `k` in bar `n` (bar 0 starts at the drop; negative bars are the intro). */
const at = (n: number, k = 0) => Math.round((DROP + n * BAR + k * BEAT) * FPS);
const META = sfxMeta as Record<string, { dur: number; peak: number }>;

// Real data: live ledger and Sniper counts on Nov 11, 2026, and the two live verdicts.
const LAUNCHES_24H = 1627;
const LEDGER = { verdicts: 312, receipts: 819, miners: 10 };
const LINES = data.approve.lines;
const ROWS = (data.launches as { s: string; rug: boolean }[]);
const CHECK: Record<string, string> = { contract_audit: "CONTRACT AUDIT", holder_count: "HOLDERS", liquidity_depth: "LIQUIDITY", sanctions: "SANCTIONS", wash_trading: "WASH TRADING" };
const short = (h: string, a = 8, b = 4) => `${h.slice(0, a)}…${h.slice(-b)}`;
const p01 = (f: number, a: number, len: number, e = ease) => interpolate(f, [a, a + len], [0, 1], { ...clamp, easing: e });

/* ---------- Scenes ---------- */

/** Hook: the number, then the flood of real launches; the rugs turn red; three words. */
const Hook: React.FC = () => {
  const f = useCurrentFrame();
  const flood = at(-3), flip = at(-2), q = at(-1);
  const words = [["HONEYPOTS.", at(-2, 0)], ["RUG PULLS.", at(-2, 1)], ["SANCTIONED WALLETS.", at(-2, 2)]] as const;
  const cols = 14, rows = 8;
  const gridO = interpolate(f, [flood - 2, flood + 4, q - 4, q + 2], [0, 1, 1, 0.08], clamp);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {/* the counter */}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: interpolate(f, [4, 14, flood - 6, flood], [0, 1, 1, 0], clamp) }}>
        <div style={{ fontFamily: F.display, fontWeight: 300, fontSize: 260, letterSpacing: "-0.07em", color: C.text, lineHeight: 1 }}>
          {Math.round(interpolate(f, [6, flood - 14], [0, LAUNCHES_24H], { ...clamp, easing: ease })).toLocaleString("en-US")}
        </div>
        <Mono size={30} color={C.thread} style={{ marginTop: 18 }}>new tokens launched on Base in the last 24 hours</Mono>
      </AbsoluteFill>
      {/* the wall */}
      <AbsoluteFill style={{ opacity: gridO, padding: 40, display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 10, alignContent: "center", transform: `scale(${1.08 - p01(f, flood, 70, easeInOut) * 0.08})` }}>
        {Array.from({ length: cols * rows }, (_, i) => {
          const L = ROWS[i % ROWS.length]!;
          const born = flood + Math.floor(random(`b${i}`) * 4) * (BEAT * FPS / 2);
          const o = interpolate(f, [born, born + 3], [0, 1], clamp);
          const red = L.rug && f >= flip + Math.floor(random(`r${i}`) * 3) * 4;
          return (
            <div key={i} style={{ opacity: o, height: 98, border: `1px solid ${red ? C.reject : C.edge}`, background: red ? "rgba(255,93,93,0.12)" : "rgba(19,21,24,0.85)", padding: "10px 12px", display: "flex", flexDirection: "column", justifyContent: "space-between", boxShadow: red ? "0 0 22px rgba(255,93,93,0.35)" : undefined }}>
              <div style={{ fontFamily: F.mono, fontSize: 12, color: C.muted }}>BASE · NEW</div>
              <div style={{ fontFamily: F.display, fontSize: 25, fontWeight: 500, color: red ? C.reject : C.text, letterSpacing: "-0.02em" }}>{L.s}</div>
            </div>
          );
        })}
      </AbsoluteFill>
      {/* three words on three beats */}
      <Shake hits={words.map((w) => w[1])} amp={12}>
        {words.map(([w, t], i) => {
          const next = i < 2 ? words[i + 1]![1] : q;
          if (f < t || f >= next) return null;
          return (
            <AbsoluteFill key={w} style={{ alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.55)" }}>
              <Glitch delay={t} len={7}>
                <div style={{ fontFamily: F.display, fontWeight: 500, fontSize: i === 2 ? 150 : 190, letterSpacing: "-0.055em", color: C.reject, transform: `scale(${1.2 - 0.2 * p01(f, t, 6)})` }}>{w}</div>
              </Glitch>
            </AbsoluteFill>
          );
        })}
      </Shake>
      {/* the question, then black */}
      {f >= q && f < at(0) && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: interpolate(f, [at(-1, 3) - 2, at(-1, 3) + 4], [1, 0], clamp) }}>
          <div style={{ fontFamily: F.display, fontWeight: 300, fontSize: 120, letterSpacing: "-0.05em", color: C.text }}>
            <Type text="Which ones are safe to list?" delay={q} cps={34} />
          </div>
        </AbsoluteFill>
      )}
      {words.map(([w, t]) => <Flash key={w} at={t} color={C.reject} peak={0.3} len={8} />)}
      <Grain />
    </AbsoluteFill>
  );
};

/** The drop: warp, the mark draws in one bar, the wordmark lands on the next beat. */
const Reveal: React.FC = () => {
  const f = useCurrentFrame(); // local: 0 = the drop
  const b = (n: number, k = 0) => at(n, k) - at(0);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <AbsoluteFill style={{ opacity: interpolate(f, [0, 4, b(1), b(2)], [0, 1, 0.8, 0.35], clamp) }}>
        <Warp intensity={1.4} speed={interpolate(f, [0, b(1)], [4, 1], clamp)} seed="tz" />
      </AbsoluteFill>
      <Glow color={C.knot} r={interpolate(f, [b(0, 2), b(0, 2) + 20], [150, 900], clamp)} opacity={interpolate(f, [b(0, 2) - 1, b(0, 2) + 3, b(0, 2) + 50], [0, 0.4, 0.1], clamp)} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `translateY(${-p01(f, b(1), 14, easeInOut) * 120}px) scale(${1 - p01(f, b(1), 14, easeInOut) * 0.3})` }}>
        <BigMark size={380} delay={0} draw={Math.round(BEAT * 2 * FPS)} />
        <div style={{ marginTop: 12, fontFamily: F.brand, fontWeight: 500, fontSize: 170, letterSpacing: "-0.06em", color: C.text, opacity: p01(f, b(0, 3), 6), transform: `translateY(${(1 - p01(f, b(0, 3), 8)) * 30}px)` }}>skein</div>
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", paddingBottom: 170 }}>
        <div style={{ display: "flex", gap: 34, fontFamily: F.display, fontWeight: 300, fontSize: 92, letterSpacing: "-0.045em" }}>
          <span style={{ color: C.text, opacity: p01(f, b(1, 0), 6), transform: `translateY(${(1 - p01(f, b(1, 0), 8)) * 40}px)` }}>One request.</span>
          <span style={{ color: C.thread, opacity: p01(f, b(1, 2), 6), transform: `translateY(${(1 - p01(f, b(1, 2), 8)) * 40}px)`, textShadow: `0 0 40px ${C.thread}66` }}>Every thread.</span>
        </div>
      </AbsoluteFill>
      <Flash at={b(0, 2)} color={C.knot} peak={0.35} len={12} />
      <Grain />
    </AbsoluteFill>
  );
};

/** The work: a token arrives, five threads go to five ranked miners, payments out, receipts back. */
const Work: React.FC = () => {
  const f = useCurrentFrame(); // local: 0 = bar 2
  const b = (n: number, k = 0) => at(n, k) - at(2);
  const cx = 960, cy = 520;
  const nodes = LINES.map((l, i) => {
    const ang = [-162, -126, -90, -54, -18].map((d) => (d * Math.PI) / 180)[i]!;
    return { l, x: cx + Math.cos(ang) * 660, y: cy + 90 + Math.sin(ang) * 400 };
  });
  const tokenIn = p01(f, 0, 10);
  const collapse = p01(f, b(3, 2), 8, easeInOut);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Stripes opacity={0.1} />
      <Dust n={50} opacity={0.5} seed="tw" />
      {/* the token arrives and falls into the knot */}
      <div style={{ position: "absolute", left: cx - 330, top: cy + 260 - collapse * 200, width: 660, opacity: tokenIn * (1 - collapse), transform: `scale(${1 - collapse * 0.6})`, border: `1px solid ${C.thread}`, background: "rgba(11,13,15,0.95)", padding: "18px 26px", boxShadow: `0 0 40px ${C.thread}33` }}>
        <Mono size={18} color={C.thread}>Token · Base</Mono>
        <div style={{ fontFamily: F.mono, fontSize: 34, color: C.text, marginTop: 6 }}><Type text="0x940181a9…FD98631" delay={2} cps={40} /></div>
      </div>
      {/* the knot */}
      <div style={{ position: "absolute", left: cx - 80, top: cy - 20 }}>
        <BigMark size={160} delay={b(3, 0)} draw={12} />
      </div>
      {/* threads, payments, receipts */}
      <svg width="1920" height="1080" style={{ position: "absolute" }}>
        {nodes.map((n, i) => {
          const t = b(4, i);
          const p = p01(f, t, 6, easeInOut);
          const pay = interpolate(f, [b(5, 1) + i * 2, b(5, 1) + i * 2 + 10], [0, 1], clamp);
          const back = interpolate(f, [b(6, 0) + i * Math.round(BEAT * FPS / 2), b(6, 0) + i * Math.round(BEAT * FPS / 2) + 10], [0, 1], { ...clamp, easing: easeInOut });
          const sx = cx, sy = cy + 90;
          return (
            <g key={i}>
              <line x1={sx} y1={sy} x2={sx + (n.x - sx) * p} y2={sy + (n.y - sy) * p} stroke={C.thread} strokeWidth={3.5} style={{ filter: `drop-shadow(0 0 10px ${C.thread})` }} />
              {pay > 0 && pay < 1 && <circle cx={sx + (n.x - sx) * pay} cy={sy + (n.y - sy) * pay} r={11} fill={C.knot} style={{ filter: `drop-shadow(0 0 12px ${C.knot})` }} />}
              {back > 0 && back < 1 && <rect x={n.x + (sx - n.x) * back - 9} y={n.y + (sy - n.y) * back - 9} width={18} height={18} fill={C.approve} style={{ filter: `drop-shadow(0 0 12px ${C.approve})` }} />}
            </g>
          );
        })}
      </svg>
      {nodes.map((n, i) => {
        const t = b(4, i);
        const p = p01(f, t + 3, 7);
        const rec = f >= b(6, 0) + i * Math.round(BEAT * FPS / 2) + 10;
        return (
          <div key={i} style={{ position: "absolute", left: n.x - 170, top: n.y - 80, width: 340, opacity: p, transform: `scale(${0.85 + 0.15 * p})`, border: `1px solid ${rec ? C.approve : C.thread}`, background: "rgba(11,13,15,0.95)", padding: "12px 16px", boxShadow: rec ? `0 0 30px ${C.approve}44` : `0 0 26px ${C.thread}22` }}>
            <Mono size={16} color={C.thread}>{CHECK[n.l.check]}</Mono>
            <div style={{ fontFamily: F.display, fontSize: 26, color: C.text, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.l.miner}</div>
            <div style={{ fontFamily: F.mono, fontSize: 16, color: rec ? C.approve : C.knot, marginTop: 4 }}>{rec ? `✓ ${short(n.l.receipt)}` : f >= b(5, 1) ? "$0.010 · escrow" : "ranked miner"}</div>
          </div>
        );
      })}
      {/* captions of the action, on bars */}
      {[
        [b(4, 0), b(5, 0), "Five ranked miners on Telegraph"],
        [b(5, 0), b(6, 0), "Each one paid through the escrow"],
        [b(6, 0), b(7, 0), "Every answer comes back with a receipt"],
      ].map(([a, z, text]) => (
        <AbsoluteFill key={text as string} style={{ alignItems: "center", justifyContent: "flex-end", paddingBottom: 80, opacity: interpolate(f, [(a as number), (a as number) + 5, (z as number) - 4, (z as number)], [0, 1, 1, 0], clamp) }}>
          <div style={{ fontFamily: F.display, fontWeight: 300, fontSize: 64, letterSpacing: "-0.03em", color: C.text }}>{text}</div>
        </AbsoluteFill>
      ))}
      <Grain />
    </AbsoluteFill>
  );
};

/** The decision: rules fuse the answers; four outcomes, two of them real verdicts from today. */
const Decide: React.FC = () => {
  const f = useCurrentFrame(); // local: 0 = bar 6
  const b = (n: number, k = 0) => at(n, k) - at(6);
  const cards = [
    { t: b(7, 0), v: "APPROVE", col: C.approve, a: "Aerodrome (AERO) · Base", z: "5 paid receipts · 5.4 s · signed", rot: -4, x: -430, y: -40 },
    { t: b(7, 2), v: "REJECT", col: C.reject, a: "Lazarus Group · OFAC SDN", z: "exact address match · confidence 100%", rot: 3, x: 430, y: -40 },
    { t: b(8, 0), v: "ESCALATE", col: C.escalate, a: "Conflicting answers", z: "a human makes the call", rot: -2, x: -430, y: 250 },
    { t: b(8, 2), v: "ABSTAIN", col: C.abstain, a: "A required check is missing", z: "never a guess", rot: 2, x: 430, y: 250 },
  ];
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Glow opacity={0.08} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: interpolate(f, [0, 6, b(7, 0) - 6, b(7, 0)], [0, 1, 1, 0], clamp) }}>
        <BigMark size={200} delay={-30} draw={10} />
        <div style={{ fontFamily: F.display, fontWeight: 300, fontSize: 104, letterSpacing: "-0.05em", color: C.text, marginTop: 20 }}>Fixed, versioned rules.</div>
        <Mono size={24} color={C.thread} style={{ marginTop: 14 }}>policy sha-256 locked · same answers, same verdict, every time</Mono>
      </AbsoluteFill>
      <Shake hits={cards.map((c) => c.t)} amp={10}>
        {cards.map((c) => (
          f >= c.t - 1 && (
            <AbsoluteFill key={c.v} style={{ alignItems: "center", justifyContent: "center" }}>
              <div style={{ transform: `translate(${c.x}px, ${c.y - 120}px)`, textAlign: "center" }}>
                <Stamp text={c.v} delay={c.t} color={c.col} size={104} rotate={c.rot} />
                <div style={{ marginTop: 20, opacity: p01(f, c.t + 4, 6) }}>
                  <div style={{ fontFamily: F.display, fontSize: 34, color: C.text }}>{c.a}</div>
                  <Mono size={18} style={{ marginTop: 6 }}>{c.z}</Mono>
                </div>
              </div>
            </AbsoluteFill>
          )
        ))}
      </Shake>
      {cards.map((c) => <Flash key={c.v} at={c.t} color={c.col} peak={0.16} len={8} />)}
      <Grain />
    </AbsoluteFill>
  );
};

/** Proof: the receipts become one Merkle root, signed; anyone can recompute. */
const Proof: React.FC = () => {
  const f = useCurrentFrame(); // local: 0 = bar 9
  const b = (n: number, k = 0) => at(n, k) - at(9);
  const leaves = LINES.map((_, i) => [400 + i * 280, 780] as const);
  const mid = [[540, 610], [1100, 610], [1520, 610]] as const;
  const top = [[820, 440], [1520, 440]] as const;
  const root = [1170, 270] as const;
  const seg = (a: readonly number[], z: readonly number[], t: number, k: string) => {
    const p = p01(f, t, 5);
    return <line key={k} x1={a[0]} y1={a[1]} x2={a[0]! + (z[0]! - a[0]!) * p} y2={a[1]! + (z[1]! - a[1]!) * p} stroke={C.thread} strokeWidth={3} style={{ filter: `drop-shadow(0 0 8px ${C.thread})` }} />;
  };
  const checks = ["Answers re-read", "Policy rerun", "Receipts re-rooted", "Engine matched", "Signature checked"];
  const stage2 = f >= b(10, 0);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Dust n={30} opacity={0.4} seed="pf" />
      <AbsoluteFill style={{ opacity: interpolate(f, [b(10, 0) - 4, b(10, 0) + 2], [1, 0], clamp) }}>
        <svg width="1920" height="1080" style={{ position: "absolute" }}>
          {leaves.map((l, i) => seg(l, mid[Math.min(2, Math.floor(i / 2))]!, b(9, 1) + i * 2, `l${i}`))}
          {seg(mid[0], top[0], b(9, 2), "m0")}{seg(mid[1], top[0], b(9, 2), "m1")}{seg(mid[2], top[1], b(9, 2), "m2")}
          {seg(top[0], root, b(9, 3), "t0")}{seg(top[1], root, b(9, 3), "t1")}
          {leaves.map((l, i) => <rect key={`r${i}`} x={l[0] - 11} y={l[1] - 11} width={22} height={22} fill={C.approve} opacity={p01(f, i * 3, 4)} />)}
          <circle cx={root[0]} cy={root[1]} r={26 * p01(f, b(9, 3) + 5, 5)} fill={C.knot} style={{ filter: `drop-shadow(0 0 24px ${C.knot})` }} />
        </svg>
        {LINES.map((l, i) => <div key={i} style={{ position: "absolute", left: leaves[i]![0] - 120, top: 812, width: 240, textAlign: "center", fontFamily: F.mono, fontSize: 19, color: C.approve, opacity: p01(f, i * 3, 4) }}>{short(l.receipt, 6, 4)}</div>)}
        <div style={{ position: "absolute", left: root[0] + 50, top: root[1] - 30, opacity: p01(f, b(9, 3) + 6, 5) }}>
          <Mono size={20} color={C.knot}>Merkle root · bill of materials</Mono>
          <div style={{ fontFamily: F.mono, fontSize: 30, color: C.text }}>{short(data.approve.bomRoot, 12, 8)}</div>
        </div>
        <div style={{ position: "absolute", left: 140, top: 140 }}>
          {f >= b(9, 3) + 8 && <Stamp text="SIGNED" delay={b(9, 3) + 8} color={C.thread} size={88} rotate={-5} />}
        </div>
      </AbsoluteFill>
      {stage2 && (
        <AbsoluteFill style={{ padding: "150px 420px" }}>
          <div style={{ fontFamily: F.display, fontWeight: 300, fontSize: 92, letterSpacing: "-0.05em", color: C.text, opacity: p01(f, b(10, 0), 6) }}>Don't trust. Recompute.</div>
          <div style={{ marginTop: 40 }}>
            {checks.map((c, i) => {
              const t = b(10, 0) + Math.round(i * BEAT * FPS * 0.75) + 8;
              const ok = f >= t;
              return (
                <div key={c} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", borderBottom: `1px solid ${C.edge}`, opacity: 0.3 + 0.7 * p01(f, t - 4, 5) }}>
                  <div style={{ fontFamily: F.display, fontSize: 46, color: C.text }}>{c}</div>
                  <div style={{ width: 54, height: 54, border: `2px solid ${ok ? C.approve : C.edge}`, background: ok ? "rgba(61,220,132,0.15)" : undefined, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34, color: C.approve, boxShadow: ok ? `0 0 20px ${C.approve}66` : undefined }}>{ok ? "✓" : ""}</div>
                </div>
              );
            })}
          </div>
        </AbsoluteFill>
      )}
      <Grain />
    </AbsoluteFill>
  );
};

/** Results: out of sample, then the live ledger. */
const Results: React.FC = () => {
  const f = useCurrentFrame(); // local: 0 = bar 11
  const b = (n: number, k = 0) => at(n, k) - at(11);
  const s2 = f >= b(12, 0);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Glow color={C.thread} opacity={s2 ? 0.06 : interpolate(f, [0, 10, 40], [0.35, 0.18, 0.1], clamp)} />
      {!s2 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <Mono size={26} color={C.text}>Bad launches Skein approved</Mono>
          <div style={{ fontFamily: F.display, fontWeight: 300, fontSize: 380, letterSpacing: "-0.07em", color: C.thread, lineHeight: 0.95, textShadow: `0 0 90px ${C.thread}88`, transform: `scale(${1.25 - 0.25 * p01(f, 0, 6)})` }}>0</div>
          <Mono size={24} style={{ marginTop: 10 }}>of 27 · labelled 72 hours later · out of sample</Mono>
        </AbsoluteFill>
      )}
      {s2 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 140 }}>
          {[
            [LEDGER.verdicts, "verdicts sealed", 0],
            [LEDGER.receipts, "paid receipts", 1],
            [LEDGER.miners, "Telegraph miners", 2],
          ].map(([v, label, i]) => {
            const t = b(12, i as number);
            return (
              <div key={label as string} style={{ textAlign: "center", opacity: p01(f, t - 2, 5), transform: `translateY(${(1 - p01(f, t - 2, 8)) * 40}px)` }}>
                <div style={{ fontFamily: F.display, fontWeight: 300, fontSize: 170, letterSpacing: "-0.06em", color: i === 1 ? C.knot : C.text, lineHeight: 1 }}>{Math.round(interpolate(f, [t, t + 14], [0, v as number], { ...clamp, easing: ease }))}</div>
                <Mono size={24} style={{ marginTop: 10 }}>{label}</Mono>
              </div>
            );
          })}
        </AbsoluteFill>
      )}
      <Flash at={0} color={C.thread} peak={0.35} len={12} />
      <Grain />
    </AbsoluteFill>
  );
};

/** The final build and the end card on the track's last hit. */
const Finale: React.FC = () => {
  const f = useCurrentFrame(); // local: 0 = bar 13
  const b = (n: number, k = 0) => at(n, k) - at(13);
  const hit = b(14, 0);
  const end = TEASER_FRAMES - at(13);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {f < hit && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <Stripes opacity={interpolate(f, [0, hit], [0.1, 0.45], clamp)} />
          <div style={{ display: "flex", gap: 40, fontFamily: F.display, fontWeight: 400, fontSize: 140, letterSpacing: "-0.055em" }}>
            <span style={{ color: C.text, opacity: p01(f, b(13, 0), 4) }}>One request.</span>
            <span style={{ color: C.thread, opacity: p01(f, b(13, 2), 4), textShadow: `0 0 50px ${C.thread}88` }}>Every thread.</span>
          </div>
        </AbsoluteFill>
      )}
      {f >= hit && (
        <AbsoluteFill style={{ opacity: interpolate(f, [end - 20, end - 2], [1, 0], clamp) }}>
          <Warp intensity={0.6} speed={0.5} seed="tf" />
          <AbsoluteFill style={{ background: "radial-gradient(circle at 50% 45%, rgba(0,0,0,0.1) 0, rgba(0,0,0,0.85) 62%)" }} />
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingBottom: 120, transform: `scale(${1.12 - 0.12 * p01(f, hit, 10)})` }}>
            <BigMark size={280} delay={hit - 6} draw={6} />
            <div style={{ fontFamily: F.brand, fontWeight: 500, fontSize: 150, letterSpacing: "-0.06em", color: C.text, marginTop: 6 }}>skein</div>
            <div style={{ fontFamily: F.display, fontWeight: 300, fontSize: 44, color: C.muted, marginTop: 6, letterSpacing: "-0.02em" }}>The listing verdict for any token.</div>
          </AbsoluteFill>
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", paddingBottom: 150 }}>
            <div style={{ fontFamily: F.display, fontSize: 46, color: C.ink, background: C.thread, padding: "12px 38px", boxShadow: `0 0 60px ${C.thread}88`, opacity: p01(f, hit + 6, 6) }}>skeinlabs.site</div>
            <div style={{ marginTop: 26, opacity: p01(f, hit + 14, 8) }}><Mono size={20}>Built on Telegraph · npm i @skeinlabs/sdk</Mono></div>
          </AbsoluteFill>
        </AbsoluteFill>
      )}
      <Flash at={hit} color="#ffffff" peak={0.6} len={14} />
      <Grain />
    </AbsoluteFill>
  );
};

/* ---------- Sound ---------- */
type Cue = { from: number; sfx: string; vol: number; len: number };
const CUES: Cue[] = [];
function hit(frame: number, sfx: string, vol: number, mode: "peak" | "start" = "peak", maxS = 4) {
  const m = META[sfx];
  if (!m) throw new Error(`no sfx ${sfx}`);
  const from = mode === "peak" ? Math.round(frame - m.peak * FPS) : frame;
  CUES.push({ from: Math.max(0, from), sfx, vol, len: Math.ceil(Math.min(m.dur, Math.max(maxS, m.peak + 1.2)) * FPS) });
}
// hook
hit(2, "sweep_tech", 0.35, "start");
hit(6, "tech_calc", 0.3, "start");
for (let k = 0; k < 4; k++) hit(at(-3, k), "ui_click", 0.3, "start");
hit(at(-3, 0), "ui_zoom_long", 0.4);
hit(at(-2, 0) - 2, "glitch_static", 0.2, "start");
for (const [k, s] of [[0, "impact_trailer"], [1, "impact_heart"], [2, "impact_big"]] as const) { hit(at(-2, k), s, 0.5); hit(at(-2, k), "glitch_cine", 0.25, "start"); }
for (let i = 0; i < 12; i++) hit(at(-1) + 2 + i * 3, "keyclick", 0.1 + random(`kc${i}`) * 0.06, "start");
hit(at(0), "riser_trailer", 0.7);
hit(at(0), "hit_reverse", 0.5);
// drop
hit(at(0), "trailer_whoosh_impact", 0.7);
hit(at(0, 2), "impact_logo", 0.9);
hit(at(0, 2), "bass_rumble", 0.5);
hit(at(1, 0), "swoosh_accent", 0.35);
hit(at(1, 2), "whoosh_cine", 0.35);
// work
hit(at(2), "laser_swoosh", 0.35);
for (let i = 0; i < 10; i++) hit(at(2) + 2 + i * 2, "keyclick", 0.1, "start");
hit(at(3, 0), "ui_zoom_in", 0.35);
hit(at(3, 2), "whoosh_rocket", 0.35);
for (let i = 0; i < 5; i++) { hit(at(4, i), "sweep_fast", 0.45, "start"); hit(at(4, i) + 4, "tech_bleep", 0.18, "start"); }
for (let i = 0; i < 5; i++) hit(at(5, 1) + i * 2, "coins", 0.2, "start");
hit(at(5, 1) + 10, "coin_drop", 0.4);
for (let i = 0; i < 5; i++) hit(at(6, 0) + i * Math.round(BEAT * FPS / 2) + 10, "tech_confirm", 0.35, "start");
// decide
hit(at(6), "whoosh_hit", 0.5);
hit(at(6), "brass_transition", 0.3, "start");
hit(at(7, 0), "impact_epic", 0.8); hit(at(7, 0), "positive", 0.45, "start");
hit(at(7, 2), "impact_big", 0.85); hit(at(7, 2), "reject_tone", 0.45, "start");
hit(at(8, 0), "impact_heart", 0.7); hit(at(8, 0), "tech_alert", 0.35, "start");
hit(at(8, 2), "impact_heart", 0.6); hit(at(8, 2), "ui_zoom_out", 0.3, "start");
// proof
hit(at(9), "sweep_metal", 0.4, "start");
for (let i = 0; i < 5; i++) hit(at(9) + i * 3, "ui_click", 0.25, "start");
hit(at(9, 3) + 5, "impact_deep", 0.55);
hit(at(9, 3) + 8, "shutter", 0.6);
hit(at(10, 0), "whoosh_cine", 0.4);
for (let i = 0; i < 5; i++) hit(at(10, 0) + Math.round(i * BEAT * FPS * 0.75) + 8, "tech_confirm", 0.4, "start");
// results
hit(at(11), "impact_logo", 0.85);
hit(at(11), "impact_waves", 0.45);
for (let i = 0; i < 3; i++) hit(at(12, i), "impact_heart", 0.45);
// finale
hit(at(13, 0), "drum_hit", 0.6);
hit(at(13, 2), "drum_hit", 0.6);
hit(at(14, 0), "riser_drama", 0.5);
hit(at(14, 0), "impact_logo", 1.0);
hit(at(14, 0), "deep_impact2", 0.7);
hit(at(14, 0), "bass_rumble", 0.5);
hit(at(14, 0) + 8, "hit_glass", 0.25, "start");

/* ---------- The teaser ---------- */
const SCENES: { from: number; to: number; C: React.FC }[] = [
  { from: 0, to: at(0), C: Hook },
  { from: at(0), to: at(2), C: Reveal },
  { from: at(2), to: at(6), C: Work },
  { from: at(6), to: at(9), C: Decide },
  { from: at(9), to: at(11), C: Proof },
  { from: at(11), to: at(13), C: Results },
  { from: at(13), to: TEASER_FRAMES, C: Finale },
];

export const Teaser: React.FC = () => (
  <AbsoluteFill style={{ background: C.bg }}>
    <FontFaces />
    {SCENES.map((s, i) => (
      <Sequence key={i} from={s.from} durationInFrames={s.to - s.from}>
        <s.C />
      </Sequence>
    ))}
    {[at(2), at(6), at(9)].map((m, i) => <ThreadWipe key={i} mid={m} len={12} dir={i % 2 ? -1 : 1} />)}
    <Audio src={staticFile("v2/music/teaser-edit.wav")} volume={(f) => interpolate(f, [0, 8, TEASER_FRAMES - 30, TEASER_FRAMES], [0.85, 0.85, 0.85, 0], clamp)} />
    {CUES.map((q, i) => (
      <Sequence key={`s${i}`} from={q.from} durationInFrames={q.len}>
        <Audio src={staticFile(`v2/sfxn/${q.sfx}.wav`)} volume={(fr) => q.vol * 0.7 * interpolate(fr, [q.len - 12, q.len], [1, 0], clamp)} />
      </Sequence>
    ))}
  </AbsoluteFill>
);
