# Hermes Family Operator — Limited-Family Beta (M5)

M5 is the operational safety layer that allows a very small set of trusted FamETC families to use live Operator execution without turning the broader product into an unrestricted autonomous agent.

## Default posture

Production is unconditionally deny-by-default: a family enrollment is required before live execution can be claimed. `OPERATOR_BETA_ENFORCE=1` may force the same enforcement in development, but no environment setting can disable it in production.

A beta family has two autonomy ceilings:

- `shadow-only` — Hermes can plan and run M4 shadow evaluations, but live execution is blocked.
- `approved-low-risk` — live execution is permitted only for the M5 launch allowlist and only after the existing exact parent approval contract has been satisfied.

M5 does **not** introduce silent autonomy or an approval exemption.

## Launch action boundary

The only beta-eligible live actions are:

- `calendar.create`
- `calendar.update`
- `action.create`
- `action.update`
- `trip.itinerary.update`

Every beta action must still be registered as `low` risk and executable in `operator-risk`. The beta control plane refuses any configured action outside that intersection.

Payments, bookings, email sending, subscription cancellation, medical/legal attestations, unrestricted browser automation, and silent external messaging remain disabled.

## Execution authority chain

Live execution follows all of these gates:

1. initiating human actor capability;
2. family/case scope;
3. deterministic action-risk registry;
4. exact action hash persisted in the approval record;
5. authenticated parent decision;
6. short-lived single-use execution capability;
7. M5 family enrollment and autonomy ceiling;
8. global and family kill switches;
9. family action allowlist;
10. hourly and daily quota reservation;
11. exact server-stored action dispatched by the existing allowlisted driver.

`lib/operator-live-execution.js` is the production facade used by Hermes MCP. It adds M5 gates around the existing `operator-execution` engine; it does not replace the approval contract.

## Kill switches

There are three ways to stop live execution:

- environment emergency stop: `OPERATOR_BETA_KILL_SWITCH=1`;
- persisted global kill switch via the admin API;
- persisted per-family kill switch via the family beta configuration.

The environment kill switch wins over persisted configuration and therefore remains available even if SQLite configuration is stale.

`OPERATOR_BETA_ENABLED=0` can also globally disable the beta.

## Quotas

Defaults are deliberately small:

- 10 executions per rolling hour;
- 25 executions per rolling 24 hours.

Admin configuration may lower or raise them within bounded limits. A quota slot is reserved before a live driver runs, preventing concurrent runs from independently observing the same remaining capacity. Runtime failures count toward quota to prevent retry storms; token/hash/state failures release the reservation.

## Evidence and audit

The canonical Operator audit trail remains independent and is not deleted by M5 cleanup.

M5 additionally records encrypted beta evidence for:

- safety-control blocks;
- completed beta execution;
- failed beta execution;
- released reservations;
- explicit parent feedback.

Beta evidence defaults to 365 days of retention and may be pruned only through the admin operation. Case cards expose a sanitized evidence projection, not stored capability material or raw actor IDs.

## Required feedback

A case requests explicit parent feedback after a completed/failed execution, a beta safety block, a finished shadow review, or a terminal case state.

The Today case card asks one of two concise questions:

- completed result: `Helpful` / `Not helpful`;
- blocked result: `Yes, block was right` / `No, it should have run`.

Feedback is family-scoped, parent-only, auditable, and included in beta coverage metrics. Pending feedback is available at `GET /api/operator/beta/feedback-pending`.

## Parent beta endpoints

- `GET /api/operator/beta/status`
- `GET /api/operator/beta/feedback-pending`
- `POST /api/operator/cases/:caseId/feedback`

Parents may inspect their status and give feedback. They cannot self-enroll, change quotas, raise their autonomy ceiling, or operate a kill switch.

## Admin operations

These use a dedicated, header-only Operator administration credential. Set `OPERATOR_ADMIN_TOKEN` and send it only in the `x-operator-admin-token` header. The analytics token and query-string credentials are not accepted for these high-impact operations.

- `GET /api/admin/operator-beta/dashboard`
- `POST /api/admin/operator-beta/global`
- `GET /api/admin/operator-beta/families/:familyId`
- `POST /api/admin/operator-beta/families/:familyId`
- `POST /api/admin/operator-beta/prune-evidence`

Example enrollment body:

```json
{
  "enabled": true,
  "autonomyCeiling": "approved-low-risk",
  "hourlyQuota": 5,
  "dailyQuota": 12,
  "allowedActionTypes": ["calendar.create", "action.create"]
}
```

Setting `killSwitch: true` on that same family endpoint immediately blocks later claim/run attempts for the family.

## Safety dashboard

The admin dashboard reports:

- current global beta/kill-switch state;
- configured beta families;
- family autonomy ceiling and action allowlist;
- rolling hourly/daily execution usage;
- seven-day beta block count;
- required/submitted feedback coverage;
- M4 shadow graduation status for each observed workflow;
- an explicit hard-coded safety boundary showing that payments, medical/legal attestations, unrestricted browser execution, and silent external messaging are disabled.

Shadow graduation remains necessary evidence, not sufficient authority. Passing the M4 gate never enables a family or workflow by itself.

## Rollback

The beta can be disabled globally or per-family without altering ordinary FamETC, Family Memory, attachments, shadow mode, Odds Core identity mapping, or specialist-product integrations. This is a core release criterion for the limited-family rollout.
