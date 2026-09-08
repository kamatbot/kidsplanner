# CI and release gates

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
