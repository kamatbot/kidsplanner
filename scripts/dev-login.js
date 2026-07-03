"use strict";
/**
 * Local-only dev login helper.
 *
 * Fam ETC auth is passkey-only (WebAuthn), which can't be driven from curl or
 * a headless QA browser — there's no automatable ceremony. This script gives
 * automated/local testing a way in WITHOUT adding any login backdoor to the
 * production request path:
 *
 *   1. Ensures a dedicated dev PARENT account exists in the local datastore,
 *      with a demo family (invite code + two kid profiles) so chat/calendar/
 *      homework/goals all have something real to render. Grandfathered so the
 *      billing gate never blocks testing.
 *   2. Mints a VALID signed `fam_sess` session cookie for that account, using
 *      the exact same scheme cookie-session uses (Keygrip over
 *      `fam_sess=<base64 json>`).
 *
 * It is safe because it only works under the INSECURE local-dev cookie secret:
 * production sets a real SESSION_SECRET (and NODE_ENV=production), under which
 * this script refuses to run. No new code touches the live server.
 *
 *   Usage:
 *     node scripts/dev-login.js            # ensure account + print cookie
 *     node scripts/dev-login.js --reset    # also re-seed the demo family
 *     node scripts/dev-login.js --json     # machine-readable output
 *
 * After running, RESTART your local dev server (it caches the datastore in
 * memory and won't see a newly-created user until it reloads).
 */
require("../lib/loadenv").load();

const fs = require("fs");
const path = require("path");
const Keygrip = require("keygrip");
const db = require("../lib/db");
const store = require("../lib/store");
const family = require("../lib/family");
const { DATA_DIR } = require("../lib/paths");

// Mirror server.js: a real SESSION_SECRET (or NODE_ENV=production) means this is
// NOT a local dev box — refuse, so a forged cookie can never be minted in prod.
const SESSION_SECRET = process.env.SESSION_SECRET;
if (process.env.NODE_ENV === "production" || SESSION_SECRET) {
  console.error(
    "[dev-login] Refusing to run: this looks like production (SESSION_SECRET set " +
    "or NODE_ENV=production). This tool is for local dev only."
  );
  process.exit(1);
}
const COOKIE_SECRET = SESSION_SECRET || "fametc-dev-secret-change-me"; // server.js dev default
const COOKIE_NAME = "fam_sess"; // server.js cookieSession({ name: ... })

const DEV_EMAIL = "dev@fametc.local";
const DEV_NAME = "Dev Parent";
const args = process.argv.slice(2);
const RESET = args.includes("--reset");
const JSON_OUT = args.includes("--json");

function findDevUser() {
  const root = db.load();
  for (const u of Object.values(root.users || {})) {
    if (store.normEmail(u.email) === DEV_EMAIL) return u;
  }
  return null;
}

function ensureDevUser() {
  let user = findDevUser();
  if (!user) {
    user = store.createUser(DEV_EMAIL, DEV_NAME);
  }
  // Always keep it grandfathered (permanent free access) so billing never blocks tests.
  user.billing = { status: "grandfathered", since: user.createdAt || new Date().toISOString(), source: "dev" };
  store.saveUser(user);
  return user;
}

function ensureDevFamily(userId) {
  let fams = family.familiesForUser(userId);
  let fam = fams[0] || family.createFamily(userId, "The Dev Family");
  if (RESET) fam.kids = [];
  if (!fam.kids.length) {
    family.addKid(fam.id, userId, { name: "Alex", grade: "8" });
    family.addKid(fam.id, userId, { name: "Sam", grade: "5" });
  }
  return family.getFamily(fam.id);
}

// Build the cookie pair exactly as cookie-session + cookies/keygrip would.
function mintCookies(userId) {
  const payload = JSON.stringify({ uid: userId });
  const value = Buffer.from(payload).toString("base64");
  const kg = new Keygrip([COOKIE_SECRET]);
  const sig = kg.sign(`${COOKIE_NAME}=${value}`);
  return {
    name: COOKIE_NAME,
    value,
    sigName: `${COOKIE_NAME}.sig`,
    sig,
    header: `${COOKIE_NAME}=${value}; ${COOKIE_NAME}.sig=${sig}`,
  };
}

const user = ensureDevUser();
const fam = ensureDevFamily(user.id);
db.flushSync();
const c = mintCookies(user.id);

// Persist the cookie header to the (gitignored, out-of-tree) data dir for reuse.
const cookieFile = path.join(DATA_DIR, "dev-session.cookie");
try { fs.writeFileSync(cookieFile, c.header + "\n", { mode: 0o600 }); } catch (e) { /* non-fatal */ }

if (JSON_OUT) {
  console.log(JSON.stringify({
    userId: user.id, email: user.email, familyId: fam.id, inviteCode: fam.inviteCode,
    kids: fam.kids, cookieHeader: c.header, cookieFile,
  }, null, 2));
} else {
  const port = process.env.PORT || 4000;
  console.log("Dev parent account ready");
  console.log(`   email:      ${user.email}`);
  console.log(`   userId:     ${user.id}`);
  console.log(`   family:     ${fam.name} (invite code ${fam.inviteCode})`);
  console.log(`   kids:       ${fam.kids.map((k) => k.name).join(", ")}`);
  console.log("");
  console.log("Session cookie (valid under the local dev secret):");
  console.log(`   ${c.header}`);
  console.log("");
  console.log(`   saved to: ${cookieFile}`);
  console.log("");
  console.log("Restart your local dev server first (it caches the datastore in memory).");
  console.log("");
  console.log("   curl example:");
  console.log(`     curl -s -b "$(cat ${cookieFile})" http://localhost:${port}/api/me | head`);
}
