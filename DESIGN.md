---
name: Fam ETC — Family Rings
description: Every child's day is rings to close; the parent's ring is what needs you.
seed: 19a71449
approved: 2026-09-26
colors:
  background: '#F4F5F7'
  card: '#FFFFFF'
  card-secondary: '#F7F8FA'
  rule: '#E7E9EE'
  ink: '#15171C'
  ink-secondary: '#6B7280'
  action: '#7B4DFF'
  action-ink: '#5B2EE6'
  homework: '#E8467C'
  habits: '#0EA58C'
  daily3: '#4B7BF5'
  fams: '#D99A00'
typography:
  family: Geist
  weights: 100–900
  numeric: tabular-nums
  greeting: 30px / 700
  hero: 64px / 800
  statistic: 30px / 800
  card-title: 20px / 700
  action-title: 17px / 600
  body: 14px / 400
  meta: 13px / 400
  section: 12px / 600 / uppercase
radii:
  card: 24px
  phone-card: 20px
  input: 12px
  pill: 999px
spacing:
  desktop-canvas: 30px 32px
  phone-canvas: 14px 16px
  card-gap: 20px
  phone-gap: 14px
---

# Family Rings

The source of truth is [the approved brief](docs/design/family-rings/BRIEF.md) and its light, dark and phone reference images. All web app surfaces share the exact light/dark `--fr-*` tokens in `public/css/horizon.css`; existing token names alias them. Geist is self-hosted with its OFL license. No runtime font service or new JavaScript dependency is used.

The 224px sidebar and resizable 340px family chat frame Today. The first card pairs a 188px violet ring with at most three actions. The center counts eligible open actions; its arc measures actions cleared today against cleared plus due by today. Future snoozes do not enter the preview. Parents review homework; their buttons never complete a child's assignment. All-actions retains creation, completion, snooze and delete according to existing permissions.

Child cards remain in family order. Their 156px rings always use rose outer homework, teal middle habits and azure inner Daily 3. Homework includes this Monday–Sunday plus unfinished overdue items; habits use today's recorded check-ins; Daily 3 includes only News, Quote and Word. Unknown Daily 3 is labeled unavailable and its ring is omitted. Empty denominators use dashed tracks. Fams balances and the gold weekly bar keep their actual numerator and limit visible.

The day strip runs 7 AM–9 PM; overlapping events occupy separate lanes, and all-day/out-of-hours events remain accessible beside it. On narrow screens the track scrolls internally and centers the current time. Tonight links parents to Meals. News, Quote, Word and Challenge tiles lead to the existing mounted panels so drafts and puzzle state survive navigation.

Phones use a brand/avatar header, five destinations in a 76px bottom bar and a 56px chat button. Cards stack and rings scale to 120px. Two child columns begin at 900px of available Today content to preserve the approved 1600px desktop composition with its sidebar and chat; narrower cards stack. This resolves the brief's 1100px container threshold against its 1600px reference image, which supplies about 960px of content.

Kid Today contains only the signed-in child's actionable work and progress, with learning promoted after the hero. Parent-only child insights, setup, Tonight and Hermes case tools retain their existing role boundaries. The dedicated parent child view adds a 220px ring hero and Mon–Sun recorded bars; absent history and future days remain unrecorded. Homework, Goals, Calendar, Activities, Trips, Meals, Notes, Settings, billing, security and authentication retain their existing functions on the shared visual system.

Every ring includes a textual accessible label. Controls keep visible focus, native dialog/tab keyboard behavior, and textual counts alongside colors. Changes animate SVG arcs over 700ms, with a brief increment spark and completion glow; reduced-motion preference disables these effects. There is no confetti or ranking.

Web-only adoption: native iOS parity is pending. The public landing retains its Horizon palette and typography through a scoped token preservation rule; its HTML and CSS are unchanged.
