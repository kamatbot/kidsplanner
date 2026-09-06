# Launch video — `public/video/fametc-demo.mp4`

20 s, 1600×1000 (8:5), H.264 yuv420p, faststart, **no audio**. Embedded at
`#watch` on `public/landing.html`; poster is `public/video/fametc-demo-poster.jpg`
(the solved-crossword frame at 17.45 s).

## Concept

Silent ad, not a walkthrough: a Sunday in one family's week, told in three
real product moments — a chat message that becomes a shopping item, a homework
assignment ticked off, the weekend crossword solved. Every frame is the real
app (or real widget markup + real CSS) driven deterministically; captions
carry the words.

## Shot list (30 fps, 600 frames)

| t (s)        | Shot                        | What moves                                                                                                       |
| ------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 0.0 – 1.6    | Title card                  | Four brand marks assemble; "One week. Two kids. One place." word by word.                                       |
| 1.6 – 8.8    | Today + chat (parent)       | Page arrives; slow push-in; a new chat message lands (1.3 s); push to chat; 🛒 tap; real "Add to Shopping" dialog (prefilled); "Add item"; real toast. Captions: *Everyone opens the same day* / *A message that's really a job* / *It's on the shopping list. No retyping.* |
| 8.8 – 12.8   | Homework (kid session)      | Tap ring on the check; green fill + tick stroke draws; title strikes through; row fades and collapses; counters roll 3→2, 0/3→1/3; focus panel moves to the next assignment. Caption: *Tick it off. Everyone sees it.* |
| 12.8 – 17.6  | Weekend crossword (scene)   | Today's real crossword; letters pop in entry by entry with the active cell/clue highlighted; "Check puzzle"; green wave; "You did it — every answer is correct!". Captions: *A crossword every weekend* → *Sunday's puzzle, solved.* |
| 17.6 – 20.0  | End card                    | Marks, "Fam ETC", the one coral→violet momentum bar, "The family week, in one app.", fametc.com.                |

## How to re-render

Everything lives in the session scratchpad
`…/scratchpad/demo2/` (copy that directory somewhere permanent if you want to
keep it; nothing in it is app code):

| File                  | Role                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| `setup.sh`            | Boots an isolated app on :3200 (`FAM_DATA_DIR` = the demo2 dir, never real data), seeds it, launches headless Chrome on :9222. |
| `kid-login.cjs`       | Mints a signed **kid** session cookie for Alex (mirrors `scripts/dev-login.js`); needed because only a kid session can tick homework. |
| `seed.mjs`            | Seeds events, homework and chat through the real HTTP API with the parent cookie.                     |
| `cdp.mjs`             | Tiny DevTools-protocol client (Node 24 WebSocket, no deps).                                              |
| `director.js`         | In-page helpers: easing, captions on a "lens" that counter-transforms the camera, tap rings, number rolls, keyframes. |
| `shot-today.js`, `shot-homework.js` | `__setup()` / `__seek(t)` for the two shots driven inside the real app pages.                |
| `scene/cards.html`, `scene/crossword.html` | Title/end cards and the crossword scene (real widget markup, real `styles.css`, fonts copied from `public/fonts`). |
| `render.mjs`          | For every shot: navigate, settle, inject director + shot script, then step `t` frame by frame and capture with a CDP `clip` (the camera — Chrome re-rasterises the zoom, so it stays crisp). `node render.mjs [fps] [shot]`. |
| `assemble.sh`         | `frames/%05d.png` → mp4 (`CRF=23 ./assemble.sh 30`).                                                     |

Steps:

```sh
cd <demo2>
./setup.sh                    # app :3200 + Chrome :9222 with seeded data
node render.mjs 30            # ~2 min; writes frames/00000..00599.png
CRF=23 ./assemble.sh 30       # fametc-demo.mp4 (≈3.8 MB)
cp fametc-demo.mp4 <repo>/public/video/fametc-demo.mp4
ffmpeg -y -ss 17.45 -i fametc-demo.mp4 -frames:v 1 -q:v 3 <repo>/public/video/fametc-demo-poster.jpg
```

Notes:
- `.env` sets `NODE_ENV=production` and a `SESSION_SECRET`; `setup.sh` overrides both (empty secret + development) so `dev-login.js` will run.
- The crossword is whatever `GET /api/enrichment/puzzle/today?date=<today>` returns — render on a weekend to get a crossword (Wednesdays serve sudoku, which the scene does not handle).
- Design constraints honoured: Horizon tokens only, Space Grotesk / JetBrains Mono, per-kid teal/amber, green only as the semantic "done" colour, one gradient element (end card). No feature is shown that the app cannot do.
