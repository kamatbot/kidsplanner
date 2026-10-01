# CI and release gates

Refreshed 2026-09-30 for the Screen Time essentials and truthful-status release:
`main` remains `protected=false`; the effective-rules endpoint returns `[]`.
The only active workflow remains the lightweight ready-PR lane and full Node 24
push-to-`main` gate. Use the single push run for the frozen release commit;
native build/distribution is owner-managed and excluded from the web archive.
The exact release SHA, run and deployment receipts are recorded in the local
task checkpoint after the gate completes.

The workflow has two intentional lanes. A ready pull request runs only
whitespace validation and `node --check` for changed JavaScript files; draft
pull requests are skipped. It does not install dependencies or run `npm test`.

A push to `main` or a manual `workflow_dispatch` runs the full Node gate with
Node 24, `npm ci --no-audit --no-fund`, and `npm test`. Use that single full run
for the frozen release source before deployment; do not treat a lightweight PR
run as release evidence. See [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

## Provider read evidence

Read 2026-09-07: the main-branch read API reported `protected=false` with no
required checks, and the effective rules endpoint returned `[]`. These are
observations of the provider state, not a substitute for the workflow gate.
Refresh both reads before every release and record any change with the release
source.

Refreshed again 2026-09-26 for the combined Family Rings/Study Pal/chat release: `main` remains `protected=false` and
the effective rules endpoint returns `[]`. The active workflow still runs the
full Node 24 gate on a push to `main`; no additional dispatch is needed.

Refreshed 2026-09-27 for the own-name and first-launch recovery release
(`27620bf`): `main` remains `protected=false` and the effective rules endpoint
returns `[]`. The push-to-`main` CI run for `27620bf` passed the full Node 24
gate before the Hostinger build went live.

Refreshed 2026-09-28 for the Screen Time fixes release (off-state alerts,
enforcement guards, iPad full-screen UX): the branch listing reports `main`
`protected=false`; the effective-rules endpoint could not be read from this
session (GitHub connector only). The push-to-`main` runs from `5ddee04` through
`09a6396` failed on the date-dependent Hermes nav-badge test; this release pins
that test's clock so the full Node 24 gate is green again before deployment.

Confirmed 2026-09-28 at deploy time for `38a5bc9`: the effective rules endpoint
returns `[]`, `main` is `protected=false`, and the push-to-`main` CI run for
`38a5bc9` passed the full Node 24 gate before the Hostinger build went live.

Refreshed 2026-09-28 for the Screen Time false-positive fixes release
(`0f5a876`): `main` remains `protected=false` and the effective rules endpoint
returns `[]`. The push-to-`main` CI run for `0f5a876` passed the full
Node 24 gate before the Hostinger build went live.

Refreshed 2026-09-28 for the kid-set goals release (`878b200`): `main`
remains `protected=false` and the effective rules endpoint returns `[]`.
The push-to-`main` runs for `080f165` and `aa4d1e4` failed on a timing-
dependent datastore-writer test; `878b200` makes that test wait for the
writer instead of sleeping, and its full Node 24 gate passed before the
Hostinger build went live.

Refreshed 2026-10-01 for the Screen Time plan release (app-only Screen Time
signup, invite-gated full plan, kid setup codes): the branch listing reports
`main` `protected=false`; the effective-rules endpoint could not be read from
this session (GitHub connector only). Local Node 24 `node --test` was fully
green on the release source before the merge; the push-to-`main` run is the
release gate.
