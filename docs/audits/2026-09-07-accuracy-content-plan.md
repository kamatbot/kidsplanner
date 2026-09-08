# FamETC accuracy, content and engagement plan

Date: 7 September 2026  
Basis: [project audit](/Users/kamatbot/Documents/Claude/Planner/docs/audits/2026-09-07-project-audit.md) of `99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa`.  
Status: proposed implementation plan; no application changes or release authorization implied.

## 1. Direction and success definition

Make FamETC **trustworthy enough to stop double-checking**, then make its optional learning useful enough that children choose to return.

The existing product brief's family-coordination mission should remain primary. “More engaging” should mean clearer choices, relevant challenge, useful feedback and a satisfying stopping point—not more cards, longer sessions or more pressure.

A successful version should let:

- A child join with a family code, obtain parent approval and see the correct family on every supported device, including after failed requests and account switches.
- A family trust that Homework, Today, Calendar and reminders describe the same commitments.
- A parent know which imported information is observed, inferred, stale, unsupported or incomplete.
- A learner get an appropriately challenging activity with a defensible answer, understandable explanation and honest progress.
- A maintainer change one domain without silently changing behavior on another client.
- A release operator deploy the exact reviewed source through the established Hostinger path, without environmental improvisation.

Non-goals: framework rewrite, universal cross-platform UI, microservices, automated SAT-score predictions, a new CMS, raw child-behavior surveillance, bulk content generation, a wholesale database migration in the first increment, or a Hostinger environment reconfiguration.

## 2. Target structure: fewer independent sources of truth

Keep the Node/Express application, existing domain modules, native clients and focused test approach. Change ownership before changing directories.

```text
External source / human input
            |
            v
Source adapter: validate, identify, preserve evidence and time meaning
            |
            v
Canonical domain: permissions + lifecycle + durable mutation
            |
            v
Read projection: role scope + freshness + completeness + source reference
            |
            +---- Web presentation
            +---- iOS presentation
            +---- Android presentation
            +---- Watch presentation
```

AI is an input adapter that creates a **candidate**, not a privileged writer or authority on missing facts. Today is a projection, not a second homework database. Learning outcomes are derived from attempts, not device checkmarks.

### Domain ownership

| Boundary | Owns | Must not own |
| --- | --- | --- |
| Session/membership | Authenticated principal, family membership, device grants, revocation, client session generation | Learning scores or screen layout |
| Coordination | Homework lifecycle, family actions, event/occurrence identity, assignee rules, source relationships | Arbitrary client-specific “done” meanings |
| Import adapters | Feed parsing, observed/inferred fields, normalization, successful-snapshot reconciliation | Silent deletion of unrelated/manual work |
| Learning/content | Reviewed catalog, eligibility, issued activities, answer evaluation, review scheduling | SAT outcome claims delegated to external PathOdds |
| Meals/trips | Validated planning constraints, explicit commit boundaries, booking/recipe provenance | Unchecked model dates or invented nutrient precision |
| Integrations/Operator | Narrow capabilities, exact approval, idempotency, durable execution/reconciliation | Ambient authority from a conversational token |
| Client presentation | Navigation, accessible controls, optimistic state, offline/stale display, retry | Reimplementing policy, content keys, scoring or source truth |

### Practical module strategy

- Keep existing `lib/homework.js`, `actions.js`, `events.js`, `wordbank.js`, `brainteaser.js` and routes as the initial homes. Introduce a helper only when at least two concrete callers need the same invariant.
- Extract web responsibilities from `public/js/app.js` **when their behavior is being repaired**: session/bootstrap first, then homework coordination and daily content. Reuse existing `auth.js`, `action-queue.js`, `school.js`, `sat.js` and `util.js`. Avoid recreating a second utility layer.
- Keep the iOS observable store as composition initially. Separate the session reset/fetch-generation boundary before attempting wholesale store decomposition. Reuse homework's existing stale-read revision protections.
- In Android, correct API projections and session ownership before subdividing the repository. UI components should consume explicit domain states, not call unrelated endpoints directly.
- Define contracts as small versioned JSON fixtures and documented runtime invariants first. A TypeScript migration, schema code generator or new validation dependency is not a prerequisite.
- If bundled/offline content is needed, generate its subset from one catalog. Do not maintain independently handwritten web and Swift banks.
- Do not delete `PlaceholderScreens.swift`: it contains the live Homework screen. Trace the legacy scanner/WebView island and decide whether to reconnect or retire it in a separate task.

## 3. The four contracts to establish

### A. Session and membership contract

Use independent states rather than overloaded nulls:

```text
Authentication: unknown | signed-out | authenticated | expired
Membership:    loading | pending-approval | member | confirmed-none | error
Domain read:   loading | ready | stale | error
```

A ready domain can contain zero rows; an error cannot masquerade as an authoritative empty list. Cache data also records the identity it belongs to and the time of its last successful retrieval.

Requirements:

1. Every login/logout/account switch increments a client session generation. In-flight responses from earlier generations cannot write state or disk.
2. Native cookie storage, WebView cookies, memory collections, learning flags, room caches and push-registration ownership participate in one reset.
3. Cache keys include account + family; learner activities additionally include learner + content revision/day. Partitioning is not permission enforcement: the server remains authoritative.
4. Offline sign-out clears local access immediately. Server-revocation failure is recorded distinctly from local sign-out and must not silently restore the old identity on reconnect.
5. Family-code approval is not inferred from an empty response. After approval, verify authenticated identity and membership explicitly; offer retry for transport/decoding failures.
6. Parent/child UI capabilities follow validated role data. Do not make `unknown` implicitly parent-capable.
7. Membership departure revokes family-bound Watch and integration authority.

Canonical fixture set: parent; kid with omitted invite-code field; pending approval; expired session; valid zero-family guest; first fetch failure; 401 during a domain refresh; two siblings on one device; parent moves families; logout while refresh is in flight. Never populate these fixtures from unredacted family data.

### B. Coordination contract

Every source-derived item needs a small explicit identity relationship:

- Stable source type + source ID; canonical entity ID; relevant source revision.
- Authority: where completion, deletion, assignee and date changes are decided.
- Visibility: family/role/member scope enforced by the server.
- Temporal meaning: date-only, instant, or local time in a named timezone.
- Provenance: source link/reference and whether each consequential field was observed, inferred or confirmed.
- Freshness: last successful retrieval, last attempt, stale/error reason and inventory completeness.

Do not put every possible field on every entity. Define common semantics, then the smallest domain-specific representations.

Mutation rules:

- A Homework-derived action's completion command uses Homework's permissions and lifecycle. Today cannot create a second completion truth.
- Reopen/delete/source disappearance reconcile derived rows and reminder eligibility.
- Import refresh preserves local progress and manual data; source deletion affects only the source-owned scope.
- All candidate changes are validated before destructive replacement. A failed commit leaves original state unchanged.
- Empty successful snapshots, source failures and unsupported/omitted rows are distinguishable.
- Active work and history have separate query contracts; any pagination/truncation is explicit.
- Retrying a command cannot double-create a task, meal or notification.

Time policy:

- Homework due on a school date stays a date, not midnight UTC.
- Timed events preserve instant and source timezone. Display conversion is intentional and consistent.
- Floating school wall times require school timezone context; absent context is surfaced, not guessed.
- Recurrence has a documented support matrix, stable occurrence IDs, cancellations and exceptions.
- “Today” for learning uses the learner's configured day/timezone; ordinary display can show travel-local time without awarding a second day's credit. Do not silently change established timezone policy.

### C. Content catalog and assessment contract

Begin with a reviewed, checked-in catalog. Preserve existing stable item IDs.

| Field group | Minimum purpose |
| --- | --- |
| Identity | Item ID, revision, kind, publish status |
| Learning fit | Objective/skill, prerequisites, language/reading band, editorial challenge band |
| Presentation | Prompt, options or answer form, optional worked example |
| Evaluation | Correct answer/rubric and rationale for each alternative |
| Feedback | Explanation, misconception hints, next suitable practice |
| Provenance | Author/editor, source locator, attribution status, review date; rights/license where relevant |
| Suitability | Topic sensitivities, optional curriculum tag with evidence |
| Scheduling | Approximate duration, repetition family/template ID |

Editorial bands are starting hypotheses, not measurements of intelligence or standardized achievement. A parent's grade entry is context, not a universal ability score. Curriculum alignment should name the skill and actual source; do not label generic puzzles as aligned to a school's curriculum without checking.

The client submits an issued activity ID, item revision, selected answer, attempt ID and hint/reveal events. The server determines correctness and whether the attempt earns new progress. Repeating the same request yields the same result, not extra credit. Offline practice can remain available, but must not be represented as verified server progress before reconciliation.

Do not retroactively convert historical three-tap mastery into validated retention. Preserve old counts as legacy practice history, label their provenance, and begin stronger evidence prospectively.

### D. Content/AI evidence contract

Use one visible vocabulary for certainty:

| Value | User-facing meaning |
| --- | --- |
| Observed | Present in the source; view the supporting excerpt |
| Inferred | Proposed interpretation; confirm before it becomes a commitment |
| Confirmed | A person accepted/edited it; record who and when |
| Unknown | No trustworthy value yet |
| Stale | Last known information from a named date/time |
| Unsupported/partial | Some source content could not be represented |

For AI homework, unknown due dates remain null. For meal plans, allowed dates/slots and household constraints are enforced in code. For nutrition, either calculate from normalized quantities and yield with a traceable source, or display a clearly rough qualitative estimate. Never disguise a fallback or relaxed preference as a perfect match.

## 4. Calibrated, engaging content: the editorial plan

### Separate three different jobs

1. **Coordination:** “What do I need to do next?” Accuracy and completion matter.
2. **Optional enrichment:** “Give me something interesting to think about.” Curiosity and explanation matter.
3. **Deliberate practice:** “Help me improve this skill.” Appropriate challenge and later recall matter.

Do not merge their metrics. Completing homework is not a vocabulary score. Opening a story is not mastery. PathOdds remains the explicit owner of its SAT preparation; FamETC presents linked, dated status without inventing a parallel SAT-readiness score.

### Start with a small complete learning experience

Recommended first content increment: a vocabulary/reading-context pack with a modest number of reviewed items across a few named skills, not another large mixed trivia bank. A suggested pilot seed is 30–50 items; this is a workload estimate, not a scientifically derived threshold.

Each assessed item must pass:

- Exactly one defensible answer for the stated question, or an explicit multi-answer rubric.
- No giveaway from target-word presence, option length, grammar agreement or inconsistent formatting.
- Every distractor maps to a plausible misconception; none is merely nonsense.
- The explanation states why, not just which option was correct.
- Prerequisites and reading burden match the editorial starting band.
- Source/attribution can be checked; time-sensitive claims have a review date.
- Revisions are traceable; withdrawing a bad item does not corrupt old attempts.

Use AI to draft variants or flag questionable items, never as the sole publisher or proof of factual correctness. One independent editorial check is required for consequential answer keys and factual claims.

### Use transparent evidence and a modest scheduler

Initial labels:

- **“You said this is familiar”** — placement/self-report.
- **“Practiced”** — participated, regardless of first-attempt correctness.
- **“Answered without a hint”** — an unassisted attempt.
- **“Recalled later”** — successful delayed recall.
- **“Worth another look”** — current evidence suggests review.

A simple starting scheduler can mix one due review, one approachable item and one new challenge, with “easier,” “harder” and “skip” choices. Revisit incorrect items after explanation/prerequisite help rather than monopolizing every slot immediately. A proposed 1/3/7-day review cadence is a **pilot heuristic**, not a validated mastery threshold; tune or replace it with observed learning evidence.

Spacing, retrieval practice, worked examples and explanatory questions have a research basis in the [IES practice guide](https://ies.ed.gov/ncee/wwc/PracticeGuide/1). The particular scheduler and UI proposed here are product hypotheses, not results established by that guide.

Keep completion credit separate from accuracy. A correct-only streak penalizes learners for taking an appropriate challenge. Prefer a weekly participation summary and voluntary return; no shame copy, streak-loss countdowns, mandatory catch-up or sibling leaderboards.

### Make the daily experience bounded and optional

“Daily 5” currently mixes formats and does not behave consistently across platforms. Keep the recognizable name only if its promise is explicit—five optional minutes or a small selection, not five new obligations.

Suggested child flow:

1. Show the next real school/family action and whether its source is current.
2. Offer “Try a quick challenge” as optional, with an estimated duration.
3. Let the learner choose between two suitable topics or review.
4. Give specific feedback and a hint/explanation.
5. End with “You're done for now,” plus optional save/question/report controls.

Suggested parent flow:

1. Show the next few commitments and unresolved approvals/conflicts.
2. Put broken/stale source connections where they affect those commitments.
3. Let the parent open a compact learning summary only when desired.
4. Summarize effort and next help, not a league table or unsupported ability rating.

Retain Chat as a quick coordination input. Avoid repeating the same homework as an urgent card, action card, daily checklist and reminder without a clear relationship.

### News, quotations and nutrition

- News cards keep publisher, article date, link and a short “why this may interest you.” Separate current reporting, opinion and evergreen explanation.
- Use reading-band/topic controls and family preference. A reputable publisher is not sufficient proof that every story is suitable for every learner.
- Crossword clues retain their actual article attribution; do not relabel the expanded feed registry as a single publisher.
- Prefer original reflection prompts or verified quotations. Retire unsupported author claims.
- Do not publish exact fibre/protein claims inferred from ingredient names alone. Approximate output must look approximate; unmet preferences must be visible.
- Add “Something seems wrong?” to content, with an item/revision reference and optional comment. Avoid requiring children to disclose personal details to report an ambiguous question.

### Copy examples

| Current failure mode | Proposed copy |
| --- | --- |
| Family fetch fails after approval | “Your approval is complete. We couldn't load your family yet. Try again.” Only use the approval claim if confirmed. |
| Membership still resolving | “Checking your family…” |
| Confirmed zero-family parent | “Create or join a family to get started.” |
| Cached completed quest from yesterday | “Last update: yesterday. Today's progress is unavailable.” |
| Photo has no deadline | “No deadline found. Add one, or keep this undated.” |
| Three practice successes | “Answered correctly 3 times.” Not “Mastered.” |
| Wrong answer after effort | “Not quite. Here's the clue that helps…” |
| No new work, source unavailable | “Showing your last update. School sync needs attention.” |
| All intended activity finished | “That's enough for today. Come back when you want another challenge.” |

## 5. Implementation sequence

This is a sequence of bounded work packages, not authorization to execute them all. At each start record the **current** commit, dirty files, owner, focused check and rollback point. Reproduce the selected finding on that baseline first; the checkout changed during this audit.

Default maximum: two implementation files per module, with tests/docs additional. Where a workstream crosses clients, use successive modules rather than one cross-repository patch. Critical auth/privacy/data-loss/contracts remain under direct senior review; routine isolated presentation work can follow the project's Luna implementation protocol.

### Phase 0 — Lock evidence and immediate trust fixes

| Package | Initial ownership / boundary | Acceptance |
| --- | --- | --- |
| 0A Baseline/fixtures | New synthetic contract fixtures and audit regressions; no live data | Reproduce targeted findings on selected current source; preserve unrelated work |
| 0B Watch family binding | `server.js`, `lib/watch-auth.js` | Parent move/revocation proof fails closed; valid parent/kid watches unaffected |
| 0C Android cookie reset | `ApiClient.kt`, `AppRepository.kt` | Same-process and offline sign-out remove native/WebView access; old responses cannot repopulate |
| 0D iOS session reset | `AppStore.swift`, `APIClient.swift` | Every account-scoped collection resets; late responses rejected; local sign-out survives network failure |
| 0E iOS cookie bridge | `AuthService.swift`, `RootView.swift` | Native/WebView login and logout agree; server revocation behavior preserved |
| 0F Learning cache partition | Two files at a time: DailyContent/SAT, then puzzle identity/persistence caller | Sibling switches inherit no answers, placement or done flags; same-user resume works |
| 0G Encryption invariant | `server.js`; focused boot tests | Authenticated public-mode boot cannot fall back to plaintext |
| 0H Android release hygiene | `ApiClient.kt`, `app/build.gradle.kts` | Release contains no BODY logging; signing identity is explicit and approved |

Dependencies: 0A before changed behavior; 0C/0D before cache-preserving UX. Do not generate/rotate a production signing identity without the owner's existing release-key policy.

Account deletion is not a two-file cleanup. First produce the store/retention inventory, then sequence revocation, family disposition, shared-data handling and external retry independently under Phase 3 below.

### Phase 1 — Stop data loss and restore coordination truth

| Package | Initial ownership / boundary | Acceptance |
| --- | --- | --- |
| 1A Meal candidate validation | `lib/routes/meals.js`, existing meal validation model | Out-of-window/malformed/duplicate candidates leave the menu untouched |
| 1B Atomic meal replacement | `lib/meals.js`, planner route | All-or-nothing update of only requested slots; retry does not duplicate |
| 1C School adoption policy | `lib/school-api.js`, `lib/homework.js` | Preserve manual work and matching student progress; sibling data unchanged |
| 1D Import disclosure/recovery | `public/js/school.js`, source-review markup | Explain changes and omissions; destructive replacement requires explicit informed choice |
| 1E Homework canonical commands | Define shared model behavior first; wire one route per follow-on module | Complete/reopen/delete reconcile action, source and reminders without permission bypass |
| 1F Active queue/history | `lib/actions.js`, `lib/routes/actions.js` | 200+ old completions cannot hide active work; history has cursor/completeness |
| 1G Client queue adaptation | One web, iOS or Android module at a time | Every client uses the same active/history meaning |
| 1H Preserve unknown deadlines | `lib/routes/ai.js`, `public/js/school.js` | Missing deadline stays unknown; inference is explicit and confirmed |
| 1I Undated official homework | `lib/school-api.js`, `lib/homework.js`; then client contract modules | Complete inventory with a no-deadline bucket; no sentinel date presented |

Dependencies: validation before atomic replacement; lifecycle contract before wiring projections; preserve nullable values before offering undated import end to end. The first rollback for source migration is a verified snapshot/archive, not re-running a destructive import.

### Phase 2 — Shared read contracts, time and client parity

| Package | Initial ownership / boundary | Acceptance |
| --- | --- | --- |
| 2A Session/error DTO fixtures | Contract fixture files + decoder tests | Omitted optional fields, error bodies and role projections decode consistently |
| 2B Web family read state | `public/js/app.js`, `public/js/auth.js` | Fetch failure cannot invoke create/join or “no family” recovery |
| 2C Native family read state | iOS store/Chat first; Android repository/root separately | Loading/error/pending/confirmed-none are distinct and actionable |
| 2D Android shopping projection | `FamEtcApi.kt`, `AppRepository.kt` | Kid gets real shopping rows, never parent-only planner state |
| 2E Time normalization | `lib/ical.js`, feed adapter | Preserve date/instant/local-zone meaning in golden fixtures |
| 2F Projection time consumers | Actions adapter/web selector, then iOS, then Android/Watch | Same event/date/reminder semantics across zones and midnight |
| 2G Manual recurrence window | `lib/events.js` | Old series generate current occurrences without unbounded historical iteration |
| 2H ICS recurrence support | Parser/feed adapter, then copy in separate module | Supported recurrence/exceptions are correct; unsupported data clearly identified |
| 2I Source freshness | Feed state and calendar DTO, then client surfaces | Last success differs from failed last attempt; partial results visible |
| 2J Native navigation recovery | iOS Today/root; Android root/activity separately | Account/settings/sign-out and back navigation work on phone/tablet |

Keep changes backward-compatible with installed clients. Add metadata first, accept old request shapes during a documented transition where safe, and test the oldest supported native build. A web deployment does not update native binaries.

### Phase 3 — Durable lifecycle and integration containment

Treat these as separately approved critical workstreams, not background “refactoring.”

1. **Account deletion:** inventory references; decide last-parent and co-parent outcomes; revoke local authorities durably; add external revocation/subscription cleanup queue; handle shared content per approved policy; record completion versus pending external work. Verify failure/retry and retention behavior.
2. **Membership identities:** choose person-global versus family-scoped subjects, migrate grants safely and revoke departure authority. Never silently rebind a prior family's integration.
3. **Mobile entitlement:** lock policy, separate advisory client detection from durable entitlement, then migrate provenance without accidentally charging or disabling existing legitimate users.
4. **Storage durability:** measure actual writer model; preserve backups; add crash-after-success probes. Use the existing SQLite capability if it fits, but preserve encryption/retention guarantees. Migrate one aggregate with count/content-hash parity and a cutover/rollback rule; no blind dual-write period.
5. **Operator recovery:** attempt record, driver idempotency and startup reconciliation; never automatically replay an uncertain non-idempotent update.
6. **Notification leases:** atomic claim/expiry and stable client event IDs; expose backlog/dead-letter age. Treat provider delivery as at-least-once.
7. **Capability intent:** separate read/context from approval-request/execute classes, bind case/action identity where appropriate and preserve explicit parent approval.

Each workstream needs its own bounded modules, threat/failure fixtures and rollback plan before edits. These are the places where a superficial cleanup would create more risk than it removes.

### Phase 4 — Content correctness and one complete learning vertical

| Package | Initial ownership / boundary | Acceptance |
| --- | --- | --- |
| 4A Quarantine ambiguous word items | `public/js/sat.js`, iOS SAT activity | No valid alternative marked wrong; no target-presence giveaway |
| 4B Stale quest handling | Web SAT + iOS wrapper model first; card follow-on separately | Yesterday's completion cannot credit today; cached date visible |
| 4C Source attribution | `lib/daily-puzzles.js`, content source data | BBC/WHO/NOAA fixture retains correct attribution and link |
| 4D Catalog pilot | Proposed reviewed catalog + existing learning adapter | IDs/revisions/rationales/provenance validated before publish |
| 4E Issued attempts | `lib/wordbank.js`, `lib/routes/learning.js` | Server evaluates answers; replay/hints/self-report distinguished |
| 4F Web learner client | SAT activity/API wrapper | New learner can start, finish, retry and review without false progress |
| 4G iOS learner client | SAT screen/API wrapper | Same fixtures and outcomes as web; account-safe resume |
| 4H Android learner client | API/card first, repository wiring separately if required | Empty-bank onboarding, full question sequence and submission work |
| 4I Eligibility/review schedule | Teaser selector + catalog adapter | Starting bands/prerequisites apply; review does not monopolize new content |
| 4J Meal constraint parity | Planner route + recipe validator | AI/fallback enforce identical hard constraints; estimates/relaxations explicit |

Follow each with narrowly scoped editorial/client tests. Do not expand the content bank until one vertical works on all supported clients. Do not advertise unfinished Android activities.

### Phase 5 — Simplify the experience and prove usefulness

- Parent Today: concise next commitments, approvals and source issues; defer optional enrichment below the operational work.
- Child Today: one clear starting action, visible completion, an optional appropriately sized challenge, a clear stopping point.
- Account/family tools: discoverable Settings/Help/Sign out on phone/tablet with role-correct paths.
- Content feedback: explanations, easy/hard choice, save/revisit and report-an-item.
- Public pages: current help, verified contact details and owner-approved policy text.
- Documentation: a current feature/platform capability matrix, contract owners and dated decisions. Archive historical advice; do not let contradictory checklists remain authoritative.

Verify each actual navigation/tap path at narrow widths and large text. Preserve the established visual identity; state clarity and hierarchy should drive design changes.

## 6. Test and evaluation matrix

Golden fixtures should run through actual serializers/decoders and behavior, not merely search source for expected strings.

| Journey | Required cases | Pass condition |
| --- | --- | --- |
| Kid joins family | Approval, denial, expired request, failed membership fetch, optional fields | Correct membership or truthful recovery; no forced duplicate signup |
| Shared device | A→B login, offline sign-out, stale in-flight response, WebView reopen | No A data, cookie or completion is shown/used as B |
| Homework lifecycle | Complete/reopen/delete/import/retry, parent vs kid | One canonical state; correct permissions and reminders |
| Daily workload | Large completed history, undated work, partial sync | No active work hidden; completeness explained |
| Calendar | Bangkok/UTC/DST, midnight, old recurring series, exceptions | Correct instant/date and stable occurrence identity |
| Meal planning | Wrong date, invalid title, malformed ingredients, diet conflict, partial failure | No unintended deletion; constraints enforced uniformly |
| Learning | New learner, wrong/correct/replay/reveal/delayed recall | Accurate feedback and evidence; no answer giveaway or inflated progress |
| Quest outage | Yesterday complete, current unavailable, timezone rollover | Cached result never credits the wrong learner/day |
| Content quality | Ambiguous option, bad attribution, item withdrawal | Publish blocked or item visibly corrected; history remains coherent |
| Native navigation | iPhone/iPad compact window/Android phone+tablet, system back, re-auth | Settings/help/logout/retry reachable without hidden gestures |
| Durability | Kill after acknowledged write; multiple writers; execution crash | Accepted state retained or explicit unresolved outcome, never silent success |

Manual acceptance must include VoiceOver/TalkBack, keyboard navigation, larger text, Reduce Motion, empty/loading/error/stale states, low connectivity and interrupted writes. No such manual verification is claimed by the audit.

Use focused affected tests during implementation. For an authorized release, use the single authoritative full-CI gate on the frozen commit, without duplicating it locally. Add path-scoped native build/decoder checks to the appropriate release gate; source-text Node tests cannot replace an actual native compile or a real join flow.

## 7. Metrics without overclaiming or surveillance

The product brief names family time saved as the North Star; current aggregate counters do not measure it. Do not label opens, streaks or completed actions as minutes saved.

| Outcome | Measurement approach | Guardrail |
| --- | --- | --- |
| Reliable family entry | Aggregate approved-join success/failure category and retry rate | No names, codes, cookie values or raw auth responses |
| Trustworthy coordination | Projection mismatch regressions; anonymized error categories; explicit user correction/undo feedback | Do not infer omitted work from mere inactivity |
| Less coordination effort | Opt-in brief parent diary/interview of a repeated weekly task, before/after | Separate reported estimates from measured time |
| Appropriate challenge | Per-item/revision first-attempt results, skips, hints and reported ambiguity in a small consented pilot | Small cohorts are not psychometric calibration; avoid individual ranking |
| Retained learning | Delayed unassisted recall of matched skills/items | Do not confuse replay or revealed answers with retention |
| Healthy engagement | Voluntary return, explanation usefulness and ability to stop/resume | Do not optimize session length, notification pressure or streak anxiety |
| Operational reliability | Stale age, failed sync counts, outbox age, unresolved execution attempts | No raw child content in operational logs |

Keep necessary per-learner progress in the protected product store; send only deliberately allowlisted aggregates to product analytics. Define retention and access before expanding event collection. Suppress small-cohort reporting where it could reveal an individual child's activity.

Before setting numeric improvement targets, collect a baseline. Release invariants such as “no known cross-account disclosure” and “invalid meal input leaves existing plans unchanged” are correctness gates, not A/B-test goals.

## 8. Release and rollback policy

No release was performed as part of this work.

When a repair is authorized for release:

1. Identify the exact current reviewed commit and supported client versions.
2. Record focused checks and the single final authoritative CI result.
3. Preserve a recoverable artifact/data snapshot appropriate to that module.
4. Use the established Hostinger direct deployment flow and canonical packer. Preserve required `.env.hostinger` and the specifically selected APNs key; do not improvise a panel/environment migration.
5. Enforce Node 24 and locked dependency resolution; validate target-native modules and the actual archive boot.
6. Restrict secret-bearing artifacts and log output; include source/build identity and artifact hash without exposing configuration values.
7. Verify deployment ID, live build marker, canonical and alias hosts, health and unauthenticated/protected auth boundaries; ensure no pending automatic deployment can overwrite the release.
8. For native fixes, separately build/sign/distribute the native application and verify the real affected flow. A successful web deploy does not prove the installed iPad/Android application contains the fix.
9. Roll back the module if its acceptance fails. For schema/data changes, code rollback alone is not sufficient: test the data compatibility/restore path beforehand.

Do not rerun full CI repeatedly on an unchanged commit or run a broad suite after every small edit.

## 9. Complexity guardrails and deliberate deferrals

Keep the first repair at the lowest-complexity rung that satisfies correctness:

- Reuse the existing shopping endpoint rather than opening parent meals access.
- Replace inferred deadlines with explicit unknowns rather than a more elaborate guessing prompt.
- Fix source/projection authority rather than adding another sync loop.
- Replace independently authored content copies with one reviewed source, not a CMS.
- Remove misleading labels and unreachable controls rather than building features merely to justify them.
- Do not force a global state-management/framework migration to express a few explicit read states.
- Preserve tests, permissions, recovery and accessibility; they are not bloat.

No mass deletion is approved by this plan. A measured complexity-only pass belongs after each nontrivial change is focused-test green; report only actionable cuts with file/line and estimated net reduction. Do not manufacture a line-saving target for the audit itself.

Defer until evidence justifies them: broad TypeScript conversion, automatic DTO generation, microservices, advanced adaptive-learning models, real-time event infrastructure, a content CMS and a full visual redesign.

## 10. Recommended first increment

Start with **family/session integrity**: reproduce the approved-child flow on the selected current branch, correct the false-empty/error states and complete account-scoped logout/reset. In parallel, an independently owned critical module can fix the Watch family-binding defect.

Then repair destructive meal replacement and homework projection truth before expanding learning engagement. This yields a safer daily product while the catalog and calibration work proceeds as a separate, testable vertical.

