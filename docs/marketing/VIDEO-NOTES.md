# Launch film — the landing hero (`public/video/film/`)

The landing hero plays the 60 s storybook film as the **live canvas animation**, not an MP4. The same code
renders the masters, and this is the pattern retireodds.com/familyoffice uses.
- `public/landing.html` has a 16:9 `.hero-film` box whose background is `public/video/film/poster.webp`.
- The iframe `#hero-film` carries `data-src="/video/film/index.html"`, and `public/js/landing.js` sets its
  `src` after the page's `load` event, so the film never competes with first paint.
- The film autoplays silently and loops. "Sound on" brings in `assets/audio/mix.mp3`, which is `preload="none"`
  and fetched only then. Pause is always available. With reduced motion it waits on a Play button.
- Page weight: the sprites, scripts, Caveat and the poster come to about 2 MB. The audio (1.9 MB) loads only
  on Sound on. That replaced a 7.5 MB MP4 section (2026-09-27).

## Concept

A storybook minute in watercolour and coloured pencil, captions only (STA-LAUNCH-PLAN §3.3), about the
fictional Walker family: Kate, Tom, Mia and Leo. It shows the plan's two selling moments.
- **Chat → action:** a message becomes the shared shopping list through the real *Add to Shopping* dialog.
- **Homework:** assignments come in from school, are sorted by due date, and Mia ticks one off.

The app screens are Family Rings redrawn from reference shots of the real web app. The wording follows §2,
and Hermes is left out.

## Source and update

The film is its own project at `~/Documents/Claude/fametc-promo-video/` (git repo; the README and
CONCEPT.md hold the beat sheet). MP4 masters for sharing and texting are in
`~/Documents/Claude/Builds/marketing/`.

```sh
cd ~/Documents/Claude/fametc-promo-video
node tools/build.mjs                                            # after changing the film: re-render the masters
./tools/export-embed.sh ~/Documents/Claude/Planner/public/video/film   # refresh the hero embed + poster
```

`export-embed.sh` copies `web/embed.html` (as index.html), `promo.js`, `ui.js`, the sprites, the mix and
Caveat, and it cuts `poster.webp` from the last master at `POSTER_T`. The other fonts come from `/fonts/`.
