#!/usr/bin/env bash
#
# Build a Hostinger deploy archive for the Fam ETC Node app, matching the
# RetireOdds-established convention: a timestamped zip in ../Builds/ that
# bundles the whole project INCLUDING node_modules, excluding only VCS, the
# iOS app, user data (data/*.json), secrets (.env), and editor/office junk.
#
# Output: <Planner-parent>/Builds/fametc-hostinger-<timestamp>.zip
#
# Usage:
#   scripts/deploy-hostinger.sh
# Then deploy the printed archive to fametc.com via the Hostinger
# "deploy JS application" tool (app_type=express, node 20, entry server.js) with
# removeArchive=FALSE so the artifact in ../Builds/ is preserved, and poll until
# the build state is "completed".
#
# This script only BUILDS + VERIFIES the archive. The upload is a separate,
# deliberate step so a deploy is never triggered as a silent side effect.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILDS_DIR="$(cd "$REPO_ROOT/.." && pwd)/Builds"
mkdir -p "$BUILDS_DIR"

TS="$(date +%Y%m%d-%H%M%S)"
ZIP="$BUILDS_DIR/fametc-hostinger-${TS}.zip"
rm -f "$ZIP"

# Zip the whole project (node_modules included, mirroring RetireOdds' prior
# deploys) minus: .git, ios/ (native app — not served), data/*.json (user
# data, lives outside the app dir in prod), .env AND .env.* (secrets), tool
# caches, editor lockfiles, prior zips, and .DS_Store.
cd "$REPO_ROOT"
zip -r -q "$ZIP" . \
  -x ".git/*" ".git" "ios/*" "ios" "marketing/*" "marketing" \
     ".claude/*" ".claude" ".serena/*" ".serena" ".gstack/*" ".gstack" \
     "data/db.json" "data/fx.json" "data/*.json" ".env" ".env.*" \
     "*.DS_Store" "*/.DS_Store" ".~lock*" "*.~lock*" \
     "*.xlsx" "*.docx" "*.zip"

# ---- guard rails: refuse to hand over an archive that's wrong ----
fail() { echo "DEPLOY ARCHIVE CHECK FAILED: $1" >&2; rm -f "$ZIP"; exit 1; }
LIST="$(unzip -l "$ZIP")"
has() { grep -qE "$1" <<<"$LIST"; }

has " server.js$"            || fail "server.js missing"
has " package.json$"         || fail "package.json missing"
has "node_modules/express/"  || fail "node_modules not bundled (expected, per project convention)"
has "data/db.json$"          && fail "user data (data/db.json) must be excluded"
has "\.env$"                 && fail ".env (secrets) must be excluded"
has "(^| )\.env\."           && fail ".env.* (secrets, e.g. .env.hostinger) must be excluded"
has "(^| )ios/"              && fail "ios/ app must be excluded"
has "\.git/"                 && fail ".git must be excluded"

# Keep the parent folder holding exactly ONE current deploy zip — the
# artifact that gets uploaded. Builds/ keeps the full history; the root
# holds only the latest. Replace any prior root copy.
ROOT_DIR="$(cd "$REPO_ROOT/.." && pwd)"
rm -f "$ROOT_DIR"/fametc-hostinger-*.zip
cp "$ZIP" "$ROOT_DIR/"

echo "OK  $ZIP"
echo "    $(unzip -l "$ZIP" | tail -1 | awk '{print $2}') files, $(du -h "$ZIP" | cut -f1)"
echo "    current copy: $ROOT_DIR/$(basename "$ZIP")"
echo "    next: deploy this archive to fametc.com (Hostinger deploy JS application,"
echo "          removeArchive=false), then poll until completed."
