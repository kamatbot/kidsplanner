"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-watch-homework-"));

const store = require("../lib/store");
const family = require("../lib/family");
const homework = require("../lib/homework");
const homeworkRoutes = require("../lib/routes/homework");

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function buildRoutes() {
  const routes = {};
  const register = (method) => (route, ...handlers) => {
    routes[`${method} ${route}`] = handlers[handlers.length - 1];
  };
  const pass = (req, res, next) => next();
  homeworkRoutes({
    get: register("GET"),
    post: register("POST"),
    patch: register("PATCH"),
    delete: register("DELETE"),
  }, {
    homework,
    actions: {},
    chat: { sendMessage() {} },
    notifications: { notifyWatchHomework() {} },
    store,
    requireAuth: pass,
    requireFamily: pass,
    userRole: (user) => user?.data?.profile?.role || "parent",
    kidIdForUser: (req) => req.user?.data?.kid?.kidId,
    friendlyDate: (date) => date,
  });
  return routes;
}

function fixture(label) {
  const parent = store.createUser(`${label}-${Math.random()}@example.com`, `Parent ${label}`);
  const fam = family.createFamily(parent.id, `${label} Family`);
  const { kid: ownerKid } = family.addKid(fam.id, parent.id, { name: `${label} Owner` });
  const { kid: siblingKid } = family.addKid(fam.id, parent.id, { name: `${label} Sibling` });
  const owner = store.findOrCreateKidUser(fam.id, ownerKid.id, ownerKid.name);
  const sibling = store.findOrCreateKidUser(fam.id, siblingKid.id, siblingKid.name);
  const item = homework.addHomework(fam.id, {
    kidId: ownerKid.id,
    title: "History project",
    dueDate: "2026-09-14",
    checklist: [
      { text: "Choose a topic", done: false },
      { text: "Draft the outline", done: false },
    ],
  }).homework;
  return { parent, fam, owner, sibling, item };
}

async function call(handler, { user, fam, item, index = "0", body, watchAuth = true }) {
  const req = {
    user,
    family: fam,
    watchAuth: watchAuth ? { targetType: "kid" } : undefined,
    params: { id: item.id, index },
    body: body || {},
  };
  const res = response();
  await handler(req, res);
  return res;
}

test("paired kid Watch can set an own checklist step idempotently", async () => {
  const routes = buildRoutes();
  const data = fixture("own-step");
  const handler = routes["PATCH /api/homework/:id/checklist/:index"];

  const first = await call(handler, { ...data, user: data.owner, body: { done: true } });
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.homework.checklist[0].done, true);
  assert.equal(first.body.homework.checklist[0].text, "Choose a topic");

  const replay = await call(handler, { ...data, user: data.owner, body: { done: true } });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.homework.checklist[0].done, true);
});

test("paired kid Watch cannot change a sibling checklist", async () => {
  const routes = buildRoutes();
  const data = fixture("sibling-step");
  const result = await call(routes["PATCH /api/homework/:id/checklist/:index"], {
    ...data,
    user: data.sibling,
    body: { done: true },
  });

  assert.equal(result.statusCode, 403);
  assert.equal(homework.getById(data.fam.id, data.item.id).checklist[0].done, false);
});

test("checklist step route rejects malformed indexes and payload expansion", async () => {
  const routes = buildRoutes();
  const data = fixture("invalid-step");
  const handler = routes["PATCH /api/homework/:id/checklist/:index"];

  const badIndex = await call(handler, {
    ...data,
    user: data.owner,
    index: "99",
    body: { done: true },
  });
  assert.equal(badIndex.statusCode, 400);

  const badType = await call(handler, {
    ...data,
    user: data.owner,
    body: { done: "yes" },
  });
  assert.equal(badType.statusCode, 400);

  const expanded = await call(handler, {
    ...data,
    user: data.owner,
    body: { done: true, text: "Replace the assignment" },
  });
  assert.equal(expanded.statusCode, 400);
  assert.equal(homework.getById(data.fam.id, data.item.id).checklist[0].text, "Choose a topic");
});

test("generic homework PATCH remains status-only for Watch credentials", async () => {
  const routes = buildRoutes();
  const data = fixture("generic-patch");
  const handler = routes["PATCH /api/homework/:id"];
  const result = await call(handler, {
    ...data,
    user: data.owner,
    body: { checklist: [{ text: "Rewritten", done: true }] },
  });

  assert.equal(result.statusCode, 403);
  assert.equal(homework.getById(data.fam.id, data.item.id).checklist[0].text, "Choose a topic");
});

test("parents can view homework but cannot change student planning or progress", async () => {
  const routes = buildRoutes();
  const data = fixture("parent-read-only");

  const status = await call(routes["PATCH /api/homework/:id"], {
    ...data,
    user: data.parent,
    body: { status: "in_progress" },
    watchAuth: false,
  });
  assert.equal(status.statusCode, 403);

  const checklist = await call(routes["PATCH /api/homework/:id"], {
    ...data,
    user: data.parent,
    body: { checklist: [{ text: "Parent-authored step", done: false }] },
    watchAuth: false,
  });
  assert.equal(checklist.statusCode, 403);

  const step = await call(routes["PATCH /api/homework/:id/checklist/:index"], {
    ...data,
    user: data.parent,
    body: { done: true },
    watchAuth: false,
  });
  assert.equal(step.statusCode, 403);

  const stored = homework.getById(data.fam.id, data.item.id);
  assert.equal(stored.status, "todo");
  assert.deepEqual(stored.checklist, data.item.checklist);
});

test("parents can edit assignment facts without replacing student steps", async () => {
  const routes = buildRoutes();
  const data = fixture("parent-facts");
  const result = await call(routes["PATCH /api/homework/:id"], {
    ...data,
    user: data.parent,
    body: { title: "Revised history project", dueDate: "2026-09-20" },
    watchAuth: false,
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.homework.title, "Revised history project");
  assert.equal(result.body.homework.dueDate, "2026-09-20");
  assert.equal(result.body.homework.checklist[0].text, "Choose a topic");
});

test("parents cannot create homework with student-authored steps", async () => {
  const routes = buildRoutes();
  const data = fixture("parent-create-steps");
  const result = await call(routes["POST /api/homework"], {
    ...data,
    user: data.parent,
    body: {
      kidId: data.item.kidId,
      title: "New assignment",
      dueDate: "2026-09-21",
      checklist: [{ text: "Parent-authored step", done: false }],
    },
    watchAuth: false,
  });

  assert.equal(result.statusCode, 403);
  assert.match(result.body.error, /only be created by the student/i);
});
