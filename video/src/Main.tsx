import React from "react";
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile } from "remotion";
import { Cold, How, MINERS, Problem, Reveal } from "./scenes/Act1";
import { Evidence, Live, Verdict, Verify } from "./scenes/Act2";
import { Bench, Integrate, Miner, Outro, Sniper } from "./scenes/Act3";
import { C, FPS } from "./theme";
import { SceneId, SCENES, TOTAL, said, scene } from "./timeline";
import { Envelope, FontFaces } from "./ui";

const VIEWS: Record<SceneId, React.FC> = { cold: Cold, reveal: Reveal, problem: Problem, how: How, verdict: Verdict, live: Live, evidence: Evidence, verify: Verify, sniper: Sniper, miner: Miner, bench: Bench, integrate: Integrate, outro: Outro };

type Cue = { at: number; sfx: string; vol: number; dur?: number };
const g = (id: SceneId, local: number) => scene(id).from + Math.round(local);
const end = (id: SceneId, before = 10) => scene(id).from + scene(id).dur - before;

function cues(): Cue[] {
  const c: Cue[] = [];
  const add = (at: number, sfx: string, vol: number, dur?: number) => c.push({ at: Math.max(0, Math.round(at)), sfx, vol, dur });
  // Cold open
  add(g("cold", 2), "glitch_intro", 0.45);
  add(g("cold", said("cold", "Most of them")), "glitch_break", 0.5);
  add(g("cold", said("cold", "Most of them") + 26), "glitch_small", 0.35);
  [0, 14, 28].forEach((k) => add(g("cold", said("cold", "If you run") + k), "click_ui", 0.55));
  add(g("cold", said("cold", "Is this token") - 72), "riser", 0.55);
  add(g("cold", said("cold", "Is this token") - 4), "impact_deep", 0.8);
  add(end("cold", 12), "whoosh_fast", 0.7);
  // Reveal
  add(g("reveal", 0), "tunnel_woosh", 0.55);
  add(g("reveal", 6), "sweep_cine", 0.45);
  add(g("reveal", 36), "impact_logo", 0.9);
  add(g("reveal", 36), "bass_rumble", 0.45);
  add(g("reveal", scene("reveal").voFrom + 18), "swoosh_quick", 0.35);
  add(end("reveal", 10), "whoosh_air", 0.5);
  // Problem
  [0, 1, 2, 3, 4].forEach((i) => add(g("problem", 8 + i * 9), "click_cool", 0.32));
  add(g("problem", said("problem", "hours of analyst")), "computing", 0.4);
  add(g("problem", said("problem", "nobody can show")), "glitch_break", 0.55);
  add(g("problem", said("problem", "nobody can show") + 2), "impact_deep", 0.6);
  add(end("problem", 10), "whoosh_fast", 0.55);
  // How it works
  add(g("how", 4), "sweep_tech", 0.4);
  add(g("how", said("how", "Ask it about") - 6), "zoom_in", 0.5);
  MINERS.forEach((m) => add(g("how", said("how", m.cue, -0.3)), "bleep_confirm", 0.45));
  add(g("how", said("how", "Every check is paid")), "coins", 0.55);
  add(g("how", said("how", "Every check is paid") + 22), "money_drop", 0.4);
  add(end("how", 10), "whoosh_air", 0.5);
  // Verdict
  add(g("verdict", 0), "sweep_cine", 0.45);
  add(g("verdict", 32), "impact_deep", 0.45);
  add(g("verdict", said("verdict", "fixed, versioned rules")), "typing", 0.3, 50);
  ["Approve.", "Reject.", "Escalate.", "Or abstain."].forEach((w) => {
    add(g("verdict", said("verdict", w, -0.15)), "impact_deep", 0.45);
    add(g("verdict", said("verdict", w, -0.15)), "click_ui", 0.5);
  });
  add(g("verdict", said("verdict", "With the reasons") - 4), "whoosh_air", 0.5);
  add(g("verdict", said("verdict", "With the reasons") + 4), "zoom_in", 0.35);
  add(end("verdict", 10), "whoosh_fast", 0.5);
  // Live
  add(g("live", 2), "glitch_small", 0.35);
  add(g("live", said("live", "A project applies", -0.6)), "click_ui", 0.55);
  add(g("live", said("live", "A project applies", -0.6) + 6), "typing", 0.45, 110);
  add(g("live", said("live", "A project applies", -0.6) + 118), "click_select", 0.6);
  add(g("live", said("live", "A project applies", -0.6) + 124), "loading", 0.3);
  [0, 1, 2, 3, 4].forEach((i) => add(g("live", said("live", "A project applies", -0.6) + 130 + i * 9), "coins", 0.28));
  add(g("live", said("live", "it decides on its own", -0.4)), "positive", 0.7);
  add(g("live", said("live", "Shortlisted") - 4), "impact_big", 0.5);
  add(end("live", 10), "whoosh_air", 0.5);
  // Evidence
  add(g("evidence", 4), "zoom_in", 0.45);
  [0, 1, 2, 3, 4].forEach((r) => add(g("evidence", 30 + r * 14), "click_cool", 0.28));
  ["the miner", "the receipt hash", "the signal hash", "the price"].forEach((k) => add(g("evidence", said("evidence", k, -0.2)), "bleep_confirm", 0.35));
  add(end("evidence", 10), "whoosh_fast", 0.5);
  // Verify
  add(g("verify", 2), "sweep_tech", 0.4);
  ["The answers", "the policy", "the receipts", "the engine", "the signature"].forEach((k) => add(g("verify", said("verify", k, -0.2)), "confirm", 0.42));
  add(g("verify", said("verify", "All checked")), "positive", 0.6);
  add(end("verify", 10), "whoosh_air", 0.5);
  // Sniper
  add(g("sniper", 0), "bass_pulse", 0.45);
  Array.from({ length: 8 }, (_, i) => add(g("sniper", 30 + i * 22), "click_cool", 0.22));
  add(g("sniper", said("sniper", "Of a hundred")), "computing", 0.4);
  add(g("sniper", said("sniper", "The tokens it skipped") - 4), "glitch_break", 0.4);
  add(g("sniper", said("sniper", "The tokens it skipped")), "impact_deep", 0.6);
  add(end("sniper", 10), "whoosh_fast", 0.5);
  // Miner
  add(g("miner", 2), "sweep_cine", 0.42);
  add(g("miner", 70), "coins", 0.32);
  add(g("miner", said("miner", "single paid request") - 10), "typing", 0.35, 40);
  add(g("miner", said("miner", "No account") - 3), "impact_deep", 0.55);
  add(g("miner", said("miner", "No key") - 3), "impact_deep", 0.55);
  add(end("miner", 10), "whoosh_air", 0.5);
  // Bench
  add(g("bench", 2), "whoosh_air", 0.35);
  add(g("bench", said("bench", "approved none")), "impact_deep", 0.5);
  Array.from({ length: 7 }, (_, i) => add(g("bench", said("bench", "approved none") + i * 3), "click_ui", 0.2));
  add(g("bench", said("bench", "rejected none")), "impact_deep", 0.5);
  Array.from({ length: 13 }, (_, i) => add(g("bench", said("bench", "rejected none") + i * 3), "click_ui", 0.18));
  add(end("bench", 10), "whoosh_fast", 0.5);
  // Integrate
  ["A REST API", "TypeScript", "M C P server", "x four oh two", "Or Telegraph"].forEach((k) => {
    add(g("integrate", said("integrate", k, -0.25)), "swoosh_quick", 0.35);
    add(g("integrate", said("integrate", k, -0.25) + 3), "click_cool", 0.3);
  });
  add(end("integrate", 80), "riser", 0.5);
  // Outro
  add(g("outro", 4), "sweep_cine", 0.45);
  add(g("outro", 34), "impact_logo", 0.95);
  add(g("outro", 34), "bass_rumble", 0.5);
  add(g("outro", said("outro", "Try it today")), "bleep_confirm", 0.45);
  return c;
}
const CUES = cues();

// Music: under the narration from the logo reveal to the end, ducked while the voice speaks.
const VO_SPANS = SCENES.map((s) => [s.from + s.voFrom, s.from + s.voFrom + s.voDur]);
const MUSIC_FROM = scene("reveal").from + 30;
function musicVolume(f: number) {
  const gf = f + MUSIC_FROM;
  let duck = 0;
  for (const [a, b] of VO_SPANS) {
    const d = interpolate(gf, [a - 8, a + 4, b - 2, b + 14], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    duck = Math.max(duck, d);
  }
  const base = 0.42 - duck * 0.28;
  const fadeIn = interpolate(f, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(gf, [TOTAL - 5 * FPS, TOTAL - 10], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return base * fadeIn * fadeOut;
}

export const Main: React.FC = () => (
  <AbsoluteFill style={{ background: C.bg }}>
    <FontFaces />
    {SCENES.map((s) => {
      const View = VIEWS[s.id];
      return (
        <Sequence key={s.id} from={s.from} durationInFrames={s.dur} name={s.id}>
          <Envelope dur={s.dur} inFrames={s.id === "cold" ? 20 : 10} outFrames={s.id === "outro" ? 2 : 10}>
            <View />
          </Envelope>
        </Sequence>
      );
    })}
    {SCENES.map((s) => (
      <Sequence key={`vo-${s.id}`} from={s.from + s.voFrom} durationInFrames={s.voDur + 15} name={`vo ${s.vo}`}>
        <Audio src={staticFile(`vo/${s.vo}n.wav`)} volume={1} />
      </Sequence>
    ))}
    {/* Cold-open bed: wind hum and a heartbeat, before the music arrives. */}
    <Sequence from={0} durationInFrames={scene("reveal").from + 40} name="cold bed">
      <Audio src={staticFile("sfxn/wind_hum.wav")} volume={(f) => interpolate(f, [0, 30, scene("reveal").from, scene("reveal").from + 40], [0, 0.32, 0.32, 0], { extrapolateRight: "clamp" })} />
    </Sequence>
    <Sequence from={0} durationInFrames={scene("reveal").from} name="heartbeat">
      <Audio src={staticFile("sfxn/heartbeat_amb.wav")} loop volume={(f) => interpolate(f, [0, 20, scene("reveal").from - 20, scene("reveal").from], [0, 0.42, 0.55, 0], { extrapolateRight: "clamp" })} />
    </Sequence>
    <Sequence from={MUSIC_FROM} name="music">
      <Audio src={staticFile("music/bed.wav")} volume={musicVolume} />
    </Sequence>
    {CUES.map((q, i) => (
      <Sequence key={`sfx${i}`} from={q.at} durationInFrames={q.dur ?? 9 * FPS} name={`sfx ${q.sfx}`}>
        <Audio src={staticFile(`sfxn/${q.sfx}.wav`)} volume={q.vol} />
      </Sequence>
    ))}
  </AbsoluteFill>
);
