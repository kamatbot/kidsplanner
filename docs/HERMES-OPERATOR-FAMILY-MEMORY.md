# Family Memory (M1)

Family Memory is FamETC-owned durable memory for Hermes Family Operator. It is not Hermes model memory and does not make Odds Core authoritative for FamETC facts.

## Authority

- Hermes may read active memory visible to the initiating actor.
- Hermes may propose a pending memory.
- Only an authenticated FamETC parent may approve, reject, edit, add directly, or delete Family Memory.
- Person-scoped records use immutable FamETC `subj_*` subjects.
- Kid actors can only propose person-scoped memory about their own subject.
- Sensitive/identity memory is not disclosed to kid actors.

## Stored metadata

Every record carries scope, subject, key, fact/preference kind, asserted/derived/projection provenance, confidence, sensitivity, expiry and state. Value and provenance payloads are encrypted in `operator.sqlite`.

Future Odds Core projections may enter as `assertionType: projection` with their original product/source authority retained. A projection does not become a FamETC-authored fact merely because Family Memory stores it.

## Product surfaces

- parent API: `/api/operator/memory`
- parent review UI: `/operator-memory.html`
- MCP: `fametc_memory_list`, `fametc_memory_propose`
