# Hermes proactive assistant: analysis and completion plan

**Status:** analysis and plan, 2026-09-26. The decisions in §12 are pending the owner.
**Author:** Claude (Opus). **Implementer:** Astra.
**Builds on:**
- [FAMILY-TIME-SAVER-PLAN.md](FAMILY-TIME-SAVER-PLAN.md), which already calls for "one notification preference and quiet-hours service" and decisions like "Can someone pick up Sam?".
- The Hermes Operator docs (`docs/HERMES-OPERATOR-*.md`).
- [roadmap.md](../roadmap.md).

---

## 0. Summary

**Hermes today is a careful operator, not an assistant.**
- It has strong internals: approval-gated cases, family memory, attachments, shadow mode, beta kill switches and an audit trail.
- But it only acts when someone types **@Hermes**.
- It runs on one parent's Mac.
- Its output reaches people through a web-only Today card and pushes that go to the whole family.
- It never starts a conversation, never follows up, and never uses what FamETC already knows about the day. Muse and Instinct feel useful because they do all three.

**The fix is not a smarter model.** It is a **server-side proactive loop**:
- Every minute, the server reads FamETC's own data (timetable, calendar, homework, actions, meals, home plans).
- It decides who needs to know what, now.
- It delivers one short, actionable message through push, Today and, later, a private Hermes thread.
- It records the answer and follows up once.
- The Mac-hosted Hermes agent stays as the "brain" for open-ended requests and research. Hermes becomes the name on the messages, not a dependency of them.

**The three requested moments, specified end to end in §6:**

| Moment | Who | When | One-tap outcome |
|---|---|---|---|
| **Home check-in** | Kid and parents | Kid: at home time. Parents: evening check-in. One follow-up at 19:30. | Start homework, "later", nudge the kid, review |
| **Pickup** | Parents (kid gets a confirmation) | From the end of the kid's **last commitment** of the day: ask 90 min before, leave-by, "got them?" | "I'll go" / "Can't today" / "No pickup needed"; the claim becomes an owned action |
| **Dinner offer** | **Parents only** | Tonight: 3 h before dinner if nothing is planned. Weekly: planning day if under half the week is planned. | "Show 3 ideas" → "Cook this"; "Draft the week" → existing review |

**The analysis also found 8 defects to fix first (§9).** They include:
- a **kid privacy gap**: a kid's @Hermes turn receives the parent-level context;
- approvals that notify nobody;
- meal-prep reminders that never fire;
- no family timezone;
- iOS homework reminders that fire at **midnight**.

---

## 1. How Hermes works today (evidence)

| Layer | What exists | Where |
|---|---|---|
| Runtime | Nous Research Hermes Agent 0.21.2 plus the FamETC plugin v1.5, running as a gateway **on a parent's Mac**. It makes outbound HTTPS only: a long-poll on room messages (25 s hold) and a 10 s supervisor loop. | `integrations/hermes/fametc/plugin.yaml`, `adapter.py:48-53,311-333`, `lib/routes/hermes.js:363-373` |
| Trigger | A human message that contains `@Hermes`. Nothing else starts a turn. | `lib/hermes.js:97-101` |
| Context | A per-turn family snapshot from `GET /api/hermes/rooms/:id/context`, built with **`actor: null`** | `lib/routes/hermes.js:350-362`, `lib/family-context.js:142-156` |
| Output | Chat replies (pushed to **every** parent and kid). Server-inferred cards: `meal-plan-draft`, `trip-itinerary-draft`, `hermes-travel-results`. | `lib/hermes.js:138-157`, `lib/routes/hermes.js:374-382` |
| Operator | Cases, exact approvals and 5 reversible writes (`calendar.*`, `action.*`, `trip.itinerary.update`). Beta is enforced: **no family enrolled**, and the roadmap says "live proof pending". | `lib/operator*.js`, `roadmap.md:15-19,108` |
| Surfaces | Web Today "Hermes is working on…" cases (30 s refresh). **No iOS case or approval UI.** Family Memory and attachment pages exist but aren't linked. | `public/js/action-queue.js:157-423` |
| Scheduling | **None for Hermes.** The server has only the school-API scan (15 min), the attachment cleanup, and the outbox retry timer. | `server.js:801-802`, `lib/school-api.js:528-536` |
| Delivery | APNs plus web push, and a durable outbox with dedup and retries. There are **no notification categories or action buttons** and **no per-user preferences**. The only quiet hours are Meals' hard-coded 22–07. | `lib/fam-notifications.js`, `lib/notification-outbox.js:93-124`, `lib/meals.js:751-808` |
| Dead reminder code | `notifyHomeworkReminder` has **no caller**. `notifyMealPrep` is reachable only from `POST /api/meals/prep/sweep`, which **no client calls**. | `lib/fam-notifications.js:487-519`, `lib/routes/meals.js:652-671` |

**What the data layer already knows** (this is what makes proactivity cheap):
- **Timetable:** per-kid lessons with start, end and room (stamped `+07:00`). Today's last lesson is computable. (`lib/school-api.js:340-362`)
- **Home plan:** per kid, per date: `{schoolEnd, pickupTime, homeTime, pickupLabel}`. It is parent-only, entered by hand per date, and never repeats. (`lib/child-insights.js:37-45`)
- **Activities:** weekday start, end and location, but they aren't merged into the calendar, watch or Hermes. (`lib/activities.js:9-17`)
- **Watch route:** the one server-side per-kid merge that keeps end time and location. (`lib/routes/watch.js:27-51`)
- **Meals:** menu by date and slot, `dinnerTime`, pantry, recipe suggestions, AI and deterministic planning, and prep steps with `leadHours`. (`lib/meals.js`, `lib/recipes.js:2441-2492`, `lib/routes/meals.js:551-650`)
- **Actions:** owner, due date and time, snooze, and server-generated instances keyed by source. (`lib/actions.js:279-311,659-796`)

---

## 2. Why the experience is poor (root causes)

1. **It never speaks first.** Proactivity requires a clock, and Hermes has none. Every useful moment in a family's day (a lesson ending, dinner not planned, homework due tomorrow) passes silently.
2. **It runs on the wrong machine for time-critical work.**
   - A 3:40 pm "leave now" cannot depend on a Mac being awake and online.
   - One Mac per family also doesn't scale to other families.
3. **It has no private channel.**
   - The only rooms are `family` and `trip:*` (`lib/routes/chat.js:405-419`).
   - Every Hermes reply pushes to parents *and kids*.
   - So Hermes cannot nudge one person, and anything it says is noise to four others.
4. **Its output doesn't reach where people are.**
   - Approvals live only on web Today, with no push.
   - iOS has no approval UI.
   - iOS shows trip research as a "📚 Homework" card (`ChatView.swift:1842-1848`).
   - iOS shows no HELPER tag.
5. **Suggestions don't close.**
   - Nothing turns into an owned, timed commitment that's followed up.
   - `/menu/plan` writes menus directly and posts the card **as the parent** (`routes/meals.js:636-647`).
6. **It has no sense of "today".**
   - There is no family timezone (`lib/family.js`).
   - Times are plain `HH:MM`, and meal prep uses the server's clock (`meals.js:770-779`).
   - The school API hard-codes Bangkok.
   - If the host runs UTC, anything scheduled is 7 h off.
7. **It has a trust gap.**
   - A kid's @Hermes turn gets the snapshot built with `actor: null`, which grants **all** sections, including preferences and memory (`family-context.js:150-153`).
   - The reply is posted where the kid reads it.

## 3. The bar: what Muse and Instinct do, and what we adopt

| Behaviour | Muse (Meta, Sept 2026) | Instinct (invite-only) | FamETC adopts as |
|---|---|---|---|
| Speaks first | "can send you messages without you prompting it" | "calling or texting you first" | The proactive loop (§5) |
| Uses what it remembers | Suggests unprompted from saved content, e.g. a recipe reel → grocery list | Keeps context across a multi-day thread | Family Memory (M1) and meal prefs shape dinner ideas; pickup rules remember who usually collects |
| Follows up on open loops | — | "following up on threads you dropped" | One follow-up per moment, then stop. Unclaimed pickups escalate once. |
| Messaging-native | App thread and WhatsApp | iMessage, WhatsApp, calls | Actionable push plus a private Hermes thread per person (P5) |
| Handles logistics | Appointments, forms | "arranging the ride to the airport", school-schedule logistics | Pickup coordination between parents, with a confirmation to the kid |
| Checks before acting; audit trail | "checks with the person before sensitive actions"; complete audit trail | Reported to have "sent an email on her behalf without checking first" | Nudges never write outside FamETC. In-app writes happen only on an explicit tap and can be undone. Parents see a "What Hermes did" log. |

**What we deliberately don't copy:**
- screen, keyboard, audio or location capture;
- cached third-party credentials;
- acting without confirmation.

FamETC's advantage is structured family data it already owns. Proactivity comes from **timing plus that data**, not from surveillance.

---

## 4. Target experience: one Friday

A family of Mayur and Priya (parents) and Ryshi (11). Swimming, Ryshi's last commitment of the day, ends at 16:00 at the Leisure Centre.

| Time | Who | Hermes says | Taps |
|---|---|---|---|
| 14:30 | Mayur, Priya | "Ryshi finishes Swimming at 4:00 · Leisure Centre. Who's collecting?" | **I'll go** · Can't today · No pickup needed |
| 14:31 | Priya (silent) | "Mayur is collecting Ryshi at 4:00 ✓" | — |
| 15:30 | Mayur, Priya | "Dinner tonight isn't planned. It's a swimming night, so here are 3 quick ideas from your pantry." | **Show 3 ideas** · Eating out · I've got it |
| 15:35 | Mayur | "Leave now for Ryshi: 4:00 at the Leisure Centre, about 20 min." | On my way · Running late · Swap to Priya |
| 15:50 | Ryshi | "Dad's collecting you at 4:00 from the Leisure Centre." | — |
| 16:15 | Mayur | (only if not closed) "Got Ryshi?" | **Yes** |
| 16:45 | Ryshi | "Welcome home. Tonight: Maths worksheet (due tomorrow) and 1 habit." | **Start Maths** · In 30 min |
| 17:30 | Mayur, Priya | "Tonight: Ryshi has 1 due tomorrow (not started). PE kit tomorrow." | Nudge Ryshi · Review |
| 19:30 | Ryshi | (only if Maths is still open) "Maths worksheet is due tomorrow. Want to finish it now?" | Start · Done |
| Sun 17:00 | Mayur, Priya | "Next week has 2 of 7 dinners planned. Draft the other 5?" | **Draft the week** · Not this week |

**Daily volume on that day**
- Each parent: 4 messages.
- Ryshi: 2–3 messages.
- None fires during quiet hours, and none repeats.

---

## 5. Architecture: the proactive loop

```
 ┌────────────── every 60 s (server.js, next to the school scan) ───────────────┐
 │ for each family with a push-capable member:                                  │
 │   ctx  = snapshot(family)        // kids, prefs, tz, kidDay(), homework,     │
 │                                  // actions, menu, ledger                    │
 │   cand = planPickup(ctx, now) ∪ planHome(ctx, now) ∪ planDinner(ctx, now)    │
 │          ∪ planActionDue(ctx, now) ∪ prepReminders(ctx, now)                 │
 │   send = select(cand, now, ledger, prefs)   // due window, dedup, quiet hrs, │
 │                                             // caps, bundling, role scope    │
 │   for n in send: ledger.write(n) → outbox.enqueue("nudge", n, dedupeKey)     │
 └──────────────────────────────────────────────────────────────────────────────┘
        │ push (APNs category + web actions) · Today "Hermes" strip · thread (P5)
        ▼
 POST /api/nudges/:key/respond  →  claim / snooze / done / ideas / pick / draft
        │ side effects are FamETC-native, explicit, undoable:
        ▼ create/complete a pickup action · add a menu entry and shopping · open a draft review
```

### 5.1 Components (reuse first)

| # | Component | New or reuse | Notes |
|---|---|---|---|
| 1 | **Family clock**: `family.timezone` (IANA) and `lib/family-time.js` | New, ~40 lines | Set from the first parent client (`Intl…resolvedOptions().timeZone` / `TimeZone.current.identifier`). Existing family defaults to `Asia/Bangkok`, matching the school API. Uses `Intl` only, with no dependency. Also fixes meal prep (§9). |
| 2 | **Kid day**: `lib/kid-day.js` → `kidDay(familyId, kidId, date)` | New; port of the watch-route merge | Merges timetable, the kid's school iCal, the kid's manual events and **weekly activities**, with the home plan as an override. Returns the ordered commitments `{start, end, location, source}`, `schoolEnd`, `last` and `homeTime`. The watch route switches to it, so there is one source of truth. |
| 3 | **Planner**: `lib/nudges.js` | New | Pure `plan*` functions over a snapshot, plus `select()`. Deterministic, fake-clock testable, and self-healing: every tick recomputes from live data, so moved events, finished homework and new menus correct themselves with no rescheduling code. |
| 4 | **Ledger**: `nudges[familyId]` | New store | `{key, kind, stage, recipients, firedAt, state, answer, answeredBy, answeredAt, snoozeUntil}`. Holds ids and times only, no free text. Pruned after 30 days. It enforces "once", and it is the parent audit log. |
| 5 | **Delivery** | Reuse the outbox and senders | Add `famType: "nudge"`, `nudgeKey`, `aps.category`, `thread-id` per moment, and an interruption level. Add web-push `actions` in `sw.js`. |
| 6 | **Respond API**: `POST /api/nudges/:key/respond {action, value}` | New route | Only the recipient can answer. Idempotent, rate-limited, and role-checked (a kid can't claim a pickup). |
| 7 | **Preferences** | New, and completes FAMILY-TIME-SAVER Phase 0 | Per person: on/off per moment and quiet hours (defaults: parents 21:30–07:00, kids 20:30–07:00). Per family: evening check-in (17:30), dinner-offer lead (3 h), planning day and time (Sun 17:00), pickup defaults. Parents set kid settings. |
| 8 | **Surfaces** | Web Today and iOS extend existing components | A Today "Hermes" strip above the Needs-you hero shows live nudges with the same buttons. iOS gets `UNNotificationCategory` actions plus `NotificationHandler` routing. The private thread comes in P5. |

### 5.2 Rules that apply to every moment

- **Quiet hours:** a person's quiet hours always win. A pickup is inherently daytime; if one ever lands in quiet hours, it's sent at the quiet-hours start boundary, not skipped.
- **Caps:**
  - Kids: at most 4 per day.
  - Parents: at most 8 per day, not counting time-critical pickup stages.
  - At least 15 min between non-pickup nudges to the same person.
- **Bundling:** one "tonight" message per parent per evening. If the dinner offer and the evening check-in are due within 30 min of each other, merge them.
- **Only when useful:** a moment with nothing actionable is never sent. There are no "all good!" messages.
- **Role scope:**
  - Kids receive only their own items.
  - The pickup confirmation to a kid names the collector and nothing else.
  - Dinner offers go to parents only.
- **Channel by urgency:**

  | Nudge | Interruption level |
  |---|---|
  | Pickup ask (unclaimed), leave-by, escalation | `time-sensitive` (needs the entitlement; §9) |
  | Home check-in, dinner offer | Active |
  | Confirmations to the *other* parent | Passive |

- **Late ticks:** after downtime, a nudge more than 10 min late is skipped, except "got them?" and escalation messages.
- **Copy:**
  - Names and numbers first, one sentence, no guilt.
  - Push title: "Hermes".
  - No emoji in chrome (the Family Rings rule). This replaces "📚 … homework due soon!" and "🍳 Prep for tonight".

**Why server-side, not the Mac agent:**
- **Reliability:** it works when the Mac sleeps.
- **Latency.**
- **Cost:** no model call per tick.
- **Privacy:** kids' schedules stay on the server.
- **Testability:** a fake clock can drive it.
- **Scale:** it works for every family, not only a family running Hermes on a Mac.

The Mac agent keeps what it's good at: research, trip work, learned read-only skills and free-text conversation (§12 D2).

**Hosting check (do this first).** Confirm that the Hostinger Node process stays alive between requests.
- Look for overnight gaps in the 15-min school-scan log lines using `hosting_getNode_jsRuntimeLogsV1`.
- If there are gaps, add an hPanel cron that calls an authenticated `POST /api/internal/tick` every minute. The secret lives in an env var; refer to it by name only.

---

## 6. The three moments

### 6.1 Home check-in (kids and parents)

**Intended flow.** After school, when the child's day is done and they're home, Hermes:
1. tells the **child** what's on at home tonight (homework due tomorrow first);
2. tells **parents** what needs them at home tonight;
3. follows up once at 19:30 if due-tomorrow work is still open.

If "home reminder" meant only *homework* reminders, those are the first line of both messages, so this flow covers them.

**Kid: "Welcome home"**

*When* (the first rule that applies wins):
1. The home plan's `homeTime` for the date.
2. The pickup claim's end plus travel.
3. `kidDay.last.end + 45 min`.
4. On weekdays with no commitments: 16:00.

*Weekends:* off by default; a setting turns them on.

*Content:* built from existing data:
- homework due tomorrow and not done, then overdue (`store` homework);
- habits not checked today (goals);
- Daily 3 remaining (`child-insights` progress);
- the kid's own actions due today or tomorrow.

*Rules:*
- Show at most 1 item by name, then "+N more".
- Send only if at least 1 item exists.

*Buttons:*
- **Start** opens the homework item or study start.
- **In 30 min** snoozes the nudge.
- A Done action only if the item is done-able by the kid.

*Follow-up:*
- At 19:30, if any due-tomorrow item is still open and the kid didn't answer Done, send one follow-up.
- Maximum 2 home nudges per evening.

**Parents: "Tonight"** (the evening check-in, 17:30 by default)
- *Per kid:* due tomorrow and not done, with status (not started or in progress).
- *Family:*
  - dinner status (bundled with the offer, §6.3);
  - tomorrow's first commitment, if it's early (before 08:00) or unusual (not in the regular timetable);
  - this parent's own actions due today.
- *Buttons:*
  - **Nudge Ryshi** sends the kid an immediate home nudge, rate-limited to once per hour.
  - **Review** opens the homework review.
  - **Plan dinner** hands off to §6.3.

**Action due reminders** (closes the gap where phone and web ignore action times; today only the watch reminds):

| Action | Reminder |
|---|---|
| Timed | At `dueTime` to its assignee |
| Date-only, assigned to a kid | In the kid's home check-in |
| Date-only, assigned to a parent | In one 08:00 "today" line |

**Data work**
- **Weekly home-plan template:** `homePlanTemplate[weekday]` in `child-insights`. Parents set "Mon–Fri: pickup 15:30, home 16:15" once; per-date plans override it.
- **Kid-readable plan:** kids may read their own resolved plan (`schoolEnd`, `pickupTime`, `homeTime`, `pickupLabel`), so "Dad's collecting you" and "home by 4:15" appear on kid Today. Parents keep edit rights.
- **Retire the iOS local homework reminder** (`NotificationScheduler.swift:119-137`).
  - It fires at due − 8 h with a default due time of 08:00, which is **00:00** for date-only homework.
  - Once server home reminders ship, it would duplicate them.

### 6.2 Pickup

**Intended flow.** For each child on each day with commitments, Hermes:
1. finds the end of their **last** commitment;
2. asks parents who's collecting, unless a standing rule already answers that;
3. reminds the collector when to leave;
4. tells the child who's coming;
5. closes the loop once the pickup is done.

**Which commitment is "last"**
- Use `kidDay().last`: the latest-ending, timed, non-all-day commitment **for that kid**. Sources:
  - timetable lessons;
  - the kid's school iCal events;
  - manual events with `kidId` = the kid;
  - the kid's weekly activities.
- Family-wide events (`kidId: null`) never count.
- Sanity window: an end between 11:00 and 21:00.
- **Explicit home plan wins:** a date's `pickupTime` and `pickupLabel` replace the computed end.
- **Location:**
  - An event's location when it has one.
  - For timetable lessons, the "location" is a classroom (`raw.room`), so use the family's **school pickup point** setting (for example "Main gate") instead.
- **Known data gaps:**
  - Manual ECA sign-ups have no end time or location (`app.js:7567-7575`). Fall back to that activity's weekday record in `lib/activities.js`.
  - If neither exists, ask once: "When does Chess end?"

**Standing rules** (kills daily questions)
- `pickupRules[kidId][weekday]` is one of:

  | Value | Effect |
  |---|---|
  | `parent:<id>` | Skip the ask; send the leave-by to that parent |
  | `bus` / `walk` / `none` | No parent nudges; the kid still gets the home check-in |
  | `ask` (default) | Run the full flow |

- Offer to save a rule after two identical weekday claims: "Mayur collected Ryshi the last 2 Fridays. Make Fridays Mayur's?" This is a Family Memory proposal, so it needs parent approval (M1).

**Stages.** Times are in the family timezone. Ledger key: `pickup:<kidId>:<date>:<stage>`.

| Stage | Fires | To | Message | Buttons → effect |
|---|---|---|---|---|
| Ask | `end − 90 min` (not before 07:00) | Both parents | "Ryshi finishes Swimming at 4:00 · Leisure Centre. Who's collecting?" | **I'll go** → create the action "Collect Ryshi · 4:00 · Leisure Centre" (assignee = claimer, `sourceType:"pickup"`, `sourceId:"<kid>:<date>"`, due `end`); the other parent gets a passive "✓". **Can't today** → record it; if both say this, escalate now. **No pickup needed** → silence the rest for today. |
| Re-ask on change | Event moved or removed after the ask | Both parents | "Update: Swimming now ends 4:30" / "Swimming was removed. Is a pickup still needed?" | Same buttons. An existing claim moves with the event. |
| Escalate | `end − 45 min`, if unclaimed | Both parents, time-sensitive | "No one is set to collect Ryshi at 4:00." | I'll go |
| Leave-by | `end − travel − 5 min` | Collector, time-sensitive | "Leave now for Ryshi: 4:00 at the Leisure Centre (~20 min)." | **On my way** · **Running late** (tells the kid "~10 min late") · **Swap** (hands off to the other parent and re-asks them) |
| Kid confirmation | `end − 10 min` | Kid (if they have a device) | "Dad's collecting you at 4:00 from the Leisure Centre." | — |
| Close | `end + 15 min`, if the action is open | Collector | "Got Ryshi?" | **Yes** → the action is done and the parent ring advances |

**Pickup rules for several kids and for travel**
- **Combining kids:** kids ending at the same place within 15 min of each other get **one** pickup ("Ryshi & Mia at school, 3:10").
- **Travel time:**
  - A family default of 20 min.
  - A per-place override, learned when a parent edits "~20 min".
  - Later (iOS, optional): an on-device MapKit ETA from the parent's current location. It is never sent to the server.

**Wins that come for free**
- Half days and early finishes show up in the timetable, so the reminder moves on its own. This is the moment people will notice.
- The pickup becomes an action, so it appears in the Family Rings "Needs you" ring and on the watch (the watch already reminds on action `dueTime`).

**Storage and privacy**
- Rules, pickup points and per-place travel times describe **kids' whereabouts**. Store them with the datacrypto at-rest pattern.
- Kids never see other kids' pickups.

### 6.3 Dinner planning offer (parents only)

**Intended flow.** When dinner isn't planned in time, Hermes offers parents a one-tap way to plan it:
- tonight's dinner, in the afternoon;
- next week's dinners, on the planning day.

Accepted plans become menu entries, shopping gaps and prep reminders through the existing Meals pipeline.

**Tonight**

*Trigger:* at `dinnerTime − 3 h` (dinner time comes from meal prefs; default 18:30 → 15:30), if there's no dinner entry for today.

*Offer:* "Dinner tonight isn't planned. Want 3 ideas from your pantry?"
- On pickup nights where the last commitment ends within 90 min of dinner, it adds "It's a swimming night, so these are quick ones".
- Buttons: **Show 3 ideas** · We're eating out · I've got it.

*Ideas:*
- **Source:** deterministic, from the existing `recipes.suggest` coverage. **No model call.**
  - Pantry coverage comes first.
  - Allergens and avoid-lists are enforced (move `householdExcludeTerms` from `routes/meals.js` into `lib/meals.js` so both paths share it).
  - Skip anything served in the last 10 days.
  - Prefer recipes of 25 min or less on busy nights.
- **Card:** 3 rows showing title, minutes and "you have 7 of 9".
- **Cook this:**
  - `meals.addMenuEntry(... source:"hermes")`;
  - missing items → shopping;
  - confirmation: "Added Paneer wraps for 6:30 · 2 items added to shopping".
- **Undo** is available for 10 minutes.

**Next week**

*Trigger:* on the planning day and time (Sun 17:00 by default), if Mon–Sun has fewer than 4 dinners planned.

*Offer:* "Next week has 2 of 7 dinners planned. Draft the other 5?" Buttons: **Draft the week** · Not this week.

*Draft:*
- **Uses the existing `/menu/plan` engine:** AI when `ANTHROPIC_API_KEY` is set and within quota, deterministic otherwise.
- **Refactor it** into `meals.planDraft()` so it can return a **draft without writing**.
- **Context:**
  - Family Memory and meal prefs;
  - busy nights (pickup ends, late activities) → quick meals;
  - trip days → skipped;
  - leftovers → planned.
- **Review:** the draft opens the **existing** meal-plan import review (`routes/meals.js:405-462`). Nothing is written until the parent approves.
- **After approval:**
  - Menu entries are added.
  - The shopping list and prep stamps run through the existing pipeline.
  - The family room gets one card from **Hermes**: "Next week's dinners are planned."
- **Fix the sender:** today's `/menu/plan` posts that card as the parent.

**Prep reminders finally fire.** The tick calls `meals.duePrepReminders`, which already handles caps and quiet hours, and computes times in the family timezone. The iOS `meal_prep` push route opens Meals.

**Learning** (Muse-style, governed): after 3 similar picks, Hermes *proposes* a memory, for example "Quick pasta on swimming nights?". A parent approves it in Family Memory. Hermes can never write memory directly (M1).

---

## 7. Surfaces and copy

| Surface | What changes |
|---|---|
| **Push (iOS)** | Categories `nudge.pickup.ask`, `nudge.pickup.leave`, `nudge.home.kid`, `nudge.home.parent` and `nudge.dinner`, with actions that respond in the background. `thread-id` per moment, e.g. `pickup-<kid>-<date>`, so each day groups together. Add the Time Sensitive Notifications capability. |
| **Push (web)** | `actions` in `showNotification` (`public/sw.js`), and `notificationclick` posts to the respond API. |
| **Today (web and iOS)** | A slim "Hermes" strip above the Needs-you hero. It shows at most 2 live nudges, with the same buttons, and is resolved in place. The pickup claim also appears as a hero row. Kid Today shows "Dad's collecting you at 4:00 · home by 4:45". |
| **Private Hermes thread** (P5) | Chat scope `assistant:<userId>`, listed as "Hermes" in each person's rooms, with push to that person only. Each nudge is a live card whose buttons show state ("Claimed by Mayur ✓"). Free-text replies are covered in §12 D2. The kid-context leak is fixed by construction, because a kid's thread always carries the kid actor. |
| **Watch** | Nothing new. Pickup actions flow through the existing watch reminder plan. |
| **"What Hermes did"** (parents) | The ledger rendered as today's list: sent, answered by, and outcome. It's the audit trail, and it's how parents tune settings. |

---

## 8. Controls, safety and privacy

- **Opt-in rollout.** Moments default to on for this family (the owner) behind a per-family flag. Other families get it only after the owner's review.
- **No writes outside FamETC.** Every FamETC-native write (pickup action, menu entry, shopping) needs an explicit tap and can be undone. The Operator approval engine stays the path for anything else.
- **Kid boundaries.**
  - Kids get their own items only.
  - Kids can't claim pickups or change rules.
  - Parents control a kid's nudge settings.
- **Encryption.**
  - The ledger stores ids and times.
  - Pickup places, rules and any stored text use the datacrypto pattern.
- **Rate limits** on the respond route. Answers are idempotent, and a second claim returns "already claimed by Mayur".
- **Analytics** use aggregate counters only, through the existing `lib/analytics.js`.

---

## 9. Fix first (found during this analysis)

| # | Defect | Evidence | Fix |
|---|---|---|---|
| 1 | **A kid's @Hermes turn receives the parent-level context** (preferences and memory sections) | `routes/hermes.js:356` builds with `actor: null`; `family-context.js:150-153` grants all sections when the actor is null | Resolve the actor from the inbound message's actor token and refuse `family-assistance` context without one. Test: a kid mention's context lacks the parent-only sections. |
| 2 | Operator approvals notify nobody; iOS has no approval UI | `lib/operator*.js` sends no notifications | Push parents on `awaiting_approval` (`famType:"operator_approval"`). iOS routes the tap to the web Today until a native approval UI exists. |
| 3 | Hermes replies push to every member, kids included | `routes/hermes.js:378` | Push the asker; other members' notifications are passive. The plugin passes `replyTo`. |
| 4 | Meal-prep reminders never fire; times use the server clock | `routes/meals.js:652-671` has no caller; `meals.js:772-779` | Call the sweep from the tick, and compute in the family timezone. |
| 5 | No family timezone; timetable hard-coded `+07:00` | `family.js`, `school-api.js:21,348-349` | `family.timezone` plus `lib/family-time.js`. Run tests with `TZ=UTC`. |
| 6 | The iOS homework reminder fires at midnight (due 08:00 − 8 h) | `NotificationScheduler.swift:119-137` | Remove it once the home check-in ships (P3). Until then, fire at 16:00 the day before. |
| 7 | iOS ignores `meal_prep` pushes, shows travel research as a homework card, and has no HELPER tag | `NotificationHandler.swift:87-113`, `ChatView.swift:1842-1848` | Add the route, a generic Hermes result card, and the tag (IOS-BRIEF §4.6). |
| 8 | `notifyHomeworkReminder` is dead code | `fam-notifications.js:507-519` | Delete it. The home check-in replaces it. |

---

## 10. Phases (each ends with runnable checks)

All phases follow the house rules:
- Node 24; run `node --test` before every commit.
- Conventional commit per phase.
- **Push `main` before deploying.**
- Deploy with `scripts/pack-deploy.sh`, then the Hostinger V1 upload and build.
- Verify on live fametc.com.
- For iOS: the owner archives; run the `production` skill before submission.
- Never echo secrets.

**P0 · Fix first** (§9 #1–5, #7–8). Rough size: 2–3 days.
- Checks:
  - `node --test tests/hermes-context-actor.test.js` (new);
  - `TZ=UTC node --test tests/meals-prep-timezone.test.js` (new);
  - existing Hermes and operator suites green.
- iOS: `NotificationHandler` routes verified by `xcrun simctl push` (simulator-only).

**P1 · Proactive foundation.** Rough size: 4–5 days.
- Family clock, `kidDay` (with the watch route switched to it), planner, ledger, tick, preferences and quiet hours, the respond API, push categories and web actions, and the web Today "Hermes" strip.
- Checks (fake clock, `TZ=UTC`):
  - a planned nudge fires exactly once;
  - a restart between ticks doesn't resend;
  - quiet hours hold;
  - bundling and caps hold;
  - a kid can't answer a parent nudge;
  - `kidDay` equals the watch route's output for the fixture family.

**P2 · Pickup.** Rough size: 3–4 days.
- All stages, standing rules, the pickup point, per-place travel time, combined pickups, the kid confirmation, and "got them?".
- Checks: the timetable fixture ends 15:10 → the ask fires at 13:40 Bangkok. A claim by parent A:
  - creates an action for A;
  - gives B a passive update;
  - a second claim returns 409.
- A moved event triggers a re-ask, and "No pickup needed" silences the rest.
- iOS: tapping "I'll go" from a simulator push posts the claim to the fixture server.

**P3 · Home check-in.** Rough size: 3 days.
- Kid and parent messages, the 19:30 follow-up, action due reminders, the weekday home-plan template, the kid-readable plan, and retiring the iOS local homework reminder.
- Checks:
  - nothing is sent when nothing is actionable;
  - one follow-up at most;
  - a kid never sees a sibling's items.

**P4 · Dinner offers.** Rough size: 3–4 days.
- Tonight's offer and 3 ideas, "Cook this" with undo, the weekly draft through `meals.planDraft()` and the existing review, the prep tick, and the Hermes sender for plan cards.
- Checks:
  - allergens are excluded from ideas;
  - no writes before approval;
  - the offer never reaches a kid;
  - the busy-night filter applies when a pickup ends within 90 min of dinner.

**P5 · Private Hermes threads and conversation.** Rough size: about 5 days, pending D2 and D3.
- `assistant:<userId>` rooms, live nudge cards, free-text replies, and the "What Hermes did" page.

**P6 · Tune.** Use response and dismiss rates to lower nudges people ignore. Review with the owner after 2 weeks of real use.

**Done means:** on live fametc.com with the owner's family, and verified on a real iPhone:
- a real pickup ask, claim, leave-by and close;
- a real home check-in;
- a real dinner offer.

The owner confirms each one. Time-sensitive Focus breakthrough and lock-screen actions are **device-only** checks.

## 11. How we'll know it works

| Moment | Signal | Direction |
|---|---|---|
| Pickup | Collector known 45 min before the end | ↑ toward 95% |
| Pickup | Escalations per week | ↓ |
| Home | Due-tomorrow homework done before 21:00 | ↑ vs. the 2-week baseline |
| Home | Kid "Start" taps | ↑ |
| Dinner | Dinners planned by 16:00 | ↑ |
| Dinner | Offer → "Cook this" acceptance | ≥ 30% |
| Dinner | Weekly draft approvals | ↑ |
| Noise | Nudges per person per day | ≤ 4 kids / ≤ 6 parents |
| Noise | Mute and disable rate | ↓ |
| Noise | "Not useful" taps | ↓ |

## 12. Decisions for the owner

- **D1 · Where Hermes's proactivity lives.** *Recommended:* the server-side loop (§5), with the Mac agent as the optional brain. The alternative, scheduling from the Mac agent, fails whenever the Mac sleeps and can't serve other families.
- **D2 · Free-text replies to nudges.**
  - *Recommended:*
    1. Buttons first.
    2. A small server intent parser for "snooze / done / remind me at 6 / Priya's getting him".
    3. Anything else goes to the Mac Hermes agent when it's connected, with the replying person's actor.
  - *Alternative:* a server-side Claude call. The server currently pins `claude-sonnet-4-6`; move to `claude-sonnet-5` or `claude-haiku-4-5-20251001` for intents. This is always available but adds cost and a kids'-data processing decision.
- **D3 · Private Hermes threads (P5).** *Recommended:* yes. This is what makes Hermes feel like Muse or Instinct. Until then, push plus the Today strip carry every moment.
- **D4 · Default times.** Confirm or change:
  - pickup ask −90 / escalate −45 / leave-by −(travel + 5) / close +15;
  - travel 20 min;
  - kid home fallback +45;
  - evening check-in 17:30;
  - kid follow-up 19:30;
  - dinner offer −3 h;
  - planning day Sun 17:00;
  - quiet hours: parents 21:30–07:00, kids 20:30–07:00.
- **D5 · Kid messages.** Should kids get the home check-in and the pickup confirmation on their own devices from day one, or should parents opt each kid in?
- **D6 · School pickup point and travel time.** Accept fixed defaults now (recommended), and add an on-device ETA later.

---

**Sources**
- [Meta: Introducing Muse](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/)
- [CNBC on Muse](https://www.cnbc.com/2026/09/08/meta-personal-ai-agents-public-reckoning-privacy-safety.html)
- [Vellum: Instinct breakdown](https://www.vellum.ai/blog/official-instinct-breakdown)
- [AlphaMatch: Instinct review](https://www.alphamatch.ai/blog/instinct-ai-personal-assistant-review-2026)
