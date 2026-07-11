# Horizon redesign — plan of record (2026-07-11)

Source of truth: `docs/design/redesign/Fam-ETC-Redesign.dc.html` (claude.ai/design
project d048593a…, "Redesigning Kidsplanner"), split into per-screen specs
`canvas-1a.html` … `canvas-1h.html`. **Implement these canvases.**

User decisions (2026-07-11, explicit):
1. **Docked family chat wins** — docked chat column on web desktop + iPad
   landscape (collapses to a slim avatar strip on Homework/Goals/Activities);
   slide-over chat only on iPad portrait / kid view. Supersedes the 2026-07-04
   revert.
2. **Big-bang web rollout** — one deploy carrying shell + all screens + dark mode.
3. **Web + iOS together** — parallel implementation threads.
4. **Nothing dropped** — Notes, Settings (family/school/Moodle/passkeys/billing),
   school-stats widget, streak, news ticker all survive, restyled to Horizon.

## Canvas map
| Canvas | Screen | Key content |
|--------|--------|-------------|
| 1a | Web Today (new landing) | greeting, schedule timeline, homework due, habits, Daily 5, docked chat |
| 1b | Web Calendar | week/month toggle, kid chips (kid switching moves here), feeds legend |
| 1c | Web Homework | urgency groups (Overdue/Due today/This week/Done), subject+kid filters, Scan diary, chat strip |
| 1d | Web Goals | habit rings, milestone cards, weekly family recap, gentle language |
| 1e | Web Activities | registry cards (when/where/coach/gear), day-of helper banner |
| 1f | iPad landscape Today | icon rail + content + docked chat |
| 1g | iPad portrait kid view | bigger/playful, streak ring, chat slide-over |
| 1h | Dark mode | same tokens re-resolved |

## Design language (from the doc's own notes)
Horizon: greige bg (`--bg #f1efec`), white panels, violet `--accent #6f43d6` as
the ONLY interactive color, coral→violet gradient reserved for ONE momentum
element per screen, green/red semantic only. Space Grotesk UI + JetBrains Mono
numerals, 11px uppercase micro-labels. Per-kid identity via categorical palette
(kid 1 = teal `--c-teal`, kid 2 = amber `--c-amber`, assigned by kid order).
Tokens: `public/css/horizon.css` (light + `.dark`). Fonts: `public/fonts/`.

## Execution
Phased agents; web and iOS tracks run in parallel, phases within a track are
sequential (shared files).

- **W1** web shell: index.html restructure (sidebar nav → main → chat column),
  Today screen, Daily 5, dark mode, kid view. Then
- **W2** Calendar + Homework screens. Then
- **W3** Goals + Activities + Notes + Settings restyle.
- **I1** iOS DesignSystem: Theme.swift → Horizon tokens, bundle fonts,
  RootView iPad-landscape docked chat. Then
- **I2** iOS feature screens: Today/Calendar/Chat/Notes to match canvases.

Verify: `node --test` green, local preview screenshots per screen
(light/dark/desktop/iPad), deploy fametc.com, verify live. iOS: build +
simulator screenshots; TestFlight ships separately (never auto).

## Affected files (APP-BRIEF design-row change, confirmed by user 2026-07-11)
Web: `public/index.html`, `public/css/{styles.css,app.css,horizon.css}`,
`public/fonts/*`, `public/js/{app.js,school.js,notes.js,sat.js,school-stats.js,util.js,auth.js}` (rendering paths only — API wrappers unchanged).
iOS: `ios/FamETC/DesignSystem/*`, `ios/FamETC/App/RootView.swift`,
`ios/FamETC/Features/**`, `ios/project.yml` (fonts).
Docs: `APP-BRIEF.md` design rows, this file.
