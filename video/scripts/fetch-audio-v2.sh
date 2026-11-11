#!/bin/sh
# Film v2 audio: Mixkit music and sound effects (Mixkit License: free for use in videos, no attribution
# required), peak-normalized to -2 dBFS at 48 kHz stereo. The files are not redistributed in the repo.
set -eu
cd "$(dirname "$0")/../public/v2"
mkdir -p sfx sfxn music
while read name id; do
  [ -s "sfx/$name.mp3" ] || curl -sf -o "sfx/$name.mp3" "https://assets.mixkit.co/active_storage/sfx/$id/$id-preview.mp3"
done <<'LIST'
whoosh_air 1492
whoosh_cine 1491
whoosh_stutter 2623
whoosh_swirl 2903
whoosh_hit 2907
whoosh_impact 2650
whoosh_rocket 1490
whoosh_tunnel 3005
sweep_fast 1487
sweep_air 1484
sweep_future 1463
sweep_tech 2635
sweep_cine 2783
sweep_metal 3118
swoosh_accent 169
impact_big 2908
impact_trailer 2782
impact_logo 3046
impact_epic 2600
impact_waves 2777
impact_suspense 781
impact_zoom 2804
impact_deep 1469
impact_heart 2182
impact_space 2199
hit_glass 2630
hit_reverse 2900
riser_trailer 2350
riser_drama 786
riser_space 498
swell_suspense 1093
bass_pulse 2408
bass_rumble 2615
brass_hum 2295
wind_hum 563
heartbeat 1177
glitch_static 2563
glitch_intro 1022
glitch_cine 2951
glitch_break 1039
glitch_electric 2950
glitch_quick 1021
device_fail 2940
reject_tone 2820
ui_click 2573
ui_select 2576
ui_start 2575
ui_open 1108
ui_box 2858
ui_zoom_in 2636
ui_zoom_out 3116
ui_zoom_long 2626
tech_bleep 2602
tech_confirm 3117
tech_affirm 2521
tech_alert 2621
tech_notif 3122
tech_calc 996
tech_power 2507
tech_ambience 2520
tech_loading 2504
typing 3124
keyclick 1110
shutter 275
coins 1992
coin_drop 1936
positive 2867
confirm_tone 937
correct 2358
LIST
for f in sfx/*.mp3; do
  n=$(basename "$f" .mp3)
  [ -s "sfxn/$n.wav" ] && continue
  mv=$(ffmpeg -i "$f" -af volumedetect -f null - 2>&1 | grep max_volume | awk '{print $5}')
  ffmpeg -v error -y -i "$f" -af "volume=$(python3 -c "print(-2.0-($mv))")dB" -ar 48000 -ac 2 "sfxn/$n.wav"
done
[ -s music/bed.mp3 ] || curl -sf -o music/bed.mp3 "https://assets.mixkit.co/music/598/598.mp3"
echo "sfx: $(ls sfxn | wc -l)"
