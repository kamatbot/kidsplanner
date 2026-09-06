#!/usr/bin/env bash
# Render the framed Fam ETC App Store screenshots at every required size from the
# raw simulator captures in SHOTS_DIR (shots/iphone, shots/ipad). Requires Google
# Chrome. Output -> appstore/<size>/*.png (opaque PNG, exact pixel dims).
# Copied from RetireOdds ios/marketing/frame.sh; only SIZES + paths changed.
set -euo pipefail
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
export SHOTS_DIR="${SHOTS_DIR:-$PWD/shots}"

node frame.js

# kind:label-WxH (portrait upload pixels). 6.9" is required by App Store Connect;
# 6.7"/6.5" are the sizes the founder asked for; iPad 13"/12.9" because iPad is a
# co-equal surface (APP-BRIEF).
SIZES=(
  "iphone:6.9-1320x2868"
  "iphone:6.7-1284x2778"
  "iphone:6.5-1242x2688"
  "ipad:13-2064x2752"
  "ipad:12.9-2048x2732"
  "watch:s11-416x496"
  "watch:ultra3-410x502"
)

for entry in "${SIZES[@]}"; do
  kind="${entry%%:*}"; size="${entry#*:}"
  dims="${size#*-}"; W="${dims%x*}"; H="${dims#*x}"
  outdir="appstore/$kind-$size"; mkdir -p "$outdir"
  for f in frame-html/$kind/*.html; do n=$(basename "$f" .html)
    "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
      --window-size="$W,$H" --default-background-color=FFFFFFFF --virtual-time-budget=4000 \
      --screenshot="$outdir/$n.png" "file://$PWD/$f" >/dev/null 2>&1
  done
  echo "rendered $kind $size ($(ls "$outdir" | wc -l | tr -d ' ') shots)"
done
echo "done -> appstore/"
