# Fam ETC landing page — reimagining brief

**Status:** design brief. Input to a Fable design pass. Nobody implements from
this file — implementation happens from the guide Fable produces alongside the
design canvas.

**Target of the redesign:** `public/landing.html` (359 lines) +
`public/css/landing.css` (1,824 lines). Served by `server.js:683` to signed-out
visitors at `https://fametc.com/`.

**The one-line ask that drives everything below:** the landing page is for
*the modern family, to stay in touch and stay on top*. Today's page is for
*an STA parent who wants Moodle homework in an app*. That gap is the whole
brief.

---

## 1. Audit of the page as it stands

I read the live page and the source. It is competent, tidy, and on-system —
it is not a bad page. It is the wrong page for the stated ask. Specific
findings, roughly in order of how much they cost:

**1.1 — The first thing a visitor reads is a school's name, not a promise.**
The page opens with a badge: `BUILT FOR STA · ST ANDREWS INTERNATIONAL SCHOOL,
BANGKOK`. That's an eligibility notice above the fold. It tells a visitor who
they must be before it tells them what they get. For a "modern family"
positioning this is backwards — availability is a footnote to a promise, never
its opening line.

**1.2 — The hero visual is illegible.** `landing.html:61-166` renders a full
three-column application — sidebar, six nav items, greeting, actions card,
schedule card, homework card, Daily 5, house points, and a complete chat
column with four messages — inside a browser chrome scaled to fit a hero slot.
At real viewport size the type in that mock is roughly 6–8px. It is a texture,
not a screenshot. ~150 DOM nodes are spent on decoration that communicates
"there is an app" and nothing more. A visitor cannot read a single feature out
of it.

**1.3 — The best feature on the page is buried at 40% scale.**
`landing.html:212-231` — Chat Actions: a family message ("Could we pick up
pasta, tomatoes and basil for dinner?") becoming a structured shopping item.
That is the product's actual magic trick and the clearest expression of "stay
in touch *and* stay on top" in one motion. It currently sits as the right-hand
half of a two-up grid, static, under a caption. It should be a section.

**1.4 — The feature grid is a spec sheet.** `landing.html:257-266` — eight
identical cards, numbered 01–08, no imagery, equal visual weight. "Quizzes"
and "Puzzles" carry the same weight as "Family chat" and "Homework hub". A
numbered list of eight things reads as a feature inventory, which is what you
write when you have not decided what the product is *for*.

**1.5 — There is no emotional register at all.** No people, no faces, no
texture, no moment, no motion. The page describes a family product in the
visual language of a B2B analytics dashboard. "Calm" is asserted in the
headline and never *felt*. A family product that never shows a family is
leaving its entire emotional case on the table.

**1.6 — The problem is never stated.** The page opens at the solution. It
never names the five overlapping WhatsApp threads, the fridge whiteboard, the
permission slip found on Monday, the kit bag remembered in the car. Without
the "before", "calm" has nothing to be calm *relative to*.

**1.7 — The iOS app is invisible.** Fam ETC is a hybrid iOS + web product with
native Today/Chat/Calendar/Homework, iPhone *and* iPad as co-equal surfaces
(APP-BRIEF: "iPad is a KEY app surface"), and a genuinely unusual adaptive
story — nav rail plus docked family chat on iPad landscape, slide-over in
portrait. The landing page shows a browser window and never mentions a phone.

**1.8 — Trust is a paragraph inside a panel.** `landing.html:242` — one
sentence about encryption inside the school-sync card, plus one FAQ row.
This product holds children's homework, children's timetables, and a family's
private chat. Parental objection #1 is "who can see this". That deserves a
band of the page, not a clause.

**1.9 — CTA discipline.** The hero offers two CTAs; the final CTA offers
*three* (`landing.html:328-332`: Create your family / See how school sync works
/ See pricing). Three choices at the point of conversion is not a choice, it's
a stall. Also "See how school sync works" is an anchor to a section the
visitor has already scrolled past by the time they reach it.

**1.10 — Dark mode is missing.** `horizon.css` defines a complete `.dark`
palette. `index.html:13-23` applies it pre-paint. `landing.html` does neither
— no theme script, `theme-color` hard-pinned to `#f1efec`. A visitor in dark
mode gets a bright greige page, then a dark app after sign-in. The system
supports it; the landing opted out.

**1.11 — Accessibility is thin rather than wrong.** The hero mock is one
`role="img"` with a single label; the two proof windows are `aria-hidden`
`<figure>`s whose entire meaning lives in the `figcaption`. Not broken —
screen-reader users get captions — but every product claim on the page is
carried by pixels a screen reader never sees.

**1.12 — Nothing moves, and nothing is interactive.** For a page whose product
claim is "turn a message into a plan", a fully static page is a missed
argument. (This is a note about *purposeful* motion, not decoration — see §5.)

### What is working and must survive

- The Horizon system itself: greige ground, white panels, violet as the single
  interactive color, JetBrains Mono micro-labels. It looks like a considered
  product, not a template.
- The honesty of the copy. "No — Fam ETC is built by parents for STA families"
  is a better answer than most startups would give. Keep that voice.
- The 3-step "how it works" and the FAQ. Structurally right, just need work.
- The school-sync explanation. The parent-pastes-a-link-once model is unusual
  and the page explains it clearly and without hype.
- The chat→action concept (see 1.3) — promote it, don't reinvent it.

---

## 2. Strategy: the two-pillar spine

**Stay in touch. Stay on top.** Those are not a tagline, they are the page's
skeleton. Every section belongs to one pillar, and the page alternates between
them so the reader feels both halves of the product rather than a list.

| Pillar | What it owns | Emotional job |
|---|---|---|
| **Stay on top** | school sync, homework, timetable, ECAs, calendar, reminders, house points | *Nothing lands on you at 8pm that you should have known at 8am.* |
| **Stay in touch** | family chat, chat→action, kid mode, meals, trips, goals | *The family thread is where things get decided, not just discussed.* |

The single strongest idea on the page is where the pillars **meet**: a message
in the family thread becomes a task, an event, or a shopping list. That is the
proof that this is not "a school app plus a chat app". Build the page's
centre of gravity there.

### Positioning shift

- **From:** "Moodle homework, timetables and ECAs for St Andrews parents."
- **To:** "The place a family runs its week — school on one side, home life on
  the other, one thread down the middle."

STA does not disappear. It moves from *gate* to *proof*: this is a real
product, live with real families at a real school, with a real integration.
That is stronger as evidence than as an eligibility notice.

### ⚠ The honesty tension — a product decision, flagged, not decided here

Signup today requires an STA invite code ("Free for STA parents. Use your
invite code"). A broad "modern family" hero followed by a gated CTA is a
bait-and-switch, and parents will feel it.

There are two honest resolutions. **Design both; the owner picks.**

- **Variant A — Focused (no product change).** Broad emotional hero, and an
  availability line sitting *with* the CTA, not above the headline:
  *"Open now to St Andrews Bangkok families. Other schools — join the list."*
  Where "join the list" is a plain `mailto:` or a link to a form. Zero backend
  work.
- **Variant B — Waitlist (small product change).** Same, but the secondary CTA
  opens an inline school-waitlist capture (school name + email). Needs a
  `POST /api/waitlist` endpoint and a store. Roughly a half-day of work and it
  converts the traffic the new positioning will attract instead of bouncing it.

Design the hero so A and B are the *same layout with a different secondary
action*. Do not fork the page.

---

## 3. Section-by-section requirements

Fable owns the visual invention. This section fixes the *content contract* —
what each section must accomplish and what must not be lost.

**S0 · Navigation**
Slim, sticky, blurred (keep the current treatment, it works). Nav items:
Features · Family chat · School sync · iPhone & iPad · FAQ. Right side: dark
mode is automatic (no toggle needed on the landing page), `Sign in`,
`Create family`. Drop the `Free for STA parents` header pill — that claim moves
to the CTA area where it is load-bearing.

**S1 · Hero — the promise**
- Headline carries the *outcome*, not the category. Direction, not final copy:
  *"Everyone knows what today looks like."* /
  *"The family thread that actually gets things done."* /
  *"Stay in touch. Stay on top."* — Fable should write 3 candidates and
  recommend one, with reasoning.
- Sub-headline names both pillars in one sentence and mentions that school
  homework, the timetable and ECAs arrive on their own.
- Primary CTA: `Create your family`. Secondary CTA: `See a family week` —
  scrolls to S5 (the day-in-the-life), *not* to school sync.
- Availability line under the CTAs (see §2 variants).
- **The hero visual must be legible.** This is the single most important
  visual instruction in the brief. Do not render the whole application. Pick
  **one** surface — the Today screen — show it at a size where a person can
  actually read "Sign Mia's swim gala permission slip", and let two or three
  smaller elements (a chat bubble, a homework-due chip, a sync toast) float
  around it at *their own* legible scale. Composition over completeness.
- The coral→violet gradient appears **once** on this screen and nowhere else
  above the fold (APP-BRIEF: reserved for one momentum element per screen).
- Trust strip immediately under the hero, small, mono micro-label scale:
  *Encrypted at rest · Read-only school sync · No ads, no tracking · Kids
  can't sign up alone.*

**S2 · The before — one short beat**
The page currently opens at the solution. Give the problem one honest,
compact section. Not a sob story, not a hero-sized block: a single band,
maybe a row of overlapping "before" fragments (three group threads, a
whiteboard, a slip dated last Tuesday) resolving into one line of copy.
Keep it under ~60 words. It exists so that "calm" has a referent.

**S3 · Pillar — Stay on top**
School sync, homework, timetable, ECAs, reminders. Reuse the substance of the
current `#moodle` section — the parent-pastes-the-link-once model, the four
items (Homework / Timetable / ECA & activities / Automatic refresh), the
"encrypted, never displayed again, read-only, every eight hours" promise.
What changes: it gets a legible product visual (the Homework or Today screen
at readable scale) and it gets framed as *relief*, not as *integration*.
"You never chase a due date again" beats "conditional checks every eight
hours" as a headline — keep the mechanism as the supporting detail, because
parents who care about mechanism will read it and be reassured.

**S4 · Pillar — Stay in touch, and the moment they meet**
The centrepiece. Family chat, and then chat→action as a **staged, stepped
sequence** the visitor can follow (three beats: message → choose Action /
Calendar / Shopping → the structured result). Scroll-driven or
autoplay-with-pause; must degrade to a legible static state. This section
should be the largest, most crafted thing on the page — it carries the claim
that Fam ETC is one product and not two.
Include the safety framing here, briefly: one thread per family, kids read and
reply safely, parents can delete any message.

**S5 · A day in the family**
Replace the eight-card feature grid as the page's main feature vehicle. A
single day, as a timeline, where each moment is a feature doing its job:

| Time | Moment | Feature it proves |
|---|---|---|
| 07:10 | "Leo's football kit" reminder, before the school run | Reminders |
| 08:20 | Football, astro pitch, kit + boots | ECAs / timetable |
| 09:12 | School sync: Maths worksheet added for Mia, due today | School sync |
| 12:05 | Leo: "Can someone bring my goggles?" → Priya: "In the swim bag" | Family chat |
| 12:08 | "Pasta, tomatoes, basil" → shopping list, 3 items | Chat actions |
| 16:00 | Maths worksheet ticked off | Homework hub |
| 19:00 | Friday dinner chosen together | Meals |

Every one of these already exists in the current page's mock data — reuse the
same family (Priya, Mia, Leo) so the whole page tells one continuous story
instead of restarting its cast every section. This is the section that makes
the product feel like it belongs to a family rather than to a school.

**S6 · Everything else — bento, not a checklist**
The remaining features (meals, trips, goals & habits, quizzes, puzzles, house
points, shared calendar) in a varied bento grid: two large tiles with real
visuals, four to five small ones. Kill the 01–08 numbering — numbering implies
sequence and there isn't one. Nothing in this section may be the same size as
everything else in it.

**S7 · Every screen the family already uses**
New section — currently absent. iPhone, iPad, and the web, with the adaptive
story shown honestly: tab bar on iPhone; nav rail + main + **docked family
chat** on iPad landscape; chat as slide-over in portrait; full layout on
desktop. This is a real differentiator and it costs the page one section.
If App Store availability is not yet live, use a "Coming to the App Store"
treatment rather than a fake badge — do not render a badge that isn't real.

**S8 · Kid mode / Parent mode**
Keep both — the split is genuinely good. Make it **one component with two
states** and a real toggle, rather than two static cards side by side. Same
device frame, contents swap. Kid state: what's due, what's on after school,
the streak — big and bright. Parent state: every child, every deadline, every
ECA, the whole week.

**S9 · Privacy & safety — promoted to its own band**
This must stop being a paragraph. Parents hand this product their children's
schedules and their family's private messages. Give it a calm, confident band
with the real commitments, each in plain language:
- Chat and children's data encrypted at rest.
- School sync is strictly read-only; the school link is encrypted and never
  shown again after you paste it.
- No ads. No per-user tracking — aggregate counters only.
- Children cannot sign up on their own; a parent creates every child profile.
- Parents can delete any message in the family and remove any member.
Link to `/privacy`. Do not dress this section up — restraint *is* the design
here.

**S10 · How it works — three steps**
Keep the existing three (Create your family → Connect the school feeds → Open
Today). Tighten the copy. Under Variant B, step 2 needs a non-STA branch.

**S11 · FAQ**
Keep the four existing questions, add: *Does it work on iPhone and iPad?* ·
*What if we're not at St Andrews?* · *Can my kids see everything I see?* ·
*What does it cost after the trial?* Keep the current voice — direct, willing
to say "no".

**S12 · Final CTA**
**One** button. `Create your family`. Availability line beneath it. Nothing
else competing.

**S13 · Footer**
Brand, the www.fametc.com line, Privacy · Pricing · Support · School sync.
Add an App Store slot only when the app is actually live.

---

## 4. Hard constraints — the Horizon contract

`CLAUDE.md` and `APP-BRIEF.md` §Design are a contract. **This is a
re-composition, not a rebrand.** Fable must not propose a new palette, new
typefaces, or a new logo. Any such proposal requires listing affected files and
getting explicit owner confirmation first, and would stop this work.

Binding:

- **Tokens 1:1 from `public/css/horizon.css`.** No new hex values in the
  design. Ground `--bg #f1efec`, panels `--panel #ffffff`, borders
  `--border #e7e3dd`, text `--text #211e1b` / `--text-2 #6a655f`.
- **`--accent #6f43d6` violet is the ONLY interactive color.** Links, primary
  buttons, focus rings, active states. If it isn't clickable, it isn't violet.
- **`--coral #f0704f` is the partner accent**, never a second button color.
- **The coral→violet gradient is rationed: one momentum element per screen.**
- **Type: Space Grotesk** for UI, **JetBrains Mono** for numerals and 11px
  uppercase micro-labels (the `.eyebrow / .kicker / .micro / .step-label`
  rule at `landing.css:121-129`). Both are self-hosted in `public/fonts/`.
  No web-font additions.
- **Per-kid identity is categorical by kid order** — kid 1 teal, kid 2 amber.
  Mia and Leo must be colored consistently everywhere they appear on the page.
- **Green and red are strictly semantic** (done / overdue). Never decorative.
- **Dark mode is required.** Same tokens re-resolved via `.dark`. Add the
  pre-paint theme script from `index.html:13-23` to `landing.html` and make
  `theme-color` respond. Every artboard needs a dark counterpart for at least
  the hero, the chat→action section, and the footer CTA.
- **No new runtime dependencies.** The page is static HTML + CSS with, at most,
  a small vanilla `IntersectionObserver` script. No framework, no animation
  library, no CDN. CSP on this server is `script-src 'self'`.

---

## 5. Motion — purposeful only

The current page is fully static; the answer is not "add animation everywhere".

- Motion is permitted in exactly two places: the **hero** momentum element,
  and the **chat→action sequence** in S4. Optionally a light reveal-on-scroll
  for section entrances.
- Everything must be **legible and complete in its static state** — motion
  clarifies, it never delivers information that isn't otherwise there.
- `@media (prefers-reduced-motion: reduce)` must resolve every sequence to its
  final, readable frame. Non-negotiable.
- CSS transforms and opacity only. No layout-thrashing animation, no
  scroll-jacking, no autoplaying video.

---

## 6. Accessibility & performance floor

- Every product visual carries a real text equivalent. If a claim only exists
  inside an `aria-hidden` mock, the page has not made that claim.
- Heading order sane: one `h1`, sections in `h2`, no level skips.
- Contrast: body text ≥ 4.5:1, large text ≥ 3:1, in **both** themes. Check
  `--text-2 #6a655f` on `--panel-2 #faf8f5` specifically.
- Visible focus ring on every interactive element, in violet, in both themes.
- Keyboard-operable: the kid/parent toggle and the chat→action sequence must
  work without a mouse.
- Touch targets ≥ 44px (the existing `.brand` rule already honors this).
- The hero must not cost 150 DOM nodes of decoration. Budget the hero mock at
  well under half the current node count — if a detail isn't legible, it isn't
  earning its markup.
- No layout shift from the hero. Reserve its space.
- Responsive: 360 · 768 · 1024 · 1440. `--landing-stage` stays 1440px.

---

## 7. What Fable delivers

1. **A design canvas** — multi-artboard, published as an Artifact, sources
   saved under `docs/design/landing-2026/`. Artboards required:
   - Desktop hero (light) · Desktop hero (dark)
   - Full desktop page, top to bottom
   - Mobile (390px) full page
   - The chat→action sequence, all three beats as separate frames
   - The day-in-the-family timeline
   - Kid mode / Parent mode, both states
   - Hero CTA area in both availability variants (A and B from §2)
2. **`docs/design/landing-2026/IMPLEMENTATION-GUIDE.md`** — written for a
   developer with **zero context on this conversation**. It must contain:
   - Section-by-section DOM structure with the exact class names to use,
     following the existing `landing.css` naming conventions.
   - The CSS to add, remove, and change in `public/css/landing.css`, keyed to
     the current line numbers where something is being replaced.
   - Every token used, by variable name — never a raw hex.
   - Breakpoint behaviour per section.
   - Motion specs: property, duration, easing, trigger, and the
     reduced-motion fallback.
   - The dark-mode wiring for `landing.html`, including the pre-paint script.
   - Accessibility requirements per component.
   - The complete **copy deck** — every final string on the page, including
     both availability variants, all FAQ answers, and all alt text.
   - Any new assets needed, with dimensions and format.
   - An acceptance checklist a reviewer can run against the built page.
3. **A one-page rationale** (may live at the top of the guide): what changed
   from today's page, and why, in the language of the two-pillar spine.

**Out of scope for Fable:** writing production code, touching
`public/landing.html` or `public/css/landing.css`, running the build, or
deploying. Someone else implements from the guide.
