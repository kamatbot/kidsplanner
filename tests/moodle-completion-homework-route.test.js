"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-moodle-completion-route-"));

const store = require("../lib/store");
const family = require("../lib/family");
const homework = require("../lib/homework");
const homeworkRoutes = require("../lib/routes/homework");

const MOODLE_ORIGIN = "https://bangkok.learn.nae.school";

function identity(taskId, userId = "14177") {
  return {
    origin: MOODLE_ORIGIN,
    homeworkViewId: "2",
    userId,
    taskId,
  };
}

function makeFamily(label) {
  const parent = store.createUser(`${label}-${Math.random()}@example.com`, `Parent ${label}`);
  const fam = family.createFamily(parent.id, `${label} Family`);
  const { kid } = family.addKid(fam.id, parent.id, { name: `${label} Kid`, grade: "8" });
  return { parent, fam, kid };
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function registerHomeworkRoutes() {
  const routes = new Map();
  const app = {
    get(route, ...handlers) { routes.set(`GET ${route}`, handlers); },
    post(route, ...handlers) { routes.set(`POST ${route}`, handlers); },
    patch(route, ...handlers) { routes.set(`PATCH ${route}`, handlers); },
    delete(route, ...handlers) { routes.set(`DELETE ${route}`, handlers); },
  };
  const pass = (req, res, next) => next();
  homeworkRoutes(app, {
    homework,
    actions: { getBySource() { return null; } },
    chat: { sendMessage() {} },
    store,
    notifications: { notifyWatchHomework() {} },
    requireAuth: pass,
    requireFamily: pass,
    userRole: (user) => user && user.data && user.data.profile && user.data.profile.role || "parent",
    kidIdForUser: (req) => req.user && req.user.data && req.user.data.kid && req.user.data.kid.kidId,
    friendlyDate: (date) => date,
  });
  return routes;
}

async function callFinal(routes, method, route, { user, fam, body, params, watchAuth } = {}) {
  const handlers = routes.get(`${method} ${route}`);
  assert.ok(handlers, `missing route ${method} ${route}`);
  const req = { user, family: fam, body: body || {}, params: params || {}, query: {}, watchAuth };
  const res = response();
  await handlers.at(-1)(req, res);
  return res;
}

test("parent import can persist exact Moodle identity while kid import cannot claim it", async () => {
  const { parent, fam, kid } = makeFamily("create");
  const routes = registerHomeworkRoutes();

  const parentResult = await callFinal(routes, "POST", "/api/homework", {
    user: parent,
    fam,
    body: {
      kidId: kid.id,
      title: "Exact Moodle task",
      dueDate: "2026-09-04",
      source: "school-portal",
      moodleIdentity: identity("3808216"),
    },
  });
  assert.equal(parentResult.statusCode, 200);
  assert.deepEqual(parentResult.body.homework.moodleIdentity, identity("3808216"));
  assert.equal(parentResult.body.homework.sourceUid, "moodle:2:14177:3808216");

  const kidUser = { data: { profile: { role: "kid" }, kid: { kidId: kid.id } } };
  const kidResult = await callFinal(routes, "POST", "/api/homework", {
    user: kidUser,
    fam,
    body: {
      kidId: "another-kid",
      title: "Kid-created task",
      dueDate: "2026-09-05",
      source: "school-portal",
      moodleIdentity: identity("3808217"),
    },
  });
  assert.equal(kidResult.statusCode, 200);
  assert.equal(kidResult.body.homework.kidId, kid.id);
  assert.equal(kidResult.body.homework.source, "manual");
  assert.equal(kidResult.body.homework.moodleIdentity, undefined);
});

test("status completion returns the durable queue result and duplicate done does not requeue", async () => {
  const { parent, fam, kid } = makeFamily("complete");
  const routes = registerHomeworkRoutes();
  const item = homework.addHomework(fam.id, {
    kidId: kid.id,
    title: "Complete me",
    dueDate: "2026-09-04",
    source: "school-portal",
    moodleIdentity: identity("3808220"),
  }).homework;

  const first = await callFinal(routes, "PATCH", "/api/homework/:id", {
    user: parent,
    fam,
    params: { id: item.id },
    body: { status: "done" },
  });
  const second = await callFinal(routes, "PATCH", "/api/homework/:id", {
    user: parent,
    fam,
    params: { id: item.id },
    body: { status: "done" },
  });

  assert.equal(first.statusCode, 200);
  assert.equal(first.body.completionSync.queued, true);
  assert.match(first.body.completionSync.requestId, /^mcr_/);
  assert.deepEqual(second.body.completionSync, { queued: false, reason: "already_done" });
  assert.equal(homework.listPendingMoodleCompletions(fam.id).completions.length, 1);
});

test("a parent can backfill identity separately while kid, Watch, and mixed patches fail closed", async () => {
  const { parent, fam, kid } = makeFamily("backfill");
  const routes = registerHomeworkRoutes();
  const item = homework.addHomework(fam.id, {
    kidId: kid.id,
    title: "Legacy completed task",
    dueDate: "2026-09-04",
    source: "school-portal",
  }).homework;
  homework.updateHomework(fam.id, item.id, { status: "done" });

  const mixed = await callFinal(routes, "PATCH", "/api/homework/:id", {
    user: parent,
    fam,
    params: { id: item.id },
    body: { moodleIdentity: identity("3808230"), status: "done" },
  });
  assert.equal(mixed.statusCode, 400);
  assert.equal(item.moodleIdentity, undefined);

  const kidUser = { data: { profile: { role: "kid" }, kid: { kidId: kid.id } } };
  const kidResult = await callFinal(routes, "PATCH", "/api/homework/:id", {
    user: kidUser,
    fam,
    params: { id: item.id },
    body: { moodleIdentity: identity("3808230") },
  });
  assert.equal(kidResult.statusCode, 403);

  const watchResult = await callFinal(routes, "PATCH", "/api/homework/:id", {
    user: parent,
    fam,
    params: { id: item.id },
    body: { moodleIdentity: identity("3808230") },
    watchAuth: { id: "watch" },
  });
  assert.equal(watchResult.statusCode, 403);

  const parentResult = await callFinal(routes, "PATCH", "/api/homework/:id", {
    user: parent,
    fam,
    params: { id: item.id },
    body: { moodleIdentity: identity("3808230") },
  });
  assert.equal(parentResult.statusCode, 200);
  assert.equal(parentResult.body.completionSync.queued, true);
  assert.deepEqual(parentResult.body.homework.moodleIdentity, identity("3808230"));
  assert.equal(homework.listPendingMoodleCompletions(fam.id).completions.length, 1);
});
