"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-school-actions-"));

const db = require("../lib/db");
const store = require("../lib/store");
const family = require("../lib/family");
const actions = require("../lib/actions");
const calendarRoutes = require("../lib/routes/calendar");
const actionRoutes = require("../lib/routes/actions");

function userRole(user) {
  return (user && user.data && user.data.profile && user.data.profile.role) || "parent";
}

function makeFamily(label) {
  const parent = store.createUser(`${label}-${Math.random()}@example.com`, `Parent ${label}`);
  const fam = family.createFamily(parent.id, `${label} Family`);
  const { kid } = family.addKid(fam.id, parent.id, { name: `${label} Kid`, grade: "9" });
  return { fam, parent, kid };
}

function makeResponse() {
  return { statusCode: 200, body: null, headers: {}, set(name, value) { this.headers[name] = value; return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

function buildHarness(syncFamily) {
  const routes = {};
  const register = (method) => (route, ...handlers) => { routes[`${method} ${route}`] = handlers[handlers.length - 1]; };
  const app = { get: register("GET"), post: register("POST"), patch: register("PATCH"), delete: register("DELETE") };
  const pass = (req, res, next) => next();
  calendarRoutes(app, { schoolFeeds: { syncFamily }, homework: { removeBySource() {} }, actions, events: {}, chat: { sendMessage() {} }, trips: { allTrips: () => [] }, meals: { getState: () => ({ prefs: {}, menu: [] }) }, requireAuth: pass, requireParent: pass, requireFamily: pass, userRole, kidIdForUser: (req) => req.user?.data?.kid?.kidId, friendlyDate: (date) => date });
  actionRoutes(app, { actions, analytics: null, requireAuth: pass, requireParent: pass, requireFamily: pass, userRole, kidIdForUser: (req) => req.user?.data?.kid?.kidId });
  return routes;
}

async function call(handler, { user, fam, body, params } = {}) {
  const req = { user: user || { id: "u_test", data: {} }, family: fam, body: body || {}, params: params || {}, query: {} };
  const res = makeResponse();
  await handler(req, res);
  return res;
}

function deadlineEvent(kidId, overrides = {}) {
  return Object.assign({ uid: "uid-1", subscriptionId: "sub-1", title: "Submit IA", start: "2026-08-12T09:05:00Z", allDay: false, isDeadline: true, type: "deadline", kidId }, overrides);
}

test("calendar sync projects a throttled public-feed deadline into one kid action", async () => {
  const { fam, parent, kid } = makeFamily("create");
  const event = deadlineEvent(kid.id, { title: "x".repeat(260) });
  const routes = buildHarness(async () => ({ events: [event], throttled: true, errors: [] }));
  const response = await call(routes["POST /api/calendar/sync"], { user: parent, fam });
  assert.equal(response.statusCode, 200);
  const list = actions.listActions(fam.id);
  assert.equal(list.length, 1);
  assert.equal(list[0].title, "x".repeat(actions.MAX_TITLE_LENGTH));
  assert.equal(list[0].dueDate, "2026-08-12");
  assert.equal(list[0].dueTime, "09:05");
  assert.equal(list[0].assigneeType, "kid");
  assert.equal(list[0].assigneeId, kid.id);
  assert.equal(list[0].kidId, kid.id);
  assert.equal(list[0].sourceType, "school");
  assert.equal(list[0].sourceId, "sub-1::uid-1");
  assert.equal(list[0].createdBy, null);
});

test("re-sync updates only source-owned fields and preserves family edits and lifecycle", () => {
  const { fam, parent, kid } = makeFamily("resync");
  const first = deadlineEvent(kid.id);
  assert.deepEqual(actions.projectSchoolDeadlines(fam.id, [first]), { created: 1, updated: 0, skipped: 0, dismissed: 0 });
  const original = actions.listActions(fam.id)[0];
  const edited = actions.updateAction(fam.id, original.id, { status: "snoozed", snoozedUntil: "2026-08-20T09:00:00Z", notes: "Parent note", assigneeType: "parent", assigneeId: parent.id }).action;
  const createdAt = edited.createdAt;
  const second = deadlineEvent(kid.id, { title: "Updated feed title", start: "2026-08-13T14:20:00Z" });
  assert.deepEqual(actions.projectSchoolDeadlines(fam.id, [second]), { created: 0, updated: 1, skipped: 0, dismissed: 0 });
  const refreshed = actions.getAction(fam.id, original.id);
  assert.equal(refreshed.title, "Updated feed title"); assert.equal(refreshed.dueDate, "2026-08-13"); assert.equal(refreshed.dueTime, "14:20");
  assert.equal(refreshed.status, "snoozed"); assert.equal(refreshed.snoozedUntil, "2026-08-20T09:00:00.000Z"); assert.equal(refreshed.notes, "Parent note");
  assert.equal(refreshed.assigneeType, "parent"); assert.equal(refreshed.assigneeId, parent.id); assert.equal(refreshed.kidId, null); assert.equal(refreshed.createdAt, createdAt);
  actions.updateAction(fam.id, original.id, { status: "done" });
  actions.projectSchoolDeadlines(fam.id, [deadlineEvent(kid.id, { title: "Final feed title", start: "2026-08-14T08:00:00Z" })]);
  const completed = actions.getAction(fam.id, original.id);
  assert.equal(completed.status, "done"); assert.equal(completed.snoozedUntil, null); assert.equal(completed.notes, "Parent note"); assert.equal(completed.assigneeId, parent.id);
});

test("same UID on distinct subscriptions creates distinct school actions", () => {
  const { fam, kid } = makeFamily("subscriptions");
  const sameUid = [deadlineEvent(kid.id, { subscriptionId: "sub-a", uid: "same-uid", title: "Feed A" }), deadlineEvent(kid.id, { subscriptionId: "sub-b", uid: "same-uid", title: "Feed B" })];
  const result = actions.projectSchoolDeadlines(fam.id, sameUid);
  assert.equal(result.created, 2); assert.equal(actions.listActions(fam.id).length, 2); assert.deepEqual(actions.listActions(fam.id).map((action) => action.sourceId).sort(), ["sub-a::same-uid", "sub-b::same-uid"]);
});

test("non-deadline, foreign-kid, missing-identity, and invalid date/time events are skipped", () => {
  const { fam, kid } = makeFamily("boundaries");
  const base = deadlineEvent(kid.id);
  const invalid = [Object.assign({}, base, { isDeadline: false, type: "event" }), Object.assign({}, base, { kidId: "kid-foreign" }), Object.assign({}, base, { uid: "" }), Object.assign({}, base, { subscriptionId: "" }), Object.assign({}, base, { title: "" }), Object.assign({}, base, { start: "2026-02-30T09:00:00Z" }), Object.assign({}, base, { start: "2026-08-12T24:00:00Z" }), Object.assign({}, base, { allDay: true, start: "2026-02-30" }), Object.assign({}, base, { allDay: true, start: "" })];
  const result = actions.projectSchoolDeadlines(fam.id, invalid);
  assert.equal(result.created, 0); assert.equal(actions.listActions(fam.id).length, 0);
});

test("parent deletion persists a source dismissal across later sync projection", async () => {
  const { fam, parent, kid } = makeFamily("dismissal");
  const event = deadlineEvent(kid.id, { subscriptionId: "sub-dismiss", uid: "uid-dismiss" });
  actions.projectSchoolDeadlines(fam.id, [event]); const action = actions.listActions(fam.id)[0];
  const routes = buildHarness(async () => ({ events: [event], throttled: true, errors: [] }));
  const deleted = await call(routes["DELETE /api/family/actions/:id"], { user: parent, fam, params: { id: action.id } });
  assert.equal(deleted.statusCode, 200); assert.deepEqual(actions.listActions(fam.id), []);
  assert.deepEqual(actions.projectSchoolDeadlines(fam.id, [event]), { created: 0, updated: 0, skipped: 0, dismissed: 1 }); assert.deepEqual(actions.listActions(fam.id), []);
  db.flushSync(); const disk = JSON.parse(fs.readFileSync(db.DB_FILE, "utf8")); assert.deepEqual(disk.actionDismissals[fam.id], ["sub-dismiss::uid-dismiss"]);
});

test("failed calendar sync does not mutate existing school actions", async () => {
  const { fam, parent, kid } = makeFamily("failed"); const event = deadlineEvent(kid.id); actions.projectSchoolDeadlines(fam.id, [event]); const before = JSON.stringify(actions.listActions(fam.id));
  const routes = buildHarness(async () => { throw new Error("feed unavailable"); });
  const response = await call(routes["POST /api/calendar/sync"], { user: parent, fam });
  assert.equal(response.statusCode, 502); assert.equal(JSON.stringify(actions.listActions(fam.id)), before);
});
