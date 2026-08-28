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

Durable Family Memory is FamETC-owned rather than Hermes model memory.

- facts and preferences with provenance, confidence, sensitivity, and expiry;
- parent-visible approve/edit/delete controls at `/operator-memory.html`;
- person/household scope using FamETC immutable `subj_*` identity subjects;
- explicit source references and asserted/derived/projection distinction;
- MCP tools where Hermes may read active memory and propose a pending memory, but cannot activate/edit/delete it;
- provenance model can carry future Odds Core cross-product projections without changing specialist-product authority.

### M2 — Attachments

Make files first-class Operator case artifacts.

- photos, PDFs, screenshots, receipts, forms, itineraries, and documents;
- encrypted metadata and storage references;
- bounded extraction with provenance and content hashes;
- MIME/size limits and malware/content safety hooks;
- every extracted value marked as untrusted external content;
- purpose-scoped MCP retrieval instead of dumping whole documents into model context;
- delete/revoke semantics that remove derived Operator data as well as source artifacts.

### M3 — Low-risk first-party workflows

Expand the allowlisted executor only for FamETC-native reversible operations first.

- `calendar.create` / `calendar.update`;
- `action.create` / `action.update`;
- trip itinerary add/update/import;
- reminders and family follow-up actions;
- document → calendar/action/trip proposals;
- deterministic risk registry enforcement and exact-action approvals;
- idempotent writes with evidence returned to the case timeline.

Initial product workflows:

1. turn a school message/screenshot into calendar + actions;
2. research trip activities and prepare itinerary updates;
3. convert confirmations into calendar/trip data;
4. household appointment research with a parent-approved calendar action;
5. gift-card/voucher/membership reminders and expiry actions.

### M4 — Shadow mode

Run the complete Operator decision process without external execution.

- Hermes creates the plan, context package, proposed actions, and expected result;
- FamETC records what it *would* do and blocks the final write;
- compare proposed behavior with the parent's eventual choice;
- score every run with the Operator benchmark dimensions;
- collect false-positive, unnecessary-question, context-miss, and unsafe-action telemetry;
- use shadow-mode evidence to decide when a workflow may graduate to live execution.

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
