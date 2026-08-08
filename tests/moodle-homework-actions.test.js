"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-moodle-actions-"));

const store = require("../lib/store");
const family = require("../lib/family");
const homework = require("../lib/homework");
const actions = require("../lib/actions");
const schoolRoutes = require("../lib/routes/school");
const homeworkRoutes = require("../lib/routes/homework");

function makeFamily(label) {
  const parent = store.createUser(`${label}-${Math.random()}@example.com`, `Parent ${label}`);
  const fam = family.createFamily(parent.id, `${label} Family`);
  const { kid } = family.addKid(fam.id, parent.id, { name: `${label} Kid`, grade: "9" });
  return { parent, fam, kid };
}

function registerRoutes(register) {
  const routes = {};
  const app = {
    get: (route, ...handlers) => register(routes, "GET", route, handlers),
    post: (route, ...handlers) => register(routes, "POST", route, handlers),
    patch: (route, ...handlers) => register(routes, "PATCH", route, handlers),
    delete: (route, ...handlers) => register(routes, "DELETE", route, handlers),
  };
  return { app, routes };
}

function lastHandler(routes, method, route) {
  return routes[`${method} ${route}`];
}

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function call(handler, { user, fam, body, params } = {}) {
  const req = { user, family: fam, body: body || {}, params: params || {}, query: {} };
  const res = response();
  return Promise.resolve(handler(req, res)).then(() => res);
}

function schoolRoute() {
  const { app, routes } = registerRoutes((table, method, route, handlers) => {
    table[`${method} ${route}`] = handlers[handlers.length - 1];
  });
  const pass = (req, res, next) => next();
  schoolRoutes(app, {
    schoolAccount: {},
    moodleClient: {},
    family,
    homework,
    actions,
    requireAuth: pass,
    requireParent: pass,
    requireFamily: pass,
    authLimiter: pass,
  });
  return lastHandler(routes, "POST", "/api/school/import/confirm");
}

function homeworkRoute() {
  const { app, routes } = registerRoutes((table, method, route, handlers) => {
    table[`${method} ${route}`] = handlers[handlers.length - 1];
  });
  const pass = (req, res, next) => next();
  homeworkRoutes(app, {
    homework,
    actions,
    chat: { sendMessage() {} },
    requireAuth: pass,
    requireFamily: pass,
    userRole: () => "parent",
    kidIdForUser: () => null,
    friendlyDate: (date) => date,
  });
  return lastHandler(routes, "PATCH", "/api/homework/:id");
}

test("Moodle homework projects one kid action and repeated projection is idempotent", () => {
  const { fam, kid } = makeFamily("create");
  const item = homework.addHomework(fam.id, {
    kidId: kid.id,
    title: "Submit final exam reflection",
    dueDate: "2026-08-15",
    dueTime: "09:00",
    source: "school-portal",
  }).homework;

  assert.deepEqual(actions.projectMoodleAssignments(fam.id, [item]), {
    created: 1, updated: 0, skipped: 0, dismissed: 0,
  });
  assert.deepEqual(actions.projectMoodleAssignments(fam.id, [item]), {
    created: 0, updated: 0, skipped: 0, dismissed: 0,
  });

  const projected = actions.listActions(fam.id)[0];
  assert.equal(projected.sourceType, "homework");
  assert.equal(projected.sourceId, item.id);
  assert.equal(projected.title, item.title);
  assert.equal(projected.dueDate, item.dueDate);
  assert.equal(projected.dueTime, item.dueTime);
  assert.equal(projected.assigneeType, "kid");
  assert.equal(projected.assigneeId, kid.id);
  assert.equal(projected.kidId, kid.id);
});

test("Moodle re-sync updates source fields but preserves action edits and lifecycle", () => {
  const { fam, parent, kid } = makeFamily("resync");
  const item = homework.addHomework(fam.id, {
    kidId: kid.id,
    title: "First title",
    dueDate: "2026-08-15",
    source: "school-portal",
  }).homework;
  actions.projectMoodleAssignments(fam.id, [item]);
  const original = actions.listActions(fam.id)[0];
  const edited = actions.updateAction(fam.id, original.id, {
    title: "Parent edit",
    notes: "Keep the printed copy",
    status: "snoozed",
    snoozedUntil: "2026-08-20T09:00:00Z",
    assigneeType: "parent",
    assigneeId: parent.id,
  }).action;

  const changed = Object.assign({}, item, {
    title: "Updated Moodle title",
    dueDate: "2026-08-16",
    dueTime: "14:20",
  });
  assert.deepEqual(actions.projectMoodleAssignments(fam.id, [changed]), {
    created: 0, updated: 1, skipped: 0, dismissed: 0,
  });

  const refreshed = actions.getAction(fam.id, edited.id);
  assert.equal(refreshed.title, "Updated Moodle title");
  assert.equal(refreshed.dueDate, "2026-08-16");
  assert.equal(refreshed.dueTime, "14:20");
  assert.equal(refreshed.notes, "Keep the printed copy");
  assert.equal(refreshed.status, "snoozed");
  assert.equal(refreshed.snoozedUntil, "2026-08-20T09:00:00.000Z");
  assert.equal(refreshed.assigneeType, "parent");
  assert.equal(refreshed.assigneeId, parent.id);
});

test("Moodle projection is family-scoped and rejects foreign or non-Moodle homework", () => {
  const first = makeFamily("first");
  const second = makeFamily("second");
  const foreign = homework.addHomework(second.fam.id, {
    kidId: second.kid.id,
    title: "Foreign assignment",
    dueDate: "2026-08-15",
    source: "school-portal",
  }).homework;
  const manual = homework.addHomework(first.fam.id, {
    kidId: first.kid.id,
    title: "Manual assignment",
    dueDate: "2026-08-15",
    source: "manual",
  }).homework;

  assert.deepEqual(actions.projectMoodleAssignments(first.fam.id, [foreign, manual]), {
    created: 0, updated: 0, skipped: 2, dismissed: 0,
  });
  assert.equal(actions.listActions(first.fam.id).length, 0);

  assert.deepEqual(actions.projectMoodleAssignments(second.fam.id, [foreign]), {
    created: 1, updated: 0, skipped: 0, dismissed: 0,
  });
  assert.equal(actions.listActions(first.fam.id).length, 0);
});

test("school import confirm creates one canonical homework action across repeated confirms", async () => {
  const { fam, parent, kid } = makeFamily("confirm");
  const confirm = schoolRoute();
  const payload = {
    kidId: kid.id,
    homework: [{ title: "Algebra worksheet", subject: "Math", dueDate: "2026-08-20", completed: false }],
    timetable: [],
  };

  const first = await call(confirm, { user: parent, fam, body: payload });
  const second = await call(confirm, { user: parent, fam, body: payload });
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.homeworkCreated, 1);
  assert.equal(second.body.homeworkCreated, 0);
  assert.equal(actions.listActions(fam.id).length, 1);
  const item = homework.listForFamily(fam.id)[0];
  const action = actions.listActions(fam.id)[0];
  assert.equal(action.sourceType, "homework");
  assert.equal(action.sourceId, item.id);
  assert.equal(action.kidId, kid.id);
});

test("completing canonical Moodle homework completes its linked Today action", async () => {
  const { fam, parent, kid } = makeFamily("complete");
  const item = homework.addHomework(fam.id, {
    kidId: kid.id,
    title: "Read chapter",
    dueDate: "2026-08-22",
    source: "school-portal",
  }).homework;
  actions.projectMoodleAssignments(fam.id, [item]);
  const update = homeworkRoute();

  const result = await call(update, {
    user: parent,
    fam,
    params: { id: item.id },
    body: { status: "done" },
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.homework.status, "done");
  assert.equal(actions.getBySource(fam.id, "homework", item.id).status, "done");
});
