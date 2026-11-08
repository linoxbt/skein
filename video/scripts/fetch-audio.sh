#!/bin/sh
# Downloads the Mixkit music bed and sound effects (Mixkit License: free for use in videos) and normalizes them.
set -eu
cd "$(dirname "$0")/../public"
mkdir -p sfx sfxn music
while read name id; do
  curl -sf -o "sfx/$name.mp3" "https://assets.mixkit.co/active_storage/sfx/$id/$id-preview.mp3"
done <<'LIST'
whoosh_fast 1492
whoosh_air 1489
swoosh_quick 1464
sweep_tech 2634
sweep_cine 2635
impact_logo 2900
impact_big 788
impact_deep 498
riser 790
riser_short 1144
glitch_intro 2950
glitch_break 2951
glitch_small 1030
click_ui 3124
click_cool 2568
click_select 1109
typing 2531
bleep_confirm 2520
tech_notif 3123
confirm 2867
positive 951
reject 896
coins 1993
money_drop 1989
computing 3122
loading 2529
zoom_in 2618
zoom_out 2619
bass_rumble 2297
bass_pulse 2295
heartbeat_amb 497
wind_hum 1177
tunnel_woosh 1486
glass_hit 677
data_hum 2507
LIST
for f in sfx/*.mp3; do
  n=$(basename "$f" .mp3)
  mv=$(ffmpeg -i "$f" -af volumedetect -f null - 2>&1 | grep max_volume | awk '{print $5}')
  ffmpeg -v error -y -i "$f" -af "volume=$(python3 -c "print(-2.0-($mv))")dB" -ar 48000 -ac 2 "sfxn/$n.wav"
done
curl -sf -o music/bed.mp3 "https://assets.mixkit.co/music/597/597.mp3"
ffmpeg -v error -y -i music/bed.mp3 -af "loudnorm=I=-16:TP=-1.5:LRA=11" -ar 48000 -ac 2 music/bed.wav
for f in vo/s??.wav; do
  ffmpeg -v error -y -i "$f" -af "highpass=f=70,acompressor=threshold=-20dB:ratio=2.5:attack=5:release=80,loudnorm=I=-16:TP=-1.5:LRA=7" -ar 48000 -ac 2 "${f%.wav}n.wav"
done
