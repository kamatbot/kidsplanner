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

### M4 — Shadow mode — ✅ implemented / CI #52 green

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

### M5 — Limited-family beta

Release to a very small trusted cohort with strict operational controls.

- per-family feature flag and autonomy ceiling;
- low-risk first-party actions only at launch;
- execution quotas and rate limits;
- emergency global/family kill switch;
- enhanced audit retention and evidence capture;
- explicit feedback on every completed/blocked case;
- benchmark and safety dashboards;
- no payments, medical/legal attestations, unrestricted browser execution, or silent external messaging.

## Exit criteria for Weeks 7–12

- zero unauthorized or cross-family writes in adversarial regression tests;
- zero prohibited-action executions;
- 100% executed actions linked to an exact approval or an explicitly approved low-risk policy exemption introduced later;
- every case has provenance-aware context and a readable activity timeline;
- shadow-mode benchmark demonstrates acceptable plan/context/approval accuracy before each workflow is enabled live;
- family beta can be disabled without breaking normal FamETC, Odds Core, or specialist-product operation.
