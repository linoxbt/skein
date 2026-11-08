import React from "react";
import { AbsoluteFill, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion";
import live from "../live.json";
import { C, F } from "../theme";
import { said, scene } from "../timeline";
import { Browser, clamp, ease, Grain, Mark, Shot, Stripes, Tag, useSpring, Words } from "../ui";

const VERDICTS = [
  { w: "APPROVE", c: C.approve, cue: "Approve." },
  { w: "REJECT", c: C.reject, cue: "Reject." },
  { w: "ESCALATE", c: C.escalate, cue: "Escalate." },
  { w: "ABSTAIN", c: C.abstain, cue: "Or abstain." },
];
const RULES = [
  ["contract_audit", "FAIL", "→ REJECT"],
  ["required check", "UNAVAILABLE", "→ ABSTAIN"],
  ["confidence", "< 0.55", "→ ESCALATE"],
  ["all required", "PASS", "→ APPROVE"],
];

/** 4. Threads fuse under fixed rules into one of four verdicts, with reasons and cost. */
export const Verdict: React.FC = () => {
  const frame = useCurrentFrame();
  const tRules = said("verdict", "fixed, versioned rules");
  const tReasons = said("verdict", "With the reasons");
  const fuse = interpolate(frame, [0, 40], [0, 1], { ...clamp, easing: ease });
  const words = interpolate(frame, [tReasons - 8, tReasons + 10], [1, 0], clamp);
  const card = useSpring(tReasons, { damping: 16 });
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <svg width="1920" height="1080" style={{ position: "absolute", opacity: words }}>
        {[0, 1, 2, 3, 4].map((i) => {
          const y0 = 140 + i * 200;
          return <path key={i} d={`M0,${y0} C600,${y0} 700,300 960,300`} fill="none" stroke={C.thread} strokeWidth={2.5} pathLength={1} strokeDasharray="1" strokeDashoffset={1 - fuse} opacity={0.75} />;
        })}
        <circle cx={960} cy={300} r={18 * fuse} fill={C.knot} style={{ filter: "drop-shadow(0 0 18px rgba(242,184,75,0.9))" }} />
      </svg>
      <div style={{ position: "absolute", right: 120, top: 120, opacity: words * interpolate(frame, [tRules, tRules + 12], [0, 1], clamp) }}>
        <Tag>Policy dex-list@0.2.0 · locked</Tag>
        <div style={{ marginTop: 18, fontFamily: F.mono, fontSize: 24, lineHeight: 1.8 }}>
          {RULES.map((r, i) => {
            const p = interpolate(frame, [tRules + 6 + i * 6, tRules + 18 + i * 6], [0, 1], clamp);
            return (
              <div key={i} style={{ opacity: p, transform: `translateX(${(1 - p) * 30}px)` }}>
                <span style={{ color: C.muted }}>{r[0]}</span> <span style={{ color: C.text }}>{r[1]}</span> <span style={{ color: C.thread }}>{r[2]}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ position: "absolute", left: 120, right: 120, top: 470, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 28, opacity: words }}>
        {VERDICTS.map((v) => {
          const t = said("verdict", v.cue, -0.15);
          const p = useSpring(t, { damping: 11, stiffness: 170 });
          const flash = interpolate(frame, [t, t + 4, t + 16], [0, 1, 0], clamp);
          return (
            <div key={v.w} style={{ border: `1px solid ${v.c}`, padding: "40px 24px", textAlign: "center", opacity: p, transform: `translateY(${(1 - p) * 60}px)`, background: `rgba(0,0,0,0.6)`, boxShadow: `0 0 ${20 + flash * 80}px ${v.c}55` }}>
              <div style={{ fontFamily: F.display, fontSize: 82, letterSpacing: "-0.05em", color: v.c }}>{v.w}</div>
            </div>
          );
        })}
      </div>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: card }}>
        <div style={{ transform: `translateY(${(1 - card) * 120}px) scale(${0.92 + card * 0.08})` }}>
          <Browser url="skeinlabs.site/v/vrd_mw8dfz384v6a6v094n03" width={1520} height={855}>
            <Shot src="shots/web-verdict-approve-full.jpg" aspect={6816 / 3200} width={1520} height={855} from={[1, 0.5, 0]} to={[1, 0.5, 0.42]} dur={scene("verdict").dur - tReasons} delay={tReasons + 10} />
          </Browser>
        </div>
      </AbsoluteFill>
      <Grain />
    </AbsoluteFill>
  );
};

type Mark2 = { marker?: string; t: number; file?: string };
const LF = (live as { frames: Mark2[] }).frames;
const t0 = LF.find((f) => f.file)!.t;
const at = (m: string) => (LF.find((f) => f.marker === m)?.t ?? t0) - t0;

/** 5. Live: an exchange's listing desk, run by an agent, buys a verdict and decides. */
export const Live: React.FC = () => {
  const frame = useCurrentFrame();
  const s = scene("live");
  const tApplies = said("live", "A project applies", -0.6);
  const tDecides = said("live", "it decides on its own", -0.4);
  const tShort = said("live", "Shortlisted");
  // Clip: typing and submit at normal speed, then the wait compressed so the decision lands on "it decides".
  const typeFrom = at("type-project") - 0.3;
  const submitAt = at("submit");
  const decidedAt = at("decided");
  const seg1 = Math.round((submitAt - typeFrom + 0.4) * 30);
  const waitFrames = Math.max(20, tDecides - (tApplies + seg1));
  const rate2 = Math.max(1, ((decidedAt - submitAt - 0.4) * 30) / waitFrames);
  const decidedLocal = tApplies + seg1 + waitFrames;
  const waiting = frame > tApplies + seg1 && frame < decidedLocal;
  const elapsed = interpolate(frame, [tApplies + seg1, decidedLocal], [0, 5.8], clamp); // vrd_mw8dfz384v6a6v094n03: durationMs 5817
  const stamp = useSpring(tShort - 4, { damping: 10, stiffness: 180 });
  const checks = ["Contract audit", "Sanctions", "Holders", "Liquidity", "Wash trading"];
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Stripes opacity={0.35} />
      <div style={{ position: "absolute", left: 80, top: 56, display: "flex", gap: 18, alignItems: "center" }}>
        <div style={{ width: 16, height: 16, borderRadius: 8, background: C.reject, opacity: 0.5 + 0.5 * Math.sin(frame / 5), boxShadow: `0 0 16px ${C.reject}` }} />
        <div style={{ fontFamily: F.mono, fontSize: 24, color: C.text, letterSpacing: "0.12em" }}>LIVE · TELEGRAPH TESTNET · DESK.SKEINLABS.SITE</div>
      </div>
      <div style={{ position: "absolute", left: 80, top: 120 }}>
        <Browser url={frame < tApplies ? "desk.skeinlabs.site" : frame < decidedLocal ? "desk.skeinlabs.site/apply" : "desk.skeinlabs.site/a/app_…"} width={1280} height={720}>
          {frame < tApplies + 2 && <Shot src="shots/desk-home.jpg" width={1280} height={720} from={[1.34, 0.0, 0.0]} to={[1.48, 0.05, 0.04]} dur={tApplies} />}
          <Sequence from={tApplies} durationInFrames={seg1}>
            <OffthreadVideo src={staticFile("clips/desk-live.mp4")} startFrom={Math.round(typeFrom * 30)} style={{ width: 1280, height: 720 }} muted />
          </Sequence>
          <Sequence from={tApplies + seg1} durationInFrames={waitFrames}>
            <OffthreadVideo src={staticFile("clips/desk-live.mp4")} startFrom={Math.round((submitAt + 0.1) * 30)} playbackRate={rate2} style={{ width: 1280, height: 720 }} muted />
          </Sequence>
          <Sequence from={decidedLocal}>
            <OffthreadVideo src={staticFile("clips/desk-live.mp4")} startFrom={Math.round((decidedAt - 0.2) * 30)} style={{ width: 1280, height: 720 }} muted />
          </Sequence>
        </Browser>
      </div>
      <div style={{ position: "absolute", left: 1420, top: 150, width: 420 }}>
        <Tag delay={tApplies + seg1 - 10} color={C.knot}>Verdict time</Tag>
        <div style={{ fontFamily: F.mono, fontSize: 96, color: waiting ? C.knot : C.thread, marginTop: 18, opacity: interpolate(frame, [tApplies + seg1 - 4, tApplies + seg1 + 6], [0, 1], clamp) }}>{elapsed.toFixed(1)}s</div>
        <div style={{ marginTop: 26, display: "flex", flexDirection: "column", gap: 14 }}>
          {checks.map((c, i) => {
            const t = tApplies + seg1 + 6 + i * Math.max(4, Math.floor(waitFrames / 6));
            const p = useSpring(t, { damping: 15 });
            return (
              <div key={c} style={{ opacity: p, transform: `translateX(${(1 - p) * 30}px)`, display: "flex", justifyContent: "space-between", fontFamily: F.mono, fontSize: 24, color: C.text, borderBottom: `1px solid ${C.edge}`, paddingBottom: 10 }}>
                <span>{c}</span>
                <span style={{ color: C.knot }}>$0.010 ✓</span>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ position: "absolute", left: 1400, top: 760, opacity: stamp, transform: `rotate(-5deg) scale(${2 - stamp})`, border: `4px solid ${C.approve}`, color: C.approve, fontFamily: F.mono, fontSize: 64, letterSpacing: "0.1em", padding: "12px 30px", background: "rgba(0,0,0,0.7)", boxShadow: `0 0 50px ${C.approve}55` }}>SHORTLISTED</div>
      <Grain />
      {frame < 1 && <div />}
      {s.dur < 0 && <div />}
    </AbsoluteFill>
  );
};

/** 6. The bill of materials: every purchase with its receipt and signal. */
export const Evidence: React.FC = () => {
  const frame = useCurrentFrame();
  const s = scene("evidence");
  const rows = [0, 1, 2, 3, 4];
  const callouts = [
    { label: "Miner that answered", x: 330, cue: "the miner" },
    { label: "Receipt hash", x: 820, cue: "the receipt hash" },
    { label: "Signal hash on the node", x: 1060, cue: "the signal hash" },
    { label: "Price", x: 1205, cue: "the price" },
  ];
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <div style={{ position: "absolute", left: 80, top: 60 }}>
        <Tag>Bill of materials · 5 receipts</Tag>
      </div>
      <div style={{ position: "absolute", left: 160, top: 130 }}>
        <Browser url="skeinlabs.site/v/vrd_mw8dfz384v6a6v094n03 · Evidence" width={1600} height={900}>
          <Shot src="shots/web-verdict-evidence-crop.jpg" width={1600} height={900} from={[1.0, 0.0, 0.5]} to={[1.3, 0.12, 0.5]} dur={s.dur * 0.8} delay={10} />
          {rows.map((r) => {
            const t = 30 + r * 14;
            const o = interpolate(frame, [t, t + 6, t + 26], [0, 0.55, 0.12], clamp);
            const prog = interpolate(frame, [10, 10 + s.dur * 0.8], [0, 1], clamp);
            const z = 1 + 0.3 * prog;
            const y = (388 + r * 32.5) * z - 450 * (z - 1);
            return <div key={r} style={{ position: "absolute", left: 0, right: 0, top: y, height: 30 * z, background: `linear-gradient(90deg, rgba(46,230,200,${o}) 0%, rgba(46,230,200,0) 80%)` }} />;
          })}
        </Browser>
      </div>
      <div style={{ position: "absolute", left: 160, right: 160, bottom: 46, display: "flex", gap: 22, justifyContent: "center" }}>
        {callouts.map((c) => {
          const p = useSpring(said("evidence", c.cue, -0.2), { damping: 14 });
          return <div key={c.label} style={{ opacity: p, transform: `translateY(${(1 - p) * 20}px)`, fontFamily: F.mono, fontSize: 22, color: C.text, background: "rgba(19,21,24,0.92)", border: `1px solid ${C.thread}`, padding: "10px 18px" }}><span style={{ color: C.thread }}>● </span>{c.label}</div>;
        })}
      </div>
      <Grain />
    </AbsoluteFill>
  );
};

const STEPS = [
  { t: "Answers re-read", d: "Each paid answer re-read by the adapter version recorded with it.", cue: "The answers" },
  { t: "Policy rerun", d: "The decision table rerun on those findings: same decision, same hash.", cue: "the policy" },
  { t: "Receipts re-rooted", d: "The bill-of-materials Merkle root rebuilt from every receipt.", cue: "the receipts" },
  { t: "Engine matched", d: "The engine version is the one that made the verdict.", cue: "the engine" },
  { t: "Signature checked", d: "Skein's EIP-191 signature recovers to its published address.", cue: "the signature" },
];

/** 7. Don't trust: recompute. */
export const Verify: React.FC = () => {
  const frame = useCurrentFrame();
  const tAll = said("verify", "All checked");
  const done = interpolate(frame, [tAll, tAll + 14], [0, 1], { ...clamp, easing: ease });
  return (
    <AbsoluteFill style={{ background: C.paper }}>
      <div style={{ position: "absolute", left: 110, top: 150, width: 720 }}>
        <Tag light delay={4} color={C.threadDeep}>Verify</Tag>
        <div style={{ height: 30 }} />
        <Words text="Don't trust." delay={8} size={130} color={C.ink} />
        <Words text="Recompute." delay={22} size={130} color={C.threadDeep} />
        <div style={{ marginTop: 60, opacity: done, transform: `translateY(${(1 - done) * 20}px)`, fontFamily: F.display, fontSize: 64, letterSpacing: "-0.04em", color: C.threadDeep }}>Every step matches.</div>
      </div>
      <div style={{ position: "absolute", left: 900, top: 150, width: 900 }}>
        {STEPS.map((st) => {
          const t = said("verify", st.cue, -0.2);
          const p = useSpring(t - 10, { damping: 16 });
          const tick = useSpring(t, { damping: 9, stiffness: 200 });
          return (
            <div key={st.t} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `2px dashed ${C.rule}`, padding: "26px 0", opacity: 0.25 + 0.75 * p }}>
              <div>
                <div style={{ fontFamily: F.display, fontSize: 52, letterSpacing: "-0.04em", color: C.ink }}>{st.t}</div>
                <div style={{ fontFamily: F.display, fontSize: 22, color: C.ink2, marginTop: 4 }}>{st.d}</div>
              </div>
              <div style={{ width: 78, height: 78, background: C.threadDeep, display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${tick})`, boxShadow: `0 0 ${tick * 30}px rgba(8,117,101,0.5)` }}>
                <svg width="40" height="40" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="square" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - tick} /></svg>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 110, bottom: 80, display: "flex", alignItems: "center", gap: 16, opacity: done }}>
        <Mark size={54} delay={tAll} drawFrames={14} glow={false} />
        <div style={{ fontFamily: F.mono, fontSize: 22, color: C.ink2 }}>POST /v1/verify {"{"}"id": "vrd_mw8dfz384v6a6v094n03"{"}"}</div>
      </div>
    </AbsoluteFill>
  );
};
