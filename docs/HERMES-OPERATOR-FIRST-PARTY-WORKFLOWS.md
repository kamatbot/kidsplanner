# Low-risk first-party Operator workflows (M3)

M3 expands live execution only to reversible FamETC-native writes. The exact parent approval / action-hash / single-use execution-capability boundary remains unchanged.

## Enabled drivers

| Action | Risk | Live |
| --- | --- | --- |
| `calendar.create` | low | yes |
| `calendar.update` | low | yes |
| `action.create` | low | yes |
| `action.update` | low | yes |
| `trip.itinerary.update` | low | yes |

Email, subscription cancellation, bookings, payments and medical/legal attestations remain disabled.

## Runtime policy

The execution engine now rechecks the deterministic risk registry at validation, claim and run time. A stored approval cannot make an action executable if the registry no longer permits live execution.

Every write still follows:

1. Hermes proposes an exact structured action.
2. FamETC validates its target, fields and family scope.
3. A parent sees the exact payload/hash and approves or rejects it.
4. FamETC creates a short-lived single-use execution capability.
5. Execution reloads the approved encrypted action from SQLite rather than accepting a replacement payload.
6. The driver returns concrete evidence into the case timeline.

## Driver behavior

- Calendar create uses an Operator source id for idempotency.
- Calendar update targets an existing family-owned event and validates the merged final event before writing.
- Action create is family/person-reference validated and uses the execution grant as a stable source id.
- Action update validates the full resulting action state before writing.
- Trip itinerary add/update requires that the approving parent is a writable trip member. Additions detect exact date/time/title duplicates before creating another item.

These tools are enough to implement the initial family workflows without enabling open-world browser writes: document/school message → calendar/actions, confirmation → calendar/trip, trip research → itinerary proposal, and reminders for vouchers/memberships.
