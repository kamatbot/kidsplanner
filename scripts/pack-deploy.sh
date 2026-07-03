#!/usr/bin/env bash
# Package a Hostinger deploy archive with a TIMESTAMPED build label.
#
# Why the timestamp: so a live build is identifiable in the startup log and at
# /api/health (build "20260703-1547Z-<sha>") — we can always tell which deploy
# is running and "what went wrong with which build".
#
# IMPORTANT: this archive is built from `git ls-files`, so it deliberately does
# NOT contain .env (gitignored — no secrets in the repo). A Hostinger redeploy
# replaces the app directory, so any server-side .env is wiped. Runtime env
# vars (SESSION_SECRET, DATA_ENCRYPTION_KEY, VAPID_*, GIPHY_API_KEY, STRIPE_*)
# MUST be set in the hPanel Node app "Environment variables" section so they
# survive redeploys. If SESSION_SECRET is missing with NODE_ENV=production the
# app throws on boot and every route returns 503.
set -euo pipefail

cd "$(dirname "$0")/.."

OUT="${1:-fametc-deploy.tar.gz}"
LABEL="$(date -u +%Y%m%d-%H%M%SZ)-$(git rev-parse --short HEAD)"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
COMMIT="$(git rev-parse HEAD)"

# Stamp the build so server.js can report it (read at startup, see BUILD_INFO).
printf '{"label":"%s","builtAt":"%s","commit":"%s"}\n' "$LABEL" "$BUILT_AT" "$COMMIT" > build-info.json

# Archive = all git-tracked files (current working-tree contents) + the stamp.
# --null keeps paths with spaces safe.
{ git ls-files -z; printf 'build-info.json\0'; } | tar --null -czf "$OUT" -T -

echo "Packed $OUT"
echo "  build label : $LABEL"
echo "  built at    : $BUILT_AT"
echo "  commit      : $COMMIT"
echo "Reminder: runtime env vars live in hPanel, NOT in this archive."
