# Fam ETC working notes

Read [CLAUDE.md](CLAUDE.md) first, then use the contract and decision record in
[APP-BRIEF.md](APP-BRIEF.md). For feature context, use [FEATURE_PLAN.md](FEATURE_PLAN.md),
[docs/ARCHITECTURE-PLAN.md](docs/ARCHITECTURE-PLAN.md), and [docs/TRIPS-PLAN.md](docs/TRIPS-PLAN.md)
only when the task touches those areas. CI/release trigger details are in
[docs/CI-RELEASE.md](docs/CI-RELEASE.md). Keep `fam_` storage names, encryption
at rest, the first-party CSP, and the native/web split intact.

The web source of truth is `server.js`, `lib/`, and `public/`. The iOS source of
truth is `ios/FamETC/`; native tabs remain native and secondary surfaces use
`HybridWebView`. Native model contracts live in
`ios/FamETC/Networking/Models.swift`, with server shapes in the corresponding
`lib/` route/store modules. The scanner bridge remains unwired; do not treat
the old `WebShellController` path as shipped.

For ordinary web release discovery, start at `scripts/pack-deploy.sh`. It is
the authoritative packer: it requires an approved env source, stamps the
commit, excludes native sources, bundles named runtime extras, and boot-smokes
the archive. `scripts/deploy-hostinger.sh` is a compatibility wrapper that
delegates to the canonical packer, preserving its optional output path and
default Builds archive; it has no independent archive recipe. It enforces the
Node 24 precondition and prints a deprecation notice. The scripts and [the
2026-09-07 audit](docs/audits/2026-09-07-project-audit.md) are source references.

Runtime and CI rules are inherited from `/Users/kamatbot/.codex/AGENTS.md`:
put `/opt/homebrew/opt/node@24/bin` first and verify `node --version` is v24.*
before any Node command. During edits use focused checks such as
[`node --test tests/deploy-archive-contract.test.js`](tests/deploy-archive-contract.test.js)
or the smallest affected suite. Native verification belongs on a Mac with
Xcode; do not infer it from source inspection or a web test run. Keep temporary
data and task checkpoints under the already ignored `.dev-data/` directory.

Acceptance must cover the real response contract and recovery boundaries:
child-scoped `Family` responses must decode without private invite/parent fields,
parent responses must retain their expected shape, and sign-out/account switch
must remain reachable when initial family loading fails. Verify the native
session is actually cleared before displaying another account; a server logout
test alone does not prove this UI recovery flow. Do not assume the existing
fixtures cover a missing-field regression without inspecting their payloads.
`GET /api/me` role/kid fields decode through `User`/`MeResponse`, chat payloads
decode through `ChatMessage`/`MessagesResponse` (including optional trip fields),
and a signed session copied before `POST /api/logout` is rejected after logout.
Use the existing native fixtures in
[`ios/FamETCTests/ModelDecodingTests.swift`](ios/FamETCTests/ModelDecodingTests.swift)
and [`ios/FamETCTests/ChatMergeTests.swift`](ios/FamETCTests/ChatMergeTests.swift),
plus [`tests/session-revocation.test.js`](tests/session-revocation.test.js);
preserve kid privacy and role boundaries.

Follow the native release gate in [CLAUDE.md](CLAUDE.md): Xcode tests and device
checks precede TestFlight, and never ship the iOS app automatically to the App
Store. Do not expose secrets or alter credentials/configuration. Standing
project authorization does not broaden a task's scope: docs-only work remains
local until the owner explicitly authorizes commit, upload, merge, or deployment.
