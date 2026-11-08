import json, subprocess, sys
src = sys.argv[1] if len(sys.argv) > 1 else 'capture/live.json'
d = json.load(open(src)); fr = [f for f in d['frames'] if 'file' in f]
lines = []
for a, b in zip(fr, fr[1:] + [None]):
    dur = (b['t'] - a['t']) if b else 1.0
    lines.append(f"file '{a['file'].split('/')[-1]}'\nduration {max(dur, 0.001):.4f}")
lines.append(f"file '{fr[-1]['file'].split('/')[-1]}'")
folder = '/'.join(fr[0]['file'].split('/')[:-1])
open(f'{folder}/list.txt', 'w').write('\n'.join(lines))
subprocess.run(['ffmpeg','-v','error','-y','-f','concat','-safe','0','-i',f'{folder}/list.txt','-vf','fps=30,scale=1920:1080:flags=lanczos,format=yuv420p','-c:v','libx264','-crf','14','-preset','slow','public/clips/desk-live.mp4'], check=True)
print('clip ok', round(fr[-1]['t'] - fr[0]['t'], 2), 's')
