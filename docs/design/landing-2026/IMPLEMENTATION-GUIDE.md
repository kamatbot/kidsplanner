# Fam ETC landing page 2026 — implementation guide

**Audience:** a developer with no prior context. Everything you need is in this
file plus three sibling files in this folder:

| File | What it is |
|---|---|
| `reference-landing.body.html` | The exact `<body>` markup for the new page (Variant A). Paste-ready. |
| `reference-landing.css` | The exact section stylesheet to port into `public/css/landing.css`. |
| `fametc-landing-2026.html` + `*.dc.html` | The design canvas (also published as an Artifact) — open to see what each section is meant to look like, light and dark, desktop and 390px. |
| `build-artboards.mjs` | Generates all of the above. If you change the reference markup, change it here and re-run `node build-artboards.mjs`. |

**Target files (you edit only these):** `public/landing.html` (currently 359
lines) and `public/css/landing.css` (currently 1,824 lines), plus one new
file `public/js/landing.js` (~40 lines). Nothing else on the server changes,
except under Variant B (see §11).

**What this is not:** a rebrand. No new colors, fonts, logo or tokens. Every
color below is a CSS variable from `public/css/horizon.css`; the two fonts
are already self-hosted in `public/fonts/`. If you find yourself typing a hex
value into `landing.css`, stop — it belongs in `horizon.css` and needs the
owner's sign-off (§14).

---

## 1. Rationale — what changed and why (one page)

The old page sold *"Moodle homework, timetables and ECAs for St Andrews
parents."* The product is *"the place a modern family runs its week."* The
page is now built on two pillars that alternate down the scroll:

- **Stay on top** — school sync, homework, timetable, ECAs, reminders, house
  points. Emotional job: *nothing lands on you at 8pm that you should have
  known at 8am.*
- **Stay in touch** — family chat, chat→action, kid mode, meals, trips, goals.
  Emotional job: *the family thread is where things get decided, not just
  discussed.*

The page's centre of gravity is where the pillars meet: a chat message
("Could we pick up pasta, tomatoes and basil for dinner?") becoming a shared
shopping list. That was a 40%-scale figure in a two-up grid; it is now the
largest section on the page, in three legible beats.

Concretely, versus today's page:

| Today | New | Why |
|---|---|---|
| Opens with `BUILT FOR STA · ST ANDREWS…` badge | Opens with the promise; availability line sits under the CTAs | Eligibility is a footnote to a promise, not its opening line |
| Hero = whole 3-column app at ~6–8px type (~150 nodes) | Hero = one Today card at 15px body type + three floating elements (~45 nodes) | Legibility. Composition over completeness |
| Problem never stated | One 60-word "Before" band (three group threads, a whiteboard, an overdue slip) | "Calm" needs a referent |
| School sync framed as integration | "You never chase a due date again." with the mechanism as supporting detail | Relief, not plumbing |
| Chat→action = static half of a grid | Three-beat stepped sequence, scroll-revealed, the biggest section | It's the proof this is one product, not two |
| Eight identical numbered feature cards | A "day in the family" timeline (7 moments) + a bento grid with two large tiles | Features shown doing their job, for one continuous family (Priya, Mia, Leo) |
| iOS app invisible | "Every screen the family already uses": iPhone tab bar, iPad rail + docked chat, web | Real differentiator; one section |
| Kid/parent = two static cards | One component, two states, a real tablist toggle | Same device, contents swap |
| Trust = one sentence in a panel | A calm privacy band with five plain commitments | Parents' first objection deserves a band |
| Final CTA = three buttons | One button + availability line | Three choices at conversion is a stall |
| No dark mode | Pre-paint theme script; `theme-color` responds | The app is dark-capable; the landing opted out |

Kept: the Horizon system, the honest voice ("No — Fam ETC is built by
parents…"), the three-step how-it-works, the FAQ, the school-sync
explanation, the mock family.

---

## 2. Token reference (the only place hex values appear)

Every color in the design is one of these `horizon.css` variables. Use the
variable, never the value. Values are listed only so a reviewer can verify
contrast and so `theme-color` metas (§8) can be filled in.

| Variable | Light | Dark | Use on the landing page |
|---|---|---|---|
| `--bg` | `#f1efec` | `#211f1d` | Page ground; `theme-color` |
| `--sidebar` | `#f8f6f3` | `#262421` | Privacy band, footer, mode-toggle track |
| `--panel` | `#ffffff` | `#2c2926` | Every card |
| `--panel-2` | `#faf8f5` | `#33302c` | Chat bubbles, chips, "before" fragments |
| `--border` | `#e7e3dd` | `#3b3733` | All 1px borders, progress track, timeline rail |
| `--text` | `#211e1b` | `#f1efec` | Headings, body |
| `--text-2` | `#6a655f` | `#a29c93` | Secondary copy, micro-labels |
| `--accent` | `#6f43d6` | `#b98cff` | **Only** on clickable things: links, primary buttons, focus rings, selected tab/option, active filter chip |
| `--accent-soft` | rgba(111,67,214,.11) | rgba(185,140,255,.15) | Selected-state fills |
| `--on-accent` | `#ffffff` | `#1c1526` | Text on `--accent` |
| `--coral` | `#f0704f` | `#ff8a66` | Partner accent: hero kicker dot, gradient start, link hover. Never a button |
| `--c-teal` | `#0d9488` | `#2dd4bf` | **Mia** (kid 1) — everywhere |
| `--c-amber` | `#f59e0b` | `#fbbf24` | **Leo** (kid 2) — everywhere |
| `--c-green` | `#16a34a` | `#4ade80` | Semantic only: done / synced |
| `--c-red` | `#dc2626` | `#f87171` | Semantic only: due today / overdue |
| `--shadow` | — | — | Card shadow |

The coral→violet gradient `linear-gradient(90deg, var(--coral), var(--accent))`
appears **exactly once** on the page: the hero "3 of 6 done" momentum bar.

Contrast check (WCAG relative luminance, computed): `--text-2` on `--panel-2`
light 5.4:1, dark 4.8:1; `--text-2` on `--bg` light 5.0:1; `--accent` on
`--bg` light 5.3:1; `--on-accent` on `--accent` dark 7.0:1. All pass AA for
body text.

Type: `"Space Grotesk"` for everything; `"JetBrains Mono"` for numerals,
times, and the 11px uppercase micro-labels (`.eyebrow .kicker .micro
.step-label .beat-label`), exactly as today's `landing.css:121-129`.

---

## 3. Page map

Section order, ids, and the pillar each belongs to. Nav anchors point at the
ids in bold.

| # | Section | `id` | Pillar |
|---|---|---|---|
| S0 | Header | — | — |
| S1 | Hero + trust strip | — | Both |
| S2 | Before | — | — |
| S3 | Stay on top (school sync) | **`school-sync`** | On top |
| S4 | Stay in touch + chat→action | **`chat`** | In touch |
| S5 | A day in the family | **`day`** | Both |
| S6 | Everything else (bento) | **`features`** | In touch |
| S7 | Every screen | **`devices`** | — |
| S8 | Kid / Parent mode | **`kids`** | Both |
| S9 | Privacy & safety | **`privacy`** | — |
| S10 | How it works | — | — |
| S11 | FAQ | **`faq`** | — |
| S12 | Final CTA | — | — |
| S13 | Footer | — | — |

The old `#moodle` id is retired in favour of `#school-sync`. Nothing outside
`landing.html` links to `#moodle` (verified with grep), so no redirects.

---

## 4. Section-by-section DOM

Class names follow the existing `landing.css` conventions: kebab-case,
`.section` for full-width bands, `.kicker` / `.micro` / `.eyebrow` for
mono micro-labels, `.button .button-primary .button-secondary .button-large`
for buttons, `.feature-card` for feature tiles, `.step-card`, `.faq-item`,
`.cta-panel`, `.site-header`, `.site-footer`. New classes are introduced only
where a new component exists.

The full, paste-ready markup is `reference-landing.body.html`. Below is the
skeleton per section so you can see the structure without the mock content.

### S0 · Header
```html
<header class="site-header"><div class="header-inner">
  <a class="brand" href="/" aria-label="Fam ETC home"><svg class="brand-mark">…</svg>
    <span class="brand-name">Fam<span class="brand-etc">ETC</span></span></a>
  <nav class="site-nav" aria-label="Landing page navigation">
    <a href="#features">Features</a><a href="#chat">Family chat</a>
    <a href="#school-sync">School sync</a><a href="#devices">iPhone &amp; iPad</a><a href="#faq">FAQ</a>
  </nav>
  <div class="header-actions">
    <a class="button button-secondary header-signin" href="/login">Sign in</a>
    <a class="button button-primary header-create" href="/signup">Create family</a>
  </div>
</div></header>
```
Removed: `<span class="header-trial micro">Free for STA parents</span>`.
Brand SVG is unchanged from today's file.

### S1 · Hero
```html
<section class="section hero" aria-labelledby="hero-title">
  <div class="hero-copy">
    <p class="hero-kicker micro">Stay in touch <i></i> Stay on top</p>
    <h1 id="hero-title">…</h1>
    <p class="hero-lede">…</p>
    <div class="hero-actions">
      <a class="button button-primary button-large" href="/signup">Create your family</a>
      <a class="button button-secondary button-large" href="#day">See a family week</a>
    </div>
    <p class="availability">… (Variant A or B, §11)</p>
  </div>
  <div class="hero-stage" role="group" aria-label="…">
    <article class="today-card" aria-label="Today screen">
      <div class="today-head"><div><span class="eyebrow">Wednesday 22 August</span>
        <p class="today-greeting">Good morning, Priya</p></div>
        <span class="chip"><span class="dot"></span>School sync 08:10</span></div>
      <div class="momentum">
        <div class="momentum-label"><span>Today</span><span class="mono">3 of 6 done</span></div>
        <div class="momentum-track" role="progressbar" aria-valuenow="3" aria-valuemin="0" aria-valuemax="6" aria-label="3 of 6 things done today"><div class="momentum-fill"></div></div>
      </div>
      <ul class="today-list"><li><time>08:20</time><i class="bg-leo"></i><span>Football · Leo<small>…</small></span><span class="who">ECA</span></li>…×3</ul>
      <div class="today-actions"><span class="eyebrow">Family actions</span>
        <div class="action-row"><span class="checkbox"></span><span>Sign Mia's swim gala permission slip</span><span class="due today">Due today</span></div>
        <div class="action-row">…Pack Leo's football kit … <span class="due">Tomorrow</span></div>
      </div>
    </article>
    <aside class="float float-chat" aria-label="Family chat message">…Leo · 12:05 · Can someone bring my goggles?</aside>
    <aside class="float float-due" aria-label="Homework due">…Maths · Fractions worksheet · Mia · due 16:00</aside>
    <aside class="float float-sync" aria-label="School sync notice">…2 items added from school · 09:12</aside>
  </div>
</section>
<div class="trust-strip" role="list" aria-label="Trust commitments">
  <span role="listitem">Encrypted at rest</span>…×4
</div>
```
Node budget for `.hero-stage`: ≤ 60 elements (today: ~150). The three
`.float` asides each carry their own `aria-label`; the Today card's text is
real DOM text, not `aria-hidden`.

The **only** gradient on the page is `.momentum-fill`. The `.dot` inside the
sync chip is `--c-green` (semantic: sync succeeded). `.due.today` is
`--c-red` (semantic: due today).

### S2 · Before
```html
<section class="section before-section" aria-labelledby="before-title">
  <div class="before-grid">
    <div class="before-fragments" aria-hidden="true">
      <div class="fragment"><strong>Year 4 Parents</strong>47 members · "does anyone know if…"<span class="unread">128</span></div>
      <div class="fragment">…Swim squad parents…<span class="unread">31</span></div>
      <div class="fragment">…Family…<span class="unread">9</span></div>
      <div class="fragment fragment-board">Thurs — Leo football<br>Fri — ??? dinner<br>~~Mia clarinet~~ moved</div>
      <div class="fragment fragment-slip">PERMISSION SLIP · Swim gala<br>Return by Tue 13 Aug<br><em>Found Mon 19 Aug</em></div>
    </div>
    <div class="before-copy"><p class="kicker">Before</p><h2 id="before-title">…</h2><p>…</p></div>
  </div>
</section>
```
Fragments are decorative (`aria-hidden`); the copy carries the meaning.
Positions/rotations are `nth-child` rules in the CSS, not inline styles, so
the 520px breakpoint can stack them. The unread badges are `--text` on
`--bg` (neutral, not violet — they are not clickable). The slip's "Found"
stamp is `--c-red` (semantic: overdue).

### S3 · Stay on top
```html
<section id="school-sync" class="section" aria-labelledby="school-title">
  <div class="pillar-grid">
    <div class="pillar-copy">
      <p class="kicker">Stay on top</p><h2 id="school-title">…</h2><p>…</p>
      <div class="sync-items">
        <div class="sync-item"><strong>Homework</strong><span>…</span></div> ×4
      </div>
      <p class="sync-trust"><strong>Parent-controlled.</strong> … <a href="/privacy">How we handle school data</a></p>
    </div>
    <div class="pillar-visual" role="group" aria-label="…">
      <div class="toast"><span class="dot"></span><div><span class="eyebrow">School sync</span>Maths worksheet added for <span class="kid-mia">Mia</span>, due today<time>09:12</time></div></div>
      <article class="homework-card">
        <div class="card-head"><strong>Homework</strong><span class="chip"><span class="dot"></span>Synced 08:10 · next 16:10</span></div>
        <div class="kid-filter" role="tablist" aria-label="Filter by child"><span class="chip active">All</span><span class="chip"><span class="dot bg-mia"></span>Mia</span><span class="chip"><span class="dot bg-leo"></span>Leo</span></div>
        <ul class="hw-list"><li><span class="checkbox done"></span><span>English · Reading log<small><span class="kid-mia">Mia</span> · Ms Harper</small></span><span class="due done">Done</span></li> ×4</ul>
      </article>
    </div>
  </div>
</section>
```
`.sync-item` replaces today's `.moodle-item`; `.sync-trust` replaces
`.moodle-trust`; `.pillar-grid` replaces `.moodle-grid`. The active filter
chip is violet because a filter chip is interactive in the real app.

### S4 · Stay in touch — chat→action (the centrepiece)
```html
<section id="chat" class="section chat-section center" aria-labelledby="chat-title">
  <p class="kicker">Stay in touch</p><h2 id="chat-title">…</h2><p class="section-intro">…</p>
  <div class="chat-sequence" data-reveal>
    <div class="chat-beat"><p class="beat-label"><b>01</b>A message</p>
      <div class="chat-phone" role="group" aria-label="…">
        <div class="chat-head"><span>Family</span><span class="avatars">…P M L</span></div>
        <div class="msg sys"><p>School sync · 09:12 · Maths worksheet added for Mia</p></div>
        <div class="msg"><span class="meta">Leo · 12:05</span><p>Can someone bring my goggles?</p></div>
        <div class="msg mine"><span class="meta">Priya · 12:07</span><p>In the swim bag.</p></div>
        <div class="msg mine focus"><span class="meta">Priya · 12:08</span><p>Could we pick up pasta, tomatoes and basil for dinner?</p></div>
        <div class="composer"><span>Message the family…</span><b>Send</b></div>
      </div></div>
    <div class="chat-beat"><p class="beat-label"><b>02</b>Turn it into…</p>
      <div class="chat-phone" role="group" aria-label="…">…
        <div class="msg mine dim">…same message…</div>
        <div class="action-sheet"><span class="eyebrow">Turn this message into</span>
          <div class="action-options"><span>…Action</span><span>…Calendar</span><span class="selected">…Shopping</span></div></div>
      …</div></div>
    <div class="chat-beat"><p class="beat-label"><b>03</b>It's on the list</p>
      <div class="chat-phone" role="group" aria-label="…">…
        <div class="result-card"><div class="result-head"><span class="tick">✓svg</span>Added to Shopping</div>
          <div class="result-sub">Dinner · 3 items · Today</div>
          <ul class="result-list"><li><span class="checkbox"></span>Pasta</li>…</ul>
          <div class="result-foot">Shared with the family · whoever's near a shop ticks them off</div></div>
        <div class="msg sys"><p>Priya added 3 items to Shopping · 12:08</p></div>
      …</div></div>
  </div>
  <div class="chat-safety">
    <div><svg/><span><strong>One thread per family</strong>…</span></div> ×3
  </div>
</section>
```
Avatars: P = `--text-2`, M = `--c-teal`, L = `--c-amber`. The focused message
in beat 1 has a violet outline (it is the pressed/selected item — interactive
state). The selected `Shopping` option is violet (selected control). The
result tick is `--c-green` (semantic: done). Icons are inline stroke SVGs
(20/22px), never emoji.

### S5 · A day in the family
```html
<section id="day" class="section" aria-labelledby="day-title">
  <div class="day-grid">
    <div class="day-copy"><p class="kicker">One Wednesday</p><h2 id="day-title">A day in the family.</h2><p>…</p></div>
    <ol class="day-timeline">
      <li class="moment"><time class="moment-time">07:10</time><span class="moment-dot leo" aria-hidden="true"></span>
        <div class="moment-card"><div><p class="kicker">Reminders</p><strong>Leo's football kit</strong><p>…</p></div>
          <div class="mini"><span class="chip"><span class="dot bg-leo"></span>Kit + boots · in the car</span></div></div></li>
      … ×7 (see copy deck §10.6)
    </ol>
  </div>
</section>
```
`.moment-dot.mia` = `--c-teal` ring, `.moment-dot.leo` = `--c-amber` ring,
family/neutral = `--text-2` ring. Mini visuals per moment: `.chip`,
`.mini-bubble` (×2 for chat), `.mini-list` (shopping), `.mini-poll` (meals).

### S6 · Everything else (bento)
```html
<section id="features" class="section" aria-labelledby="features-title">
  <h2 id="features-title">…</h2><p class="section-intro">…</p>
  <div class="bento">
    <article class="feature-card large"><div class="feature-title">Meals</div><p>…</p>
      <div class="feature-visual" role="img" aria-label="…"><span class="eyebrow">Friday dinner · 4 voted</span>
        <div class="poll"><div class="lead"><span>Pad thai</span><b class="num">3</b><i><b style="width:75%"></b></i></div>…</div></div></article>
    <article class="feature-card wide"><div class="feature-title">Shared calendar</div><p>…</p>
      <div class="feature-visual" role="img" aria-label="…"><div class="week-strip"><div>MON<span class="leo">Football</span></div>…×5</div></div></article>
    <article class="feature-card"><div class="feature-title">Trips</div><p>…</p></article>
    <article class="feature-card"><div class="feature-title">Goals &amp; habits</div><p>…</p></article>
    <article class="feature-card"><div class="feature-title">Quizzes</div><p>…</p></article>
    <article class="feature-card"><div class="feature-title">Puzzles</div><p>…</p></article>
    <article class="feature-card wide"><div class="feature-title">House points</div><p>…</p>
      <div class="feature-visual points" role="img" aria-label="…"><div><b>148</b><small class="kid-mia">Mia</small></div><div><b>96</b><small class="kid-leo">Leo</small></div>…</div></article>
  </div>
</section>
```
Grid: 4 columns. `.large` = 2×2, `.wide` = 2×1, plain = 1×1. Three sizes,
so nothing is the same size as everything else. `.feature-number` is gone.
The poll's leading bar is violet — **exception noted:** it reads as the
winning vote, which in the app is the option a user tapped; if you'd rather
keep violet strictly clickable, use `--text` for the lead bar instead. Both
are acceptable; the canvas shows violet.

### S7 · Every screen
```html
<section id="devices" class="section" aria-labelledby="devices-title">
  <p class="kicker">iPhone · iPad · Web</p><h2 id="devices-title">…</h2><p class="section-intro">…</p>
  <div class="device-row">
    <figure><div class="device-frame frame-phone" role="img" aria-label="…"><div class="device-screen">
        <div class="mini-today">…</div><div class="tabbar" aria-hidden="true">…Today Chat Calendar Homework</div></div></div>
      <figcaption class="device-caption"><strong>iPhone</strong><span>…</span></figcaption></figure>
    <figure><div class="device-frame frame-ipad" role="img" aria-label="…"><div class="device-screen">
        <div class="rail">…</div><div class="ipad-main">…</div><div class="docked-chat">…</div></div></div>
      <figcaption class="device-caption"><strong>iPad</strong><span>…</span></figcaption></figure>
    <figure><div class="device-frame frame-web" role="img" aria-label="…"><div class="browser-bar"><i></i><i></i><i></i><span>fametc.com</span></div><div class="device-screen">…</div></div>
      <figcaption class="device-caption"><strong>Web</strong><span>…</span></figcaption></figure>
  </div>
  <p class="store-note"><svg/><span>The iPhone &amp; iPad app is coming to the App Store. …</span></p>
</section>
```
No fake status bars inside the device frames. The App Store line is plain
text, not a badge — swap in the real badge only when the app is live (§14).

### S8 · Kid mode / Parent mode
```html
<section id="kids" class="section" aria-labelledby="modes-title">
  <p class="kicker">Kid mode · Parent mode</p><h2 id="modes-title">Same family, two very different days.</h2>
  <div class="mode-switch">
    <div class="mode-copy">
      <div class="mode-toggle" role="tablist" aria-label="Choose a view">
        <button class="mode-tab" role="tab" id="tab-kid" aria-selected="true" aria-controls="mode-kid">Kid mode</button>
        <button class="mode-tab" role="tab" id="tab-parent" aria-selected="false" aria-controls="mode-parent" tabindex="-1">Parent mode</button>
      </div>
      <div class="mode-text" data-mode="kid"><h3>Big, bright and only today.</h3><p>…</p></div>
      <div class="mode-text" data-mode="parent" hidden><h3>The whole family at a glance.</h3><p>…</p></div>
    </div>
    <div class="mode-frame" role="tabpanel" id="mode-kid" aria-labelledby="tab-kid">
      <div class="kid-hello"><span class="avatar bg-mia">M</span>Hi Mia</div>
      <div class="kid-tiles"><div class="kid-tile"><b>2</b><span>things due today</span></div>
        <div class="kid-tile row"><span>Swim squad · pool 2</span><b>15:30</b></div>
        <div class="kid-tile row"><span>Reading streak</span><b>9 days</b></div></div>
    </div>
    <div class="mode-frame" role="tabpanel" id="mode-parent" aria-labelledby="tab-parent" hidden>
      <div class="kid-hello"><span class="avatar bg-p">P</span>This week</div>
      <div class="parent-week"><div class="rowh">…MON…FRI</div><div class="row"><b class="kid-mia">Mia</b><div class="cell"><em class="mia">Clarinet</em></div>…</div>…</div>
    </div>
  </div>
</section>
```
One component, two states. Both panels are in the DOM; `hidden` toggles.
(The canvas artboard shows both states side by side for review; the live
page shows one at a time.) The selected tab is violet — it is a control.

### S9 · Privacy & safety
```html
<section id="privacy" class="privacy-band" aria-labelledby="privacy-title">
  <div class="section privacy-grid">
    <div><p class="kicker">Privacy &amp; safety</p><h2 id="privacy-title">…</h2><p>… <a href="/privacy">Read the full privacy policy</a>.</p></div>
    <ul class="privacy-list">
      <li><svg/><span><strong>Encrypted at rest</strong>…</span></li> ×5
    </ul>
  </div>
</section>
```
Ground is `--sidebar`, borders `--border`, icons stroke `--text`. No cards,
no color. Restraint is the design.

### S10 · How it works
Unchanged structure: `.steps-grid > .step-card` ×3 with `.step-label`,
`.step-title`, `<p>`. Copy tightened (§10.11). Section gets an `<h2
id="steps-title">` so the section is labelled.

### S11 · FAQ
Unchanged structure: `.faq-list > details.faq-item > summary + .faq-answer`.
Eight items (§10.12).

### S12 · Final CTA
```html
<section class="section" aria-labelledby="cta-title">
  <div class="cta-panel"><h2 id="cta-title">Start with this week.</h2><p>…</p>
    <div class="cta-actions"><a class="button button-primary button-large" href="/signup">Create your family</a></div>
    <p class="availability">… (same variant as hero)</p>
  </div>
</section>
```
One button. The two secondary buttons are gone.

### S13 · Footer
Unchanged structure. `.footer-note` copy changes; the `School sync` link
points at `#school-sync`.

---

## 5. CSS — what to remove, change and add in `public/css/landing.css`

Work from top to bottom. Line numbers are today's file.

### 5.1 Keep as-is (lines 1–159, minus one block)
`:root`, `body`, `a`, `.landing-shell`, `section[id]`, `.site-header`,
`.header-inner/.section/.footer-inner`, `.brand*`, `.site-nav`,
`.header-actions`, the mono micro-label rule (121–129), `.button*`,
focus-visible (150–154), nav/footer 44px targets (156–159).

- **Delete lines 130–133** (`.header-trial`).
- **Change line 140** `.button { … }`: add `gap: 8px;` (icon spacing) — optional.
- **Change `.section` (line 1259–1262)** to `padding-block: 88px` (was
  24/56). Sections now breathe; the page has fewer of them doing more.

### 5.2 Delete the hero mock and proof section wholesale
- **Delete lines 173–196** (`.school-badge`, `.school-badge-dot`,
  `.school-badge .micro`).
- **Delete lines 234–238** (`.preview-card`).
- **Delete lines 248–277** (`.preview-browser-bar`, `-dots`, `-address`).
- **Delete lines 279–863** — every `.dashboard-*` rule. This is the
  scaled-down three-column application. Nothing survives.
- **Delete lines 865–1252** — `.proof-section`, `.proof-intro`,
  `.proof-grid`, `.product-preview`, `.product-window*`, all `.calendar-*`,
  all `.chat-proof-*`, `.audience-chip`, `.kid-chip`, `.parent-chip`,
  `.result-icon`, and the `figcaption` rules. The chat→action idea is
  rebuilt as S4 with new class names.
- **Delete lines 1264–1266** (`.moodle-section`), **1296–1301**
  (`.moodle-copy h2`), **1308–1311** (`.moodle-copy p`), **1312–1316**
  (`.moodle-trust` → becomes `.sync-trust`), **1322–1343** (`.moodle-items`,
  `.moodle-item*` → become `.sync-items`, `.sync-item*`), **1273–1279**
  (`.moodle-grid` → `.pillar-grid`).
- **Delete lines 1367–1379** (`.feature-number`).
- **Delete lines 1392–1457** (`.mode-grid`, `.mode-card*`, `.mode-pills`,
  `.mode-pill*`, `.stats-grid`, `.stat-box`, `.stat-value`, `.stat-label`) —
  replaced by `.mode-switch` and friends.
- **Delete lines 1459–1462** (`.steps-section`) and **1557–1560**
  (`.cta-section`) — sections use the shared `.section` padding now.
- **Delete lines 1652–1824** — all four `@media` blocks. Replaced (§6).

### 5.3 Change
- **Line 225–232** `.preview-card, .panel-card, .feature-card, .mode-card, .product-preview, .cta-panel { … }` →
  `.panel-card, .feature-card, .cta-panel, .moment-card, .chat-phone, .today-card, .homework-card, .mode-switch, .device-frame, .step-card { background: var(--panel); border: 1px solid var(--border); box-shadow: var(--shadow); }`
- **Line 1254–1257** `.step-card { background: var(--panel-2) }` → delete
  (it now uses `--panel` via the shared rule above).
- **Line 160–164** `.hero` → two-column grid:
  `display:grid; grid-template-columns:minmax(0,520px) minmax(0,1fr); gap:56px; align-items:center; padding-block:64px 40px;`
- **Line 166–171** `.hero-copy` → remove `text-align:center` and the
  `animation` (motion now lives in the stage, not the copy).
- **Line 198–206** `.hero h1` → `font-size: clamp(40px, 4.4vw, 62px); line-height: 1; letter-spacing: -0.035em; margin: 0;`
- **Line 208–215** `.hero-lede` → `margin: 22px 0 0; max-width: 46ch;` (left-aligned).
- **Line 217–223** `.hero-actions` → `justify-content: flex-start; margin-top: 30px;`
- **Line 240–246** `.hero-stage` → `position: relative; min-height: 600px;` (drop the `left:50%/translateX` centering).
- **Line 1291–1294** `.section h2` → `font-size: clamp(30px, 3vw, 40px); line-height: 1.08; text-wrap: balance;`
- **Line 1345–1349** `.section-intro` → `max-width: 56ch; margin: 14px 0 0; line-height: 1.55;`
- **Line 1351–1355** `.feature-grid` → rename to `.bento`, add
  `grid-auto-rows: minmax(150px, auto); margin-top: 40px;`
- **Line 1357–1365** `.feature-card` → `border-radius: 18px; padding: 22px; display: flex; flex-direction: column; gap: 6px; min-width: 0;` and drop the hover transform (bento tiles aren't links).
- **Line 1562–1566** `.cta-panel` → `padding: 56px 44px;`
- **Line 1581–1587** `.cta-actions` → drop `flex-wrap` and `gap` (one button).
- **Line 1639–1650** reduced-motion block → keep, and **add** the explicit
  final-frame rules from §7.

### 5.4 Add
Append everything in `reference-landing.css` from the `/* hero */` comment
onward that is not already covered above. The file is organised by section
with a comment per section (`/* hero */ /* trust strip */ /* before */
/* pillar grid (S3) */ /* chat section (S4) */ /* day timeline (S5) */
/* bento (S6) */ /* devices (S7) */ /* modes (S8) */ /* privacy (S9) */
/* steps, faq, cta, footer */ /* motion fallback */ /* breakpoints */`).
It is 348 lines and uses only the variables in §2.

Skip the first ~20 lines of `reference-landing.css` (resets, `body`, `a`,
header, buttons) — `landing.css` already has them; the reference file
carries them only so the canvas renders standalone. Also skip
`.variant-label` (canvas-only).

Net effect: `landing.css` goes from 1,824 lines to roughly 900.

---

## 6. Breakpoints

`--landing-stage` stays `1440px`. Container padding 28px, 20px at ≤520.

| Section | 1440 | 1024 | 768 | 360–520 |
|---|---|---|---|---|
| Header | brand · nav · Sign in · Create family | nav hidden (`.site-nav{display:none}`) | same | `Create family` hidden; Sign in stays |
| S1 Hero | 2 cols: copy 520px / stage; stage 600px tall, card 460px right-anchored, three floats | 1 col; stage below copy, max-width 640px, floats re-anchored (chat top-left, due bottom-left, sync bottom-right) | same | stage becomes a vertical stack: card, then the three floats as full-width rows; no absolute positioning; no animation |
| Trust strip | one centred row | wraps | wraps | vertical list, left-aligned |
| S2 Before | 2 cols: fragments (absolute, rotated) / copy 420px | 1 col; fragments above copy | fragments height 240px | fragments stack as a grid, `position:static`, ±1° rotation |
| S3 School | 2 cols: copy 480px / visual | 1 col; homework card static, toast above it | same | `.sync-items` 1 col |
| S4 Chat | 3 beats in a row, chevrons between | same | 1 col, max 420px centred, chevrons rotate to point down | same |
| S5 Day | copy 380px sticky / timeline | 1 col, copy not sticky | same | tighter columns (56/28/1fr) |
| S6 Bento | 4 cols; large 2×2, wide 2×1 | same | 2 cols | 1 col (`minmax(0,1fr)`); spans reset |
| S7 Devices | 3 across: phone 260 / iPad flex / web 360 | 2 cols; web spans full row | 1 col; iPad screen 320px tall; docked chat hidden | same; phone capped 260px |
| S8 Modes | copy / frame 380px | 1 col | same | padding 20px |
| S9 Privacy | copy 400px / 2-col list | 1 col | 1-col list | same |
| S10 Steps | 3 cols | same | 1 col | same |
| S11 FAQ | 820px max | same | same | same |
| S12 CTA | centred panel | same | same | full-width button |
| Footer | brand · note · links right | same | links wrap | links left |

Exact rules are the three `@media` blocks at the end of `reference-landing.css`
(`max-width: 1024px`, `768px`, `520px`). 360px was checked at 390 on the
canvas; nothing depends on the 30px difference. Horizontal overflow at 390
is zero (`document.documentElement.scrollWidth === innerWidth`).

---

## 7. Motion

Motion appears in exactly two places plus an optional third. Everything is
transforms and opacity. Nothing autoplays video; nothing scroll-jacks.

| Element | Property | Duration / easing | Trigger | Reduced-motion fallback |
|---|---|---|---|---|
| Hero `.momentum-fill` | `transform: scaleX(0→1)` (`transform-origin:left`), keyframes `famFill` | 900ms `cubic-bezier(.2,.7,.2,1)`, `both` | page load | `animation: none` → bar rendered at its final 50% width |
| Hero `.float-chat` / `.float-due` / `.float-sync` | `opacity 0→1`, `translateY(10px→0)`, keyframes `famRise` (already in file, line 1628) | 600ms `ease`, delays 250 / 400 / 550ms | page load | `animation: none` → visible, in place |
| S4 `.chat-beat` ×3 | `opacity 0→1`, `translateY(14px→0)` via transition | 500ms `ease`; `transition-delay` 0 / 350 / 700ms | `IntersectionObserver` adds `.is-in` to `.chat-sequence` at 35% visibility, once | `.chat-beat{opacity:1;transform:none;transition:none}` — all three beats fully visible |
| Optional: section reveals | `opacity`, `translateY(12px)` on `[data-reveal]` | 400ms `ease` | same observer | no animation |

The whole page must read correctly with JavaScript disabled: the CSS default
for `.chat-beat` is `opacity:0` **only when** the sequence has the `data-reveal`
attribute **and** the script has run. Implement it as: the script adds class
`js` to `<html>` on load; the hidden state is `html.js .chat-sequence:not(.is-in) .chat-beat{opacity:0;transform:translateY(14px)}`.
No script → no hiding.

Reduced-motion block (extend the existing one at line 1639):
```css
@media (prefers-reduced-motion: reduce) {
  :root { scroll-behavior: auto; }
  .momentum-fill, .float { animation: none; }
  .chat-beat { opacity: 1 !important; transform: none !important; transition: none; }
}
```

---

## 8. Dark mode wiring for `landing.html`

1. **Pre-paint script.** Copy `public/index.html` lines 13–23 verbatim into
   `landing.html`'s `<head>`, *before* the stylesheet links:
   ```html
   <script>
     (function () {
       try {
         var raw = localStorage.getItem('fam_theme');
         var t = raw ? JSON.parse(raw) : null;
         var dark = t === 'dark' || (t !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
         document.documentElement.classList.toggle('dark', dark);
       } catch (e) { /* localStorage unavailable — default light */ }
     })();
   </script>
   ```
   Inline scripts are allowed by the server's CSP (`script-src 'self'
   'unsafe-inline'`, `server.js:108`).

2. **`theme-color`.** Replace the single hard-pinned meta with two:
   ```html
   <meta name="theme-color" media="(prefers-color-scheme: light)" content="«light --bg from §2»">
   <meta name="theme-color" media="(prefers-color-scheme: dark)"  content="«dark --bg from §2»">
   ```
   Then, at the end of the pre-paint script, override for an explicit saved
   choice: `document.querySelectorAll('meta[name=theme-color]').forEach(function(m){ m.content = dark ? '«dark --bg»' : '«light --bg»'; });`

3. **No toggle on the landing page.** Dark follows the OS or the saved
   in-app choice. The app's Settings > Appearance already writes `fam_theme`.

4. Nothing else changes: every rule uses tokens, so `.dark` re-resolves them.
   Verify on the canvas: `HeroDark`, `ChatSectionDark`, `FinalCTADark`.

---

## 9. JavaScript — `public/js/landing.js` (new, ~40 lines, no deps)

Load with `<script src="/js/landing.js" defer></script>` before `</body>`.

```js
document.documentElement.classList.add('js');

// 1. Chat→action reveal (and optional [data-reveal] sections)
var seq = document.querySelectorAll('[data-reveal]');
if ('IntersectionObserver' in window) {
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
  }, { threshold: 0.35 });
  seq.forEach(function (el) { io.observe(el); });
} else { seq.forEach(function (el) { el.classList.add('is-in'); }); }

// 2. Kid / Parent tablist
var tabs = Array.prototype.slice.call(document.querySelectorAll('.mode-tab'));
function selectTab(tab) {
  tabs.forEach(function (t) {
    var on = t === tab;
    t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
  });
  document.querySelectorAll('.mode-text').forEach(function (p) { p.hidden = p.dataset.mode !== tab.id.replace('tab-', ''); });
  tab.focus();
}
tabs.forEach(function (t, i) {
  t.addEventListener('click', function () { selectTab(t); });
  t.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); selectTab(tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]); }
    if (e.key === 'Home') selectTab(tabs[0]); if (e.key === 'End') selectTab(tabs[tabs.length - 1]);
  });
});

// 3. Variant B only: waitlist disclosure
document.querySelectorAll('.waitlist-toggle').forEach(function (a) {
  a.addEventListener('click', function (e) {
    e.preventDefault();
    var f = document.getElementById(a.getAttribute('aria-controls'));
    var open = f.classList.toggle('is-open'); a.setAttribute('aria-expanded', String(open));
    if (open) f.querySelector('input').focus();
  });
});
```

---

## 10. Copy deck — every string on the page

### 10.1 `<head>`
- `<title>`: **Fam ETC — stay in touch, stay on top**
- `meta description`: **Fam ETC is where a family runs its week: school homework, timetable and activities arrive on their own; chat, meals, lifts and plans get decided in one family thread — and turned into the plan with a tap.**

### 10.2 Header
Nav: `Features` · `Family chat` · `School sync` · `iPhone & iPad` · `FAQ`.
Buttons: `Sign in` · `Create family`.

### 10.3 Hero
**Kicker:** `STAY IN TOUCH · STAY ON TOP` (mono micro-label; the dot is coral).

**Headline — three candidates:**

1. **Everyone knows what today looks like.** ← *recommended*
2. Stay in touch. Stay on top.
3. The family thread that actually gets things done.

*Recommendation:* #1. It is an outcome, not a category, and it is true for
both pillars at once — knowing "what today looks like" is exactly what school
sync delivers and exactly what the family thread settles. It is also the
sentence the old page already ended its lede on, so it has been read by
real parents without objection. #2 is the page's skeleton and is better as
the kicker above the headline (where it now sits) than as the headline —
as an h1 it is a tagline, and taglines assert where outcomes show. #3 is the
strongest single-pillar line but tips the page toward chat and undersells
school sync.

**Sub-headline:** `School on one side, home on the other, one family thread down the middle. Homework, the timetable and after-school activities arrive on their own; lifts, kit bags and dinner get decided in chat — and turned into the plan with a tap.`

**CTAs:** primary `Create your family` → `/signup`; secondary `See a family week` → `#day`.

**Availability line — Variant A (Focused, no product change):**
`Open now to St Andrews Bangkok families. Other schools — join the list.`
"join the list" is `<a href="mailto:hello@fametc.com?subject=Fam%20ETC%20for%20our%20school">` (address to confirm, §14).

**Availability line — Variant B (Waitlist):**
`Open now to St Andrews Bangkok families. Other schools — join the waitlist.`
"join the waitlist" toggles the inline form:
- helper (mono micro): `Your school and an email — we'll write when it opens.`
- inputs: placeholder `School name` (aria-label `School name`), placeholder `you@example.com` (aria-label `Email`, `type=email`)
- button: `Notify me` (secondary style — it is not the page's primary action)
- success (after POST): `Thanks — we'll write when your school is ready.`
- error: `That didn't send. Try again, or email hello@fametc.com.`

**Hero Today card (real text):**
- eyebrow `WEDNESDAY 22 AUGUST`; greeting `Good morning, Priya`; chip `School sync 08:10`
- momentum: `Today` … `3 of 6 done`
- list: `08:20` `Football · Leo` / `Astro pitch · kit + boots` / `ECA`; `10:00` `Clarinet · Mia` / `Music block · room 4` / `ECA`; `15:30` `Swim squad · Mia` / `Pool 2 · bring goggles` / `ECA`
- `FAMILY ACTIONS`: `Sign Mia's swim gala permission slip` — `Due today`; `Pack Leo's football kit` — `Tomorrow`

**Floats:** chat `Leo · 12:05` / `Can someone bring my goggles?`; due `Maths · Fractions worksheet` / `Mia · due 16:00`; sync `2 items added from school` / `09:12`.

**Trust strip:** `ENCRYPTED AT REST` · `READ-ONLY SCHOOL SYNC` · `NO ADS, NO TRACKING` · `KIDS CAN'T SIGN UP ALONE`

### 10.4 Before (S2)
Kicker `BEFORE`. H2: `Five threads, a fridge door, and a slip you found on Monday.`
Body: `Everyone had a piece of the week. Nobody had the week. The kit gets remembered in the car and the due date at 8pm.` (≈45 words with the heading.)
Fragments (decorative): `Year 4 Parents` / `47 members · "does anyone know if…"` / `128`; `Swim squad parents` / `Gala moved to Friday??` / `31`; `Family` / `Dad: who has the car Thursday` / `9`; whiteboard `Thurs — Leo football / Fri — ??? dinner / ~~Mia clarinet~~ moved`; slip `PERMISSION SLIP · Swim gala / Return by Tue 13 Aug / FOUND MON 19 AUG`.

### 10.5 Stay on top (S3)
Kicker `STAY ON TOP`. H2: `You never chase a due date again.`
Body: `A parent pastes each child's private homework and timetable links once, in Settings. From then on homework, the timetable and after-school activities arrive in Fam ETC on their own — read-only, refreshed every eight hours, nothing to re-type.`
Items: `Homework` / `Outstanding tasks, subjects and due dates — per child`; `Timetable` / `This week's periods, rooms and teachers`; `ECAs & activities` / `Clubs and squads, right in the timetable`; `Automatic refresh` / `Checked every eight hours, only if the school changed something`.
Trust line: `**Parent-controlled.** The school link is encrypted, never shown again after you paste it, and only ever read. [How we handle school data](/privacy)`
Homework card: title `Homework`; chip `Synced 08:10 · next 16:10`; filter `All` `Mia` `Leo`; rows `English · Reading log` / `Mia · Ms Harper` / `Done`; `Maths · Fractions worksheet` / `Mia · Mr Chen` / `Today 16:00`; `Science · Food chains poster` / `Leo · Ms Okafor` / `Mon`; `French · Vocabulary set 4` / `Leo · Mme Roux` / `Thu`.
Toast: `SCHOOL SYNC` / `Maths worksheet added for Mia, due today` / `09:12`.

### 10.6 Stay in touch (S4)
Kicker `STAY IN TOUCH`. H2: `The thread where things actually get decided.`
Intro: `One chat for the whole family — parents and kids. And when a message is really a job, a date or a shopping run, turn it into one without re-typing a word. That's the moment "in touch" and "on top" become the same thing.`
Beat labels: `01 A message` · `02 Turn it into…` · `03 It's on the list`.
Chat header `Family`. Messages: sys `School sync · 09:12 · Maths worksheet added for Mia`; `Leo · 12:05` `Can someone bring my goggles?`; `Priya · 12:07` `In the swim bag.`; `Priya · 12:08` `Could we pick up pasta, tomatoes and basil for dinner?`; composer `Message the family…` / `Send`.
Action sheet: `TURN THIS MESSAGE INTO` — `Action` · `Calendar` · `Shopping`.
Result: `Added to Shopping` / `Dinner · 3 items · Today` / `Pasta` `Tomatoes` `Basil` / `Shared with the family · whoever's near a shop ticks them off`; sys `Priya added 3 items to Shopping · 12:08`.
Safety row: `One thread per family` / `No groups to manage, no one left out.` · `Kids read and reply safely` / `They see the family thread and their own day — nothing else.` · `Parents keep the keys` / `Any parent can delete any message or remove a member.`

### 10.7 A day in the family (S5)
Kicker `ONE WEDNESDAY`. H2 `A day in the family.` Intro: `Every moment below is a feature doing its job — for Priya, Mia and Leo, on a school day like any other. Nothing lands at 8pm that you should have known at 8am.`

| Time | Kicker | Title | Body | Mini |
|---|---|---|---|---|
| 07:10 | REMINDERS | Leo's football kit | Nudged the night before and again before the school run. | chip `Kit + boots · in the car` (Leo dot) |
| 08:20 | ECAS & TIMETABLE | Football · astro pitch | From the school timetable, in Leo's colour, on everyone's Today. | chip `Period 1 · Astro pitch` |
| 09:12 | SCHOOL SYNC | Maths worksheet added for Mia | Due today. Arrived on its own — nobody typed it in. | chip `Synced from school` (green dot) |
| 12:05 | FAMILY CHAT | "Can someone bring my goggles?" | Leo asks the family. Priya answers from the office. | bubbles `Can someone bring my goggles?` / `In the swim bag.` |
| 12:08 | CHAT ACTIONS | Dinner becomes a shopping list | "Pasta, tomatoes, basil" → three items, shared with the family. | pills `Pasta` `Tomatoes` `Basil` |
| 16:00 | HOMEWORK HUB | Fractions worksheet — done | Mia ticks it off. Priya sees it without asking. | chip `Done 15:52` (green dot) |
| 19:00 | MEALS | Friday dinner, chosen together | Three votes, one winner, no debate at the table. | poll `Pad thai 3` / `Pizza 1` |

### 10.8 Everything else (S6)
H2 `Everything else a family week needs`. Intro `Same app, same calm layout, same family — one place for the things that don't come from school.`
- **Meals** — `Plan the week's dinners together. Pick a night, put it to a vote, and the shopping list writes itself.` Visual: `FRIDAY DINNER · 4 VOTED` — `Pad thai 3` / `Pizza 1` / `Tacos 0`.
- **Shared calendar** — `School events and family plans in one week, filtered per child.` Visual: `MON Football (Leo)` `TUE Clarinet (Mia)` `WED Swim squad (Mia)` `THU Grocery run` `FRI Family dinner`.
- **Trips** — `Plan a holiday with the other adults who are coming — dates, bookings, who brings what.`
- **Goals & habits** — `Reading, practice, bedtime — small habits tracked without nagging.`
- **Quizzes** — `Short rounds that follow this term's subjects — five minutes before dinner counts.`
- **Puzzles** — `A daily puzzle for each age band. Siblings can race; parents usually lose.`
- **House points** — `Straight from school, per child, with this week's change.` Visual: `148 Mia` `96 Leo` `+11 this week`.

### 10.9 Every screen (S7)
Kicker `IPHONE · IPAD · WEB`. H2 `Every screen the family already uses.`
Intro: `One passkey login, one family, three surfaces. The layout adapts instead of shrinking: a tab bar on iPhone, a nav rail with the family chat docked beside your day on iPad, the full layout on the web.`
Captions: **iPhone** `Today, Chat, Calendar and Homework as native tabs.` · **iPad** `Nav rail, your day, and the family chat docked alongside. In portrait, chat slides over.` · **Web** `Everything, including Settings, Goals and Trips, at fametc.com.`
Store note: `The iPhone & iPad app is coming to the App Store. The web app is open today — same login, same family.`

### 10.10 Kid / Parent (S8)
Kicker `KID MODE · PARENT MODE`. H2 `Same family, two very different days.`
Tabs `Kid mode` · `Parent mode`.
Kid: h3 `Big, bright and only today.` p `Kids see three things: what's due, what's on after school, and their streak. Nothing they can break, nothing they need a parent for.` Frame: `Hi Mia` · `2` / `things due today` · `Swim squad · pool 2` / `15:30` · `Reading streak` / `9 days`.
Parent: h3 `The whole family at a glance.` p `Every child, every deadline, every ECA in one week — plus meals, trips, reminders and the family thread, in one place instead of five.` Frame: `This week`; rows Mia (`Clarinet`, `Reading log`, `Maths due` + `Swim 15:30`, —, `Swim gala`), Leo (`Football`, —, `Football`, `French due`, —), Family (—, —, `Slip due`, `Grocery run`, `Pad thai night`).

### 10.11 Privacy & safety (S9)
Kicker `PRIVACY & SAFETY`. H2 `You're handing us your children's week. Here's the deal.` p `Plain commitments, not a policy summary. [Read the full privacy policy](/privacy).`
1. **Encrypted at rest** — `Chat messages and every piece of children's data are encrypted on our servers.`
2. **School sync is read-only** — `The school link is encrypted and never shown again after you paste it. We read; we never write back.`
3. **No ads, no tracking** — `We count page views in aggregate. There is no per-person analytics profile — of you or your kids.`
4. **Kids can't sign up alone** — `A parent creates every child profile and approves every child device.`
5. **Parents keep the keys** — `Any parent can delete any message in the family and remove any member.`

### 10.12 How it works (S10)
H2 `Up and running in one evening`.
- `STEP 01` **Create your family** — `One passkey account, add each child. About a minute.`
- `STEP 02` **Connect the school** — Variant A: `Paste each child's private homework and timetable links once, in Settings. Fam ETC checks them every eight hours from then on.` Variant B: `St Andrews: paste each child's private homework and timetable links once, in Settings. Another school: skip this — chat, calendar, meals and reminders work everywhere, and we'll write when your school is ready.`
- `STEP 03` **Open Today** — `Homework, ECAs, the timetable and points are already there. Say hi in the family thread.`

### 10.13 FAQ (S11) — H2 `Questions parents ask first`
1. **Is Fam ETC really free?** — `Yes, to start. Every family gets a 30-day trial with no card. St Andrews families currently sign up free with an invite code. [See pricing](/pricing).`
2. **Is this an official St Andrews app?** — `No — Fam ETC is built by parents, for families. It reads the private school feeds you choose to connect, and nothing else.`
3. **Who can see our data?** — `Only your family. Parents control every connection, the school link is encrypted, and school sync is strictly read-only. [Read the privacy policy](/privacy).`
4. **What if a teacher doesn't post the homework?** — `Snap the homework diary page. Fam ETC reads it and adds the tasks alongside the synced ones.`
5. **Does it work on iPhone and iPad?** — `Yes. The web app works on every device today; the native iPhone & iPad app is coming to the App Store. One passkey login covers both.`
6. **What if we're not at St Andrews?** — `Chat, the shared calendar, meals, reminders, goals and trips work for any family right now. Automatic school sync is live for St Andrews Bangkok; other schools can join the list and we'll write when yours is ready.`
7. **Can my kids see everything I see?** — `No. Kids see the family thread and their own day — homework, activities, streaks. Billing, family settings and other children's details stay with parents.`
8. **What does it cost after the trial?** — `One annual family plan covering both parents and all the kids. Current prices are on the [pricing page](/pricing); St Andrews invite-code families stay free.`

### 10.14 Final CTA (S12)
H2 `Start with this week.` p `Create your family tonight. By the school run, everyone knows what today looks like.` Button `Create your family`. Availability line: same variant as the hero.

### 10.15 Footer (S13)
Note: `www.fametc.com · made by parents in Bangkok`. Links: `Privacy` `/privacy` · `Pricing` `/pricing` · `Support` `/help` · `School sync` `#school-sync`.

### 10.16 Alt text / accessible names (every product visual)
- Hero stage (`role=group`): `Fam ETC Today screen with a family chat message, a homework due chip and a school sync notice`
- Today card: `Today screen`; floats: `Family chat message` / `Homework due` / `School sync notice`; progress bar: `3 of 6 things done today`
- Trust strip list: `Trust commitments`
- Before fragments: `aria-hidden="true"` (decorative; the copy carries it)
- S3 visual: `Homework screen: Mia's Maths worksheet due today, reading log done; Leo's science poster due Monday. A notice shows the Maths worksheet arriving from school at 09:12.`
- S4 beat 1: `Family chat: Priya asks whether someone could pick up pasta, tomatoes and basil for dinner`; beat 2: `Turn this message into: Action, Calendar or Shopping. Shopping is selected.`; beat 3: `Added to Shopping: Dinner, 3 items, today — Pasta, Tomatoes, Basil — shared with the family`
- S6 Meals visual: `Friday dinner poll: Pad thai 3 votes, Pizza 1, Tacos 0`; Calendar: `Week strip: Monday Leo football, Tuesday Mia clarinet, Wednesday Mia swim squad, Thursday grocery run, Friday family dinner`; House points: `House points: Mia 148, Leo 96, up 11 this week`
- S7 iPhone: `iPhone: Today screen with a tab bar — Today, Chat, Calendar, Homework`; iPad: `iPad landscape: navigation rail, Today in the middle, family chat docked on the right`; Web: `Web browser: the full Fam ETC layout at fametc.com`
- S8 panels: `Kid mode: Mia's view` / `Parent mode: the whole family's week`; tablist `Choose a view`
- Brand links: `Fam ETC home`; all decorative SVG icons `aria-hidden="true"`

---

## 11. Availability variants — A vs B

Same layout, one different secondary action. **Do not fork the page.** The
owner picks; build A unless told B.

**Variant A (Focused).** The availability `<p>` under the hero CTAs and
under the final CTA, with a `mailto:` link. Zero backend work.

**Variant B (Waitlist).** Same `<p>`; the link is a disclosure
(`aria-expanded`, `aria-controls`) revealing `form.waitlist-form`
(`action="/api/waitlist" method="post"`, fields `school`, `email`). Enhance
with `fetch` in `landing.js`; fall back to a normal POST. Server side, add to
`server.js`:
- `POST /api/waitlist` → validate (`school` 1–120 chars, `email` RFC-ish),
  append `{school, email, at}` to `FAM_DATA_DIR/waitlist.json` (encrypted
  with the existing `datacrypto.js` helpers, since it is personal data),
  respond `204`. Rate-limit 5/min/IP with the existing limiter. Return `303`
  to `/?joined=1` on a non-JS POST.
- Step 02 copy and FAQ #6 already accommodate B.
Roughly half a day. Everything else on the page is identical.

---

## 12. Accessibility — per component

- **Heading order:** one `h1` (hero); every section an `h2` (`aria-labelledby`); S8 has `h3`s under its `h2`. No skips.
- **Header:** nav has `aria-label`; all links ≥44px tall (existing rule). At ≤1024 the nav is hidden — the five sections remain reachable by scrolling; do not add a hamburger.
- **Buttons/links:** `:focus-visible` = `3px solid var(--accent)`, offset 3px (existing rule 150–154) — covers `.button`, `a`, and must be extended to `.mode-tab` and `summary`.
- **Hero stage:** `role=group` + label; each float has `aria-label`; progress bar has `role=progressbar` with values; text is real DOM. `.checkbox` spans are `aria-hidden` (state is in the text: "Due today" / "Done").
- **Before:** fragments `aria-hidden`; `h2` + `p` carry meaning.
- **S3/S4/S6/S7:** every product visual has `role=group`/`role=img` with a full-sentence label (§10.16). Nothing claimed only in pixels.
- **Chat sequence:** no control to operate; it reveals on scroll (keyboard scrolling triggers the observer). Static and reduced-motion states show all three beats. Beat labels are real text.
- **Kid/Parent toggle:** WAI-ARIA tabs pattern — `role=tablist`/`tab`/`tabpanel`, `aria-selected`, roving `tabindex`, Arrow/Home/End keys, `aria-controls`/`aria-labelledby` pairing (§9). Hidden panel uses the `hidden` attribute.
- **FAQ:** native `<details>`; `summary` gets the violet focus ring; the `+`/`−` marker is CSS `::after`, not content.
- **Waitlist form (B):** `<label>`/`aria-label` on both inputs, `type=email`, `required`, error message in an `aria-live="polite"` region.
- **Contrast:** verified in §2. Kid colours (`--c-teal`, `--c-amber`) are used for names and dots only, never as the sole carrier of meaning — the kid's name is always present in text.
- **Touch targets:** buttons 44/48px; tabs 40px tall inside a 48px track; FAQ summaries ≥48px; chips are non-interactive on this page.
- **No layout shift:** `.hero-stage{min-height:600px}` (620 at ≤1024) reserves the space; fonts are `font-display: swap` with system fallbacks already.

---

## 13. Assets

No new raster assets are required — every visual is HTML/CSS/inline SVG with
the two existing fonts. Optional:

| Asset | Size / format | Purpose |
|---|---|---|
| `public/img/og-landing.png` | 1200×630 PNG, light mode, headline + Today card | `og:image` / `twitter:image` for link previews (the page has none today). Export the `HeroLight` artboard from the canvas and crop. |
| App Store badge | Apple's official SVG, black, 120×40 | **Only when the app is live** (§14). Until then the plain text line stands. |

Inline SVG icon set used (stroke 1.8, 24-grid): lock, eye, no-ads (circle +
slash), shield-check, trash, users, check, action (rounded square + tick),
calendar, cart, sun, chat, book, phone. All in `reference-landing.body.html`.

---

## 14. Requires owner confirmation

None of these are token or typeface changes — the design proposes no changes
to `horizon.css`, the fonts, or the logo. They are product/content decisions
the design had to assume:

1. **Variant A or Variant B** (§11). The canvas shows both; the guide builds A by default.
2. **The "join the list" address** — the design uses `hello@fametc.com`. Confirm or replace; it does not exist in the codebase today.
3. **App Store status** — the design says "coming to the App Store" (`APP-BRIEF.md` says TestFlight first). Confirm wording; swap to the real badge only when the listing is live.
4. **Pricing claims in FAQ #1 and #8** — "30-day trial, no card", "one annual family plan", "St Andrews invite-code families stay free" are derived from `APP-BRIEF.md` §Monetization and today's FAQ. Confirm against `/pricing` before shipping.
5. **Sync cadence and mechanism** — "every eight hours", "read-only", "encrypted, never shown again" are lifted from today's page and `CLAUDE.md`. Confirm still true.
6. **Poll lead bar in violet** (§4 S6) — a judgment call on the "violet = interactive" rule; say the word and it becomes `--text`.
7. **Retiring the `#moodle` anchor** for `#school-sync`. No inbound links found; confirm no external material (school newsletters, etc.) links to `/#moodle`.

---

## 15. Acceptance checklist

Run against the built page at `https://fametc.com/` signed out, in light and
dark, at 1440 / 1024 / 768 / 390.

**Contract**
- [ ] `grep -c '#[0-9a-fA-F]\{6\}' public/css/landing.css` returns 0 (no hex in landing.css).
- [ ] `grep -c 'linear-gradient' public/css/landing.css` returns 1 (the momentum bar only).
- [ ] `grep -n 'moodle\|header-trial\|school-badge\|dashboard-\|proof-\|feature-number\|mode-card\|stat-box' public/landing.html public/css/landing.css` returns nothing.
- [ ] No new `@font-face`, no `<link>` to any third-party host, no new npm dependency; `landing.js` is the only script besides the pre-paint snippet.
- [ ] Every violet element on the page is a link, button, tab, selected option, or focus ring. Every coral element is decorative (kicker dot, gradient start, link hover).
- [ ] Mia is teal and Leo is amber in: hero list, hero due chip, homework card, timeline dots, week strip, house points, parent-week grid, avatars.
- [ ] Green appears only on done/synced; red only on due-today/overdue.

**Hero**
- [ ] The Today card's body text renders at ≥14px at 1440 (measure `.today-list li` computed font-size = 15px).
- [ ] `document.querySelectorAll('.hero-stage *').length` ≤ 60.
- [ ] Momentum bar animates once on load; with `prefers-reduced-motion: reduce` it renders at final width with no animation.
- [ ] No layout shift when fonts/cards load (Lighthouse CLS < 0.02).
- [ ] `See a family week` scrolls to `#day`, not to school sync.
- [ ] Availability line reads as the chosen variant; Variant B form opens on click, is keyboard-operable, and POSTs.

**Sections**
- [ ] Before band ≤ 60 words of visible copy.
- [ ] Chat sequence: all three beats visible with JS disabled; with JS, they reveal in order on scroll and stay visible after; with reduced motion, all visible immediately.
- [ ] Day timeline: seven moments, times in JetBrains Mono, rail dots coloured by kid.
- [ ] Bento: exactly three tile sizes present (2×2, 2×1, 1×1); no numbering.
- [ ] Devices: three frames, no fake status bar, App Store line is text (unless live).
- [ ] Kid/Parent toggle: click and Arrow keys switch panels; `aria-selected` flips; only one `tabpanel` visible; focus ring visible on the tab.
- [ ] Privacy band: five commitments; link to `/privacy` works.
- [ ] FAQ: eight items; `summary` focusable with violet ring.
- [ ] Final CTA: exactly one `<a class="button">` inside `.cta-panel`.
- [ ] Footer `School sync` link goes to `#school-sync`.

**Dark mode**
- [ ] With OS dark, page paints dark on first frame (no light flash); `theme-color` reports the dark `--bg`.
- [ ] With `fam_theme` = `"light"` saved, page stays light under OS dark, and vice versa.
- [ ] Every card, chip, bubble and border re-resolves (spot-check hero, chat section, CTA, footer against the `*Dark` artboards).

**Accessibility**
- [ ] One `h1`; heading outline has no skipped levels (browser a11y tree or `headingsMap`).
- [ ] Every `role=img`/`role=group` visual has a non-empty label; nothing product-claiming is `aria-hidden` except the Before fragments and icons.
- [ ] Tab through the whole page: every focus stop shows a violet ring in both themes.
- [ ] axe DevTools: 0 critical/serious.
- [ ] Contrast: `--text-2` on `--panel-2` ≥ 4.5:1 in both themes (§2).

**Responsive**
- [ ] 390px: `document.documentElement.scrollWidth === window.innerWidth`.
- [ ] 390px: hero stack order is copy → card → chat float → due float → sync float; buttons full-width.
- [ ] 768px: chat beats stack with chevrons pointing down; bento 2 columns.
- [ ] 1024px: nav hidden; hero single column; devices 2+1.

**Deploy (per CLAUDE.md)**
- [ ] `node --test` passes; conventional commit; deploy; `curl -I https://fametc.com/` 200 and `/api/health` shows the new build id; open the live URL and re-run the Hero + Dark checks there.
