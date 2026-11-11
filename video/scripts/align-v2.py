# Word timings for the v2 narration (faster-whisper, base.en), written to public/v2/vo/words.json.
import json, subprocess, sys
import numpy as np
from faster_whisper import WhisperModel
m = WhisperModel("base.en", device="cpu", compute_type="int8")
ids = json.load(open("public/v2/vo/durations.json")).keys()
out = {}
for i in sorted(ids):
    pcm = subprocess.run(["ffmpeg", "-v", "error", "-i", f"public/v2/vo/{i}.wav", "-f", "f32le", "-ac", "1", "-ar", "16000", "-"], capture_output=True, check=True).stdout
    segs, _ = m.transcribe(np.frombuffer(pcm, np.float32), word_timestamps=True, language="en", beam_size=5)
    words = [{"w": w.word.strip(), "s": round(w.start, 3), "e": round(w.end, 3)} for s in segs for w in s.words]
    out[i] = words
    print(i, " ".join(x["w"] for x in words))
json.dump(out, open("public/v2/vo/words.json", "w"), indent=1)
