"use strict";
/*
 * Screen Time-only plan, server side (docs/SCREEN-TIME-ONLY-PLAN.md §10.1):
 * plan model + hub gate, signup/family/upgrade/join, kid setup codes, targeted
 * approval, the no-passkey session, overview `setup`, fams-free more time and
 * the app-only web page. Drives the REAL server over HTTP with signed session
 * cookies (same technique as session-revocation.test.js).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");
const Keygrip = require("keygrip");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-plan-test-"));
process.env.PORT = "0";
process.env.SESSION_SECRET = "screen-time-plan-test-secret-please-change";
process.env.NODE_ENV = "test";
process.env.SIGNUP_INVITE_CODE = "Test-Invite";
// The walk below fires hundreds of requests from one IP.
process.env.RL_API_MAX = "100000";
process.env.RL_AUTH_MAX = "100000";
process.env.RL_SIGNUP_MAX = "100000";
process.env.RL_INVITE_MAX = "100000";
process.env.RL_KID_SETUP_CLAIM_MAX = "100000";

const db = require("../lib/db");
const store = require("../lib/store");
const family = require("../lib/family");
const kidAccess = require("../lib/kid-access");
const analytics = require("../lib/analytics");
const hubGate = require("../lib/hub-gate");
const app = require("../server");

const server = app.server;
let base;
test.before(async () => {
  if (!server.listening) await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

// ---------- helpers ----------
let counter = 0;
const uniq = (label) => `${label}${++counter}`;

function cookieFor(user) {
  const value = Buffer.from(JSON.stringify({ uid: user.id, authGen: store.sessionGeneration(user) }), "utf8").toString("base64");
  const sig = new Keygrip([process.env.SESSION_SECRET]).sign(`fam_sess=${value}`);
  return `fam_sess=${value}; fam_sess.sig=${sig}`;
}

async function api(user, method, url, body, extraHeaders = {}) {
  // SESSION_SECRET makes the server treat itself as production (Secure cookies),
  // so present as the TLS-terminating proxy would.
  const headers = { "X-Forwarded-Proto": "https", ...extraHeaders };
  if (user) headers.Cookie = typeof user === "string" ? user : cookieFor(user);
  if (method !== "GET") headers["Content-Type"] = "application/json";
  const res = await fetch(base + url, {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify(body === undefined ? {} : body),
    redirect: "manual",
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* not json */ }
  return { status: res.status, body: json, text, res };
}

// Cookie header (name=value pairs) built from a response's Set-Cookie headers.
function cookieFromResponse(res) {
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

function newParent({ invited = false, name = "Parent" } = {}) {
  const user = store.createUser(`${uniq("p")}@example.com`, name, invited ? { inviteValidatedAt: new Date().toISOString() } : {});
  return user;
}
function familyFor(plan, opts = {}) {
  const parent = newParent();
  const fam = family.createFamily(parent.id, uniq("Fam"), { plan, timezone: opts.timezone });
  const kid = family.addKid(fam.id, parent.id, { name: "Mia" }).kid;
  return { parent, fam, kid };
}

// ===================== plan model =====================

test("a stored family without `plan` is the full plan; publicFamily exposes plan, features, timezone", () => {
  const parent = newParent();
  const fam = family.createFamily(parent.id, "Legacy");
  delete fam.plan; // exactly what every pre-plan stored family looks like
  assert.equal(family.planOf(fam), "full");
  assert.equal(family.isFull(fam), true);
  const pub = family.publicFamily(fam);
  assert.equal(pub.plan, "full");
  assert.deepEqual(pub.features, ["screen_time", "hub"]);
  assert.equal(pub.timezone, null);

  const st = family.createFamily(newParent().id, "ST", { plan: "screen_time", timezone: "Europe/London" });
  const stPub = family.publicFamily(st);
  assert.equal(stPub.plan, "screen_time");
  assert.deepEqual(stPub.features, ["screen_time"]);
  assert.equal(stPub.timezone, "Europe/London");
});

test("createFamily ignores an invalid IANA timezone and canonicalises a valid one", () => {
  const bad = family.createFamily(newParent().id, "Bad", { timezone: "Mars/Olympus" });
  assert.equal(bad.timezone, undefined);
  const odd = family.createFamily(newParent().id, "Odd", { timezone: "asia/bangkok" });
  assert.equal(odd.timezone, "Asia/Bangkok");
});

test("a legacy (plan-less) family keeps every hub route and reports plan=full over HTTP", async () => {
  const { parent, fam } = familyFor("full");
  delete fam.plan;
  const list = await api(parent, "GET", "/api/family");
  assert.equal(list.status, 200);
  assert.equal(list.body.families[0].plan, "full");
  assert.deepEqual(list.body.families[0].features, ["screen_time", "hub"]);
  const hub = await api(parent, "GET", "/api/chat/rooms");
  assert.notEqual(hub.body && hub.body.code, "upgrade_required");
  assert.equal(hub.status, 200);
});

// ===================== signup =====================

function decodeSession(res) {
  const raw = res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith("fam_sess="));
  if (!raw) return null;
  return JSON.parse(Buffer.from(raw.slice("fam_sess=".length), "base64").toString("utf8"));
}

test("signup/options: no code is allowed, a wrong code is 403 invite_invalid, a valid code is remembered", async () => {
  const none = await api(null, "POST", "/api/webauthn/signup/options", { name: "Pat" });
  assert.equal(none.status, 200);
  assert.ok(none.body.challenge);
  assert.equal(decodeSession(none.res).waSignup.inviteValidated, false);

  const blank = await api(null, "POST", "/api/webauthn/signup/options", { name: "Pat", inviteCode: "  " });
  assert.equal(blank.status, 200);

  const wrong = await api(null, "POST", "/api/webauthn/signup/options", { name: "Pat", inviteCode: "nope" });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.body.code, "invite_invalid");
  assert.ok(wrong.body.error);

  const ok = await api(null, "POST", "/api/webauthn/signup/options", { name: "Pat", inviteCode: " test-INVITE " });
  assert.equal(ok.status, 200);
  const pending = decodeSession(ok.res).waSignup;
  assert.equal(pending.inviteValidated, true);
  assert.equal("inviteCode" in pending, false, "the code itself is never stored in the session");
});

// ===================== create family =====================

test("POST /api/family: screen_time is always allowed, full needs a valid code or a signup-validated user", async () => {
  // screen_time, no code
  const a = newParent();
  const created = await api(a, "POST", "/api/family", { name: "The Ats", plan: "screen_time", timezone: "Asia/Bangkok" });
  assert.equal(created.status, 200);
  assert.equal(created.body.family.plan, "screen_time");
  assert.deepEqual(created.body.family.features, ["screen_time"]);
  assert.equal(created.body.family.timezone, "Asia/Bangkok");

  // already in a family
  assert.equal((await api(a, "POST", "/api/family", { name: "Again" })).status, 409);

  // full without a code: refused and NOTHING created
  const b = newParent();
  const refused = await api(b, "POST", "/api/family", { name: "Nope", plan: "full" });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.code, "invite_required");
  assert.equal(family.familiesForUser(b.id).length, 0);
  const wrongCode = await api(b, "POST", "/api/family", { name: "Nope", plan: "full", inviteCode: "wrong" });
  assert.equal(wrongCode.status, 403);
  assert.equal(wrongCode.body.code, "invite_required");
  assert.equal(family.familiesForUser(b.id).length, 0);

  // full with a valid code in the body
  const full = await api(b, "POST", "/api/family", { name: "Yes", plan: "full", inviteCode: "TEST-invite" });
  assert.equal(full.status, 200);
  assert.equal(full.body.family.plan, "full");
  assert.deepEqual(full.body.family.features, ["screen_time", "hub"]);

  // full via the invite validated at signup (no code in the body)
  const c = newParent({ invited: true });
  const viaSignup = await api(c, "POST", "/api/family", { name: "Signup", plan: "full" });
  assert.equal(viaSignup.status, 200);
  assert.equal(viaSignup.body.family.plan, "full");

  // invalid plan value
  const d = newParent();
  const badPlan = await api(d, "POST", "/api/family", { name: "X", plan: "gold" });
  assert.equal(badPlan.status, 400);
  assert.equal(family.familiesForUser(d.id).length, 0);
});

test("POST /api/family with plan omitted: old app builds get full only if the signup invite was validated", async () => {
  const invited = newParent({ invited: true });
  const old = await api(invited, "POST", "/api/family", { name: "Old build" });
  assert.equal(old.status, 200);
  assert.equal(old.body.family.plan, "full");

  const open = newParent();
  const fresh = await api(open, "POST", "/api/family", { name: "No invite" });
  assert.equal(fresh.status, 200);
  assert.equal(fresh.body.family.plan, "screen_time");
  assert.equal(fresh.body.family.timezone, null, "invalid/missing timezone is simply unset");

  const badTz = newParent();
  const ignored = await api(badTz, "POST", "/api/family", { name: "Tz", plan: "screen_time", timezone: "Not/AZone" });
  assert.equal(ignored.status, 200);
  assert.equal(ignored.body.family.timezone, null);
});

test("family creation and upgrade bump the aggregate plan counters", async () => {
  const before = analytics.summary(1).events;
  const n = (e, k) => (e[k] || 0);
  await api(newParent(), "POST", "/api/family", { name: "A", plan: "screen_time" });
  const { parent } = familyFor("screen_time");
  await api(parent, "POST", "/api/family/upgrade", { inviteCode: "test-invite" });
  await api(newParent({ invited: true }), "POST", "/api/family", { name: "B", plan: "full" });
  const after = analytics.summary(1).events;
  assert.equal(n(after, "family_created_screen_time"), n(before, "family_created_screen_time") + 1);
  assert.equal(n(after, "family_created_full"), n(before, "family_created_full") + 1);
  assert.equal(n(after, "family_upgraded"), n(before, "family_upgraded") + 1);
  // These are server-only counters: the public beacon must never accept them.
  assert.equal(analytics.ALLOWED_EVENTS.has("family_upgraded"), false);
  assert.equal(analytics.recordEvent("family_upgraded"), false);
});

// ===================== upgrade + join =====================

test("POST /api/family/upgrade: parent only, bad code 403, good code flips the whole family, idempotent", async () => {
  const { parent, fam, kid } = familyFor("screen_time");
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, "Mia");

  assert.equal((await api(null, "POST", "/api/family/upgrade", { inviteCode: "test-invite" })).status, 401);
  assert.equal((await api(kidUser, "POST", "/api/family/upgrade", { inviteCode: "test-invite" })).status, 403);

  const missing = await api(parent, "POST", "/api/family/upgrade", {});
  assert.equal(missing.status, 403);
  assert.equal(missing.body.code, "invite_invalid");
  const bad = await api(parent, "POST", "/api/family/upgrade", { inviteCode: "wrong" });
  assert.equal(bad.status, 403);
  assert.equal(bad.body.code, "invite_invalid");
  assert.equal(family.planOf(family.getFamily(fam.id)), "screen_time");
  assert.equal((await api(parent, "GET", "/api/chat/rooms")).body.code, "upgrade_required");

  const ok = await api(parent, "POST", "/api/family/upgrade", { inviteCode: " TEST-INVITE " });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.family.plan, "full");
  assert.deepEqual(ok.body.family.features, ["screen_time", "hub"]);
  assert.equal(family.planOf(family.getFamily(fam.id)), "full");

  // The whole family flips: the kid reaches hub routes with no new login...
  assert.notEqual((await api(kidUser, "GET", "/api/chat/rooms")).body && (await api(kidUser, "GET", "/api/chat/rooms")).body.code, "upgrade_required");
  // ...and the parent's gate opens immediately.
  assert.equal((await api(parent, "GET", "/api/chat/rooms")).status, 200);

  // Idempotent (even without re-sending a code once the family is already full).
  const again = await api(parent, "POST", "/api/family/upgrade", { inviteCode: "test-invite" });
  assert.equal(again.status, 200);
  assert.equal(again.body.family.plan, "full");
  assert.equal((await api(parent, "POST", "/api/family/upgrade", {})).status, 200);
  // Screen Time data is untouched by the upgrade.
  assert.equal((await api(parent, "GET", "/api/screen-time")).body.kids.length, 1);
});

test("POST /api/family/join: the joiner inherits the family plan and needs no signup invite", async () => {
  const { parent, fam } = familyFor("screen_time");
  const partner = newParent(); // no invite validated
  const joined = await api(partner, "POST", "/api/family/join", { code: fam.inviteCode });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.family.id, fam.id);
  assert.equal(joined.body.family.plan, "screen_time");
  assert.equal((await api(partner, "GET", "/api/chat/rooms")).body.code, "upgrade_required");
  assert.equal((await api(partner, "GET", "/api/screen-time")).status, 200);

  const full = familyFor("full");
  const partner2 = newParent();
  const joinedFull = await api(partner2, "POST", "/api/family/join", { code: full.fam.inviteCode });
  assert.equal(joinedFull.status, 200);
  assert.equal(joinedFull.body.family.plan, "full");
  assert.equal((await api(partner2, "GET", "/api/chat/rooms")).status, 200);
  void parent;
});

// ===================== the gate =====================

const matches = (prefix, p) => p === prefix || p.startsWith(prefix + "/");
function classify(p) {
  if (hubGate.HUB_PREFIXES.some((x) => matches(x, p))) return "hub";
  if (hubGate.OPEN_PREFIXES.some((x) => matches(x, p))) return "open";
  return "unclassified";
}
function registeredApiRoutes() {
  const out = [];
  for (const layer of app._router.stack) {
    if (!layer.route) continue;
    for (const p of [].concat(layer.route.path)) {
      if (typeof p !== "string" || !p.startsWith("/api")) continue;
      for (const method of Object.keys(layer.route.methods)) out.push({ method: method.toUpperCase(), pattern: p });
    }
  }
  return out;
}
const concrete = (pattern) => pattern.replace(/:[A-Za-z0-9_]+/g, "x");

test("gate: every registered /api route is classified hub or open (a new route cannot slip through)", () => {
  const routes = registeredApiRoutes();
  assert.ok(routes.length > 150, "route inventory looks complete");
  const unclassified = routes.filter((r) => classify(r.pattern) === "unclassified").map((r) => `${r.method} ${r.pattern}`);
  assert.deepEqual(unclassified, [], "classify new routes in lib/hub-gate.js HUB_PREFIXES or OPEN_PREFIXES");
  // The contract's hub list is fully represented.
  for (const prefix of ["chat", "gifs", "hermes", "operator", "calendar", "homework", "school", "meals", "trips", "activities",
    "goals", "news", "notes", "wordbank", "brainteaser", "enrichment", "children", "daily5", "my-corner", "ai", "watch", "fams"]) {
    assert.ok(hubGate.HUB_PREFIXES.includes(`/api/${prefix}`), prefix);
  }
  assert.ok(hubGate.HUB_PREFIXES.includes("/api/family/actions") && hubGate.HUB_PREFIXES.includes("/api/family/decisions"));
});

test("gate: a Screen Time family is refused 403 upgrade_required on EVERY hub route, parent and kid", async () => {
  const { parent, fam, kid } = familyFor("screen_time");
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, "Mia");
  const hubRoutes = registeredApiRoutes().filter((r) => classify(r.pattern) === "hub");
  assert.ok(hubRoutes.length > 100);
  for (const { method, pattern } of hubRoutes) {
    for (const [who, user] of [["parent", parent], ["kid", kidUser]]) {
      const res = await api(user, method, concrete(pattern));
      assert.equal(res.status, 403, `${who} ${method} ${pattern}`);
      assert.deepEqual(res.body, { error: "This is part of the whole Fam ETC.", code: "upgrade_required" }, `${who} ${method} ${pattern}`);
    }
  }
  // Every prefix itself (and a nested path), regardless of registered routes.
  for (const prefix of hubGate.HUB_PREFIXES) {
    for (const url of [prefix, `${prefix}/anything`]) {
      for (const method of ["GET", "POST"]) {
        const res = await api(parent, method, url);
        assert.equal(res.status, 403, `${method} ${url}`);
        assert.equal(res.body.code, "upgrade_required");
      }
    }
  }
});

test("gate: a full family passes every hub prefix (the route's own answer, never upgrade_required)", async () => {
  const { parent } = familyFor("full");
  for (const prefix of hubGate.HUB_PREFIXES) {
    const res = await api(parent, "GET", prefix);
    assert.notEqual(res.body && res.body.code, "upgrade_required", prefix);
  }
  // A plan-less legacy family is identical.
  const legacy = familyFor("full");
  delete legacy.fam.plan;
  for (const prefix of hubGate.HUB_PREFIXES) {
    const res = await api(legacy.parent, "GET", prefix);
    assert.notEqual(res.body && res.body.code, "upgrade_required", prefix);
  }
});

test("gate: anonymous requests and family-less users fall through to the route's own guard", async () => {
  assert.equal((await api(null, "GET", "/api/chat/messages")).status, 401);
  const lonely = newParent();
  const res = await api(lonely, "GET", "/api/chat/messages");
  assert.equal(res.status, 404, "no family yet: same answer as before plans existed");
  assert.notEqual(res.body.code, "upgrade_required");
});

test("gate: the Screen Time plan keeps auth, family, kids, Screen Time, push, billing, /api/me and account routes", async () => {
  const { parent, fam, kid } = familyFor("screen_time");
  for (const url of ["/api/me", "/api/family", "/api/family/access-requests", "/api/screen-time", "/api/webauthn/credentials", "/api/billing/status", "/api/push/vapid-public-key"]) {
    const res = await api(parent, "GET", url);
    assert.notEqual(res.status, 403, url);
    assert.notEqual(res.body && res.body.code, "upgrade_required", url);
    assert.ok(res.status < 500, url);
  }
  const addedKid = await api(parent, "POST", "/api/family/kids", { name: "Leo" });
  assert.equal(addedKid.status, 200);
  assert.equal((await api(parent, "POST", `/api/family/kids/${kid.id}/setup-code`)).status, 200);
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, "Mia");
  assert.equal((await api(kidUser, "GET", "/api/screen-time/mine")).status, 200);
  assert.equal((await api(kidUser, "GET", "/api/family")).status, 200);
  assert.equal((await api(kidUser, "POST", "/api/logout")).status, 200);
});

test("gate: Hermes bridge tokens never work for a Screen Time family", async () => {
  const hermes = require("../lib/hermes");
  const { fam } = familyFor("full");
  const { token } = hermes.connectFamily(fam.id);
  assert.ok(hermes.familyForToken(token), "full family token resolves");
  family.getFamily(fam.id).plan = "screen_time";
  assert.equal(hermes.familyForToken(token), null);
});

test("background school sync skips Screen Time families but still visits full ones", async () => {
  const schoolApi = require("../lib/school-api");
  const st = familyFor("screen_time");
  const full = familyFor("full");
  const legacy = familyFor("full");
  delete legacy.fam.plan;
  const feeds = (db.load().schoolApiFeeds = db.load().schoolApiFeeds || {});
  // A connection with no readable code: when the scheduler visits it, it stamps
  // lastAttemptAt (and pauses). An untouched connection proves a skipped family.
  for (const f of [st, full, legacy]) feeds[f.fam.id] = { connections: { [f.kid.id]: {} } };
  await schoolApi.syncAllDue();
  assert.equal(feeds[st.fam.id].connections[st.kid.id].lastAttemptAt, undefined, "Screen Time family skipped");
  assert.ok(feeds[full.fam.id].connections[full.kid.id].lastAttemptAt, "full family visited");
  assert.ok(feeds[legacy.fam.id].connections[legacy.kid.id].lastAttemptAt, "plan-less legacy family visited");
});

// ===================== kid setup codes =====================

const SETUP_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

test("setup code issue: parent only, kid must belong to the family, 6-char alphabet, 30-minute TTL, hashed at rest", async () => {
  const { parent, fam, kid } = familyFor("screen_time");
  const other = familyFor("screen_time");
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, "Mia");

  assert.equal((await api(null, "POST", `/api/family/kids/${kid.id}/setup-code`)).status, 401);
  assert.equal((await api(kidUser, "POST", `/api/family/kids/${kid.id}/setup-code`)).status, 403);
  assert.equal((await api(parent, "POST", "/api/family/kids/k_missing/setup-code")).status, 404);
  assert.equal((await api(parent, "POST", `/api/family/kids/${other.kid.id}/setup-code`)).status, 404, "another family's kid");

  const before = Date.now();
  const res = await api(parent, "POST", `/api/family/kids/${kid.id}/setup-code`);
  assert.equal(res.status, 200);
  assert.match(res.body.code, SETUP_RE);
  assert.equal(res.body.kidId, kid.id);
  const ttl = Date.parse(res.body.expiresAt) - before;
  assert.ok(ttl > 29 * 60 * 1000 && ttl <= 30 * 60 * 1000 + 5000, `ttl ${ttl}`);
  assert.equal(JSON.stringify(db.load().kidSetupCodes).includes(res.body.code), false, "the plaintext code is never stored");
});

test("setup codes only ever use the unambiguous alphabet", () => {
  const { fam, kid } = familyFor("screen_time");
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    const { code } = kidAccess.issueSetupCode(fam.id, kid.id);
    assert.match(code, SETUP_RE);
    for (const ch of code) seen.add(ch);
  }
  for (const banned of ["0", "O", "1", "I"]) assert.equal(seen.has(banned), false, banned);
  assert.ok(seen.size > 20, "draws from the whole alphabet");
});

test("claim: case-insensitive, ignores spaces and dashes, single use, creates a TARGETED request", async () => {
  const { parent, fam, kid } = familyFor("screen_time");
  const issued = (await api(parent, "POST", `/api/family/kids/${kid.id}/setup-code`)).body;
  const sloppy = ` ${issued.code.slice(0, 3).toLowerCase()}-${issued.code.slice(3).toLowerCase()} `;

  const claim = await api(null, "POST", "/api/kid/setup-code/claim", { code: sloppy, deviceLabel: "Mia's iPad" });
  assert.equal(claim.status, 200);
  assert.deepEqual(Object.keys(claim.body).sort(), ["familyName", "kidName", "pollToken", "requestId"]);
  assert.equal(claim.body.kidName, "Mia");
  assert.equal(claim.body.familyName, fam.name);
  assert.ok(claim.body.pollToken.length >= 24);

  // Single use.
  const again = await api(null, "POST", "/api/kid/setup-code/claim", { code: issued.code });
  assert.equal(again.status, 404);
  assert.equal(again.body.code, "setup_code_invalid");

  // The parent sees one pending request, tied to the kid; the kid sees "pending".
  const pending = (await api(parent, "GET", "/api/family/access-requests")).body.requests;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].name, "Mia");
  assert.equal(pending[0].deviceLabel, "Mia's iPad");
  assert.equal("pollToken" in pending[0], false);
  const status = await api(null, "GET", `/api/kid/access-request/${claim.body.requestId}?token=${claim.body.pollToken}`);
  assert.equal(status.body.status, "pending");
});

test("claim: unknown, malformed, expired and cross-wired codes all answer 404 setup_code_invalid", async () => {
  const { parent, fam, kid } = familyFor("screen_time");
  for (const code of ["", "ABC", "ABCDEFG", "AAAAAA", "!!!!!!", undefined, 123456, { a: 1 }]) {
    const res = await api(null, "POST", "/api/kid/setup-code/claim", { code });
    assert.equal(res.status, 404, JSON.stringify(code));
    assert.equal(res.body.code, "setup_code_invalid");
  }
  const issued = (await api(parent, "POST", `/api/family/kids/${kid.id}/setup-code`)).body;
  // Expire it.
  for (const rec of Object.values(db.load().kidSetupCodes)) {
    if (rec.familyId === fam.id && rec.kidId === kid.id) rec.expiresAt = Date.now() - 1;
  }
  const expired = await api(null, "POST", "/api/kid/setup-code/claim", { code: issued.code });
  assert.equal(expired.status, 404);
  assert.equal(expired.body.code, "setup_code_invalid");
  assert.equal((await api(parent, "GET", "/api/family/access-requests")).body.requests.length, 0);
});

test("a new code for the same kid invalidates the previous one; other kids' codes are independent", async () => {
  const { parent, fam, kid } = familyFor("screen_time");
  const leo = family.addKid(fam.id, parent.id, { name: "Leo" }).kid;
  const first = (await api(parent, "POST", `/api/family/kids/${kid.id}/setup-code`)).body;
  const leoCode = (await api(parent, "POST", `/api/family/kids/${leo.id}/setup-code`)).body;
  const second = (await api(parent, "POST", `/api/family/kids/${kid.id}/setup-code`)).body;
  assert.notEqual(first.code, second.code);

  assert.equal((await api(null, "POST", "/api/kid/setup-code/claim", { code: first.code })).status, 404, "replaced code is dead");
  const ok = await api(null, "POST", "/api/kid/setup-code/claim", { code: second.code });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.kidName, "Mia");
  const leoClaim = await api(null, "POST", "/api/kid/setup-code/claim", { code: leoCode.code });
  assert.equal(leoClaim.status, 200);
  assert.equal(leoClaim.body.kidName, "Leo");
});

test("a removed kid's code stops working", async () => {
  const { parent, fam, kid } = familyFor("screen_time");
  const issued = (await api(parent, "POST", `/api/family/kids/${kid.id}/setup-code`)).body;
  assert.equal((await api(parent, "DELETE", `/api/family/kids/${kid.id}`)).status, 200);
  const res = await api(null, "POST", "/api/kid/setup-code/claim", { code: issued.code });
  assert.equal(res.status, 404);
  assert.equal(family.getFamily(fam.id).kids.length, 0);
});

// ===================== targeted approval =====================

test("approving a targeted request links to the EXISTING kid (no new profile); untargeted requests still create one", async () => {
  const { parent, fam, kid } = familyFor("screen_time");
  const issued = (await api(parent, "POST", `/api/family/kids/${kid.id}/setup-code`)).body;
  const claim = (await api(null, "POST", "/api/kid/setup-code/claim", { code: issued.code })).body;

  const approve = await api(parent, "POST", `/api/family/access-requests/${claim.requestId}/approve`);
  assert.equal(approve.status, 200);
  assert.equal(approve.body.kid.id, kid.id);
  assert.equal(approve.body.family.kids.length, 1, "no second Mia");
  assert.equal(family.getFamily(fam.id).kids.length, 1);

  const status = await api(null, "GET", `/api/kid/access-request/${claim.requestId}?token=${claim.pollToken}`);
  assert.equal(status.body.status, "approved");

  // The existing passkey registration path works against the existing kid.
  const reg = await api(null, "POST", `/api/kid/access-request/${claim.requestId}/register/options`, { token: claim.pollToken });
  assert.equal(reg.status, 200);
  assert.ok(reg.body.challenge);
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, "Mia");
  assert.equal(kidUser.data.kid.kidId, kid.id);

  // Untargeted flow, as today: family code + name -> approve creates a profile.
  const untargeted = await api(null, "POST", "/api/kid/access-request", { inviteCode: fam.inviteCode, name: "Zed", deviceLabel: "iPod" });
  assert.equal(untargeted.status, 200);
  const approved = await api(parent, "POST", `/api/family/access-requests/${untargeted.body.requestId}/approve`);
  assert.equal(approved.status, 200);
  assert.equal(approved.body.kid.name, "Zed");
  assert.notEqual(approved.body.kid.id, kid.id);
  assert.equal(approved.body.family.kids.length, 2);
});

test("a targeted request whose kid was removed cannot be approved into a new profile", async () => {
  const { parent, fam, kid } = familyFor("screen_time");
  const issued = (await api(parent, "POST", `/api/family/kids/${kid.id}/setup-code`)).body;
  const claim = (await api(null, "POST", "/api/kid/setup-code/claim", { code: issued.code })).body;
  family.removeKid(fam.id, parent.id, kid.id);
  const approve = await api(parent, "POST", `/api/family/access-requests/${claim.requestId}/approve`);
  assert.equal(approve.status, 400);
  assert.equal(family.getFamily(fam.id).kids.length, 0);
});

// ===================== no-passkey session =====================

test("POST /api/kid/access-request/:id/session: approved only, once, signs in the same kid user", async () => {
  const { parent, fam, kid } = familyFor("screen_time");
  const issued = (await api(parent, "POST", `/api/family/kids/${kid.id}/setup-code`)).body;
  const claim = (await api(null, "POST", "/api/kid/setup-code/claim", { code: issued.code })).body;
  const url = `/api/kid/access-request/${claim.requestId}/session`;

  // Not approved yet.
  const early = await api(null, "POST", url, { token: claim.pollToken });
  assert.equal(early.status, 400);
  assert.equal(early.body.code, "not_approved");
  // Wrong / missing token never reveals the request.
  assert.equal((await api(null, "POST", url, { token: "nope" })).status, 404);
  assert.equal((await api(null, "POST", url, {})).status, 404);
  assert.equal((await api(null, "POST", "/api/kid/access-request/rq_missing/session", { token: "x" })).status, 404);

  await api(parent, "POST", `/api/family/access-requests/${claim.requestId}/approve`);
  const ok = await api(null, "POST", url, { token: claim.pollToken });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { ok: true });
  const cookie = cookieFromResponse(ok.res);
  assert.match(cookie, /fam_sess=/);

  // The cookie is a real kid session for THAT kid.
  const me = await api(cookie, "GET", "/api/me");
  assert.equal(me.status, 200);
  assert.equal(me.body.user.role, "kid");
  assert.equal(me.body.user.kidId, kid.id);
  assert.equal((await api(cookie, "GET", "/api/screen-time/mine")).status, 200);
  const kidUsers = Object.values(db.load().users).filter((u) => u.data.kid && u.data.kid.kidId === kid.id);
  assert.equal(kidUsers.length, 1, "one kid user, shared with the passkey path");

  // Once only.
  const second = await api(null, "POST", url, { token: claim.pollToken });
  assert.equal(second.status, 409);
  assert.equal(second.body.code, "session_already_issued");
  assert.equal(fam.id, family.getFamily(fam.id).id);
});

test("the no-passkey session also works for an untargeted approved request", async () => {
  const { parent, fam } = familyFor("full");
  const req = (await api(null, "POST", "/api/kid/access-request", { inviteCode: fam.inviteCode, name: "Nia" })).body;
  await api(parent, "POST", `/api/family/access-requests/${req.requestId}/approve`);
  const ok = await api(null, "POST", `/api/kid/access-request/${req.requestId}/session`, { token: req.pollToken });
  assert.equal(ok.status, 200);
  const me = await api(cookieFromResponse(ok.res), "GET", "/api/me");
  assert.equal(me.body.user.name, "Nia");
  assert.equal(me.body.user.role, "kid");
});

test("a denied request cannot mint a session", async () => {
  const { parent, kid } = familyFor("screen_time");
  const issued = (await api(parent, "POST", `/api/family/kids/${kid.id}/setup-code`)).body;
  const claim = (await api(null, "POST", "/api/kid/setup-code/claim", { code: issued.code })).body;
  await api(parent, "POST", `/api/family/access-requests/${claim.requestId}/deny`);
  const res = await api(null, "POST", `/api/kid/access-request/${claim.requestId}/session`, { token: claim.pollToken });
  assert.ok([400, 404].includes(res.status));
});

// ===================== overview setup =====================

test("GET /api/screen-time: each kid carries server-evidenced `setup` through the whole checklist", async () => {
  const { parent, fam, kid } = familyFor("screen_time", { timezone: "UTC" });
  const setup = async () => (await api(parent, "GET", "/api/screen-time")).body.kids.find((k) => k.kidId === kid.id).setup;

  assert.deepEqual(await setup(), { codeActive: false, requestPending: false, signedIn: false, dealSigned: false, devices: 0 });

  const issued = (await api(parent, "POST", `/api/family/kids/${kid.id}/setup-code`)).body;
  assert.deepEqual(await setup(), { codeActive: true, requestPending: false, signedIn: false, dealSigned: false, devices: 0 });

  const claim = (await api(null, "POST", "/api/kid/setup-code/claim", { code: issued.code })).body;
  assert.deepEqual(await setup(), { codeActive: false, requestPending: true, signedIn: false, dealSigned: false, devices: 0 });

  await api(parent, "POST", `/api/family/access-requests/${claim.requestId}/approve`);
  assert.deepEqual(await setup(), { codeActive: false, requestPending: false, signedIn: false, dealSigned: false, devices: 0 });

  // A kid user that exists but has not finished (e.g. mid passkey registration) is NOT signed in.
  await api(null, "POST", `/api/kid/access-request/${claim.requestId}/register/options`, { token: claim.pollToken });
  assert.equal((await setup()).signedIn, false);

  const session = await api(null, "POST", `/api/kid/access-request/${claim.requestId}/session`, { token: claim.pollToken });
  const kidCookie = cookieFromResponse(session.res);
  assert.equal((await setup()).signedIn, true, "completed no-passkey session counts");

  const enroll = await api(kidCookie, "POST", "/api/screen-time/device/enroll", { label: "iPad", mode: "cooperative", authStatus: "approved", pushToken: "ab".repeat(32) });
  assert.equal(enroll.status, 200);
  assert.equal((await setup()).devices, 1);
  assert.equal((await setup()).dealSigned, false);

  const deal = await api(null, "PUT", "/api/screen-time/device/agreement", {
    kidPromises: ["Phone charges outside my room"], parentPromises: ["A heads-up before bedtime"],
    kidStamp: "🦊", parentSigner: "Kate", rules: { bedStart: "21:00", bedEnd: "07:00", school: 120, weekend: 180 },
  }, { Authorization: `FamDevice ${enroll.body.deviceSecret}` });
  assert.equal(deal.status, 200);
  assert.deepEqual(await setup(), { codeActive: false, requestPending: false, signedIn: true, dealSigned: true, devices: 1 });
  void fam;
});

test("a kid with a registered passkey counts as signedIn", async () => {
  const { parent, fam, kid } = familyFor("screen_time");
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, "Mia");
  const read = async () => (await api(parent, "GET", "/api/screen-time")).body.kids[0].setup.signedIn;
  assert.equal(await read(), false);
  store.addCredential(kidUser.id, { id: uniq("cred"), publicKey: "k", counter: 0, transports: [], name: "This device", createdAt: new Date().toISOString() });
  assert.equal(await read(), true);
});

// ===================== fams-free more time =====================

const TOTAL_POLICY = { enabled: true, limits: [{ kind: "total", name: "Screen time", minutesPerDay: 120 }], downtime: [] };
const todayUTC = () => new Date().toISOString().slice(0, 10);

test("more time on the Screen Time plan: no fams check, fams:0 recorded, approval spends nothing", async () => {
  const { parent, fam, kid } = familyFor("screen_time", { timezone: "UTC" });
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, "Mia");
  assert.equal((await api(parent, "PUT", `/api/screen-time/kids/${kid.id}/policy`, TOTAL_POLICY)).status, 200);

  const asked = await api(kidUser, "POST", "/api/screen-time/requests", { minutes: 30, date: todayUTC(), note: "one more level" });
  assert.equal(asked.status, 200, JSON.stringify(asked.body));
  assert.equal(asked.body.request.fams, 0);
  assert.equal(asked.body.request.minutes, 30);
  assert.equal(asked.body.request.status, "pending");

  const approved = await api(parent, "POST", `/api/screen-time/kids/${kid.id}/requests/${asked.body.request.id}/approve`);
  assert.equal(approved.status, 200);
  assert.equal(approved.body.requests[0].status, "approved");
  assert.deepEqual(approved.body.policy.bonus, { date: todayUTC(), minutes: 30 });
  const fams = require("../lib/fams");
  assert.equal(fams.balance(fam.id, kid.id), 0, "no fams were spent (or needed)");

  // Declining works the same and the response shape is unchanged.
  const second = await api(kidUser, "POST", "/api/screen-time/requests", { minutes: 15, date: todayUTC() });
  assert.equal(second.status, 200);
  const declined = await api(parent, "POST", `/api/screen-time/kids/${kid.id}/requests/${second.body.request.id}/decline`);
  assert.equal(declined.body.requests[0].status, "declined");
});

test("more time on the full plan still costs fams (unchanged)", async () => {
  const { parent, fam, kid } = familyFor("full", { timezone: "UTC" });
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, "Mia");
  await api(parent, "PUT", `/api/screen-time/kids/${kid.id}/policy`, TOTAL_POLICY);
  const broke = await api(kidUser, "POST", "/api/screen-time/requests", { minutes: 15, date: todayUTC() });
  assert.equal(broke.status, 409);
  assert.equal(broke.body.error, "Not enough fams.");
});

test("a request made on the Screen Time plan still approves free after the family upgrades", async () => {
  const { parent, fam, kid } = familyFor("screen_time", { timezone: "UTC" });
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, "Mia");
  await api(parent, "PUT", `/api/screen-time/kids/${kid.id}/policy`, TOTAL_POLICY);
  const asked = (await api(kidUser, "POST", "/api/screen-time/requests", { minutes: 15, date: todayUTC() })).body.request;
  await api(parent, "POST", "/api/family/upgrade", { inviteCode: "test-invite" });
  const approved = await api(parent, "POST", `/api/screen-time/kids/${kid.id}/requests/${asked.id}/approve`);
  assert.equal(approved.status, 200);
  assert.equal(approved.body.requests[0].status, "approved");
});

// ===================== invite code, production fail-closed =====================

test("production fails closed: with NODE_ENV=production and no SIGNUP_INVITE_CODE every invite check is 403", async () => {
  const savedEnv = process.env.NODE_ENV;
  const savedCode = process.env.SIGNUP_INVITE_CODE;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.SIGNUP_INVITE_CODE;

    // Even the legacy hardcoded code no longer works.
    const signup = await api(null, "POST", "/api/webauthn/signup/options", { name: "Pat", inviteCode: "fitodds" });
    assert.equal(signup.status, 403);
    assert.equal(signup.body.code, "invite_invalid");
    // No code at all is still fine (Screen Time signup).
    assert.equal((await api(null, "POST", "/api/webauthn/signup/options", { name: "Pat" })).status, 200);

    const parent = newParent();
    const refused = await api(parent, "POST", "/api/family", { name: "Nope", plan: "full", inviteCode: "fitodds" });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.code, "invite_required");
    assert.equal(family.familiesForUser(parent.id).length, 0);

    // Screen Time creation is unaffected, and the upgrade check fails closed too.
    const st = await api(parent, "POST", "/api/family", { name: "Ok", plan: "screen_time" });
    assert.equal(st.status, 200);
    const up = await api(parent, "POST", "/api/family/upgrade", { inviteCode: "fitodds" });
    assert.equal(up.status, 403);
    assert.equal(up.body.code, "invite_invalid");
    assert.equal(family.planOf(family.getFamily(st.body.family.id)), "screen_time");

    // Once configured in production, only that code works.
    process.env.SIGNUP_INVITE_CODE = "Prod-Code";
    assert.equal((await api(parent, "POST", "/api/family/upgrade", { inviteCode: "fitodds" })).status, 403);
    assert.equal((await api(parent, "POST", "/api/family/upgrade", { inviteCode: "prod-code" })).status, 200);
  } finally {
    process.env.NODE_ENV = savedEnv;
    process.env.SIGNUP_INVITE_CODE = savedCode;
  }
});

test("non-production without SIGNUP_INVITE_CODE keeps the dev fallback", () => {
  const inviteCode = require("../lib/invite-code");
  const savedEnv = process.env.NODE_ENV;
  const savedCode = process.env.SIGNUP_INVITE_CODE;
  try {
    process.env.NODE_ENV = "test";
    delete process.env.SIGNUP_INVITE_CODE;
    assert.equal(inviteCode.isValid("fitodds"), true);
    assert.equal(inviteCode.isValid(" FITODDS "), true);
    assert.equal(inviteCode.isValid(""), false);
    assert.equal(inviteCode.isValid(undefined), false);
    assert.equal(inviteCode.isValid({ toString: () => "fitodds" }) , true);
    process.env.NODE_ENV = "production";
    assert.equal(inviteCode.isValid("fitodds"), false);
    assert.equal(inviteCode.configuredCode(), null);
  } finally {
    process.env.NODE_ENV = savedEnv;
    process.env.SIGNUP_INVITE_CODE = savedCode;
  }
});

// ===================== web: app-only page =====================

test("a Screen Time family sees the app-only page on / and /app (and other hub pages); a full family sees the app", async () => {
  const st = familyFor("screen_time");
  const full = familyFor("full");
  const stKid = store.findOrCreateKidUser(st.fam.id, st.kid.id, "Mia");
  const isAppOnly = (text) => /Fam ETC Screen Time lives in the app/.test(text);

  for (const url of ["/", "/app", "/app/anything", "/settings", "/goals", "/activities", "/meals", "/trips", "/finance"]) {
    for (const user of [st.parent, stKid]) {
      const res = await api(user, "GET", url, undefined, { Accept: "text/html" });
      assert.equal(res.status, 200, url);
      assert.ok(isAppOnly(res.text), `app-only page on ${url}`);
      assert.match(res.text, /apps\.apple\.com/);
      assert.match(res.text, /Sign out/);
      assert.match(res.text, /Delete my account/);
      assert.match(res.res.headers.get("cache-control"), /private/);
    }
  }
  for (const url of ["/", "/app", "/settings"]) {
    const res = await api(full.parent, "GET", url, undefined, { Accept: "text/html" });
    assert.equal(res.status, 200, url);
    assert.equal(isAppOnly(res.text), false, `full family keeps the web app on ${url}`);
  }
  // Signed-out visitors still get the marketing page on "/".
  const anon = await api(null, "GET", "/", undefined, { Accept: "text/html" });
  assert.equal(anon.status, 200);
  assert.equal(isAppOnly(anon.text), false);
});

test("the app-only page works end to end: sign out and account deletion use the existing endpoints", async () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "app-only.html"), "utf8");
  assert.match(html, /\/api\/logout/);
  assert.match(html, /\/api\/account/);
  assert.match(html, /<title>[^<:]{2,40}<\/title>/);
  assert.doesNotMatch(html, /<script[^>]+src="https?:/, "no third-party scripts");

  const { parent } = familyFor("screen_time");
  const del = await api(parent, "DELETE", "/api/account");
  assert.equal(del.status, 200);
  assert.equal(store.getUser(parent.id), null);
});
