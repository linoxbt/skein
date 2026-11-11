# Film v2: encodes a live recording's screencast frames into public/v2/clips/<name>-live.mp4 at their real timing.
#   python3 capture/v2-clip.py console|desk
import json, subprocess, sys
w = sys.argv[1]
d = json.load(open(f'capture/v2/live-{w}.json')); fr = d['frames']
lines = []
for a, b in zip(fr, fr[1:] + [None]):
    dur = (b['t'] - a['t']) if b else 1.0
    lines.append(f"file '{a['file'].split('/')[-1]}'\nduration {max(dur, 0.001):.4f}")
lines.append(f"file '{fr[-1]['file'].split('/')[-1]}'")
folder = '/'.join(fr[0]['file'].split('/')[:-1])
open(f'{folder}/list.txt', 'w').write('\n'.join(lines))
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', f'{folder}/list.txt', '-vf', 'fps=30,scale=1920:1080:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-crf', '14', '-preset', 'slow', f'public/v2/clips/{w}-live.mp4'], check=True)
t0 = fr[0]['t']
json.dump({'duration': round(fr[-1]['t'] - t0, 2), 'marks': {m['label']: round(m['t'] - t0, 2) for m in d['marks']}}, open(f'public/v2/clips/{w}-live.json', 'w'))
print(w, 'clip', round(fr[-1]['t'] - t0, 2), 's')
