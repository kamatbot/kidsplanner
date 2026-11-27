"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-kid-plans-"));
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
process.env.ANTHROPIC_API_KEY = "test-key";
process.env.FAM_KID_PLANS_RETRY_MS = "0";

const store = require("../lib/store");
const family = require("../lib/family");
const events = require("../lib/events");
const actions = require("../lib/actions");
const kidPlans = require("../lib/kid-plans");
const watchAuth = require("../lib/watch-auth");
const registerActions = require("../lib/routes/actions");
const registerKidPlans = require("../lib/routes/kid-plans");

let counter = 0;
function fixture() {
  counter += 1;
  const parent = store.createUser(`kp${counter}@example.com`, `Parent ${counter}`);
  const fam = family.createFamily(parent.id, "Voice Family");
  const maya = family.addKid(fam.id, parent.id, { name: "Maya" });
  const leo = family.addKid(fam.id, parent.id, { name: "Leo" });
  const fresh = family.getFamily(fam.id);
  const mayaId = (maya.kid || maya).id;
  const leoId = (leo.kid || leo).id;
  return { parent, fam: fresh, mayaId, leoId };
}

function mockClaude(responses) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const next = responses.shift();
    if (!next) throw new Error("unexpected call");
    if (next.status) return { ok: false, status: next.status, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => next };
  };
  return { calls, restore() { global.fetch = original; } };
}

const tomorrow = () => new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
const tool = (name, input, id = crypto.randomUUID()) => ({ type: "tool_use", id, name, input });

test("one note makes several events and a reminder, all for the kid who spoke", async () => {
  const { fam, mayaId } = fixture();
  const day = tomorrow();
  const claude = mockClaude([{ stop_reason: "tool_use", content: [
    tool("add_event", { title: "Soccer", date: day, time: "10:00", category: "sports", kidId: "ignored" }),
    tool("add_event", { title: "Dentist", date: day, time: "16:00" }),
    tool("add_reminder", { title: "Pack recorder", date: day, time: "07:30" }),
  ] }]);
  let out;
  try {
    out = await kidPlans.addFromText({ fam, kidId: mayaId, userId: "maya-user", text: "soccer and dentist and remind me recorder", requestId: "req-aaaaaaaa1" });
  } finally { claude.restore(); }
  assert.equal(out.result.items.length, 3);
  assert.match(out.result.reply, /^Added 3: /);
  const evs = events.listEvents(fam.id, { from: day, to: day });
  assert.deepEqual(evs.map((e) => e.title).sort(), ["Dentist", "Soccer"]);
  assert.ok(evs.every((e) => e.kidId === mayaId && e.createdBy === "maya-user" && !e.driverMemberId && e.repeat !== "weekly"));
  const reminder = actions.getAction(fam.id, out.result.items[2].id);
  assert.equal(reminder.assigneeType, "kid");
  assert.equal(reminder.kidId, mayaId);
  assert.equal(reminder.createdByKidId, mayaId);
  assert.equal(reminder.dueTime, "07:30");
  // The prompt carries the date table and forces a tool call.
  assert.equal(claude.calls[0].body.tool_choice.type, "any");
  assert.match(claude.calls[0].body.system, /Next 14 days/);
});

test("a retry with the same request id returns the first result without calling Claude again", async () => {
  const { fam, mayaId } = fixture();
  const day = tomorrow();
  const claude = mockClaude([{ content: [tool("add_event", { title: "Swim", date: day, time: "17:00" })] }]);
  try {
    const a = await kidPlans.addFromText({ fam, kidId: mayaId, userId: "u", text: "swim", requestId: "retry-1234567" });
    const b = await kidPlans.addFromText({ fam, kidId: mayaId, userId: "u", text: "swim", requestId: "retry-1234567" });
    assert.equal(b.existing, true);
    assert.deepEqual(b.result.items, a.result.items);
  } finally { claude.restore(); }
  assert.equal(claude.calls.length, 1);
  assert.equal(events.listEvents(fam.id, { from: day, to: day }).length, 1);
});

test("past dates, missing reminder times and empty notes are skipped with a clear reply", async () => {
  const { fam, mayaId } = fixture();
  const claude = mockClaude([
    { content: [tool("add_event", { title: "Old thing", date: "2020-01-01" }), tool("add_reminder", { title: "No time", date: tomorrow(), time: "soon" })] },
    { content: [tool("nothing_to_add", { message: "Sounds like a fun day!" })] },
  ]);
  try {
    const out = await kidPlans.addFromText({ fam, kidId: mayaId, userId: "u", text: "stuff", requestId: "skip-12345678" });
    assert.equal(out.result.items.length, 0);
    assert.match(out.result.reply, /couldn't add/);
    assert.equal(out.result.skipped.length, 2);
    const none = await kidPlans.addFromText({ fam, kidId: mayaId, userId: "u", text: "I had a great day", requestId: "none-12345678" });
    assert.equal(none.result.reply, "Sounds like a fun day!");
  } finally { claude.restore(); }
});

test("undo removes exactly what that note added, only for the same kid", async () => {
  const { fam, mayaId, leoId } = fixture();
  const day = tomorrow();
  const claude = mockClaude([{ content: [tool("add_event", { title: "Party", date: day, time: "14:00" }), tool("add_reminder", { title: "Bring gift", date: day, time: "13:00" })] }]);
  let out;
  try { out = await kidPlans.addFromText({ fam, kidId: mayaId, userId: "u", text: "party", requestId: "undo-12345678" }); } finally { claude.restore(); }
  assert.equal(kidPlans.undo({ fam, kidId: leoId, requestId: "undo-12345678" }).status, 404);
  const undone = kidPlans.undo({ fam, kidId: mayaId, requestId: "undo-12345678" });
  assert.equal(undone.result.undone, true);
  assert.equal(events.listEvents(fam.id, { from: day, to: day }).length, 0);
  assert.equal(actions.getAction(fam.id, out.result.items[1].id), null);
});

test("errors are specific: no API key, Claude down, empty text", async () => {
  const { fam, mayaId } = fixture();
  const empty = await kidPlans.addFromText({ fam, kidId: mayaId, userId: "u", text: "   ", requestId: "empty-1234567" });
  assert.equal(empty.status, 400);
  const key = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const off = await kidPlans.addFromText({ fam, kidId: mayaId, userId: "u", text: "soccer", requestId: "nokey-1234567" });
    assert.equal(off.status, 503);
    assert.match(off.error, /ANTHROPIC_API_KEY/);
  } finally { process.env.ANTHROPIC_API_KEY = key; }
  const claude = mockClaude([{ status: 529 }, { status: 529 }]);
  try {
    const down = await kidPlans.addFromText({ fam, kidId: mayaId, userId: "u", text: "soccer", requestId: "down-12345678" });
    assert.equal(down.status, 502);
    assert.match(down.error, /Claude API 529/);
  } finally { claude.restore(); }
});

test("kid and parent watches may call kid-plans", () => {
  const kid = { targetType: "kid" };
  const parent = { targetType: "parent" };
  assert.equal(watchAuth.allowedRequest("POST", "/api/kid-plans", kid), true);
  assert.equal(watchAuth.allowedRequest("POST", "/api/kid-plans/abc12345/undo", kid), true);
  assert.equal(watchAuth.allowedRequest("POST", "/api/kid-plans", parent), true);
  assert.equal(watchAuth.allowedRequest("POST", "/api/kid-plans/abc12345/undo", parent), true);
  assert.equal(watchAuth.allowedRequest("GET", "/api/kid-plans", parent), false);
  assert.equal(watchAuth.allowedRequest("POST", "/api/family/actions", kid), false);
});

// ---------------------------------------------------------------- routes
function harness(register, extraDeps = {}) {
  const routes = {};
  const app = {};
  for (const verb of ["get", "post", "patch", "put", "delete"]) {
    app[verb] = (p, ...handlers) => { routes[`${verb.toUpperCase()} ${p}`] = handlers; };
  }
  const pushes = [];
  const pass = (req, res, next) => next();
  register(app, Object.assign({
    actions, store, analytics: null,
    notifications: {
      notifyWatchAction: async (args) => { pushes.push(["action", args]); },
      syncWatchesSilently: async (args) => { pushes.push(["sync", args]); },
    },
    requireAuth: pass, requireFamily: pass,
    requireParent: (req, res, next) => (req.user.data.profile.role === "kid" ? res.status(403).json({ error: "Parents only." }) : next()),
    userRole: (u) => u.data.profile.role,
    kidIdForUser: (req) => req.user.data.kid && req.user.data.kid.kidId,
  }, extraDeps));
  async function call(method, routePath, req) {
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(" ");
      if (m !== method) return false;
      const re = new RegExp("^" + p.replace(/:[^/]+/g, "([^/]+)") + "$");
      const match = re.exec(routePath);
      if (match) { const names = (p.match(/:[^/]+/g) || []).map((n) => n.slice(1)); req.params = Object.fromEntries(names.map((n, i) => [n, match[i + 1]])); }
      return !!match;
    });
    const res = { code: 200, headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    const handlers = routes[key];
    let i = 0;
    const next = async () => { const fn = handlers[i++]; if (fn) await fn(req, res, next); };
    await next();
    return res;
  }
  return { call, pushes };
}

const kidUser = (fam, kidId, id = "kid-user") => ({ id, data: { profile: { role: "kid" }, kid: { familyId: fam.id, kidId } } });

test("kids add their own reminder on iPad, it is forced to them, and their own watch is told", async () => {
  const { fam, mayaId, leoId } = fixture();
  const h = harness(registerActions);
  const res = await h.call("POST", "/api/family/actions", { user: kidUser(fam, mayaId), family: fam, body: { title: "Feed fish", dueDate: tomorrow(), dueTime: "18:00", kidId: leoId, assigneeType: "family" } });
  assert.equal(res.code, 200);
  assert.equal(res.body.action.kidId, mayaId);
  assert.equal(res.body.action.assigneeType, "kid");
  assert.equal(res.body.action.createdByKidId, mayaId);
  await new Promise((r) => setImmediate(r));
  const push = h.pushes.find((p) => p[0] === "action");
  assert.equal(push[1].includeActor, true);
  // Kid may fix the time of their own reminder and delete it.
  const patched = await h.call("PATCH", `/api/family/actions/${res.body.action.id}`, { user: kidUser(fam, mayaId), family: fam, body: { dueTime: "18:30", title: "Feed the fish" } });
  assert.equal(patched.code, 200);
  assert.equal(patched.body.action.dueTime, "18:30");
  const del = await h.call("DELETE", `/api/family/actions/${res.body.action.id}`, { user: kidUser(fam, mayaId), family: fam });
  assert.equal(del.code, 200);
  assert.ok(h.pushes.some((p) => p[0] === "sync"));
});

test("kids still cannot edit or delete reminders a parent gave them, and watches cannot create actions", async () => {
  const { parent, fam, mayaId } = fixture();
  const parentMade = actions.createAction(fam.id, { title: "Practice piano", kidId: mayaId, dueDate: tomorrow(), dueTime: "17:00", createdBy: parent.id }).action;
  const h = harness(registerActions);
  const edit = await h.call("PATCH", `/api/family/actions/${parentMade.id}`, { user: kidUser(fam, mayaId), family: fam, body: { title: "Skip piano" } });
  assert.equal(edit.code, 403);
  const del = await h.call("DELETE", `/api/family/actions/${parentMade.id}`, { user: kidUser(fam, mayaId), family: fam });
  assert.equal(del.code, 403);
  const done = await h.call("PATCH", `/api/family/actions/${parentMade.id}`, { user: kidUser(fam, mayaId), family: fam, body: { status: "done" } });
  assert.equal(done.code, 200);
  const watch = await h.call("POST", "/api/family/actions", { user: kidUser(fam, mayaId), family: fam, watchAuth: { targetType: "kid" }, body: { title: "x" } });
  assert.equal(watch.code, 403);
});

test("kid-plans route: kids get the reply and can undo", async () => {
  const { fam, mayaId } = fixture();
  const h = harness(registerKidPlans);
  const claude = mockClaude([{ content: [tool("add_event", { title: "Soccer", date: tomorrow(), time: "10:00" })] }]);
  try {
    const ok = await h.call("POST", "/api/kid-plans", { user: kidUser(fam, mayaId), family: fam, watchAuth: { targetType: "kid", targetKidId: mayaId }, body: { text: "soccer", requestId: "route-1234567" } });
    assert.equal(ok.code, 200);
    assert.equal(ok.body.items.length, 1);
    assert.equal(ok.body.items[0].type, "event");
    const undo = await h.call("POST", "/api/kid-plans/route-1234567/undo", { user: kidUser(fam, mayaId), family: fam, watchAuth: { targetType: "kid", targetKidId: mayaId } });
    assert.equal(undo.code, 200);
    assert.equal(undo.body.undone, true);
  } finally { claude.restore(); }
});

const parentUser = (parent) => ({ id: parent.id, data: { profile: { role: "parent", name: "Kamat" } } });

test("parents add their own plans: family-calendar events and reminders assigned to them", async () => {
  const { parent, fam, mayaId } = fixture();
  const h = harness(registerKidPlans);
  const day = tomorrow();
  const claude = mockClaude([{ content: [
    tool("add_event", { title: "Dentist", date: day, time: "16:00", for: "me" }),
    tool("add_reminder", { title: "Call plumber", date: day, time: "09:00", for: "me" }),
    tool("add_event", { title: "Soccer", date: day, time: "10:00", for: "Maya" }),
    tool("add_reminder", { title: "Pack kit", date: day, time: "07:30", for: "Maya" }),
  ] }]);
  try {
    const res = await h.call("POST", "/api/kid-plans", { user: parentUser(parent), family: fam, watchAuth: { targetType: "parent", targetUserId: parent.id }, body: { text: "dentist and plumber and maya soccer", requestId: "parent-1234567", via: "siri" } });
    assert.equal(res.code, 200, JSON.stringify(res.body));
    assert.equal(res.body.items.length, 4);
    const sent = claude.calls[0].body;
    assert.match(sent.system, /Kamat/);
    assert.deepEqual(sent.tools[0].input_schema.properties.for.enum, ["me", "Maya", "Leo"]);
    const [dentist, plumber, soccer, kit] = res.body.items;
    assert.equal(events.getById(fam.id, dentist.id).kidId, null);
    assert.equal(events.getById(fam.id, soccer.id).kidId, mayaId);
    const mine = actions.getAction(fam.id, plumber.id);
    assert.equal(mine.assigneeType, "parent");
    assert.equal(mine.assigneeId, parent.id);
    const forMaya = actions.getAction(fam.id, kit.id);
    assert.equal(forMaya.assigneeType, "kid");
    assert.equal(forMaya.kidId, mayaId);
    assert.equal(forMaya.createdByKidId, null);
    // Replays return the first result; undo removes everything.
    const again = await h.call("POST", "/api/kid-plans", { user: parentUser(parent), family: fam, body: { text: "x", requestId: "parent-1234567" } });
    assert.equal(again.body.items.length, 4);
    const undo = await h.call("POST", "/api/kid-plans/parent-1234567/undo", { user: parentUser(parent), family: fam });
    assert.equal(undo.code, 200);
    assert.equal(events.getById(fam.id, dentist.id), null);
    assert.equal(actions.getAction(fam.id, kit.id), null);
  } finally { claude.restore(); }
});

test("a parent's request is not visible to a kid, and a watch must belong to the speaker", async () => {
  const { parent, fam, mayaId } = fixture();
  const h = harness(registerKidPlans);
  const claude = mockClaude([{ content: [tool("add_event", { title: "Gym", date: tomorrow(), time: "06:30", for: "me" })] }]);
  try {
    const ok = await h.call("POST", "/api/kid-plans", { user: parentUser(parent), family: fam, body: { text: "gym", requestId: "parent-abcdefg" } });
    assert.equal(ok.code, 200);
    const kidUndo = await h.call("POST", "/api/kid-plans/parent-abcdefg/undo", { user: kidUser(fam, mayaId), family: fam });
    assert.equal(kidUndo.code, 404);
  } finally { claude.restore(); }
  const wrongWatch = await h.call("POST", "/api/kid-plans", { user: parentUser(parent), family: fam, watchAuth: { targetType: "kid", targetKidId: mayaId }, body: { text: "x" } });
  assert.equal(wrongWatch.code, 403);
  const otherParent = await h.call("POST", "/api/kid-plans", { user: parentUser(parent), family: fam, watchAuth: { targetType: "parent", targetUserId: "someone-else" }, body: { text: "x" } });
  assert.equal(otherParent.code, 403);
  const stranger = await h.call("POST", "/api/kid-plans", { user: { id: "nobody", data: { profile: { role: "parent" } } }, family: fam, body: { text: "x" } });
  assert.equal(stranger.code, 403);
});
