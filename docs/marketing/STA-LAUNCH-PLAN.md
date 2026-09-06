# Fam ETC — STA soft-launch plan

**Written 2026-09-06. Owner: the founder (one person, part-time).**

This is a plan for a *deliberately small* first launch: a handful of St Andrews
International School (Bangkok) families, handed a pamphlet in person, during
one school term. It is not a growth campaign and should not be run like one.

It extends the `APP-BRIEF.md` **Marketing & growth** row, which already decided:
landing page at launch, tour video once the UI settled (it now has), SEO limited
to meta + sitemap, **no referral programme**, and privacy-first aggregate
analytics only. Nothing here changes those decisions.

---

## 1. What we are actually trying to learn

With a group this small, signups are a vanity number. The launch exists to
answer four questions, in priority order:

1. **Does a parent get to a connected, useful Today screen without help?**
   The single riskiest step is pasting the school homework/timetable links in
   Settings. If parents stall there, nothing else matters.
2. **Does the family thread get used by more than one person?** A family hub
   with one active parent is a to-do list. The product's whole claim is that
   the thread is where things get decided.
3. **Does school sync stay correct for a full term?** Homework appearing late,
   duplicated, or stale is the fastest way to lose trust.
4. **What do parents ask that the FAQ does not answer?** Every repeated
   question is a landing-page or pamphlet fix.

**Target: 8–15 families, all STA, recruited by hand.** Below 8 there is no
signal; above ~15 support becomes a second job and the term's feedback loop
breaks down.

---

## 2. Positioning for this audience

The landing page leads with the broad promise ("Everyone knows what today looks
like"). In person, with STA parents, lead with the **specific** one — they
already have the problem:

> "It pulls your kids' homework and timetable out of the school system into one
> family app, next to a family chat that can turn a message into a plan. It's
> free for St Andrews families while we're testing."

Three things must be said out loud every time, because they are the three
objections that actually come up:

- **"It's not an official St Andrews app."** Say it first, unprompted. Getting
  this wrong is the only reputational risk in the whole launch.
- **"You paste your own school links; we only ever read them."** Parent-
  controlled, encrypted, read-only, refreshed every eight hours.
- **"Your kids can't sign up on their own."** A parent creates every child
  profile and approves every child device.

### Words to avoid

| Don't say | Why | Say instead |
|---|---|---|
| "Official", "partnered with STA", "approved" | Untrue and reputationally fatal | "Built by an STA parent, for STA families" |
| "Automatic sync", "always up to date" | Overclaims a conditional 8-hour check | "Checks the school every eight hours" |
| "Free forever" | We have not decided pricing | "Free for STA families while we're testing" |
| "AI-powered" | Invites scrutiny we don't need for a family calendar | Describe what it does |

These mirror the copy guardrails already enforced by
`tests/landing-page.test.js` — the pamphlet must not contradict the website.

---

## 3. Materials

Four pieces, in build order. **Only the first two are required to launch.**

### 3.1 The pamphlet — *required*
A5, folded A4, printed double-sided at home or a copy shop. Colour, but it must
survive being photocopied in black and white.

Content, in this order (this is the sequence a parent reads at a school gate):

1. **Cover** — the promise, the mark, "Free for St Andrews families", and the
   honest line that this is not an official school app.
2. **What it does** — four things, with a real screenshot each: family chat,
   homework from school, the week, meals/trips.
3. **Set up in one evening** — the three steps, with the school-link step given
   the most room because it is where people stall. Include *where* in Settings.
4. **Privacy in plain words** — the five commitments from the landing page.
5. **Back cover** — QR to `fametc.com`, the invite code, an email to reply to,
   and "we'll ask you three questions at half term."

Constraints: no jargon, no feature lists longer than four items, every claim
must match §2. Assume it is read in ninety seconds while standing up.

### 3.2 The quick-start card — *required*
A single A6 card, one side. Just the three setup steps and the QR. This is what
actually gets stuck on a fridge; the pamphlet gets recycled.

### 3.3 The demo video — *required for the site, optional in person*
60–90 seconds, no narration, captions only, silent-autoplay-safe. Shows exactly
two things because they are the two that sell it:

- **Family chat → action.** A message ("pasta, tomatoes, basil") becoming a
  shared shopping list.
- **Homework.** School-synced assignments arriving, grouped by due date, ticked
  off.

No sign-up flow, no settings, no menus. It lives on the landing page and gets
texted to interested parents.

### 3.4 The half-term email — *later*
Three questions, plain text, sent once at half term. Written in week 5, not now.

---

## 4. Distribution — how these actually reach people

No ads. No class-wide WhatsApp blasts (that reads as spam and risks the
"official app" confusion). Hand-to-hand only:

1. **The founder's own year group first.** 3–5 families the founder already
   knows, in person, pamphlet handed over with a sentence of context.
2. **Coffee morning / gate conversations.** Carry pamphlets; give one only when
   the conversation gets there naturally.
3. **One parent per year group, if it goes well.** Ask a family that is already
   using it to pass two pamphlets to people they know. That is the *entire*
   growth mechanism — deliberate, because the brief decided no referral system
   and this needs none.

**Do not** post in school-wide groups, approach the school for endorsement, or
put anything on public social media during this phase. The school relationship
is worth more than 50 extra signups.

---

## 5. Timeline

| When | What |
|---|---|
| **Week 0** (this week) | Landing motion pass; demo video cut; pamphlet + card designed and proof-printed; invite codes generated; verify a fresh signup end-to-end on live fametc.com. |
| **Week 1** | Hand out 5. Sit with at least two families while they connect school links — watch, don't help, note where they hesitate. |
| **Week 2** | Fix whatever those two sessions exposed. Hand out 5 more. |
| **Weeks 3–5** | Quiet. Watch aggregate counters. Fix sync bugs fast — this is the trust window. |
| **Half term** | Send the three-question email. Decide: widen, hold, or change the product. |

Nothing after half term is planned on purpose. The half-term answers should
decide it.

---

## 6. What we measure

Constrained by the privacy decision already on record: **aggregate daily
counters only, no per-user event log.** That is enough for this.

| Signal | Where from | What "good" looks like |
|---|---|---|
| Families created | aggregate counter | 8–15 over the term |
| School feeds connected | aggregate counter | **> 70% of families created** — the key ratio |
| Families with chat activity on 3+ separate days | aggregate counter | > half |
| Support questions received | the reply-to inbox | falling week on week |
| Sync defects reported | inbox | zero repeats of the same defect |

The second row is the one that matters. A family that signs up and never
connects the school is a family that got nothing, and that is a product or
pamphlet failure, not a user failure.

---

## 7. Risks, and what we do about them

| Risk | Likelihood | Response |
|---|---|---|
| Parents think it's official STA software | Medium | Say it first, in person; it's on the pamphlet cover, the landing FAQ, and the site. |
| The school objects to us reading their feeds | Low–medium | Parent pastes their *own* capability URLs; read-only; stop immediately and talk to the school if asked. Have this answer ready before handing out pamphlet one. |
| A parent stalls on the school-link step | **High** | Longest section of the pamphlet; watch two families do it live in week 1. |
| Sync breaks mid-term | Medium | This is the trust-killer. Weeks 3–5 are deliberately kept free to respond fast. |
| Someone shares the invite code widely | Low | Codes are revocable; keep the group small on purpose. |
| It's just not useful enough yet | Real | That is what the launch is for. Half-term answers decide whether to widen or change the product. |

---

## 8. Out of scope for this launch

App Store listing (TestFlight first), paid acquisition, other schools, the
waitlist flow (Variant B from the landing design — designed, not built),
referral mechanics, press, and any social media presence. All deliberately
deferred until the half-term answers exist.
