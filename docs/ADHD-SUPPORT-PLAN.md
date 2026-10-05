# Fam ETC student organization product plan

**Product plan approved for implementation · 5 October 2026**

The core pilot is now implemented on the local `codex/student-organization` branch. See the [implementation record](STUDENT-ORGANIZATION-IMPLEMENTATION.md) for delivered behavior, verification and remaining device gates. The roadmap and proposed pilot below remain broader than this first increment.

Fam ETC should help a student turn school and home responsibilities into a small number of clear actions, carry them out, and recover when something interrupts the plan. The initial use case is a 14-year-old using an iPad and a parent-managed Apple Watch through Apple Watch For Your Kids, without an iPhone of his own. The three priorities are homework, packing the right things for the next school day, and remembering chores such as walking the dog.

The recommended first release combines **My Next**, **Pack for School**, and **My Routines**. The iPad is the place to understand and adjust the plan. The Watch makes that plan available where an action happens. Success means fewer forgotten essentials, more completed and submitted assignments, and less parent prompting, with the student feeling more in control.

This is a proposed extension to the existing family hub. It does not amend the approved identity, Family Rings design, pricing, privacy, or native/web contracts. Findings below distinguish inspected source from device-verified behavior. Product choices, suggested defaults, estimates, and pilot targets are proposals rather than established clinical facts.

## 1 What support should accomplish

The app should answer five practical questions:

1. What matters now?
2. What is the first small thing I can do?
3. What do I need with me?
4. How do I know this responsibility is finished?
5. What can I do if I am stuck, late, or missing something?

For this pilot, design around a teenager's preferences and growing independence. Use ordinary labels such as Today, Homework, Pack, and Routines. No diagnosis is required to enable the features, and no ADHD badge appears in the interface. Let him choose the wording of prompts, routine times, visual density, and whether to show Koko. Parents help set up the system and respond to exceptions; the student should be able to operate it himself.

The app is organizational support alongside the family's existing clinical and school support. It does not diagnose, prescribe treatment, measure ADHD severity, or promise better grades. A useful feature for one student may irritate or distract another. Ask what actually helps and change one part of the routine at a time.

## 2 Evidence and its product implications

| Evidence | What it supports | Proposed Fam ETC response and limits |
| --- | --- | --- |
| CDC describes organizational training and behavioral classroom management as established school approaches. It also emphasizes individualized support and collaboration. | Practice organizing materials, planning work, and communicating expectations. | Make the actual next action easy to see and rehearse with an adult initially. A digital checklist alone is not the intervention described by CDC. [CDC classroom guidance](https://www.cdc.gov/adhd/treatment/classroom.html). |
| NICE describes environmental adjustments including written instructions, reduced distraction, shorter focus periods, and movement breaks, tailored to the person. | Adjust the surroundings and the demands of the task. | Offer a quiet work view, written steps, and adjustable work/break intervals. No universal timer length is established here. [NICE NG87 recommendations](https://www.nice.org.uk/guidance/ng87/chapter/recommendations). |
| A randomized HOPS study involved 47 students in grades 6–8. Parent ratings of organization, planning, and homework completion improved relative to a waitlist; teacher ratings did not show significant improvement. The program was delivered by school mental health providers. | Organization and homework routines are relevant intervention targets for this age range. | Start with materials management and homework workflows. Do not transfer the study's results to Fam ETC or claim equivalent effectiveness. [Langberg and colleagues, 2012, original paper](https://pass.vcu.edu/media/pass/pdfs/HOPSRandomizedTrialSPR.pdf-correctedByPAVE.pdf). |

**Product hypotheses to test:** a timetable-derived packing list will reduce forgotten equipment; a visible first step will make homework easier to start; a small number of timely Watch prompts will reduce reliance on parent reminders. These are hypotheses about this proposed product, not research findings about Fam ETC.

Avoid designing around the idea that forgetting means not caring. A missed action can also mean the task was unclear, the materials were unavailable, the prompt arrived at the wrong time, or the device was offline. The recovery flow should make those possibilities easy to handle.

## 3 Match support to the difficult moment

| Moment | Possible obstacle to explore with the student | Product response | Recovery route |
| --- | --- | --- | --- |
| Opening homework | Too many assignments; unclear starting point | One chosen assignment and one concrete next step | Choose a different task, make the step smaller, or ask for help |
| Working | Losing track of the current step or elapsed time | Persistent step, optional timer, pause and resume | Continue from the last explicit state; no automatic failure |
| Finishing | Work is finished but upload, submission, or packing remains | Separate finish and hand-in checks | Keep the hand-in action visible |
| Packing | Tomorrow's subjects and equipment are spread across sources | One list derived from the next school day's timetable | Show missing or uncertain information explicitly |
| Remembering chores | Intention is forgotten before the opportunity arrives | Agreed time window and brief Watch cue | Snooze, ask for help, or arrange a handoff |
| Switching activities | Current activity is hard to stop | Optional advance notice and a visible next action | Adjust the transition without moving the external deadline |
| A difficult day | Backlog becomes overwhelming | Choose one essential action and review the rest with a parent | Record a new plan without silently deleting responsibilities |

The table is a discovery framework. It does not assume all of these difficulties apply to the pilot student.

## 4 What Fam ETC can reuse

Source assessment: local `main` at `36c1930140092b3e7f12ebb9c68356261bd23b43`. This was a planning review, not a fresh runtime or production audit.

| Existing foundation | Inspected state | Extension required |
| --- | --- | --- |
| Native Today and iPad layouts | Family Rings, homework/habit summaries, actions, and adaptive native surfaces exist. | Add an optional action view within existing navigation; retain established ring meanings. [Today source](../ios/FamETC/Features/Today/FamilyRingsToday.swift), [app contract](../APP-BRIEF.md). |
| Homework | Due dates, effort estimates, `todo/in_progress/done`, notes, and checklists exist. Work-session suggestions are explicitly read-only. | Add student planning metadata and a distinct submission record; make the first step prominent. [Homework model](../lib/homework.js), [routes](../lib/routes/homework.js). |
| School data | Private child homework and timetable feeds exist, with server sync and deduplication. Timetable normalization maps a supplied school week to dated lessons. | Add material rules, coverage/freshness information, and packing occurrences. Verify next-week and holiday behavior before relying on it. [School API](../lib/school-api.js). |
| Family actions | Open, done, and snoozed commitments exist, with source references. | Reuse for dated routine actions where possible; add bounded recurrence and occurrence identity. [Actions](../lib/actions.js). |
| Fams chores | Parent-assigned paid chores support submission and approval. The existing creator requires a positive Fams amount. | Keep ordinary routines independent of payment. Link a routine to an optional existing reward chore without double credit. [Fams](../lib/fams.js). |
| Habits | Daily check-ins and streaks exist. | Reuse appropriate check-in behavior, but do not treat multi-step routines or packing as streak obligations. [Goals](../lib/goals.js). |
| Watch | A standalone child target already has direct HTTPS, scoped credentials, saved snapshots, an offline mutation queue, local reminders, and a local 20-minute focus block. | Extend these surfaces and validate them on the actual Family Setup Watch. Independent intent in source does not establish physical-device support. [Watch README](../ios/FamETCWatch/README.md), [project targets](../ios/project.yml). |
| Study space and privacy | Koko and private My Corner have existing contracts; mood sharing is explicit. | Preserve these boundaries. Do not turn private notes or energy selections into parent monitoring. [App contract](../APP-BRIEF.md). |

The native scanner is currently unwired in the active HybridWebView path. Photo capture, OCR, voice, and AI task extraction must not be assumed available as part of this release. Earlier plans mentioning older designs or Daily 3/Daily 5 do not override the current app brief.

## 5 The first release

### Pack for School

**Student promise:** “Show me exactly what I need for the next school day, and let me check it as I put it in my bag.”

This is the first feature to pilot because it directly addresses a stated daily problem and produces an observable outcome the next morning.

The iPad shows the target school date, timetable, packing checklist, and source freshness. The Watch shows the next unchecked item with large **Packed**, **Morning**, and **Can't find it** actions. Checking an item means it has physically been placed in the bag; merely viewing the list never completes it.

Build the list from explicit, editable rules:

| Source | Example rule | What the student sees |
| --- | --- | --- |
| Everyday essentials | School bag baseline | Pencil case, student card, water bottle |
| Subject or class | Maths → calculator and maths book | “Calculator — Maths tomorrow” |
| Activity | PE → PE kit; music lesson → instrument | Item plus the relevant activity |
| Assignment | Paper worksheet due in the next school day | “Completed worksheet — hand in during English” |
| One-off family entry | Signed form required tomorrow | “Signed form — added by parent” |

The examples are illustrative; the student and parent confirm the actual material list. Start with manual subject-to-item mapping, not AI inference from ambiguous lesson names. Deduplicate physical items while retaining every reason they are needed. Support belongings that stay at school with an explicit “Already at school” state for that occurrence, rather than pretending they are in the bag.

The list has two passes. **Evening** covers books, equipment, and completed paper work. **Morning** contains genuinely later items such as a lunchbox, filled water bottle, or iPad still charging. A summary can say “Evening packing finished; two morning items remain.” It must not say “All ready” while required items remain unresolved.

Required behavior:

- Resolve the next school day, respecting school timezone, known holidays, timetable coverage, and one-off overrides. On Friday, clearly label Monday when that is the next verified day; do not assume every weekday is a school day.
- Keep each day's packing state separate. Yesterday's checked PE kit does not automatically mean today's kit is packed. Stable item identifiers preserve ticks when a list is reordered.
- If the timetable changes after packing, highlight only the added or changed requirements. Retain unaffected checks and show why the list changed.
- If school data is missing, stale, or does not cover the target date, show “Check timetable” and the last known update. Offer a manual list; do not infer “nothing to bring.”
- Let the student report a missing item and deliberately request help. Parents receive an actionable request, not a stream of every checkbox.
- Cache the list and changes on Watch for use near the school bag without the iPad. Display pending sync honestly.
- Keep a printable or manually copied fallback for a flat battery or a school that disallows devices.

**Acceptance:** load a real, sanitized example timetable, generate tomorrow's list, pack offline on Watch, then sync to iPad without duplicate or lost checks. Change PE to a different activity after some items are packed. The revised list must show the change without reporting a false all-clear. Test Sunday evening, a holiday, absent future coverage, and an item left at school.

### Homework that ends with hand-in

**Student promise:** “Help me start the next piece of work and remember the last step.”

Keep the existing homework hub as the source of assignments. Add a small planning layer over it:

1. **Check the inbox.** Imported assignments show their source and last update. Provide “Something is missing” with a draft capture/request route; an empty import is not evidence of no homework.
2. **Choose today's work.** The student selects one to three realistic commitments around activities and rest. Expose the full list on request. Show total estimated work as an estimate, not a capacity guarantee.
3. **Choose a first step.** For “English essay,” this might be “Open the instructions and write three bullet points.” Reuse existing checklists. Begin with student/parent-authored templates and preserve original teacher instructions.
4. **Start optionally timed work.** Offer adjustable intervals, for example 5, 10, 15, or 20 minutes, plus no timer. These are pilot choices, not prescribed ADHD treatment. Start, pause, resume, extend, and stop must be clear.
5. **Recover.** “I'm stuck” offers “Explain what I need to do,” “Make the step smaller,” “I need something,” and “Ask for help.” The first two can open a checklist or a human-authored explanation; they need no chatbot.
6. **Finish the work.** A timer ending does not mark an assignment complete. Ask what remains and preserve progress.
7. **Hand it in.** Show “Upload in school portal,” “Hand to teacher,” or “Pack for tomorrow,” as appropriate. A child confirmation is labeled as self-reported. An actual school confirmation is a separate source-backed fact.

In the proposed release, the Watch will support the current step, expanded timer controls, an explicit completion action, and new hand-in reminders. The iPad will support reading instructions, editing the plan, and opening school resources. Long writing, file upload, and complex planning do not belong on the Watch.

Existing homework completion can trigger a legacy Moodle completion outbox for `school-portal` items. That is not proof that a document has been uploaded or accepted by a teacher. Preserve and test that integration; add submission metadata separately and audit every use of `done` before changing labels or lifecycle semantics. Historical completed items receive an unknown submission state, never a fabricated submission date.

**Acceptance:** complete a multi-step assignment across iPad and Watch, interrupt the timer, and resume. Finishing work must leave a required hand-in action visible. A school sync must not wipe personal steps or the plan; an offline completion must not generate duplicate rewards or school writes.

### My Routines and recurring chores

**Student promise:** “Remind me when I can act, and give me a way to change the plan.”

Start with one chore, such as walking the dog, and the packing routine. A routine contains an owner, agreed days and time window, optional short checklist, reminder preference, and a clear definition of done. Reward settings are optional and separate.

For a dog walk, use a brief cue such as “Dog walk — ready?” with **Start**, **In 10 min**, and **Need help**. A checklist can include leash and bags if he finds that useful. Completion is an explicit report after the walk. The app does not infer completion from GPS, heart rate, steps, or time elapsed, and does not require photographs as proof.

Allow **Someone else did it**, **Skip today**, and **Move today**, with appropriate parent visibility. These describe different outcomes and must not all become “done.” A routine edit changes future occurrences without rewriting yesterday. Missed daily chores do not accumulate as twenty identical overdue tasks.

For responsibilities where someone must take over, the parent and student agree on a fallback in advance. If a dog walk is still unconfirmed after its agreed window, a single private notice can ask the parent to check who will do it. No response or an offline Watch is not evidence that the chore was ignored. Fam ETC is not an emergency or animal-safety monitoring service.

Plain-language feedback can acknowledge completion immediately. Optional Fams rewards continue through the existing parent approval flow, once per occurrence. No new currency, lost-point penalty, punitive streak, or automatic Screen Time restriction is needed.

**Acceptance:** create a recurring dog walk, snooze one occurrence, hand another to a parent, and complete one offline. The next occurrence stays correctly scheduled and the wallet cannot receive duplicate credit after repeated sync.

### My Next within Today

Add an optional, focused view within the existing native Today surface. It contains one **Now** card, a small **Next** list, and a clear way to see the rest. A student can choose the active task and change it without fighting an opaque priority algorithm.

Suggested ordering is transparent: a student-started activity remains first; then a genuinely imminent fixed commitment, the agreed action for the current routine window, and the selected homework step. Show a reason such as “You chose this for after school.” If a fixed commitment conflicts with active work, offer a transition instead of silently replacing the screen.

The existing Watch already has Now, Day, and More. Extend that structure instead of inventing a separate ADHD app. Packing and routines become first-class candidates, and the student can keep a current task visible. Preserve access to Day and all work so a simplified screen does not hide important responsibilities.

This view is an opt-in presentation within the existing Family Rings design. It does not redefine ring counts, make every substep a ring contribution, or remove the existing dashboard. A larger default-layout change would require the separate design-contract decision.

### Quiet prompts and recovery

Begin the pilot with three agreed routine cues: the after-school homework check, the dog-walk window, and evening packing. Add a morning cue only if items remain. These are proposed defaults to tune together, not a universal limit or a claim about ideal frequency.

- Bundle routine prompts; avoid one alert per packing item or subject.
- Permit at most one ordinary follow-up per occurrence by default. An explicit snooze schedules the next cue instead of adding another reminder chain.
- Let him preview the haptic, choose neutral wording, and turn down or stop optional prompts.
- Respect quiet hours and manually configured school restrictions. Do not assume Fam ETC can read or override Apple's Schooltime state.
- Prefer the Watch for agreed routine cues and suppress redundant iPad prompts where the app can coordinate them. Perfect deduplication cannot be guaranteed while both devices are offline.
- Track intended, locally scheduled, acknowledged, and synced states separately. A scheduled notification is not proof it was displayed, noticed, or acted upon.
- Open the correct item from a notification. If it is already complete, say so; do not re-create it.

Keep routine notifications generic on the lock screen by default. No diagnosis, private note, full assignment text, or mood appears in a notification preview.

### Parent support without constant supervision

Parents get a small set of useful exceptions: help requested, equipment missing, schedule needs checking, or an agreed chore handoff. The student can see what parents can see. The normal parent view can summarize planned, reported complete, and awaiting confirmation, with last-sync time; it should not imply continuous observation.

Offer an optional weekly conversation card: what helped, what was annoying, and one adjustment for next week. It need not store responses. Parents and student should gradually reduce checks when the routine becomes easier, and add support when circumstances change.

Keep My Corner private and energy check-ins transient unless explicitly shared, as the current contract requires. Do not infer effort, mood, honesty, or symptom severity from taps, missed tasks, or timer use. Do not post missed work automatically into family chat.

## 6 iPad and Watch experience

| Surface | Main job | Proposed contents |
| --- | --- | --- |
| iPad Today | Understand and adjust the day | My Next, today's chosen homework, next routine, and a packing summary |
| iPad Homework | Read, plan, and finish work | Original instructions beside the current step; estimate and due date clearly distinguished; submission check |
| iPad Pack | Prepare the next school day | Timetable beside the material list; evening and morning passes; missing-item recovery |
| iPad work view | Keep one task visible | Current step, optional timer, pause, help, and next step; chat can collapse while access remains available |
| Watch Now | Act with little navigation | One current action, short context, and large explicit controls |
| Watch Day | See commitments and routines | A short chronological list with the target date and update status |
| Watch More | Retrieve and recover | Homework, Pack, Routines, pending changes, connection, and settings |
| Watch complication | Open the relevant surface | Generic counts or timer progress; preserve the current exclusion of titles and credentials |
| Parent iPad or web | Configure and help | Material rules, recurring responsibilities, source issues, requested help, and agreed exceptions |

Example screen content, subject to the student's preference:

> **Now: Maths**
>
> Open the worksheet and do question 1.
>
> **Start** · **Choose another** · **Help**

> **Pack for Tuesday**
>
> Calculator — Maths, period 2.
>
> 3 of 6 items packed.
>
> **Packed** · **Morning** · **Can't find it**

Use readable text, native controls, and meaning beyond color. Test iPad portrait, landscape, narrow multitasking widths, keyboard use, VoiceOver, larger text, and reduced motion. Use large Watch tap areas and simple vertical screens. Do not require drag-and-drop, a keyboard, sound, or a precise gesture for a core action. Prefer clear acknowledgements over celebrations that interrupt work. He should be able to disable decorative content.

### A possible day

Times below are illustrative, not a proposed schedule imposed on the family.

| Moment | Student experience | Parent involvement |
| --- | --- | --- |
| Before school | Watch shows only unfinished morning packing items | Help only if an item was flagged |
| During school | School-approved access only; no dependence on class-time prompts | Agree device rules with school |
| After a chosen rest period | iPad checks homework and lets him choose today's first task | Brief setup support initially |
| During homework | Current step stays visible; Watch timer is optional | Respond to a deliberate request |
| Agreed chore window | Watch prompts the dog walk, with snooze or handoff | Take over if the agreed fallback is needed |
| After dinner | Watch walks through the next school day's packing list | Resolve missing supplies or uncertain schedule |
| Once a week | A short conversation adjusts one troublesome part | Collaborate, then reduce unnecessary prompting |

There is no requirement to complete Daily 4, earn Fams, or fill every ring before accessing these supports.

## 7 Standalone Apple Watch requirements

The user's intended configuration is a Watch managed by a parent's iPhone through Apple Watch For Your Kids; Fam ETC operation in that configuration remains to be verified on hardware. The child's iPad is a Fam ETC client, not the device that pairs Apple Watch. Apple's setup requires a compatible cellular-capable Watch, a managing iPhone, separate Apple Accounts, and Family Sharing. A cellular subscription is not required for initial setup, but away-from-Wi-Fi connectivity depends on service. [Apple setup requirements](https://support.apple.com/en-us/109036).

The existing child target `com.fametc.watch` is the starting point. Keep its parent-issued Fam ETC code and child-scoped credential. The separate parent companion target is not a substitute: a parent's paired iPhone must never cause the child Watch to inherit the parent's identity or data. The current source requires watchOS 11; validate the actual Watch model against that requirement and the supported deployment versions before committing to a release.

| Requirement | Product consequence | Verification needed |
| --- | --- | --- |
| Install and enroll in Family Setup | Child can connect using the parent-generated Fam ETC code | Physical installation, approval/download flow, correct account, and reconnection on the target Watch |
| Direct networking | Normal use works without the parent's iPhone nearby | Parent iPhone unavailable; separately test Wi-Fi and cellular; verify iPad changes arrive after a Watch sync |
| Useful offline behavior | Packing, checklist checks, and chore reports remain usable | Airplane mode, app termination, restart, outbox replay, and conflict handling |
| Direct notifications | Watch registration and notification permissions are independent | Correct APNs topic/provisioning, local reminders, remote update, denied permissions, and token revocation |
| Honest background behavior | Cached plans remain useful when updates are delayed | Delayed refresh, Low Power Mode, flat battery, expired data, and foreground recovery |
| Discreet display | A watch face does not expose a child's assignments or support needs | Complication and notification preview inspection on the device |

Apple documents direct web-service access and notes that WatchConnectivity cannot be the primary data source for an independent experience; background refresh is constrained and not guaranteed. Fam ETC should keep its own server and use foreground refresh, saved plans, and local actions as the dependable core. [Apple Watch data guidance](https://developer.apple.com/documentation/watchos-apps/keeping-your-watchos-app-s-content-up-to-date?changes=_1).

Apple supports local Watch notifications and APNs addressed to the Watch's own device token. That establishes an available mechanism, not guaranteed delivery at a particular instant. Validate actual routing for this Family Setup configuration. [Apple notification guidance](https://developer.apple.com/documentation/watchos-apps/enabling-and-receiving-notifications?changes=l_5%2Cl_5%2Cl_5%2Cl_5).

**Schooltime is a product constraint.** Apple restricts notifications and apps during Schooltime. Do not promise classroom prompts that bypass it. Begin with home routines; if in-school access is wanted, the family and school must agree when it is allowed. Provide a paper or iPad fallback. [Apple Schooltime description](https://www.apple.com/apple-watch-for-your-kids/).

The first release must not depend on Shortcuts automation, health sensing, or a phone relay. Apple lists Shortcuts and several health features as unavailable in Apple Watch For Your Kids. [Apple feature availability](https://support.apple.com/en-us/109036). Treat voice capture and App Intents as later compatibility investigations, not dependencies of the core workflow.

If using a Thai carrier, Apple's current Family Setup carrier section lists AIS and True dtac. Confirm the exact device and subscription with the carrier; ordinary Apple Watch cellular support alone is not enough. [Apple carrier matrix, checked 5 October 2026](https://www.apple.com/watch/cellular/).

## 8 Implementation direction

### Extend existing records and projections

Avoid a second homework database or a general-purpose scheduling engine. Homework stays homework, school events stay in their existing sources, and Fams remains the reward ledger. My Next is a bounded projection of those records and the new routine/packing state.

Proposed additions:

| Record or extension | Minimum useful contents | Boundary |
| --- | --- | --- |
| Support preferences | Account/child scope, cue windows, presentation choice, timer preference, default device, family/school timezone | Store support choices, not diagnosis or clinical notes |
| Material rule | Child, stable rule/item ID, class/subject/activity match, required item, normal location, morning/evening phase | Parent/student-confirmed mapping; no unreviewed AI requirements |
| Packing occurrence | Child, target school date, source revision/coverage, stable items, required state, explicit checks, revision | New state per school day; edited lists preserve valid prior checks |
| Routine template and occurrence | Owner, timezone, days/window, steps, dated occurrence ID, completion/skip/handoff state, optional existing reward link | Can project to existing actions; one occurrence per intended date/window |
| Homework planning extension | Chosen work date/window, next step, optional work-finished marker, hand-in method and submission state/source | Do not overwrite teacher due dates or alter the legacy completion contract implicitly |
| Active focus state | Source task, interval start, accumulated paused time, target duration, owning device, revision | Timer state is operational data; it does not prove attention or task completion |

Decide exact field and route names during implementation after inspecting all callers. Add versioned, optional response fields and decoding fixtures so older iPad, Watch, and web clients continue to work. A routine projection must reference its canonical occurrence; completing a projected action cannot create a second independent completion record.

Student editing should be scoped to their own plan, checklist, packing state, and permitted routine actions. Existing parent control over authoritative assignment details remains. If students need to record an assignment missing from a feed, accept a personal draft/request without modifying school-owned metadata or granting broader family permissions. Parent and child permissions on shared material rules need an explicit implementation contract.

### Preserve dates and source authority

Use school-local calendar dates for packing and deadlines, with timezone-aware instants for timed cues. Keep a date-only deadline distinct from an exact time. The existing Watch substitutes 17:00 for date-only work; that is a reminder convention, not a teacher's stated deadline. Label or replace this convention explicitly in the support view, without changing the imported fact.

School import freshness and timetable date coverage are separate. A successful sync today may still omit next Monday. Surface both. The current timetable normalizer's week mapping and weekend behavior are a required test boundary for packing, including rotating timetables, holidays, special events, canceled lessons, and transitions into the next week. Do not invent future lessons by repeating the last cached week.

### Make offline use safe and understandable

Reuse the Watch's durable outbox, while adding stable item/occurrence IDs and idempotency keys to new writes. Prefer explicit operations such as `set packed=true` over replaying toggles. Bind every queued operation to the signed-in account, family, child, source version, and occurrence. An old device must never submit work under a newly signed-in child.

Reconcile rather than silently overwrite concurrent edits. If a packing item was removed or a task reassigned, reject or retire stale operations with a clear result. A parent editing tomorrow's schedule must not erase today's completion. Maintain revision checks for edits and return useful conflicts. Reward approval and any completion integration must be idempotent against the canonical occurrence.

The iPad needs a small account-scoped cache and queue for these selected workflows; the inventory does not establish general iPad offline support. Limit cached content to what the flow needs, protect it with platform storage protections, and clear it and scheduled reminders on local account reset. Retain the existing recovery/sign-out path when initial family loading fails. Remote revocation blocks server operations once checked; offline cache removal cannot be promised to happen instantly.

The current Watch ordinary-reminder freshness limit is 48 hours. Preserve it initially. Cached lists can remain visible with a stale label, but outdated data must not keep generating confidently current prompts. A local reminder for a remotely completed task may still fire until that device syncs; explain and test this limitation rather than promising instantaneous cancellation.

### Keep the core deterministic

No AI is needed for timetable-to-material rules, recurrence, checklists, reminders, or timer state. Later AI assistance may propose smaller steps or extract a draft from an attachment, with preview and explicit confirmation. It must preserve the original instruction, avoid inventing deadlines, and never mark work done, send a school message, change a reward, or expose private notes on its own.

## 9 Privacy and product boundaries

Preserve `fam_` storage names, encryption at rest, first-party CSP, existing role gates, the native/web split, and the full-hub plan gate. These features initially belong to the full family hub; this proposal does not silently add them to the free Screen Time plan or create a diagnosis-based tier.

| Information | Visibility proposal |
| --- | --- |
| Assigned homework, agreed routines, packing issues | Student and authorized parents, following existing child scope |
| Sibling-specific plan and Watch credential | Never accessible to another child |
| Private Corner, unshared energy selection | Preserve current private/transient behavior |
| Diagnosis, treatment, medication, health measurements | Not collected for these features |
| Help request | Preview recipient and content; explicit send; no automatic family-chat disclosure |
| Teacher summary | Later optional export, selected and previewed by the family; no automatic sharing or teacher account in MVP |
| Product analytics | Existing aggregate approach; no new per-user behavioral event stream |

Keep operational task records distinct from analytics. An active timer may need saved timing to recover after restart, but that does not authorize a permanent focus history. Proposed retention: clear detailed focus state after completion/sync or a short recovery period; use a bounded rolling window for new packing/routine history, proposed at 30 days, with deletion behavior specified before implementation. Preserve existing homework records and reward ledger requirements; do not apply blanket deletion to them.

The pilot should use a voluntary weekly family tally and conversation, not covert monitoring. Do not save the student's clinical history in this product plan or require it in setup. A later expansion to new customers needs a current child-privacy and consent review; existing documentation alone is not proof of legal compliance.

Screen Time controls remain separate. Forgetting a chore does not automatically restrict access to homework, help, family communication, or the organizer. Optional rewards should support an agreed routine, not make access to support conditional on performance.

## 10 Priorities and delivery sequence

The beta is a vertical slice across backend, iPad, and standalone Watch. Finishing only the iPad screen does not complete a feature whose main use is beside the bag or at the time of a chore.

| Stage | Deliverable | Exit condition | Rough engineering effort |
| --- | --- | --- | --- |
| 0 Feasibility and co-design | Observe the three routines; confirm school rules and actual hardware; install, pair, sync, and remind on Family Setup | Watch works with managing iPhone unavailable; source freshness understood; student agrees first routine | About 1 week |
| 1 Packing pilot | Material rules, dated packing list, morning/evening passes, Watch checks, offline sync, source warnings | Correct list and recovery over one representative school cycle | 2–3 weeks |
| 2 Homework support | My Next, first steps, adjustable timer, work-finished versus hand-in state, school-link recovery | One full capture-to-hand-in journey across devices with existing integrations preserved | 2–3 weeks |
| 3 Recurring chores | One recurring routine, explicit outcomes, snooze/handoff, optional reward link, parent exception | Dog-walk example survives offline replay and cannot double-credit | 1–2 weeks |
| 4 Beta acceptance | Accessibility, privacy/recovery, source edge cases, actual Watch day, TestFlight preparation | Required criteria below passed with recorded device evidence | 1–2 weeks |

These are planning ranges for one engineer already familiar with the codebase, with design and device-testing access. The total is roughly **7–11 engineer-weeks**, not a delivery commitment. Watch distribution/provisioning, school-feed coverage, authentication defects, and App Review can add elapsed time. Re-estimate after Stage 0. Family observation can overlap development; use the pilot results before expanding the feature set.

Each stage should be split into independently testable, reversible implementation units. Backend contracts precede dependent native views; use feature flags to enable only the pilot family. Keep old records and old clients compatible. Do not start an unrelated architecture rewrite to deliver these routines.

### Later candidates

After the three routines prove useful, consider longer project milestones, exam revision plans, a simple weekly workload view, an optional parent co-working invitation, richer routine templates, and family-previewed school summaries. Evaluate photo/voice capture only after confirming the active native bridge and Family Setup compatibility. AI-generated breakdowns can follow if manual templates are a genuine burden.

Defer mood prediction, attention scoring, passive location tracking, HealthKit-based ADHD inference, medication management, automatic punishments, leaderboards, public streaks, a child-facing general chatbot, and a teacher portal. None is required to solve the stated problems.

## 11 Pilot and success measures

Begin with a short conversation and observation, rather than asking the student to configure a large system. Ask him to show how he finds homework, packs his bag, and notices the dog needs walking. Agree what should happen when he cannot finish. Use familiar item names and physically place essential equipment where the checklist is used.

**Suggested pilot:** one school week of lightweight baseline observations while existing support continues, followed by four weeks introducing the routines gradually. Turn on packing first, then the homework first-step view, then one chore. Do not withhold effective support to create an experiment. Note timetable changes, unusual workload, or changes in other support when interpreting outcomes.

Proposed usability checks during setup: can he find the next action without guidance, check a packed item in a few taps, snooze without losing the task, and tell whether a Watch change has synced? A parent should be able to set up the initial material rules in one short sitting, proposed as 15–20 minutes; repeated maintenance should be minimal.

| Measure | How to observe without surveillance | Proposed pilot target |
| --- | --- | --- |
| Ready for school | Weekly count of school mornings with all agreed essentials available | At least 4 of 5 mornings in the final two weeks, or a clear improvement from baseline |
| Homework follow-through | Count eligible due assignments and those handed in; distinguish self-report from school confirmation | Fewer forgotten hand-ins and no rise in unresolved work |
| Independent initiation | Student/parent tally of starts needing repeated parent prompts | A meaningful reduction agreed with the student; no minimum focus-time quota |
| Chore follow-through | Agreed occurrences done in-window or deliberately handed off | At least 4 of 5 relevant occurrences resolved, adjusted for the actual schedule |
| Parent effort | Rough minutes and repeated prompts per evening | Lower than baseline without transferring a larger admin burden to the student |
| Student experience | Weekly optional “helpful / neutral / annoying” conversation | Student wants to continue and can name something that helps |
| Device burden | Actual Watch use and charging experience | Enough battery for the agreed day; tolerable notification frequency |

These are family-specific decision thresholds, not validated clinical endpoints or evidence of causation. A checkbox or running timer does not prove work, learning, or attention. Use appropriate denominators, exclude canceled tasks, and keep unknown outcomes unknown.

If annoyance, anxiety, arguments, or setup effort increases, reduce prompts and simplify the routine. If packing still fails, inspect the material rule and physical arrangement before adding more alerts. If a timer distracts him, turn it off. Pause expansion when the Watch cannot reliably support the chosen routine, even if the iPad prototype looks good.

## 12 Required acceptance before beta

| Area | Required evidence |
| --- | --- |
| Real packing journey | Correct next-day items from a representative sanitized school timetable; evening/morning passes; changed timetable; missing item; no false ready state |
| Calendar boundaries | Friday/weekend, holiday, rotating week, source failure, future coverage gap, timezone and date-only deadline behavior |
| Homework journey | Start, interrupt, resume, finish, and hand in; preserved school provenance; legacy completion outbox and reward behavior unchanged unless explicitly migrated |
| Recurrence and money | No duplicate occurrence, lost completion, accidental skip-to-done conversion, or duplicate Fams credit; no currency changes in the routine feature |
| Cross-device reliability | iPad and Watch concurrent edits, retry, offline restart, reordered checklists, removed items, and a stale device reconnecting |
| Family Setup hardware | Actual target Watch installation/enrollment, managing iPhone unavailable, Wi-Fi and cellular paths, full agreed day, charging/low battery, local notification and APNs checks |
| Notifications | Permission denied, Schooltime, quiet hours, timer cancellation, snooze, old reminders after remote edits, device duplication, deep links to completed/deleted tasks |
| Privacy and identity | Sibling and parent-role boundaries; scoped Watch access; lost/revoked credential; account switch; pending writes cannot cross accounts; private notes excluded |
| Recovery | Initial family loading failure still permits native sign-out/account switch; local session cleared before another account appears; pending/revocation states honestly shown |
| Accessibility | Actual taps/navigation on iPad sizes and target Watch; larger text, VoiceOver, reduced motion, offline/loading/empty/error views |
| Backward compatibility | Optional fields decode in existing native models and old caches; current Today formulas, plan gates, and supported web flows remain correct |

Use focused automated tests for changed boundaries and representative device journeys during development. The additions change persistence, data contracts, and reward integration, so this is not UX_FAST work. At a separately authorized release, follow the normal exact-commit CI gate and native device/TestFlight requirements. Hostinger releases must use merged `main`; App Store submission remains a separate action. The original planning task excluded builds and external changes. The subsequent implementation request authorizes the local implementation and focused verification recorded in the implementation record; it does not establish native release readiness.

## 13 Decisions and next action

The user has established the age, main difficulties, primary devices, and parent-managed Watch configuration. The draft recommends starting with packing, reusing the standalone child Watch app, keeping ordinary routines free of reward requirements, and retaining existing privacy and design contracts.

Before installing the pilot for everyday use, settle the remaining practical details from Stage 0: actual Watch model and OS, carrier/connectivity, school Watch policy, current timetable coverage, materials needed for each subject, preferred cue windows, and the student's choices about parent visibility and rewards. No further clinical information is needed to answer those product questions.

**Recommended next action:** run the Family Setup feasibility check and co-design one evening packing routine using an actual upcoming school timetable. Use the implemented pilot to verify these device assumptions before expanding the roadmap or distributing a release.
