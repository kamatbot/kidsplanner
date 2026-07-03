"use strict";
/**
 * Minimal, zero-dependency .env loader. Reads a `.env` file from the project
 * root (if present) and copies any KEY=VALUE pairs into process.env WITHOUT
 * overwriting variables already set by the real environment.
 *
 * Why not the `dotenv` package: the app deliberately keeps a tiny dependency
 * footprint for shared hosting, and this is ~20 lines. In production (Hostinger)
 * the env vars come from the panel and no `.env` is deployed (it's gitignored),
 * so this is a no-op there. Locally it lets `npm start` and the provisioning
 * script pick up secrets from a gitignored `.env`.
 *
 * Supported syntax: `KEY=value`, `KEY="value"`, `KEY='value'`, `# comments`,
 * blank lines, and an optional leading `export `. No variable expansion.
 */
const fs = require("fs");
const path = require("path");

// Default search order. `.env` is the local-dev file (gitignored, never shipped).
// `.env.hostinger` is a deploy-shipped fallback for hosts whose env-var panel is
// unreliable — it carries only non-encryption config (e.g. Stripe keys) and is
// gitignored so it never lands in source control. Real process.env always wins
// (we only fill vars that are undefined), so a working panel var overrides it.
const DEFAULT_FILES = [".env", ".env.hostinger"];

function load(file) {
  if (!file) {
    for (const f of DEFAULT_FILES) load(path.join(__dirname, "..", f));
    return;
  }
  const envPath = file;
  let raw;
  try {
    raw = fs.readFileSync(envPath, "utf8");
  } catch (e) {
    return; // file absent — nothing to do
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const withoutExport = trimmed.replace(/^export\s+/, "");
    const eq = withoutExport.indexOf("=");
    if (eq === -1) continue;
    const key = withoutExport.slice(0, eq).trim();
    if (!key) continue;
    let val = withoutExport.slice(eq + 1).trim();
    // Strip a single layer of matching quotes.
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    // Real environment wins — never clobber an explicitly set var.
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

module.exports = { load };
