// Film v2 narration: Kokoro-82M, voice af_heart; one WAV per line plus durations.json in public/v2/vo.
import { KokoroTTS } from "kokoro-js";
import { readFileSync, writeFileSync } from "node:fs";
const lines = JSON.parse(readFileSync(new URL("./script-v2.json", import.meta.url), "utf8"));
const only = process.argv.slice(2);
const out = "public/v2/vo";
const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "fp32", device: "cpu" });
const durations = (() => { try { return JSON.parse(readFileSync(`${out}/durations.json`, "utf8")); } catch { return {}; } })();
for (const l of lines) {
  if (only.length && !only.includes(l.id)) continue;
  const audio = await tts.generate(l.text, { voice: "af_heart", speed: 0.98 });
  audio.save(`${out}/${l.id}.wav`);
  durations[l.id] = audio.audio.length / audio.sampling_rate;
  console.log(l.id, durations[l.id].toFixed(2) + "s");
}
writeFileSync(`${out}/durations.json`, JSON.stringify(durations, null, 2));
