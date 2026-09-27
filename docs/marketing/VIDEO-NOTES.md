# Launch video — `public/video/fametc-film-60s.mp4`

60 s, 1920×1080, H.264 at about 1 Mbps with AAC music and sound effects (starts muted on the page), faststart.
It is embedded at `#watch` on `public/landing.html`. The poster is `public/video/fametc-film-60s-poster.jpg`,
the title card at 10.6 s. It replaced the 20 s Horizon demo (`fametc-demo.mp4`) on 2026-09-27.

## Concept

A storybook minute in watercolour and coloured pencil, captions only (STA-LAUNCH-PLAN §3.3), about the
fictional Walker family: Kate, Tom, Mia and Leo. It shows the plan's two selling moments.
- **Chat → action:** Kate's "pasta, tomatoes, basil" goes through the real *Add to Shopping* dialog, and Tom
  ticks it off at the shop.
- **Homework:** assignments come in from school, are sorted by due date, and Mia ticks one off.

The app screens are Family Rings redrawn from reference shots of the real web app, so nothing appears that
the app can't do. The wording follows §2: "Built by an STA parent, for STA families", "Checks the school every
eight hours" and "Free for STA families while we're testing". Hermes is left out.

## Source and re-render

The film is its own project at `~/Documents/Claude/fametc-promo-video/` (git repo; the README and
CONCEPT.md hold the beat sheet), built with the `promo-video` skill kit. Masters (16:9, 9:16 and 720p
share copies) are in `~/Documents/Claude/Builds/marketing/`, build `20260926-220119`.

```sh
cd ~/Documents/Claude/fametc-promo-video
node tools/build.mjs                       # renders both cuts to dist/ with a timestamped build ID
M=dist/$(cat dist/LATEST).mp4
ffmpeg -i $M -c:v libx264 -preset slow -crf 24 -tune animation -pix_fmt yuv420p \
  -c:a aac -b:a 128k -movflags +faststart <repo>/public/video/fametc-film-60s.mp4
ffmpeg -ss 10.6 -i $M -frames:v 1 -q:v 4 <repo>/public/video/fametc-film-60s-poster.jpg
```
