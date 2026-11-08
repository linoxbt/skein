// Narration with Kokoro-82M (voice af_heart) via kokoro-js; one WAV per line, plus durations.json.
import { KokoroTTS } from "kokoro-js";
import { readFileSync, writeFileSync } from "node:fs";
const lines = JSON.parse(readFileSync(new URL("./script.json", import.meta.url), "utf8"));
const only = process.argv.slice(2);
const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "fp32", device: "cpu" });
const durations = (() => { try { return JSON.parse(readFileSync("public/vo/durations.json", "utf8")); } catch { return {}; } })();
for (const l of lines) {
  if (only.length && !only.includes(l.id)) continue;
  const audio = await tts.generate(l.text, { voice: "af_heart", speed: 1.0 });
  audio.save(`public/vo/${l.id}.wav`);
  durations[l.id] = audio.audio.length / audio.sampling_rate;
  console.log(l.id, durations[l.id].toFixed(2) + "s");
}
writeFileSync("public/vo/durations.json", JSON.stringify(durations, null, 2));
