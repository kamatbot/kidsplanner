# Hermes Family Operator Roadmap

## Foundation status

Weeks 1–6 are complete. The Foundation Closeout unified the context contract, made action risk deterministic, added a formal threat model and adversarial regression suite, established the first Operator benchmark, and exposed parent-facing case/activity primitives.

The Operator foundation remains aligned with Odds Core identity work in `kamatbot/odds` branch `feature/oddscore-m2-identity-foundation`:

- FamETC remains authoritative for family-operations data.
- FamETC immutable `subj_*` identities are the migration/linking identifiers used by Odds Core.
- FamETC `family.id` is the legacy household identifier Odds Core maps to its canonical household graph.
- Operator context never exposes or invents an Odds Core `person_*` canonical id.
- Cross-product context later arrives as explicit, consented, provenance-carrying projections; it does not replace FamETC or specialist-product source-of-truth data.

## Weeks 7–12

### M1 — Family Memory — ✅ implemented

- durable FamETC-owned facts/preferences with provenance, confidence, sensitivity and expiry;
- parent approve/edit/delete UI at `/operator-memory.html`;
- person/household scope using immutable `subj_*` subjects;
- MCP read active / propose pending only; Hermes cannot govern memory.

### M2 — Attachments — ✅ implemented

- encrypted case artifacts for PDF, PNG, JPG, TXT, CSV, JSON and EML up to 8 MiB;
- encrypted metadata/storage references, SHA-256 content hashes and file-magic checks;
- malware hook and bounded extraction;
- all extracted text is `untrusted-external` with zero approval/execution authority;
- parent upload/review/delete surface and read-only purpose-scoped MCP extraction;
- deletion removes blob and derived extraction.

### M3 — Low-risk first-party workflows — ✅ implemented / CI #45 green

The exact approval/execution engine now supports only reversible FamETC-native writes:

- `calendar.create` / `calendar.update`;
- `action.create` / `action.update`;
- `trip.itinerary.update` for add/update;
- deterministic risk registry is rechecked at validation, execution claim and execution run;
- exact-action approvals and single-use execution capabilities remain mandatory;
- writes are family/target validated and return concrete evidence to the case timeline;
- create operations are idempotent or duplicate-aware.

Initial supported product patterns:

1. school message/document → calendar + action proposals;
2. trip research → itinerary add/update proposal;
3. confirmation → calendar/trip update;
4. appointment research → parent-approved calendar write;
5. voucher/membership expiry → family action/reminder.

### M4 — Shadow mode — ✅ implemented / CI #53 green

Shadow mode now runs the decision path without permitting the proposal to become execution authority.

- Hermes records a `shadow.proposal` through the existing case-step MCP tool, including plan, context sections, clarifying-question count, exact proposed actions and expected result;
- FamETC persists encrypted shadow runs with action hashes, deterministic risk-policy evaluation and audit evidence;
- an active shadow run hard-blocks transitions to approval/execution and blocks `operator.requestApproval()`;
- unsafe/prohibited proposals can be retained as evaluation evidence but never become approval or execution authority;
- initial scoring immediately covers unnecessary questions, approval correctness, proposal completeness and action safety;
- authenticated parents record accepted/modified/rejected outcomes, context misses, hallucinations and their eventual action choices;
- completed runs are scored on the same seven dimensions as the Operator benchmark;
- optional canonical benchmark observations can be attached to benchmark-linked shadow runs;
- per-workflow telemetry covers average score, acceptance, unsafe proposals, context misses, hallucinations and unnecessary questions;
- graduation is evidence-gated: at least 10 reviewed runs, average score >=90, zero unsafe proposals/hallucinations, <=10% context misses and 100% approval-policy correctness;
- parent-only family-scoped shadow review/metrics APIs expose the evidence without raw actor/reviewer ids.

See `docs/HERMES-OPERATOR-SHADOW-MODE.md`.

### M5 — Limited-family beta — ✅ implemented / CI #64 green

The live execution path is now wrapped in a separate limited-family beta control plane. Production is deny-by-default unless a family is explicitly enrolled.

- per-family beta enrollment with `shadow-only` and `approved-low-risk` autonomy ceilings;
- only the five reversible low-risk FamETC-native M3 action types can be enabled for beta execution;
- exact parent approval and the existing short-lived single-use execution capability remain mandatory — M5 adds no approval exemption;
- production Hermes execution routes through `operator-live-execution`, which applies beta checks around the exact-action execution engine;
- atomic family quota reservation before a driver runs, with bounded rolling hourly/daily limits and retry-storm accounting;
- emergency environment kill switch plus persisted global and per-family kill switches;
- admin-only family enrollment, autonomy, quota, allowlist and kill-switch controls using a dedicated header-only Operator administration credential;
- encrypted beta evidence for blocked, completed, failed and released executions while the canonical Operator audit remains independent;
- explicit parent feedback after completed/failed/blocked/shadow-reviewed cases, surfaced directly on Operator case cards;
- admin safety dashboard with family usage, seven-day block counts, feedback coverage and M4 shadow graduation status;
- beta evidence retention/pruning is configurable without deleting the canonical Operator audit trail;
- payments, medical/legal attestations, unrestricted browser execution and silent external messaging remain hard-disabled.

Operational controls and rollout instructions are documented in `docs/HERMES-OPERATOR-LIMITED-BETA.md`.

## Weeks 7–12 implementation status

The M1–M5 product and safety scaffolding is implemented. A real limited-family rollout is intentionally a separate operational step: families should first accumulate shadow-mode evidence, be reviewed against the M4 graduation metrics, and then be explicitly enrolled through the M5 admin control plane.

## Hermes v0.21 Action Capability prototype — implemented

External services are now treated as execution paths behind one Action Capability Layer, not as a marketplace of provider integrations. Hermes resolves the first viable path in this order: official connector/API, agent-friendly MCP/API, a verified learned web/API workflow, then browser/computer use for bootstrap or recovery.

The FamETC platform plugin bundles `fametc-platform:action-capability`. It uses Hermes v0.21 procedural memory and the optional official `har-derived-api-client` skill to turn one permitted browser-observed read path into a sanitized learned skill, then tries that skill before opening the browser on later requests. FamETC's existing Operator cases remain the audit boundary; credentials and raw HAR data remain ephemeral and are never copied into FamETC or learned skills.

The first completion boundary is deliberately read-only and parent-scoped: locate an existing reservation and return minimum itinerary facts. Ticket purchases, product reorders, seat moves, booking changes/cancellations, external messages and payments remain non-executable until a constrained FamETC external-write driver and risk policy exist.

## Exit criteria for Weeks 7–12

- zero unauthorized or cross-family writes in adversarial regression tests;
- zero prohibited-action executions;
- 100% executed actions linked to an exact parent approval;
- every case has provenance-aware context and a readable activity/evidence timeline;
- shadow-mode benchmark/graduation metrics are available before workflow rollout decisions;
- beta execution is deny-by-default in production and can be disabled globally or per-family without breaking normal FamETC, Odds Core, or specialist-product operation;
- beta launch allowlist is locked by regression test to low-risk reversible FamETC-native actions only;
- completed/blocked beta cases request explicit parent feedback for ongoing safety evaluation.
