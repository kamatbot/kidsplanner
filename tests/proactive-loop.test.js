"use strict";

// The server-side port of integrations/hermes/fametc/proactive.py. Table cases
// mirror tests/test_proactive.py so the two planners agree.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-proactive-loop-"));
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");

const loop = require("../lib/proactive-loop");

const at = (hhmm, day = "2026-09-25") => new Date(`${day}T${hhmm}:00+07:00`);
const iso = (hhmm, day) => at(hhmm, day).toISOString();
function kid(kidId, name, end, { kind = "school", title = "School", location = null, users = [], due = [], overdue = 0, habits = 0, daily3 = 0, home = null } = {}) {
  return {
    kidId, name, userIds: users,
    dayEnd: end ? { at: iso(end), local: end, title, kind, location } : null,
    homeAt: home ? iso(home) : null,
    tonight: { dueTomorrow: due.map(([t, s], i) => ({ id: `h${i}`, title: t, status: s })), overdue, habitsLeft: habits, habitsTotal: habits, daily3Left: daily3 },
  };
}
function baseState(overrides = {}) {
  return Object.assign({
    timezone: "Asia/Bangkok", today: "2026-09-25", weekday: "fri",
    people: [
      { userId: "p1", role: "parent", name: "Mayur" },
      { userId: "p2", role: "parent", name: "Priya" },
      { userId: "u-ryshi", role: "kid", name: "Ryshi", kidId: "k-ryshi" },
    ],
    kids: [
      kid("k-ryshi", "Ryshi", "15:10", { users: ["u-ryshi"], due: [["Maths worksheet", "todo"]], habits: 1, daily3: 3 }),
      kid("k-arya", "Arya", "15:40", { kind: "activity", title: "Chess", location: "Room 3" }),
    ],
    dinner: { time: "18:30", at: iso("18:30"), tonight: { planned: false, title: null }, nextWeek: { start: "2026-09-28", planned: 2, days: 7 } },
    helpsWith: { schoolDay: true, homework: true, dinner: true },
    sent: [],
  }, overrides);
}
const ofKind = (nudges, kind) => nudges.filter((n) => n.card.kind === kind);
const sentFrom = (nudges, postedAt, extra = {}) => nudges.map((n) => Object.assign({
  userId: n.userId, nudgeKey: n.nudgeKey, kind: n.card.kind, postedAt: iso(postedAt), status: "open", until: null, covers: (n.card.data || {}).covers || [],
}, extra));

test("day end: heads-up, then combined status, never repeated", () => {
  const state = baseState();
  const first = ofKind(loop.plan(state, at("14:40")), "day-end");
  assert.deepEqual(new Set(first.map((n) => n.userId)), new Set(["p1", "p2"]));
  assert.equal(first[0].text, "Ryshi finishes school in 30 min.");
  state.sent = sentFrom(first, "14:40");
  assert.deepEqual(ofKind(loop.plan(state, at("14:50")), "day-end"), []);
  const combined = ofKind(loop.plan(state, at("15:10")), "day-end");
  assert.equal(combined[0].text, "Ryshi's school ended now. Arya finishes Chess in 30 min (Room 3).");
  assert.deepEqual(combined[0].card.data.covers, ["k-arya:soon", "k-ryshi:now"]);
});

test("welcome home an hour after the day ends, and evening check-in for parents", () => {
  const home = ofKind(loop.plan(baseState(), at("16:10")), "home-kid");
  assert.equal(home.length, 1);
  assert.equal(home[0].userId, "u-ryshi");
  assert.match(home[0].text, /^Welcome home, Ryshi! Tonight: Maths worksheet \(due tomorrow\)/);
  const evening = ofKind(loop.plan(baseState(), at("17:45")), "home-parent");
  assert.equal(evening.length, 2);
  assert.match(evening[0].text, /Ryshi has 1 due tomorrow \(not started\)\. .*Dinner isn't planned yet\./);
});

test("quiet hours, topic switches and dinner opt-in are respected", () => {
  assert.deepEqual(loop.plan(baseState(), at("22:00")).filter((n) => n.card.kind !== "day-end"), []);
  const noDinner = baseState({ helpsWith: { schoolDay: true, homework: true, dinner: false } });
  assert.deepEqual(ofKind(loop.plan(noDinner, at("15:30")), "dinner-tonight"), []);
  const noSchool = baseState({ helpsWith: { schoolDay: false, homework: true, dinner: true } });
  assert.deepEqual(ofKind(loop.plan(noSchool, at("14:40")), "day-end"), []);
});

test("tick posts reminders into parents' Hermes threads once per moment", () => {
  const store = require("../lib/store");
  const family = require("../lib/family");
  const chat = require("../lib/chat");
  const hermesThreads = require("../lib/hermes-threads");
  const events = require("../lib/events");
  const parent = store.createUser("loop@example.com", "Loop Parent");
  const fam = family.createFamily(parent.id, "Loop Family");
  fam.timezone = "Asia/Bangkok";
  const kidRec = family.addKid(fam.id, parent.id, { name: "Ryshi" });
  const kidId = (kidRec && (kidRec.kid || kidRec).id) || fam.kids[0].id;
  const created = events.addEvent(fam.id, { title: "Chess", date: "2026-09-25", time: "14:00", endTime: "15:40", category: "other", kidId });
  assert.ok(!created || !created.error, JSON.stringify(created));
  const now = at("15:15");
  const first = loop.tick(now);
  assert.ok(first >= 1, `expected a nudge, got ${first}`);
  assert.equal(loop.tick(now), 0);
  const msgs = chat.listMessages(hermesThreads.scopeFor(parent.id), { limit: 5 });
  assert.match(msgs.at(-1).text, /Ryshi finishes Chess in 25 min/);
});

test("FAM_PROACTIVE=off stops the loop", () => {
  process.env.FAM_PROACTIVE = "off";
  try { assert.equal(loop.enabled(), false); assert.equal(loop.tick(), 0); } finally { delete process.env.FAM_PROACTIVE; }
});
