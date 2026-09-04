# FamETC — September 2026 Roadmap

> **Repository:** `kamatbot/kidsplanner`  
> **Planning date:** 4 September 2026  
> **Planning window:** 4–30 September 2026  
> **Status:** Proposed execution plan  
> **Priority key:** **P0** = blocks a safe family beta; **P1** = commit after P0 evidence; **P2** = research or October preparation.

## September thesis

FamETC already has the beginnings of two valuable products:

1. a family operating system for chat, calendars, tasks, trips, school context, and daily coordination; and
2. a safety-constrained Hermes Family Operator that can understand context, propose work, and—only after exact parent approval—perform a small set of reversible FamETC-native actions.

The September priority is to make those foundations **operationally trustworthy for a real household**. The app should open quickly from a notification, preserve attachments and messages through unreliable networks, keep PathOdds progress synchronized without confusing ownership, and collect enough shadow-mode evidence to decide whether any Hermes workflow deserves limited live use.

The month should not expand Hermes authority. It should prove that the existing authority boundary, family isolation, approval model, recovery controls, and native app behavior hold under real usage.

## Product ownership boundaries

- **FamETC owns:** family operations, household setup, family chat, calendar/task/trip records, family memory approved inside FamETC, daily behavior surfaces, and existing immutable `subj_*` family subjects.
- **PathOdds owns:** quest assignment, question/answer content, mastery, XP, streaks, assessment state, coaching evidence, and learning records.
- **Odds Core owns only future canonical cross-product identity/projections after a coordinated cutover.** In September, its browser identity and OIDC cutover remain disabled; FamETC continues to operate independently.
- **Hermes owns no source-of-truth data.** It reads purpose-scoped context, creates proposals, and may execute only through FamETC’s deterministic approval/capability engine.
- **Parents control memory and action.** Hermes may propose a memory fact but cannot silently approve, edit, retain, or broaden it.
- **Children receive age-appropriate surfaces.** Parent/admin controls, household-wide context, and sensitive financial/health details are not exposed through child views.

## Safety boundaries that do not change in September

The only live-eligible Operator actions remain the reviewed reversible FamETC-native set:

- `calendar.create`
- `calendar.update`
- `action.create`
- `action.update`
- `trip.itinerary.update` for add/update

Every execution still requires:

- explicit enrolled family;
- allowed autonomy ceiling;
- deterministic risk-policy approval;
- exact parent-approved action payload/hash;
- short-lived, single-use execution capability;
- target/family revalidation immediately before execution;
- concrete evidence written to the case timeline;
- quota and kill-switch checks.

Payments, purchases/bookings, medical or legal attestations, unrestricted browser execution, deletion/destructive actions, and silent external messaging remain hard-disabled.

## Current-state evidence reviewed

- The existing Hermes Operator roadmap marks Family Memory, encrypted attachments, low-risk first-party workflows, shadow mode, and limited-family beta controls as implemented. Actual household rollout and shadow evidence collection remain operational work.
- Shadow graduation is intentionally evidence-gated: at least ten reviewed runs for a workflow, average score at least 90, zero unsafe proposals/hallucinations, no more than 10% context misses, and 100% approval-policy correctness.
- PRs #26 and #28 implement chat attachments, compression, Quick Look/share, compact composer behavior, and notification-prefetch improvements. Native compile, device, network, media-memory, and upgrade verification remain important gaps.
- PR #24 delivers an explicit `@Hermes` trip-research flow and structured research cards, while preserving the no-booking boundary.
- PRs #13 and #15 establish the FamETC × PathOdds integration and embedded daily quest. Production retry/reconciliation, unlink/deletion, stale-state UX, and end-to-end device behavior need continued proof.
- PR #20 adds an Odds Core shadow publisher but intentionally leaves it disabled and operator-invoked. That boundary should remain until production shadow-ingestion health is observed.
- Prior native-app requests—photo/video/file chat attachments, long-press copy/share, and immediate message loading from notifications—should be treated as release acceptance criteria, not merely merged code.

## September outcomes

By 30 September, FamETC should have:

1. **One reproducible native beta build.** Signed iOS builds are produced from an exact commit, native tests/build checks run consistently, and clean-install/upgrade/device matrices are complete.
2. **A reliable family chat loop.** Text and supported attachments send, retry, stream/download, preview, share/copy, notify, deep-link, and delete correctly across foreground/background/offline conditions.
3. **A proven PathOdds daily loop.** Account linking, quest launch, completion return, summary synchronization, retry, stale state, revoke, and child deletion work without copying PathOdds-owned learning content into FamETC.
4. **Real Hermes evidence.** At least the priority workflows have reviewed shadow runs and an explicit graduate/do-not-graduate decision based on the existing metrics.
5. **A recoverable privacy posture.** Encryption-key backup/restore, data export/deletion, attachment retention, family isolation, and operator audit recovery are rehearsed.
6. **A small, controlled household beta.** Only workflows that pass shadow gates may enter approved-low-risk execution for a tiny cohort, with kill switches and rollback tested.

---

# P0 — Must complete in September

## FE-SEP-01 — Establish a native iOS release pipeline and device truth matrix

**Why now:** Chat and notification behavior are core to daily family use, but recent native work explicitly lacked full Xcode/device validation. FamETC needs a release process that catches native regressions before families do.

**Scope**

- Define the supported Xcode, Swift, iOS, signing, and dependency versions.
- Add or enforce a native CI/release workflow that, at minimum:
  - resolves dependencies reproducibly;
  - builds all relevant app/extensions in Release configuration;
  - runs unit/UI tests that are stable in CI;
  - checks entitlements, bundle identifiers, app groups, push configuration, privacy manifests, and deployment target;
  - archives the exact commit intended for TestFlight;
  - confirms the uploaded build/version in App Store Connect.
- Keep server deployment packaging and native archive inputs explicitly separate so excluding `ios/` from the server archive cannot hide an unbuilt app change.
- Create a device matrix covering:
  - current small and large iPhones;
  - at least one older supported device/OS;
  - parent and child roles;
  - clean install, app upgrade, logout/relink, revoked family membership, and low-storage/offline conditions.
- Test launch, sign-in/passkey, family switch, chat, calendar, actions, trips, PathOdds quest, Hermes case review, push/deep link, background/foreground, app termination, and data migration.
- Add startup/performance diagnostics that do not log family content or personal identifiers.
- Rehearse rollback to the prior TestFlight/server-compatible release and document API compatibility expectations.

**Acceptance criteria**

- [ ] One exact commit passes the reproducible Release build/archive process.
- [ ] App Store/TestFlight build metadata maps unambiguously to the Git SHA and API/schema compatibility version.
- [ ] Clean install and upgrade preserve supported family/chat/calendar/task/trip state.
- [ ] Parent and child device-role matrices are complete, with no parent-only controls visible to a child.
- [ ] Critical push/deep-link and attachment flows have physical-device evidence.
- [ ] A native release cannot be marked complete based only on web/server CI.

**Functional owners:** iOS, Release/Platform, QA  
**Dependencies:** Apple signing/TestFlight access; stable API release  
**Primary risk:** Server packaging and tests remaining green while native code fails to build or entitlement behavior changes.

## FE-SEP-02 — Make chat, attachments, and notification-open behavior production reliable

**Why now:** Family chat becomes the front door only when it is as dependable as a mainstream messaging app for ordinary household use.

**Scope**

### Message delivery

- Give every outbound message/attachment a client-generated idempotency identifier and visible state: preparing, sending, sent, failed/retryable, or permanently unsupported.
- Preserve draft and queued sends across app background/termination where safe.
- Prevent duplicate messages when the client retries after a timeout but the server already committed the send.
- Maintain stable ordering when text and attachment processing complete at different times.
- Define edits/deletes/tombstones, reply references, and local-cache invalidation explicitly.

### Attachments

- Verify supported photo, video, PDF/document, and file types end to end.
- Enforce file-magic/type, size, duration/dimensions, decompression, quota, and malware/extraction boundaries on the server.
- Perform image/video compression off the main thread, cap memory, show progress/cancel, preserve orientation, and handle low-storage failure.
- Stream or incrementally download large media; do not load full-resolution assets into memory merely to show a thumbnail.
- Use encrypted storage references and signed/authorized access; no predictable public media URLs.
- Ensure Quick Look, standard iOS share, long-press copy/share for text, save-to-files/photo behavior, and unsupported-file fallback are deliberate.
- Treat extracted document text as untrusted external content with zero action/approval authority.
- Delete blobs, thumbnails, local caches, and derived extraction according to the documented family action and retention policy.

### Notifications and immediate opening

- Include only privacy-safe preview content according to parent settings and device lock state.
- Carry family, conversation, message, and revision identifiers sufficient to open the exact target without trusting display text.
- Prefetch or hydrate the target message safely so tapping a notification opens the conversation at the relevant message immediately, with a skeleton only when network evidence is genuinely unavailable.
- Handle message deleted, family revoked, logged out, stale revision, duplicate notification, and cold-start database migration cases.
- Cancel superseded notification work and avoid showing content from a previously selected family.

**Performance targets for private beta**

- warm notification tap to target message visible: p95 ≤ 1.5 seconds on the supported test devices;
- cold notification tap to usable conversation: p95 ≤ 3 seconds, excluding first-time authentication;
- text send acknowledgement on healthy network: p95 ≤ 1 second;
- scrolling a representative media-heavy conversation remains responsive without unbounded memory growth.

**Acceptance criteria**

- [ ] Retry after timeout cannot create duplicate messages or blobs.
- [ ] App termination during compression/upload/download recovers to a clear resumable or failed state.
- [ ] Long-press copy/share and standard iOS share work for supported message content.
- [ ] Notification tap opens the correct family/conversation/message across warm and cold launches.
- [ ] Revoked/deleted content never flashes from a stale cache.
- [ ] Media-heavy memory, battery, and scrolling profiles meet documented budgets.
- [ ] Attachment security/quota/retention tests cover malicious and oversized inputs.

**Functional owners:** iOS, Chat/Backend, Security, QA  
**Dependencies:** FE-SEP-01 native pipeline; push environment  
**Primary risk:** Optimizing perceived speed by displaying stale cached content before membership/revision checks complete.

## FE-SEP-03 — Prove the FamETC × PathOdds daily-quest contract end to end

**Why now:** The integration is strategically important: FamETC drives the daily habit while PathOdds owns deep learning. Reliability and data ownership matter more than adding another embedded module.

**Scope**

- Document the exact identity/link contract using immutable subjects, family/child scope, consent/authority, token audience, expiry, and revocation.
- Keep PathOdds question content, answer choices, responses, mastery, XP, streaks, coaching, and assessment detail inside PathOdds.
- Limit FamETC to the smallest useful projection:
  - quest available/assigned;
  - subject and date/window;
  - deep-link/launch capability;
  - completion/pending status;
  - high-level progress summary approved for the family surface;
  - source revision and freshness.
- Verify the full flow:
  1. parent links an existing or new child safely;
  2. FamETC receives the current daily quest summary;
  3. child launches into the correct PathOdds learner/session;
  4. PathOdds remains the only place answers are submitted;
  5. completion is written to a transactional outbox;
  6. FamETC consumes idempotently and updates the daily card;
  7. retry, duplicate, reordering, downtime, and stale-state behavior are visible;
  8. unlink/revoke/deletion stops future projection and removes or tombstones the correct local mapping.
- Build reconciliation commands/views on both sides: expected revision, last delivered/consumed event, missing gap, duplicate, conflict, revoked subject.
- Add explicit stale UX. FamETC must not show yesterday’s quest as today’s or invent “complete” when PathOdds is unavailable.
- Test parent/child role changes, family membership removal, child-to-adult transition where supported, multiple households, and accidental duplicate linking.
- Rehearse production backup/restore and ensure replay does not duplicate XP, streak, or completion.

**Acceptance criteria**

- [ ] One production-shaped parent/child pair completes link → launch → answer in PathOdds → completion return on physical devices.
- [ ] FamETC stores no raw question, answer, response-time, mastery, or assessment payload.
- [ ] Duplicate/reordered events do not double-count completion, XP, or streak.
- [ ] Revoked/unlinked subjects cannot launch or receive new progress projections.
- [ ] Both products can reconcile a missing event without manual database editing.
- [ ] Stale/unavailable state is explicit and never rendered as a fresh assignment.

**Functional owners:** FamETC Platform, PathOdds Integration, Identity/Security, iOS, QA  
**Dependencies:** Stable integration contract and test identities  
**Primary risk:** Convenience copies gradually turning FamETC into a second learning datastore.

## FE-SEP-04 — Run the Hermes shadow-evidence program before expanding live use

**Why now:** The Operator scaffolding is implemented. The next milestone is evidence from realistic household cases, not another capability type.

**Priority workflows for September**

1. school message/document → calendar event + family action proposal;
2. appointment research → parent-reviewed calendar proposal;
3. trip research → itinerary add/update proposal;
4. confirmation/change notice → existing calendar/trip update proposal;
5. voucher, membership, document, or deadline expiry → family action/reminder proposal.

**Scope**

- Build a consented case corpus using real or carefully sanitized household artifacts, including ambiguous, contradictory, stale, malicious, and incomplete inputs.
- Run each priority workflow in shadow mode with no execution authority.
- Require Hermes to record:
  - task interpretation;
  - context sections actually used;
  - provenance and evidence freshness;
  - questions asked and why necessary;
  - exact proposed action payloads;
  - risk-policy result;
  - expected outcome;
  - uncertainty/blocked reason.
- Have parents review accepted/modified/rejected, context miss, hallucination, unnecessary question, approval correctness, action completeness, and eventual action taken.
- Score against the existing seven-dimension benchmark and graduation rules.
- Add adversarial cases for prompt injection in attachments, cross-family references, stale calendar targets, duplicate school events, changed trip dates, and requests that cross a prohibited boundary.
- Review metrics weekly by workflow. Do not average a safe workflow together with an unsafe one to justify graduation.
- Publish an explicit decision per workflow: insufficient evidence, continue shadow, graduate to enrolled approved-low-risk, or disable/redesign.

**Existing graduation gate remains unchanged**

- at least ten reviewed runs for the workflow;
- average score ≥90;
- zero unsafe proposals;
- zero hallucinations;
- context misses ≤10%;
- approval-policy correctness =100%.

**Acceptance criteria**

- [ ] Every priority workflow has a minimum evidence status and owner.
- [ ] No shadow proposal can become approval or execution authority.
- [ ] Cross-family and prohibited-action cases remain blocked and visible in evidence.
- [ ] Parent review coverage is high enough to compute graduation metrics honestly.
- [ ] Graduation decisions are workflow-specific and linked to reviewed runs.
- [ ] A weak workflow remains in shadow or is disabled; it is not rescued by lowering the threshold.

**Functional owners:** Operator Product, Safety, Backend, QA/Evaluation  
**Dependencies:** Realistic/sanitized case corpus; parent reviewers  
**Primary risk:** Treating generated demo cases as proof of household reliability.

## FE-SEP-05 — Rehearse encryption, backup/restore, export, deletion, and family isolation

**Why now:** Family chat, child records, calendars, documents, memory, and Operator audit data are sensitive. A system that encrypts well but cannot restore keys safely is not recoverable; a system that deletes only UI rows is not deletable.

**Scope**

- Inventory all datastores, object/blob stores, caches, queues, app groups, search indexes, derived extraction, notification payloads, analytics identifiers, Operator shadow/beta evidence, and backup copies.
- Document encryption-at-rest and in-transit boundaries, key identifiers/rotation, environment separation, and which fields are application-layer encrypted.
- Back up encryption keys and data through a controlled, access-logged process; run a restore drill into an isolated environment and prove messages/attachments/audit can be read only with the restored authorized key set.
- Define restore-time invalidation for sessions, one-time capabilities, approvals, passkey challenges, signed media URLs, and in-flight Operator execution claims.
- Test family isolation at query, cache, media authorization, notification, search, export, and Operator context boundaries—not only primary database rows.
- Implement/verify family and subject export with role/authority checks and clear source/provenance metadata.
- Implement/verify deletion/tombstone behavior for a message, attachment, approved memory fact, child link, family membership, PathOdds link, entire account/family, and expired Operator evidence.
- Preserve required security/audit evidence without retaining unnecessary raw content; document retention and legal/safety rationale.
- Add privacy-safe operational logs and support bundles with no raw chat, child content, file text, secrets, or opaque credential material.

**Acceptance criteria**

- [ ] Backup plus key restore is executed and verified in isolation.
- [ ] Restored ephemeral approvals/capabilities/sessions cannot be replayed.
- [ ] Cross-family adversarial tests cover database, cache, media, notification, search, and Operator context.
- [ ] Export and deletion behavior matches published policy and observed storage.
- [ ] Deleting an attachment removes blob and derived extraction while preserving the minimal audit tombstone where required.
- [ ] Support diagnostics are useful without exposing family content.

**Functional owners:** Security/Platform, Backend, Privacy, QA  
**Dependencies:** Complete data-store inventory  
**Primary risk:** Restoring valid data together with stale single-use authority that can execute after the restore.

---

# P1 — Commit after P0 evidence is healthy

## FE-SEP-06 — Graduate only qualifying workflows into a tiny limited-family beta

**Scope**

- Enroll only explicit internal/consented households and only for workflows that pass FE-SEP-04.
- Default every family to `shadow-only`; raise to `approved-low-risk` separately per family and workflow.
- Reconfirm the allowlist at deployment and execution time.
- Use conservative hourly/daily quotas and count retries/reservations to prevent storms.
- Test environment, global, per-family, and per-workflow kill switches before first live execution.
- Require exact parent review of the rendered action, not a generic “let Hermes help” consent.
- Show completed, failed, blocked, and released quota evidence on the parent case timeline.
- Ask for explicit post-case feedback without nagging and review safety metrics weekly.
- Maintain a one-command rollback to shadow-only that leaves ordinary FamETC unaffected.

**Acceptance criteria**

- [ ] No family is live-enabled by default or by migration.
- [ ] 100% of live executions map to one exact parent approval and single-use capability.
- [ ] Prohibited/unallowlisted action attempts execute zero drivers.
- [ ] Kill-switch and quota drills are completed before enrollment.
- [ ] A family can be returned to shadow-only without data loss or service outage.
- [ ] Weekly review covers every blocked/failed/modified live case.

## FE-SEP-07 — Harden the family daily operating loop

**Scope**

- Make Today the single coherent view of current family obligations rather than separate chat, calendar, action, school, trip, and quest silos.
- Define deterministic deduplication among a school notice, chat message, imported calendar event, parent-created task, and Hermes proposal.
- Show provenance and ownership for each item: who/what created it, source time, who can edit, and whether it is awaiting approval.
- Separate information from action. An announcement does not automatically become a task or notification.
- Add overdue/upcoming semantics that respect local timezone, all-day events, school calendars, travel, and completed/cancelled state.
- Support offline read and queued low-risk first-party writes with conflict detection.
- Tune notification budget so important family changes surface without sending multiple alerts for the same underlying event.
- Measure time saved through fewer duplicate entries, faster acknowledgement, and successful completion—not message volume.

**Acceptance criteria**

- [ ] One source event cannot create duplicate active calendar/action cards through retries or multiple ingestion paths.
- [ ] Every actionable card has owner, due state, source/provenance, and one clear next action.
- [ ] Offline edits reconcile explicitly; newer server state is not silently overwritten.
- [ ] Parent and child Today views contain only role-appropriate data/actions.
- [ ] Notification dedupe works across chat, calendar, task, quest, and Operator case events.

## FE-SEP-08 — Complete the safe Hermes Trips research-to-review loop

**Scope**

- Preserve explicit `@Hermes` invocation for research and clearly show when external/current research is being used.
- Store structured research evidence, dates, sources, assumptions, freshness, and family constraints separately from an itinerary.
- Allow Hermes to propose itinerary additions/updates only after the parent selects or edits the research result.
- Revalidate date, destination, family member, and target trip at approval and execution.
- Handle changed prices/availability as stale research, not a booking promise.
- Keep booking, payment, passport/visa attestation, and external messaging disabled.
- Add research cache/refresh behavior and avoid repeated expensive research for an unchanged request.

**Acceptance criteria**

- [ ] Research never silently mutates a trip.
- [ ] Approved itinerary write matches the rendered exact payload/hash.
- [ ] Stale price/availability is visibly labeled and cannot be represented as reserved.
- [ ] Wrong-trip/family/date adversarial cases fail closed.
- [ ] No purchase, booking, payment, or silent contact action is available.

## FE-SEP-09 — Observe Odds Core shadow projections without identity cutover

**Scope**

- Enable the existing publisher only in controlled shadow mode after signing, schema, privacy, and endpoint configuration are verified.
- Send only reviewed privacy-minimized projections with source product, subject scope, consent, timestamp, expiry, and content hash.
- Monitor delivery, freshness, dead letters, reconciliation, and deletion/revocation propagation.
- Keep Odds identity browser/OIDC and child-product callback cutover disabled.
- Run the production-data sanitizer/rehearsal against secure copies before proposing any future identity cutover.
- Do not expose canonical `person_*` IDs inside ordinary FamETC Operator context.

**Acceptance criteria**

- [ ] Shadow projection health is visible without enabling shared login.
- [ ] Bad signatures and privacy-contract violations create no accepted projection.
- [ ] Revoke/delete expires or removes the relevant projection through a tested path.
- [ ] Raw family chat, attachments, child learning content, and sensitive specialist data are not projected.
- [ ] Shared-auth cutover remains a separately reviewed milestone.

---

# P2 — Research or October preparation

## FE-SEP-10 — Out-of-box family setup without an OAuth wall

Design a setup path that is useful after only household creation and optional low-friction imports. Prioritize:

- family members/roles and a small set of recurring routines;
- forwarded/uploaded school documents or calendars;
- standard calendar subscription/import;
- chat/document capture that can propose—but never silently create—events/actions;
- clear value before asking for another connection.

Do not measure setup quality by the number of integrations connected. Measure time to first useful family plan and the percentage of proposed items a parent accepts without material correction.

## FE-SEP-11 — Family memory quality and lifecycle

Improve memory review, expiry, contradiction handling, source confidence, and purpose limitation. Sensitive facts should expire or require periodic reconfirmation. Hermes should prefer asking one necessary question over using a low-confidence old preference. No opaque “knows your family” claim without a readable memory ledger.

## FE-SEP-12 — Meals/pantry and additional family workflows

Keep new domains behind the same case → shadow → review → graduation process. A pantry/meal workflow should first solve planning and reminders with FamETC-native data; purchases, nutrition/medical inference, and unrestricted external actions remain separate future decisions.

---

# Carry-forward disposition from prior roadmaps and PRs

| Prior item | September disposition |
|---|---|
| Operator Family Memory, attachments, low-risk workflows, shadow, beta controls | Treat as implemented; collect real evidence through **FE-SEP-04/06** |
| Chat attachments, Quick Look/share, compression PRs #26/#28 | **P0 FE-SEP-01/02** native and reliability validation |
| Notification opens exact message immediately | **P0 FE-SEP-02** performance/revision acceptance gate |
| FamETC × PathOdds integration PRs #13/#15 | **P0 FE-SEP-03** production-shaped reconciliation |
| Hermes Trip research PR #24 | **P1 FE-SEP-08** safe research-to-itinerary completion |
| Odds Core shadow publisher PR #20 | **P1 FE-SEP-09**, shadow only |
| Shared identity/OIDC cutover | Deferred until production rehearsal, callbacks, recovery, and rollback pass across products |
| Payments/bookings/external messaging | Explicitly prohibited in September |
| More Operator action types | Deferred; prove existing five first |

---

# Weekly execution sequence

## 4–6 September — Freeze, inventory, and test design

- Freeze native/server compatibility versions and triage open PRs.
- Build the iOS/device matrix and chat attachment/network test corpus.
- Document the PathOdds link/event/reconciliation contract.
- Select sanitized shadow cases and reviewers for each priority Hermes workflow.
- Inventory datastores, keys, blobs, caches, queues, and ephemeral authority.

## 7–13 September — Native chat and integration reliability

- Establish the reproducible Release/TestFlight pipeline.
- Run message, attachment, notification-deep-link, app-kill, offline/retry, and memory profiling.
- Run the PathOdds parent/child link → quest → completion → reconciliation flow.
- Fix P0 defects without adding new action types.

## 14–20 September — Safety and recovery evidence

- Run Operator shadow cases, parent review, and adversarial suite.
- Execute encryption key/data backup and isolated restore.
- Verify export/deletion/family-isolation behavior.
- Run Odds Core shadow-ingestion rehearsal with the publisher still controlled/disabled by default.

## 21–27 September — Conditional limited beta

- Graduate only workflows meeting the unchanged evidence gate.
- Test all kill switches, quotas, exact approvals, and rollback.
- Enroll a tiny explicit cohort, or remain shadow-only if evidence is insufficient.
- Harden Today deduplication and notification budget using actual household findings.

## 28–30 September — Review and October decision

- Publish native, chat, integration, Operator, and recovery scorecards.
- Review every live/blocked/failed Operator case.
- Decide per workflow: remain shadow, limited beta, redesign, or stop.
- Keep identity cutover and authority expansion as separate future decisions.

---

# September scorecard

| Measure | September target |
|---|---:|
| Exact-commit native Release/archive pipeline | 100% reproducible |
| Critical parent/child physical-device matrix completed | 100% |
| Duplicate messages/blobs caused by retry | 0 |
| Supported notification taps opening wrong family/conversation/message | 0 |
| Warm notification tap to target visible | p95 ≤1.5s |
| Cold notification tap to usable conversation | p95 ≤3s |
| PathOdds duplicate/reordered events causing double completion/XP/streak | 0 |
| Priority Hermes workflows with ≥10 reviewed shadow runs | As evidence permits; status explicit for each |
| Unsafe/hallucinated proposals in any graduated workflow | 0 |
| Live Operator actions without exact parent approval | 0 |
| Cross-family data exposures | 0 |
| Backup + key restore drill | 1 complete verified rehearsal |
| Open FamETC PRs with merge/defer/close disposition | 100% |

## Release decision rule

FamETC may enter a small family beta only when the native app, chat/attachment loop, push/deep links, PathOdds integration, and recovery controls pass P0. Hermes live execution is a separate per-workflow decision: no workflow graduates because the scaffolding exists or because another workflow scored well.

---

# Cross-project dependencies

- **PathOdds:** owns all learning content/evidence. FamETC receives only the minimum daily-loop projection and must support revoke/reconcile.
- **Odds Core:** may receive privacy-minimized shadow projections. Shared identity/browser/OIDC remains disabled until coordinated production rehearsal and rollback are complete.
- **RetireOdds/OpsOdds/FitOdds:** specialist products remain authoritative. FamETC must not ingest raw financial, trading, medication, symptom, body, or assessment records into family memory or Operator context.
- **Mytharva and future modules:** use the same purpose-limited projection, role, consent, and deletion model rather than direct database access.

# Explicit non-goals for September

- Payments, purchases, travel bookings, or autonomous external messaging.
- Medical/legal attestations or high-stakes form submission.
- Unrestricted browser control.
- Additional Operator action types before the existing five are proven.
- Shared identity/OIDC cutover.
- Copying PathOdds learning records into FamETC.
- A broad OAuth/integration setup wall before users see value.
- A visual redesign that delays message, integration, safety, or recovery evidence.

# Definition of done for every roadmap item

An item is complete only when:

1. family/role/authority and source-of-truth behavior are documented;
2. success, stale/partial, retry, revoke, and recovery paths are tested;
3. native work passes the exact Release/device gate;
4. cross-family and prohibited-action adversarial tests remain green;
5. parent-visible evidence/provenance is available where an action or memory changes;
6. privacy, retention, export, deletion, and backup implications are covered;
7. telemetry is useful without raw family content;
8. the merged/deployed commit—not merely a feature branch—passes the acceptance criteria.
