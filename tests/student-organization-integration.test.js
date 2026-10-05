"use strict";

// Exercise the real Express/auth/hub/watch boundary with synthetic family data.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Keygrip = require("keygrip");

const testRoot = path.resolve(__dirname, "../.dev-data");
fs.mkdirSync(testRoot, { recursive: true });
process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(testRoot, "fam-student-http-"));
process.env.PORT = "0";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "student-support-integration-synthetic-session";
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
process.env.RL_API_MAX = "10000";
process.env.RL_AUTH_MAX = "10000";
require("../lib/loadenv").load = () => {};

const store = require("../lib/store");
const family = require("../lib/family");
const homework = require("../lib/homework");
const watchAuth = require("../lib/watch-auth");
const app = require("../server");
let base;
test.before(async () => {
  if (!app.server.listening) await new Promise(resolve => app.server.once("listening", resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
test.after(() => app.server.close());

function session(user) {
  const value = Buffer.from(JSON.stringify({ uid: user.id, authGen: store.sessionGeneration(user) })).toString("base64");
  return `fam_sess=${value}; fam_sess.sig=${new Keygrip([process.env.SESSION_SECRET]).sign(`fam_sess=${value}`)}`;
}
function setup(plan = "full") {
  const parent = store.createUser(`${crypto.randomUUID()}@example.test`, "Parent");
  const fam = family.createFamily(parent.id, "Synthetic school family", { plan, timezone: "Asia/Bangkok" });
  const kid = family.addKid(fam.id, parent.id, { name: "Student" }).kid;
  const sibling = family.addKid(fam.id, parent.id, { name: "Sibling" }).kid;
  const child = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
  const siblingUser = store.findOrCreateKidUser(fam.id, sibling.id, sibling.name);
  return { parent, fam, kid, sibling, child, siblingUser };
}
function watchFor(group, parent = false) {
  const code = watchAuth.createPairing({ familyId: group.fam.id,
    targetUserId: parent ? group.parent.id : group.child.id,
    targetType: parent ? "parent" : "kid", targetKidId: parent ? null : group.kid.id,
    targetName: "Synthetic", createdBy: group.parent.id }).pairing.code;
  return watchAuth.claimPairing(code, "Test Watch").token;
}
async function request(identity, route, body, method) {
  const headers = { "X-Forwarded-Proto": "https" };
  if (typeof identity === "string") headers.Authorization = `Bearer ${identity}`;
  else if (identity) headers.Cookie = session(identity);
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(base + route, { method: method || (body === undefined ? "GET" : "POST"), headers,
    body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  const text = await res.text();
  let bodyValue;
  try { bodyValue = JSON.parse(text); } catch { bodyValue = { text }; }
  return { status: res.status, body: bodyValue, headers: res.headers };
}
const read = (identity, kidId) => request(identity, `/api/student-support?kidId=${kidId}`);
function command(kidId, revision, type, payload) {
  return { kidId, expectedRevision: revision, commandId: crypto.randomUUID(), type, payload };
}
const write = (identity, body) => request(identity, "/api/student-support/commands", body);
function nextDay(day) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

test("parent setup, offline-style Watch retry, and self-reported hand-in preserve canonical homework", async () => {
  const group = setup();
  const initial = await read(group.parent, group.kid.id);
  assert.equal(initial.status, 200);
  assert.equal(initial.body.support.enabled, false);
  assert.equal(initial.headers.get("cache-control"), "no-store");
  const tomorrow = nextDay(initial.body.support.today);
  const task = homework.addHomework(group.fam.id, { kidId: group.kid.id, title: "English worksheet", dueDate: tomorrow }).homework;
  const before = JSON.stringify(task);
  const current = (await read(group.parent, group.kid.id)).body.support;
  const configured = await write(group.parent, command(group.kid.id, current.revision, "configure", {
    enabled: true,
    materialRules: [{ id: "calculator", title: "Calculator", matchKind: "date", matchValue: tomorrow, phase: "evening", location: "home" }],
    routines: [{ id: "dog-walk", title: "Walk the dog", weekdays: [1, 2, 3, 4, 5, 6, 7], time: "17:00", steps: [{ id: "leash", title: "Bring leash and bags" }], active: true }],
  }));
  assert.equal(configured.status, 200, JSON.stringify(configured.body));
  const token = watchFor(group);
  const onWatch = await read(token, group.kid.id);
  assert.equal(onWatch.status, 200);
  assert.equal(onWatch.body.support.packing.date, tomorrow);
  assert.equal(onWatch.body.support.packing.coverage, "manual");
  const item = onWatch.body.support.packing.items.find(row => row.title === "Calculator");
  assert.ok(item);
  const packed = command(group.kid.id, onWatch.body.support.revision, "packing_item", { date: tomorrow, itemId: item.id, status: "packed" });
  const accepted = await write(token, packed);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  const retry = await write(token, packed);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.support.revision, accepted.body.support.revision);
  assert.equal(retry.body.support.packing.items.find(row => row.id === item.id).status, "packed");
  const changedRetry = await write(token, { ...packed, payload: { ...packed.payload, status: "missing" } });
  assert.equal(changedRetry.status, 409);

  const planned = await write(group.child, command(group.kid.id, accepted.body.support.revision, "homework_plan", {
    homeworkId: task.id, nextStep: "Open the worksheet and answer question 1", workFinished: true,
    handInMethod: "teacher", submission: "pending",
  }));
  assert.equal(planned.status, 200, JSON.stringify(planned.body));
  assert.equal(planned.body.support.homeworkPlans.find(row => row.homeworkId === task.id).submission, "pending");
  const submitted = await write(token, command(group.kid.id, planned.body.support.revision, "homework_plan", {
    homeworkId: task.id, submission: "reported",
  }));
  assert.equal(submitted.status, 200);
  assert.ok(submitted.body.support.homeworkPlans.find(row => row.homeworkId === task.id).submittedAt);
  assert.equal(JSON.stringify(homework.getById(group.fam.id, task.id)), before);

  const occurrence = submitted.body.support.occurrences.find(row => row.routineId === "dog-walk");
  assert.ok(occurrence);
  const handoff = await write(token, command(group.kid.id, submitted.body.support.revision, "routine_status", { occurrenceId: occurrence.id, status: "handed_off" }));
  assert.equal(handoff.status, 200);
  assert.equal(handoff.body.support.occurrences.find(row => row.id === occurrence.id).status, "handed_off");
  const stale = await write(group.child, command(group.kid.id, submitted.body.support.revision, "routine_status", { occurrenceId: occurrence.id, status: "done" }));
  assert.equal(stale.status, 409);
});

test("real session and Watch routes reject privilege escalation and isolate sibling data", async () => {
  const group = setup();
  const foreign = setup();
  const token = watchFor(group);
  const parentToken = watchFor(group, true);
  assert.equal((await read(null, group.kid.id)).status, 401);
  assert.equal((await read(parentToken, group.kid.id)).status, 403);
  assert.equal((await read(group.parent, foreign.kid.id)).status, 404);
  const child = await read(group.child, group.sibling.id);
  assert.equal(child.status, 200);
  assert.equal(child.body.support.kidId, group.kid.id);
  assert.doesNotMatch(JSON.stringify(child.body), new RegExp(group.sibling.id));
  const configure = command(group.kid.id, child.body.support.revision, "configure", { enabled: true });
  assert.equal((await write(group.child, configure)).status, 403);
  assert.equal((await write(token, configure)).status, 403);
  const deniedOther = await write(group.siblingUser, configure);
  assert.equal(deniedOther.status, 403);
  const narrow = await request(token, "/api/student-support/admin");
  assert.ok([403, 404].includes(narrow.status));
});

test("Screen Time-only families cannot access either new support endpoint", async () => {
  const group = setup("screen_time");
  for (const identity of [group.parent, group.child, watchFor(group)]) {
    const get = await read(identity, group.kid.id);
    assert.equal(get.status, 403);
    assert.equal(get.body.code, "upgrade_required");
    const post = await write(identity, command(group.kid.id, 0, "configure", { enabled: true }));
    assert.equal(post.status, 403);
    assert.equal(post.body.code, "upgrade_required");
  }
});

test("removing a child clears the new support records and prevents further Watch access", async () => {
  const group = setup();
  const snapshot = (await read(group.parent, group.kid.id)).body.support;
  const enabled = await write(group.parent, command(group.kid.id, snapshot.revision, "configure", { enabled: true }));
  assert.equal(enabled.status, 200);
  const token = watchFor(group);
  assert.equal((await read(token, group.kid.id)).status, 200);
  const removed = await request(group.parent, `/api/family/kids/${group.kid.id}`, {}, "DELETE");
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  const after = await read(token, group.kid.id);
  assert.ok([401, 403, 404].includes(after.status));
  const records = require("../lib/db").load().fam_studentSupport;
  assert.equal(JSON.stringify(records || {}).includes(group.kid.id), false);
});
