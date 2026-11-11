import React from "react";
import { AbsoluteFill, Audio, interpolate, random, Sequence, staticFile, useCurrentFrame } from "remotion";
import { C, FPS } from "../theme";
import { clamp, FontFaces } from "../ui";
import sfxMeta from "../../public/v2/sfx-meta.json";
import data from "./data.json";
import { Cold, Decide, How, Problem, Reveal } from "./actA";
import { Bom, Desk, Sanction, Verify } from "./actB";
import { Bench, Integrate, Outro, Prod, Sniper } from "./actC";
import { Captions, ThreadWipe } from "./kit";
import { at, atG, SceneId, SCENES, scene, TOTAL } from "./tl";

const VIEWS: Record<SceneId, React.FC> = { cold: Cold, reveal: Reveal, problem: Problem, how: How, decide: Decide, desk: Desk, sanction: Sanction, bom: Bom, verify: Verify, sniper: Sniper, bench: Bench, prod: Prod, integrate: Integrate, outro: Outro };
const WIPES: SceneId[] = ["problem", "how", "desk", "bom", "sniper", "prod", "outro"];
const META = sfxMeta as Record<string, { dur: number; peak: number }>;

/* ---------- Sound design ---------- */
type Cue = { from: number; sfx: string; vol: number; len: number };
const CUES: Cue[] = [];
/** Places an effect so its loudest moment lands on `frame` (a hit), or so it starts there (`start`). */
function hit(frame: number, sfx: string, vol: number, mode: "peak" | "start" = "peak") {
  const m = META[sfx];
  if (!m) throw new Error(`no sfx ${sfx}`);
  const from = mode === "peak" ? Math.round(frame - m.peak * FPS) : Math.round(frame);
  // Long effects (ambiences, loops, long tails) are cut 1.5 s after their peak (at least 4 s) and faded, so they never linger under the narration.
  const cap = Math.max(4, m.peak + 1.5);
  CUES.push({ from: Math.max(0, from), sfx, vol, len: Math.ceil(Math.min(m.dur, cap) * FPS) + 2 });
}
const G = (id: SceneId, local: number) => scene(id).from + Math.round(local);
const end = (id: SceneId, before = 6) => scene(id).from + scene(id).dur - before;
const keys = (from: number, to: number, vol = 0.14, seed = "k") => {
  for (let f = from, i = 0; f < to; i++) { hit(f, "keyclick", vol * (0.7 + random(`${seed}${i}`) * 0.6), "start"); f += 2 + Math.floor(random(`${seed}g${i}`) * 3); }
};

// 1 Cold open
hit(G("cold", 2), "sweep_tech", 0.35, "start");
hit(atG("cold", "thousands"), "ui_zoom_long", 0.4);
hit(atG("cold", "thousands") + 4, "tech_calc", 0.3, "start");
for (let i = 0; i < 9; i++) hit(atG("cold", "thousands") + 4 + i * 4, "ui_click", 0.12 + random(`cc${i}`) * 0.08, "start");
hit(atG("cold", "honest"), "positive", 0.22);
hit(atG("cold", "traps"), "glitch_static", 0.18, "start");
hit(atG("cold", "traps"), "reject_tone", 0.3);
for (const [w, imp, gl] of [["honeypots", "impact_trailer", "glitch_cine"], ["liquidity", "impact_waves", "glitch_quick"], ["wallets", "impact_big", "glitch_electric"]] as const) {
  hit(atG("cold", w) - 3, "whoosh_cine", 0.4);
  hit(atG("cold", w) - 3, imp, 0.7);
  hit(atG("cold", w) + 6, gl, 0.3, "start");
}
hit(end("cold", 2), "whoosh_rocket", 0.55);
// 2 Reveal
const KNOT = scene("reveal").from + 50;
hit(scene("reveal").from, "whoosh_tunnel", 0.5, "start");
hit(scene("reveal").from + 2, "sweep_cine", 0.4, "start");
hit(KNOT, "riser_trailer", 0.65);
hit(KNOT, "impact_logo", 1.0);
hit(KNOT, "bass_rumble", 0.5);
hit(KNOT + 2, "hit_glass", 0.22, "start");
hit(atG("reveal", "one"), "swoosh_accent", 0.32);
for (const w of ["Ethereum", "base", "BNB", "arbitrum"]) hit(atG("reveal", w) - 2, "ui_select", 0.3);
hit(atG("reveal", "bought"), "impact_deep", 0.45);
hit(atG("reveal", "fused"), "impact_deep", 0.45);
hit(atG("reveal", "proven"), "impact_epic", 0.6);
// 3 Problem
for (let i = 0; i < 5; i++) hit(atG("problem", "five") + i * 4, "ui_open", 0.22, "start");
hit(atG("problem", "scores"), "tech_bleep", 0.22, "start");
hit(atG("problem", "invoices"), "coin_drop", 0.4);
hit(atG("problem", "analyst"), "tech_loading", 0.16, "start");
hit(atG("problem", "slow"), "glitch_quick", 0.3);
hit(atG("problem", "expensive"), "coins", 0.38);
hit(atG("problem", "nobody") - 2, "glitch_break", 0.5);
hit(atG("problem", "nobody"), "impact_suspense", 0.55);
// 4 How it works
hit(scene("how").from + 2, "sweep_future", 0.35, "start");
hit(atG("how", "asks"), "ui_start", 0.4);
hit(atG("how", "plans"), "tech_calc", 0.32, "start");
hit(atG("how", "miner"), "ui_zoom_in", 0.35);
for (const w of ["Contract", "Sanctions", "Holders", "Liquidity", "Wash"]) {
  hit(atG("how", w) - 6, "whoosh_cine", 0.28, "start");
  hit(atG("how", w) + 2, "coins", 0.12, "start");
  hit(atG("how", w) + 30, "tech_confirm", 0.32, "start");
}
hit(atG("how", "escrow"), "coin_drop", 0.4);
hit(atG("how", "receipt"), "positive", 0.35);
// 5 Decide
keys(scene("decide").from + 10, scene("decide").from + 60, 0.12, "dk");
hit(atG("decide", "four"), "whoosh_swirl", 0.35);
const DEC: [string, string, number][] = [["Approve", "positive", 0.4], ["reject", "reject_tone", 0.42], ["escalate", "tech_alert", 0.35], ["abstain", "ui_zoom_out", 0.32]];
for (const [w, tone, v] of DEC) { hit(atG("decide", w), "impact_heart", 0.65); hit(atG("decide", w), tone, v, "start"); }
hit(atG("decide", "Never"), "impact_epic", 0.6);
hit(atG("decide", "Never"), "brass_hum", 0.18, "start");
// 6 Desk (live)
hit(scene("desk").from + 2, "glitch_intro", 0.3, "start");
keys(G("desk", 0.64 * FPS), G("desk", 1.6 * FPS), 0.14, "d1");
keys(G("desk", 1.97 * FPS), G("desk", 3.8 * FPS), 0.13, "d2");
hit(G("desk", 4.0 * FPS), "ui_click", 0.45, "start");
hit(atG("desk", "buys") - 4, "whoosh_cine", 0.4);
hit(atG("desk", "buys"), "tech_loading", 0.14, "start");
{
  const segB = at("desk", "buys") - 4, tRec = at("desk", "Five");
  for (const l of data.approve.lines) { const t = scene("desk").from + segB + 12 + (l.ms / 5447) * (tRec - segB - 6); hit(t, "tech_confirm", 0.3, "start"); hit(t, "coins", 0.1, "start"); }
}
hit(atG("desk", "Five"), "ui_box", 0.4);
hit(atG("desk", "Five", { nth: 1 }), "tech_bleep", 0.28, "start");
hit(atG("desk", "Five", { nth: 2 }), "coin_drop", 0.45);
hit(atG("desk", "Approved") - 8, "whoosh_impact", 0.45);
hit(atG("desk", "Approved"), "impact_epic", 0.7);
hit(atG("desk", "Approved"), "positive", 0.5, "start");
// 7 Sanction (live)
hit(scene("sanction").from + 2, "tech_alert", 0.32, "start");
hit(scene("sanction").from + 2, "bass_pulse", 0.25, "start");
keys(G("sanction", 0.88 * FPS), G("sanction", 2.9 * FPS), 0.13, "s1");
keys(G("sanction", 2.76 * FPS), G("sanction", 3.5 * FPS), 0.1, "s2");
hit(G("sanction", 4.04 * FPS), "ui_click", 0.45, "start");
hit(atG("sanction", "Lazarus"), "glitch_cine", 0.45, "start");
hit(atG("sanction", "Lazarus"), "reject_tone", 0.3);
hit(atG("sanction", "checks") - 2, "sweep_metal", 0.4, "start");
hit(atG("sanction", "checks"), "tech_loading", 0.16, "start");
hit(atG("sanction", "match") - 3, "impact_trailer", 0.62);
hit(atG("sanction", "match") + 8, "glitch_electric", 0.25, "start");
hit(atG("sanction", "rejected"), "impact_big", 0.8);
hit(atG("sanction", "rejected"), "device_fail", 0.22, "start");
hit(atG("sanction", "evidence"), "ui_open", 0.35, "start");
// 8 BOM
for (let i = 0; i < 5; i++) hit(scene("bom").from + 4 + i * 4, "ui_click", 0.2, "start");
for (const w of ["minor", "cost", "receipt", "signal"]) hit(atG("bom", w), "tech_bleep", 0.2, "start");
hit(atG("bom", "Merkel") - 10, "sweep_tech", 0.35, "start");
hit(atG("bom", "Merkel") + 8, "impact_deep", 0.55);
hit(atG("bom", "signed") - 3, "shutter", 0.55);
hit(atG("bom", "signed") - 3, "impact_heart", 0.45);
// 9 Verify
keys(atG("verify", "Paste"), atG("verify", "Paste") + 26, 0.13, "v1");
hit(atG("verify", "replays"), "ui_zoom_long", 0.3);
for (const [w, n] of [["answers", 1], ["policy", 0], ["receipts", 0], ["engine", 0], ["signature", 0]] as const) { hit(atG("verify", w, { nth: n }) + 2, "tech_confirm", 0.42, "start"); hit(atG("verify", w, { nth: n }) + 2, "ui_box", 0.18, "start"); }
hit(atG("verify", "Every"), "impact_epic", 0.6);
hit(atG("verify", "Every"), "correct", 0.4, "start");
// 10 Sniper
hit(scene("sniper").from + 2, "sweep_future", 0.35, "start");
hit(atG("sniper", "watches"), "bass_pulse", 0.25, "start");
for (let i = 0; i < 6; i++) hit(atG("sniper", "watches") + i * 9, "tech_bleep", 0.08, "start");
hit(atG("sniper", "buys"), "ui_click", 0.4, "start");
hit(atG("sniper", "backtest") - 6, "whoosh_cine", 0.4);
hit(atG("sniper", "backtest"), "ui_zoom_in", 0.3);
hit(atG("sniper", "zero"), "glitch_static", 0.22, "start");
hit(atG("sniper", "22"), "impact_deep", 0.6);
hit(atG("sniper", "hard") - 2, "impact_trailer", 0.85);
hit(atG("sniper", "hard") - 2, "reject_tone", 0.3, "start");
keys(atG("sniper", "hard") + 6, atG("sniper", "hard") + 40, 0.1, "sn");
// 11 Bench — the music drops away, then the climax hits on "approved"
hit(scene("bench").from + 2, "sweep_tech", 0.3, "start");
hit(atG("bench", "72") - 6, "ui_zoom_long", 0.3, "start");
for (let i = 0; i < 8; i++) hit(atG("bench", "40") - 10 + i * 3, "ui_click", 0.1, "start");
hit(atG("bench", "27"), "glitch_quick", 0.3);
hit(atG("bench", "27"), "bass_rumble", 0.35);
hit(atG("bench", "approved"), "hit_reverse", 0.55);
hit(atG("bench", "approved"), "impact_logo", 0.9);
hit(atG("bench", "approved"), "impact_waves", 0.5);
hit(atG("bench", "Simpler") - 4, "whoosh_swirl", 0.35);
for (let i = 0; i < 3; i++) hit(atG("bench", "Simpler") + i * 6, "sweep_fast", 0.3, "start");
// 12 Production
for (const w of ["two", "hard", "probe", "nightly", "public"]) { hit(atG("prod", w) - 3, "impact_heart", 0.35); hit(atG("prod", w) - 3, "ui_start", 0.25, "start"); }
hit(atG("prod", "pages") - 2, "tech_notif", 0.45);
// 13 Integrate
for (const w of ["rest", "TypeScript", "MCP", "X402", "ask"]) { hit(atG("integrate", w) - 6, "whoosh_cine", 0.3, "start"); keys(atG("integrate", w), atG("integrate", w) + 22, 0.08, w); }
hit(end("integrate", 0), "riser_trailer", 0.55);
// 14 Outro
hit(scene("outro").from, "whoosh_tunnel", 0.5, "start");
hit(scene("outro").from + 34, "impact_logo", 0.9);
hit(scene("outro").from + 34, "bass_rumble", 0.45);
hit(atG("outro", "one"), "swoosh_accent", 0.3);
hit(atG("outro", "Try"), "positive", 0.35);
// transitions
for (const id of WIPES) { hit(scene(id).from - 3, "sweep_cine", 0.35, "start"); }

/* ---------- Music: Mixkit "We Will Get It" (Eugenio Mininni), edited so its break lands on the bench reveal ---------- */
const CLIMAX_IN_TRACK = 183.85; // seconds into the track where the final section re-enters after its break
const MUSIC_START = atG("bench", "approved") - Math.round(CLIMAX_IN_TRACK * FPS); // film frame where track t=0 would be
const VO_ON: number[] = (() => {
  const on = new Array<number>(TOTAL + 1).fill(0);
  for (const s of SCENES) for (let f = s.from + s.voFrom - 6; f < s.from + s.voFrom + s.voDur + 6; f++) if (f >= 0 && f <= TOTAL) on[f] = 1;
  // smooth over ~0.4 s so the duck breathes
  const k = 12, out = on.map((_, i) => { let a = 0, n = 0; for (let j = i - k; j <= i + k; j++) if (j >= 0 && j <= TOTAL) { a += on[j]!; n++; } return a / n; });
  return out;
})();
const musicVol = (f: number) => {
  const g = f; // frame within the film (the Sequence starts at 0)
  const duck = 0.55 - 0.43 * (VO_ON[g] ?? 0); // about -14 dB under the narration
  const fadeIn = interpolate(g, [0, 2 * FPS], [0, 1], clamp);
  const fadeOut = interpolate(g, [TOTAL - 4 * FPS, TOTAL - 6], [1, 0], clamp);
  const lift = g >= atG("bench", "approved") && g < atG("bench", "approved") + 2 * FPS ? 1.25 : 1;
  return duck * fadeIn * fadeOut * lift;
};

/* ---------- The film ---------- */
const Scene: React.FC<{ id: SceneId }> = ({ id }) => {
  const frame = useCurrentFrame();
  const s = scene(id);
  const View = VIEWS[id];
  const o = interpolate(frame, [0, 6, s.dur - 6, s.dur], [0, 1, 1, 0], clamp);
  return <AbsoluteFill style={{ opacity: id === "cold" ? 1 : o }}><View /></AbsoluteFill>;
};

export const Film: React.FC = () => (
  <AbsoluteFill style={{ background: C.bg }}>
    <FontFaces />
    {SCENES.map((s) => (
      <Sequence key={s.id} from={s.from} durationInFrames={s.dur} name={s.id}>
        <Scene id={s.id} />
      </Sequence>
    ))}
    {WIPES.map((id) => <ThreadWipe key={id} mid={scene(id).from} len={18} dir={id === "how" || id === "bom" || id === "prod" ? -1 : 1} />)}
    <Captions />
    {/* narration */}
    {SCENES.map((s) => (
      <Sequence key={`vo-${s.id}`} from={s.from + s.voFrom} durationInFrames={s.voDur + 15} name={`vo ${s.vo}`}>
        <Audio src={staticFile(`v2/vo/${s.vo}n.wav`)} volume={1} />
      </Sequence>
    ))}
    {/* cold-open bed: a heartbeat and wind until the music arrives */}
    <Sequence from={0} durationInFrames={scene("reveal").from + 30} name="cold bed">
      <Audio src={staticFile("v2/sfxn/heartbeat.wav")} volume={(f) => interpolate(f, [0, 15, scene("reveal").from - 10, scene("reveal").from + 30], [0, 0.24, 0.3, 0], clamp)} />
      <Audio src={staticFile("v2/sfxn/wind_hum.wav")} volume={(f) => interpolate(f, [0, 20, 140, 170], [0, 0.18, 0.18, 0], clamp)} />
    </Sequence>
    {/* the music */}
    <Sequence from={Math.max(0, MUSIC_START)} name="music">
      <Audio src={staticFile("v2/music/bed.wav")} startFrom={Math.max(0, -MUSIC_START)} volume={(f) => musicVol(f + Math.max(0, MUSIC_START))} />
    </Sequence>
    {/* effects */}
    {CUES.map((q, i) => (
      <Sequence key={`sfx${i}`} from={q.from} durationInFrames={q.len} name={`sfx ${q.sfx}`}>
        {/* an effect that peaks while she is speaking sits about 4 dB lower, so it accents the word instead of masking it */}
        <Audio src={staticFile(`v2/sfxn/${q.sfx}.wav`)} volume={(f) => q.vol * 0.74 * ((VO_ON[q.from + Math.round((META[q.sfx]?.peak ?? 0) * FPS)] ?? 0) > 0.5 ? 0.36 : 1) * interpolate(f, [q.len - 15, q.len - 2], [1, 0], clamp)} />
      </Sequence>
    ))}
  </AbsoluteFill>
);
export const FILM_FRAMES = TOTAL;
