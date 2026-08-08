# FamETC Family Time-Saver Product Plan

**Status:** product direction and sequencing proposal  
**North Star:** family coordination time saved per week

## Executive decision

FamETC should stop behaving like a set of family utilities and become a
coordination system. The product should collect information once, turn it into
shared commitments, and show each person only the next useful actions.

The existing Horizon shell is a good foundation: Today, a persistent family
chat, kid-specific views, and native surfaces for the highest-frequency jobs.
The main problem is structural. Meals and Trips are separate destinations,
chat is mostly a conversation surface, and onboarding ends before FamETC has
connected to the family's real life. More feature depth alone will not create
the time-saver effect.

## What the product must feel like

When a parent opens FamETC on Monday morning, it should already know:

- what school has published and what is due;
- which activities and travel plans affect the week;
- what dinner is planned and what needs buying or preparing;
- which decisions or tasks are waiting on each family member;
- what changed since the last visit.

The parent should be able to accept, edit, assign, or dismiss a suggestion in
seconds. A kid should see a simple "My next" view: what is due, where to be,
what to bring, and what they can check off. Chat should be the easiest place to
say something, while FamETC quietly turns useful messages into structured
family work.

## Current product assessment

### Strong foundations

- School calendar feeds, homework, activities, meals, trips, goals, notes,
  chat, push, and native iOS surfaces already exist or have clear contracts.
- The Today screen already combines schedule, dinner, homework, and habits.
- Meals has the right end-to-end primitives: menu → shopping → pantry, prep
  reminders, calendar merge, and chat cards.
- Trips has the right collaboration primitives: itinerary, flights, lodging,
  packing, guest access, and scoped trip chat.
- Role scoping and encryption decisions are appropriately conservative for
  kids' data.

### The time-saver gaps

1. **Destination sprawl.** The sidebar exposes Today, Calendar, Homework,
   Goals, Activities, Trips, Meals, Notes, and Settings. The family still has
   to decide where a new piece of information belongs.
2. **Onboarding creates an account, not value.** The current flow is role →
   passkey → create/join family. It does not connect a school feed, add kids,
   seed a meal plan, import a calendar, or invite the other parent before the
   user lands in the app.
3. **Today is a dashboard, not an action queue.** Schedule, homework, habits,
   dinner, and Daily 5 are adjacent cards, but there is no single prioritized
   list of decisions, tasks, preparation, and ownership.
4. **Chat does not close the loop.** It can carry messages and cards and pin to
   Notes, but a message cannot reliably become an event, homework item,
   shopping item, task, poll, or decision with an owner and due date.
5. **The same family work is represented multiple ways.** Calendar events,
   homework, activities, meal prep, trip packing, and chat cards have different
   capture and notification patterns.
6. **Family participation is uneven.** Kids get a simplified app, but much of
   the coordination work remains parent-only. Meals in particular needs a
   narrow kid participation layer even if planning and pantry control stay
   parent-owned.
7. **Notifications are feature-specific.** FamETC needs a shared, quiet,
   actionable reminder system rather than separate nudges from school, meals,
   trips, and chat.

## Product spine to build first

### 1. A canonical family graph

Create shared primitives used by every domain:

- `Person`: parent or kid, role, permissions, availability, preferences.
- `Commitment`: anything that occupies time or requires preparation.
- `Task`: an action with owner, due time, status, source, and optional parent
  commitment.
- `Decision`: a question or choice with options, voters, deadline, and result.
- `Artifact`: a source document, message, booking, school feed item, or photo.
- `Collection`: family, trip, meal plan, activity, or school source.

Existing meals, homework, trips, and activities remain specialized views and
domain models, but they must emit shared tasks, commitments, and notifications.
Keep trip permissions scoped for guests; merge only the permitted family-facing
outputs into Today.

### 2. One capture surface

Add a global `Add / Ask FamETC` action available from Today, chat, and iOS.
Support plain language and attachments:

> “Maya has soccer Tuesday at 5, bring the blue kit.”

The system proposes a structured result: activity event, kid, reminder, and
packing task. The user confirms once. The same capture surface should accept a
school notice, homework photo, flight/hotel confirmation, grocery request, or
family question.

### 3. One action queue

Today becomes a prioritized queue with sections such as:

- **Now:** overdue or time-sensitive actions.
- **Prepare:** tasks that must happen before a commitment.
- **Decide:** open family questions and approvals.
- **Coming up:** the next 7 days, grouped by child or family.
- **Done / caught up:** lightweight reassurance, not a productivity score.

Every row answers: what, who, when, why it matters, and the fastest action.
The queue is the default for parents; kids get the same underlying data filtered
to their own actionable view.

## Sequenced roadmap

### Phase 0 — Product spine and measurement

**Goal:** make the existing app capable of producing one coherent family plan.

- Define canonical IDs and source links for tasks, commitments, decisions, and
  notifications.
- Rework Today into the action queue; keep the current cards as supporting
  views, not competing destinations.
- Add global capture and quick-add from chat.
- Add shared ownership, due time, snooze, complete, and undo behavior.
- Build one notification preference and quiet-hours service.
- Instrument aggregate counters for activation, capture, completion, reminder
  action, and weekly active families.

**Exit test:** a parent can see school, homework, activity, dinner, and trip
preparation in one queue, with no duplicate manual entry.

### Phase 1 — Zero-to-value onboarding

**Goal:** FamETC saves time in the first session.

- Keep passkey and parent/kid role selection.
- After family creation, run a short setup checklist: add/import kids, invite
  co-parent, connect school calendar, choose the family's planning start day,
  and optionally seed meals.
- Preconfigure St Andrews feeds and show a preview before confirmation.
- Let parents paste or forward a timetable, homework diary, or calendar link.
- Seed a useful starter state: school events, one empty family chat, a sample
  week structure, and a clear next action.
- Make every setup step skippable, resumable, and visible from Today.

**Exit test:** a new parent reaches a populated Today queue in five minutes or
less, without entering every event manually.

### Phase 2 — School and weekly planning loop

**Goal:** remove the largest recurring school coordination burden.

- Normalize feed/Moodle items into assignments, exams, activities, and school
  announcements.
- Add assignment effort, work sessions, dependencies, and parent visibility.
- Turn “due Friday” into suggested work blocks earlier in the week.
- Add a Sunday/Monday weekly review: confirm schedule, homework pressure,
  activities, meals, and travel conflicts.
- Surface school changes in the family inbox and Today queue, not just the
  calendar.

**Exit test:** a parent can prepare the week from one review flow and every
  child can see their own next actions.

### Phase 3 — Meals as an automatic household loop

**Goal:** reduce planning, shopping, and pantry maintenance to a short review.

- Keep the existing menu → shopping → pantry model and integrate its outputs
  into the canonical queue.
- Let a weekly plan use the school/activity/trip schedule: late practices,
  travel days, leftovers, prep windows, and household preferences.
- Generate one shopping list from the menu, pantry state, and manual requests.
- Make “what's for dinner?” a structured chat card that can be accepted,
  changed, or turned into shopping/prep tasks.
- Keep menu and pantry controls parent-owned, but allow kids to see dinner and
  complete safe tasks such as “pack lunch” or “bring ingredients” if parents
  enable it.

**Exit test:** planning seven dinners and producing a usable shopping list takes
  less than three minutes after pantry setup.

### Phase 4 — Trips as a family plan, not a separate app

**Goal:** make travel coordination visible before and during the trip.

- Keep the trip's separate permission scope for invited adults and guests.
- Paste or upload flight, hotel, and activity confirmations; extract dates,
  times, locations, travelers, and booking references for confirmation.
- Emit family-facing commitments and preparation tasks into Today: passports,
  transfers, packing, check-in, medication, and school conflicts.
- Keep trip chat as a room, but surface important decisions, changes, and tasks
  in the family inbox.
- Add a “trip readiness” view that is a filtered action queue, not another
  independent checklist system.

**Exit test:** a family can go from booking confirmations to a shared,
role-assigned readiness plan without retyping the itinerary.

### Phase 5 — Communication becomes coordination

**Goal:** make FamETC the place where family information turns into action.

- Create a unified inbox for family chat, trip rooms, school notices, and
  system updates, with clear source labels.
- Add message actions: create task, create event, add to shopping, assign,
  remind, poll, mark important, and summarize.
- Support lightweight decisions: “Which hotel?”, “Can someone pick up Sam?”,
  “Who can bring snacks?” with a deadline and resolved state.
- Search across messages and structured objects.
- Use push for changes that require a response; batch informational updates.

**Exit test:** a family can resolve a coordination request without copying the
  message into Notes, Calendar, or a separate list.

### Phase 6 — Kids, iOS, and adaptive automation

**Goal:** make participation easy for every family member.

- Ship the kid “My next” view across iPhone, iPad, and web.
- Support parent-configured permissions for kid-safe task completion and
  limited responses in meals/trips.
- Make Today, chat, calendar, homework, and capture the highest-speed native
  iOS actions; keep deeper configuration in webview only when necessary.
- Add smart defaults from repeated behavior, but show why FamETC suggested
  something and allow easy correction.
- Add weekly family recap: completed, pending, upcoming, and unresolved—not
  a competitive score.

## What to deprioritize

- Do not expand Daily 5, Notes, or standalone enrichment until the action queue
  is useful. They are charm and retention layers, not the core time-saving
  wedge.
- Do not add more top-level tabs for every new domain.
- Do not build a general AI assistant before capture, permissions, source links,
  confirmation, and undo are reliable.
- Do not duplicate family data inside Trips or Meals just to make a screen easy
  to render.

## Success measures

Use privacy-safe aggregate counters and short in-product time-saved prompts.
Initial directional targets:

- first populated Today queue in ≤5 minutes;
- ≥3 useful sources or domains connected during the first week;
- ≥80% of weekly queue items created by import, reuse, or suggestion rather than
  manual re-entry;
- ≥90% of actionable reminders have an owner and due time;
- weekly planning completed in ≤5 minutes by an active parent;
- measurable reduction in “where/when/who?” family messages over time;
- parent and kid weekly return rate both tracked separately.

The next build should be Phase 0. It is the smallest slice that changes the
product from “many things a family can manage” into “the system that manages
the family's week.”
