"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-actions-"));

const db = require("../lib/db");
const store = require("../lib/store");
const family = require("../lib/family");
const actions = require("../lib/actions");
const analytics = require("../lib/analytics");
const actionRoutes = require("../lib/routes/actions");

function userRole(user) {
  return (user && user.data && user.data.profile && user.data.profile.role) || "parent";
}

function kidIdForUser(req) {
  return req.user && req.user.data && req.user.data.kid && req.user.data.kid.kidId;
}

function makeFamily(label) {
  const parent = store.createUser(`${label}-parent@example.com`, `Parent ${label}`);
  const parent2 = store.createUser(`${label}-parent2@example.com`, `Parent Two ${label}`);
  const fam = family.createFamily(parent.id, `${label} Family`);
  family.joinFamilyAsParent(fam.inviteCode, parent2.id);
  const { kid: kidA } = family.addKid(fam.id, parent.id, { name: `${label} Kid A` });
  const { kid: kidB } = family.addKid(fam.id, parent.id, { name: `${label} Kid B` });
  const kidAUser = store.findOrCreateKidUser(fam.id, kidA.id, kidA.name);
  const kidBUser = store.findOrCreateKidUser(fam.id, kidB.id, kidB.name);
  return { fam, parent, parent2, kidA, kidB, kidAUser, kidBUser };
}

function makeResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function buildHarness() {
  const routes = {};
  const register = (method) => (route, ...handlers) => {
    routes[`${method} ${route}`] = handlers;
  };
  const app = {
    get: register("GET"),
    post: register("POST"),
    patch: register("PATCH"),
    delete: register("DELETE"),
  };
  const tracked = [];
  actionRoutes(app, {
    actions,
    analytics: { recordEvent(name) { tracked.push(name); return true; } },
    requireAuth(req, res, next) {
      if (!req.user) return res.status(401).json({ error: "Not authenticated" });
      next();
    },
    requireParent(req, res, next) {
      if (userRole(req.user) === "kid") return res.status(403).json({ error: "Parents only." });
      next();
    },
    requireFamily(req, res, next) {
      const fam = userRole(req.user) === "kid"
        ? family.familyForKidUser(req.user)
        : family.familiesForUser(req.user.id)[0];
      if (!fam) return res.status(404).json({ error: "No family found." });
      req.family = fam;
      next();
    },
    userRole,
    kidIdForUser,
  });
  return { routes, tracked };
}

function call(handlers, { user, body, query, params } = {}) {
  const req = {
    user,
    body: body || {},
    query: query || {},
    params: params || {},
  };
  const res = makeResponse();
  let index = 0;
  const next = () => {
    const handler = handlers[index++];
    if (handler) handler(req, res, next);
  };
  next();
  return res;
}

test("action model: creates a bounded, family-scoped shape and validates references/dates", () => {
  const { fam, parent, kidA } = makeFamily("model-shape");
  const result = actions.createAction(fam.id, {
    title: `  ${"x".repeat(260)}  `,
    notes: "n".repeat(2400),
    dueDate: "2026-02-28",
    dueTime: "09:05",
    assigneeType: "kid",
    assigneeId: kidA.id,
    sourceType: "homework",
    sourceId: "hw_opaque_123",
    createdBy: parent.id,
  });
  assert.ok(!result.error);
  const action = result.action;
  assert.equal(action.familyId, fam.id);
  assert.equal(action.title.length, actions.MAX_TITLE_LENGTH);
  assert.equal(action.notes.length, actions.MAX_NOTES_LENGTH);
  assert.equal(action.status, "open");
  assert.equal(action.assigneeType, "kid");
  assert.equal(action.assigneeId, kidA.id);
  assert.equal(action.kidId, kidA.id);
  assert.equal(action.sourceType, "homework");
  assert.equal(action.sourceId, "hw_opaque_123");
  assert.equal(action.createdBy, parent.id);
  assert.equal(action.snoozedUntil, null);

  assert.ok(actions.createAction(fam.id, { title: "bad", dueDate: "2026-02-30" }).error);
  assert.ok(actions.createAction(fam.id, { title: "bad", dueTime: "24:00" }).error);
  assert.ok(actions.createAction(fam.id, { title: "bad", assigneeType: "kid", assigneeId: "k_foreign" }).error);
  assert.ok(actions.createAction(fam.id, { title: "bad", assigneeType: "parent", assigneeId: "u_foreign" }).error);
  assert.ok(actions.createAction(fam.id, { title: "bad", createdBy: "u_foreign" }).error);
});

test("action model: persists, filters deterministically, and caps list results", () => {
  const { fam, parent, kidA, kidB } = makeFamily("model-list");
  const shared = actions.createAction(fam.id, {
    title: "Shared",
    dueDate: "2026-08-04",
    assigneeType: "family",
    createdBy: parent.id,
  }).action;
  const own = actions.createAction(fam.id, {
    title: "Kid A",
    dueDate: "2026-08-02",
    assigneeType: "kid",
    assigneeId: kidA.id,
    createdBy: parent.id,
  }).action;
  actions.createAction(fam.id, {
    title: "Kid B",
    dueDate: "2026-08-03",
    assigneeType: "kid",
    assigneeId: kidB.id,
    sourceType: "calendar",
    createdBy: parent.id,
  });
  assert.deepEqual(actions.listActions(fam.id, { statuses: ["open"], kidIds: [kidA.id] }).map((a) => a.id), [own.id]);
  assert.deepEqual(actions.listActions(fam.id, { assignees: [{ type: "family" }] }).map((a) => a.id), [shared.id]);
  assert.equal(actions.listActions(fam.id, { from: "2026-08-03", to: "2026-08-04" }).length, 2);
  assert.deepEqual(actions.listActions(fam.id, { viewerKidId: kidA.id }).map((a) => a.title), ["Kid A", "Shared"]);

  for (let i = 0; i < actions.MAX_ACTIONS_PER_LIST + 10; i++) {
    actions.createAction(fam.id, { title: `Item ${i}`, createdBy: parent.id });
  }
  assert.equal(actions.listActions(fam.id).length, actions.MAX_ACTIONS_PER_LIST);

  db.flushSync();
  const disk = JSON.parse(fs.readFileSync(db.DB_FILE, "utf8"));
  assert.ok(disk.actions[fam.id].some((a) => a.id === own.id));
});

test("action model: completion and snooze transitions are consistent and atomic on invalid input", () => {
  const { fam, parent } = makeFamily("model-state");
  const created = actions.createAction(fam.id, { title: "State", createdBy: parent.id }).action;
  const completed = actions.updateAction(fam.id, created.id, { status: "done" });
  assert.equal(completed.action.status, "done");
  assert.equal(completed.action.snoozedUntil, null);

  const snoozed = actions.updateAction(fam.id, created.id, { snoozedUntil: "2026-08-10T09:00:00.000Z" });
  assert.equal(snoozed.action.status, "snoozed");
  assert.equal(snoozed.action.snoozedUntil, "2026-08-10T09:00:00.000Z");

  const before = actions.getAction(fam.id, created.id);
  const invalid = actions.updateAction(fam.id, created.id, { status: "snoozed", snoozedUntil: "not-a-time" });
  assert.ok(invalid.error);
  assert.equal(actions.getAction(fam.id, created.id).snoozedUntil, before.snoozedUntil);

  const reopened = actions.updateAction(fam.id, created.id, { status: "open" });
  assert.equal(reopened.action.status, "open");
  assert.equal(reopened.action.snoozedUntil, null);
});

test("action routes: parent CRUD, filters, cross-family isolation, and aggregate transition tracking", () => {
  const { routes, tracked } = buildHarness();
  const one = makeFamily("route-parent");
  const other = makeFamily("route-other");
  const post = call(routes["POST /api/family/actions"], {
    user: one.parent,
    body: {
      title: "Pack uniforms",
      notes: "For Friday",
      dueDate: "2026-08-07",
      dueTime: "17:30",
      assigneeType: "kid",
      assigneeId: one.kidA.id,
      sourceType: "chat",
      sourceId: "msg_opaque",
    },
  });
  assert.equal(post.statusCode, 200);
  assert.equal(post.body.action.sourceType, "chat");
  const id = post.body.action.id;
  assert.deepEqual(tracked, ["action_created"]);

  const shared = call(routes["POST /api/family/actions"], { user: one.parent, body: { title: "Family action", dueDate: "2026-08-08" } }).body.action;
  const list = call(routes["GET /api/family/actions"], { user: one.parent, query: { status: "open", source: "chat", from: "2026-08-01", to: "2026-08-10" } });
  assert.equal(list.statusCode, 200);
  assert.equal(list.headers["Cache-Control"], "no-store");
  assert.deepEqual(list.body.actions.map((a) => a.id), [id]);

  const complete = call(routes["PATCH /api/family/actions/:id"], { user: one.parent, params: { id }, body: { status: "done" } });
  assert.equal(complete.statusCode, 200);
  assert.equal(complete.body.action.status, "done");
  const snooze = call(routes["PATCH /api/family/actions/:id"], { user: one.parent, params: { id: shared.id }, body: { status: "snoozed", snoozedUntil: "2026-08-11T09:00:00Z" } });
  assert.equal(snooze.statusCode, 200);
  assert.equal(snooze.body.action.status, "snoozed");
  assert.deepEqual(tracked, ["action_created", "action_created", "action_completed", "action_snoozed"]);

  const foreign = call(routes["PATCH /api/family/actions/:id"], { user: one.parent, params: { id: actions.createAction(other.fam.id, { title: "Foreign", createdBy: other.parent.id }).action.id }, body: { status: "done" } });
  assert.equal(foreign.statusCode, 404);
  const deleted = call(routes["DELETE /api/family/actions/:id"], { user: one.parent, params: { id: shared.id } });
  assert.equal(deleted.statusCode, 200);
  assert.deepEqual(call(routes["GET /api/family/actions"], { user: one.parent }).body.actions.map((a) => a.id), [id]);

  assert.equal(call(routes["POST /api/family/actions"], { user: one.parent, body: { title: "bad", dueDate: "2026-02-31" } }).statusCode, 400);
  assert.equal(call(routes["GET /api/family/actions"], { user: one.parent, query: { from: "2026-01-01", to: "2028-01-01" } }).statusCode, 400);
});

test("action routes: kid sees shared plus own, cannot mutate shared/sibling/details, and can complete or snooze own", () => {
  const { routes } = buildHarness();
  const { fam, parent, kidA, kidB, kidAUser } = makeFamily("route-kid");
  const shared = actions.createAction(fam.id, { title: "Shared", createdBy: parent.id }).action;
  const own = actions.createAction(fam.id, { title: "Own", assigneeType: "kid", assigneeId: kidA.id, createdBy: parent.id }).action;
  const sibling = actions.createAction(fam.id, { title: "Sibling", assigneeType: "kid", assigneeId: kidB.id, createdBy: parent.id }).action;

  const list = call(routes["GET /api/family/actions"], { user: kidAUser, query: { kid: kidB.id } });
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.body.actions.map((a) => a.id).sort(), [own.id, shared.id].sort());

  assert.equal(call(routes["PATCH /api/family/actions/:id"], { user: kidAUser, params: { id: shared.id }, body: { status: "done" } }).statusCode, 403);
  assert.equal(call(routes["PATCH /api/family/actions/:id"], { user: kidAUser, params: { id: sibling.id }, body: { status: "done" } }).statusCode, 403);
  assert.equal(call(routes["PATCH /api/family/actions/:id"], { user: kidAUser, params: { id: own.id }, body: { title: "Changed" } }).statusCode, 403);
  const done = call(routes["PATCH /api/family/actions/:id"], { user: kidAUser, params: { id: own.id }, body: { status: "done" } });
  assert.equal(done.statusCode, 200);
  assert.equal(done.body.action.status, "done");

  const snoozed = call(routes["PATCH /api/family/actions/:id"], { user: kidAUser, params: { id: own.id }, body: { status: "snoozed", snoozedUntil: "2026-08-15T09:00:00Z" } });
  assert.equal(snoozed.statusCode, 200);
  assert.equal(snoozed.body.action.status, "snoozed");
  assert.equal(call(routes["DELETE /api/family/actions/:id"], { user: kidAUser, params: { id: own.id } }).statusCode, 403);
});

test("analytics: action events are allowlisted and summary remains aggregate-only", () => {
  assert.equal(analytics.recordEvent("action_created"), true);
  assert.equal(analytics.recordEvent("action_completed"), true);
  assert.equal(analytics.recordEvent("action_snoozed"), true);
  assert.equal(analytics.recordEvent("action_created_with_user_id"), false);
  assert.equal(analytics.recordEvent("title: Pack uniforms"), false);
  const summary = analytics.summary(2);
  assert.ok(summary.events.action_created >= 1);
  assert.ok(summary.events.action_completed >= 1);
  assert.ok(summary.events.action_snoozed >= 1);
  assert.equal(summary.events.action_created_with_user_id, undefined);
  assert.equal(summary.events["title: Pack uniforms"], undefined);
  assert.equal(JSON.stringify(summary).includes("Pack uniforms"), false);
});
