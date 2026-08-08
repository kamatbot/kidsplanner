"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-test-homework-session-"));

const db = require("../lib/db");
const store = require("../lib/store");
const family = require("../lib/family");
const homework = require("../lib/homework");
const homeworkRoutes = require("../lib/routes/homework");

function makeFamily(label) {
  const parent = store.createUser(`${label}-${Math.random()}@example.com`, `Parent ${label}`);
  const fam = family.createFamily(parent.id, `${label} Family`);
  const { kid } = family.addKid(fam.id, parent.id, { name: `${label} Kid`, grade: "7" });
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
  return { parent, fam, kid, kidUser };
}

function makeResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function buildSuggestionRoute() {
  const routes = {};
  const register = (method) => (route, ...handlers) => {
    routes[`${method} ${route}`] = handlers[handlers.length - 1];
  };
  const app = {
    get: register("GET"),
    post: register("POST"),
    patch: register("PATCH"),
    delete: register("DELETE"),
  };
  const pass = (req, res, next) => next();
  homeworkRoutes(app, {
    homework,
    actions: {},
    chat: { sendMessage() {} },
    requireAuth: pass,
    requireFamily: pass,
    userRole: (user) => (user && user.data && user.data.profile && user.data.profile.role) || "parent",
    kidIdForUser: (req) => req.user && req.user.data && req.user.data.kid && req.user.data.kid.kidId,
    friendlyDate: (date) => date,
  });
  return routes["GET /api/homework/:id/work-session-suggestion"];
}

async function call(handler, { user, fam, id, today } = {}) {
  const req = {
    user,
    family: fam,
    params: { id },
    query: today ? { today } : {},
    body: {},
  };
  const res = makeResponse();
  await handler(req, res);
  return res;
}

test("work-session suggestion is deterministic, bounded, and read-only", () => {
  const { fam, kid } = makeFamily("deterministic");
  const item = homework.addHomework(fam.id, {
    kidId: kid.id,
    title: "Research notes",
    dueDate: "2026-08-15",
    effortMin: 135,
    source: "school-portal",
  }).homework;
  const before = JSON.stringify(item);

  const first = homework.suggestWorkSession(fam.id, item.id, { todayIso: "2026-08-08" });
  const second = homework.suggestWorkSession(fam.id, item.id, { todayIso: "2026-08-08" });

  assert.deepEqual(second, first);
  assert.equal(first.suggestion.id, `hws_${item.id}`);
  assert.equal(first.suggestion.date, "2026-08-14");
  assert.equal(first.suggestion.durationMin, homework.MAX_WORK_SESSION_MIN);
  assert.equal(first.suggestion.effortMin, 135);
  assert.equal(first.suggestion.remainingEffortMin, 45);
  assert.equal(first.suggestion.time, null);
  assert.equal(first.suggestion.calendarEventId, null);
  assert.equal(first.suggestion.autoScheduled, false);
  assert.equal(first.suggestion.requiresParentConfirmation, false);
  assert.equal(JSON.stringify(homework.getById(fam.id, item.id)), before);
  assert.equal(db.load().familyEvents, undefined);
});

test("suggestion follows homework edits and respects completion lifecycle", () => {
  const { fam, kid } = makeFamily("lifecycle");
  const item = homework.addHomework(fam.id, {
    kidId: kid.id,
    title: "Read chapter",
    dueDate: "2026-08-20",
    effortMin: 30,
  }).homework;

  const original = homework.suggestWorkSession(fam.id, item.id, { todayIso: "2026-08-08" });
  assert.equal(original.suggestion.date, "2026-08-19");
  assert.equal(original.suggestion.durationMin, 30);

  homework.updateHomework(fam.id, item.id, {
    status: "in_progress",
    dueDate: "2026-08-12",
    effortMin: 120,
    notes: "Keep this note",
  });
  const edited = homework.suggestWorkSession(fam.id, item.id, { todayIso: "2026-08-08" });
  assert.equal(edited.suggestion.date, "2026-08-11");
  assert.equal(edited.suggestion.durationMin, 90);
  assert.equal(homework.getById(fam.id, item.id).status, "in_progress");
  assert.equal(homework.getById(fam.id, item.id).notes, "Keep this note");

  homework.updateHomework(fam.id, item.id, { status: "done" });
  const complete = homework.suggestWorkSession(fam.id, item.id, { todayIso: "2026-08-08" });
  assert.equal(complete.suggestion, null);
  assert.equal(complete.reason, "completed");
});

test("suggestion is family/kid scoped and kids can read only their own item", async () => {
  const first = makeFamily("scope-first");
  const second = makeFamily("scope-second");
  const { kid: sibling } = family.addKid(first.fam.id, first.parent.id, { name: "Sibling", grade: "7" });
  const own = homework.addHomework(first.fam.id, {
    kidId: first.kid.id,
    title: "Own assignment",
    dueDate: "2026-08-15",
    effortMin: 45,
  }).homework;
  const siblingItem = homework.addHomework(first.fam.id, {
    kidId: sibling.id,
    title: "Sibling assignment",
    dueDate: "2026-08-15",
    effortMin: 45,
  }).homework;
  const foreign = homework.addHomework(second.fam.id, {
    kidId: second.kid.id,
    title: "Foreign assignment",
    dueDate: "2026-08-15",
    effortMin: 45,
  }).homework;

  assert.equal(homework.suggestWorkSession(first.fam.id, foreign.id).error, "Homework item not found.");

  const route = buildSuggestionRoute();
  const ownResponse = await call(route, { user: first.kidUser, fam: first.fam, id: own.id, today: "2026-08-08" });
  assert.equal(ownResponse.statusCode, 200);
  assert.equal(ownResponse.body.suggestion.homeworkId, own.id);
  assert.equal(ownResponse.headers["Cache-Control"], "no-store");

  const repeatResponse = await call(route, { user: first.kidUser, fam: first.fam, id: own.id, today: "2026-08-08" });
  assert.deepEqual(repeatResponse.body, ownResponse.body);

  const siblingResponse = await call(route, { user: first.kidUser, fam: first.fam, id: siblingItem.id, today: "2026-08-08" });
  assert.equal(siblingResponse.statusCode, 403);
  assert.equal(siblingResponse.body.suggestion, undefined);

  const foreignResponse = await call(route, { user: first.kidUser, fam: first.fam, id: foreign.id, today: "2026-08-08" });
  assert.equal(foreignResponse.statusCode, 404);

  const parentResponse = await call(route, { user: first.parent, fam: first.fam, id: siblingItem.id, today: "2026-08-08" });
  assert.equal(parentResponse.statusCode, 200);
  assert.equal(parentResponse.body.suggestion.homeworkId, siblingItem.id);
});

test("items without due date or effort return no suggestion without guessing", () => {
  const { fam, kid } = makeFamily("ineligible");
  const noEffort = homework.addHomework(fam.id, {
    kidId: kid.id,
    title: "No estimate",
    dueDate: "2026-08-15",
  }).homework;
  const noDueDate = Object.assign({}, noEffort, { id: "hw_missing_due", dueDate: null, effortMin: 30 });

  assert.equal(homework.buildWorkSessionSuggestion(noEffort, { todayIso: "2026-08-08" }).reason, "missing_or_invalid_effort");
  assert.equal(homework.buildWorkSessionSuggestion(noDueDate, { todayIso: "2026-08-08" }).reason, "missing_or_invalid_due_date");
});
