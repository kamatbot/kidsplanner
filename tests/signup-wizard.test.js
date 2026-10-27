"use strict";

// Server side of the 3-step /signup wizard: who still gets the page, and the
// family-level School Sync / Family Organizer switch.
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");
const Keygrip = require("keygrip");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-signup-wizard-test-"));
process.env.PORT = "0";
process.env.SESSION_SECRET = "signup-wizard-test-secret-please-change";
process.env.NODE_ENV = "test";
process.env.SIGNUP_INVITE_CODE = "Test-Invite";

const store = require("../lib/store");
const family = require("../lib/family");
const app = require("../server");

const server = app.server;
let base;
test.before(async () => {
  if (!server.listening) await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

let counter = 0;
function newUser(role) {
  counter += 1;
  const user = store.createUser(`wizard${counter}@example.com`, `Parent ${counter}`);
  if (role) user.data.profile.role = role;
  return user;
}

function cookieFor(user) {
  const value = Buffer.from(JSON.stringify({ uid: user.id, authGen: store.sessionGeneration(user) }), "utf8").toString("base64");
  const sig = new Keygrip([process.env.SESSION_SECRET]).sign(`fam_sess=${value}`);
  return `fam_sess=${value}; fam_sess.sig=${sig}`;
}

async function request(user, method, url, body) {
  const headers = { "X-Forwarded-Proto": "https" };
  if (user) headers.Cookie = cookieFor(user);
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
  return { status: res.status, body: json, text, location: res.headers.get("location") };
}

test("/signup serves the wizard to visitors and to a signed-in parent who has no family yet", async () => {
  const visitor = await request(null, "GET", "/signup");
  assert.equal(visitor.status, 200);
  assert.match(visitor.text, /id="onboarding-step-3"/);

  const resumed = await request(newUser(), "GET", "/signup");
  assert.equal(resumed.status, 200);
  assert.match(resumed.text, /id="onboarding-step-3"/);
});

test("/signup redirects a parent who already has a family, and any kid session", async () => {
  const parent = newUser();
  family.createFamily(parent.id, "Done Family");
  const withFamily = await request(parent, "GET", "/signup");
  assert.equal(withFamily.status, 302);
  assert.equal(withFamily.location, "/");

  const kid = newUser("kid");
  const kidRes = await request(kid, "GET", "/signup");
  assert.equal(kidRes.status, 302);
});

test("POST /api/family stores the chosen mode; omitting it keeps School Sync on", async () => {
  const organizer = await request(newUser(), "POST", "/api/family", { name: "Organizer", plan: "screen_time", schoolSync: false });
  assert.equal(organizer.status, 200);
  assert.equal(organizer.body.family.schoolSync, false);

  const legacy = await request(newUser(), "POST", "/api/family", { name: "Legacy", plan: "screen_time" });
  assert.equal(legacy.status, 200);
  assert.equal(legacy.body.family.schoolSync, true);
});

test("PATCH /api/family/school-sync: a parent toggles it, bad input and non-members are refused", async () => {
  const parent = newUser();
  const fam = family.createFamily(parent.id, "Toggle Family", { schoolSync: false });

  const on = await request(parent, "PATCH", "/api/family/school-sync", { schoolSync: true });
  assert.equal(on.status, 200);
  assert.equal(on.body.family.schoolSync, true);
  assert.equal(family.getFamily(fam.id).schoolSync, true);

  const bad = await request(parent, "PATCH", "/api/family/school-sync", { schoolSync: "no" });
  assert.equal(bad.status, 400);
  assert.equal(family.getFamily(fam.id).schoolSync, true);

  const signedOut = await request(null, "PATCH", "/api/family/school-sync", { schoolSync: false });
  assert.equal(signedOut.status, 401);

  const noFamily = await request(newUser(), "PATCH", "/api/family/school-sync", { schoolSync: false });
  assert.notEqual(noFamily.status, 200);
  assert.equal(family.getFamily(fam.id).schoolSync, true);
});
