"use strict";
/**
 * Persistent data-directory resolver.
 *
 * The whole point of the "fametc" (persistent) build: user data must live
 * OUTSIDE the app/deploy directory so that re-uploading a new build (which
 * replaces the app folder wholesale on shared Node hosting) never wipes
 * db.json / fx.json.
 *
 * Resolution order:
 *   1. FAM_DATA_DIR (or the legacy DATA_DIR) env var — set this in production
 *      to an absolute path on a writable volume that is NOT inside the
 *      deploy folder.
 *   2. Default: ~/.fametc-data (the home directory survives redeploys).
 *
 * On first boot we migrate data from any earlier location into the current
 * persistent dir (the original in-app KidsPlanner localStorage data does not
 * live here — see kp_ -> fam_ localStorage migration in the web client).
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

function resolveDataDir() {
  const env = (
    process.env.FAM_DATA_DIR ||
    process.env.DATA_DIR ||
    ""
  ).trim();
  if (env) return path.resolve(env);
  return path.join(os.homedir(), ".fametc-data");
}

const DATA_DIR = resolveDataDir();

// Earlier data locations, checked in priority order during migration.
const LEGACY_DIRS = [
  path.join(__dirname, "..", "data"), // original in-app (non-persistent) build
];

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  return DATA_DIR;
}

function dataFile(name) {
  return path.join(DATA_DIR, name);
}

// One-time, best-effort migration: if the current persistent copy of `name`
// doesn't exist yet but an earlier copy does, bring the newest one across so we
// don't start empty after a rename or an upgrade from the non-persistent build.
function migrateLegacy(name) {
  try {
    const dest = path.join(DATA_DIR, name);
    if (fs.existsSync(dest)) return; // already have current persistent data
    for (const dir of LEGACY_DIRS) {
      const legacy = path.join(dir, name);
      if (path.resolve(legacy) === path.resolve(dest)) continue; // same location
      if (fs.existsSync(legacy)) {
        ensureDataDir();
        fs.copyFileSync(legacy, dest);
        return; // first (newest) match wins
      }
    }
  } catch (e) {
    /* ignore — fall back to a fresh datastore */
  }
}

module.exports = { DATA_DIR, LEGACY_DIRS, ensureDataDir, dataFile, migrateLegacy };
