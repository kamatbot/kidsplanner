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

test("day end: one message per commitment, no repeat when it ends", () => {
  const state = baseState();
  const first = ofKind(loop.plan(state, at("14:40")), "day-end");
  assert.deepEqual(new Set(first.map((n) => n.userId)), new Set(["p1", "p2"]));
  assert.equal(first[0].text, "Ryshi finishes school in 30 min.");
  assert.deepEqual(first[0].card.data.covers, ["k-ryshi@15:10"]);
  state.sent = sentFrom(first, "14:40");
  assert.deepEqual(ofKind(loop.plan(state, at("14:50")), "day-end"), []);
  // At 15:10 Ryshi's school ends (already announced) and Arya's Chess is 30 min out.
  const next = ofKind(loop.plan(state, at("15:10")), "day-end");
  assert.equal(next[0].text, "Arya finishes Chess in 30 min (Room 3).");
  assert.deepEqual(next[0].card.data.covers, ["k-arya@15:40"]);
  state.sent = state.sent.concat(sentFrom(next, "15:10"));
  for (const t of ["15:15", "15:25", "15:40", "15:50"]) assert.deepEqual(ofKind(loop.plan(state, at(t)), "day-end"), [], t);
});

test("day end: 'ended now' only when the heads-up was missed", () => {
  const late = ofKind(loop.plan(baseState(), at("15:12")), "day-end");
  assert.equal(late[0].text, "Ryshi's school ended now. Arya finishes Chess in 28 min (Room 3).");
});

test("day end: a kid's evening event (cook dinner) messages parents once", () => {
  const state = baseState({ kids: [kid("k-ryshi", "Ryshi", "19:00", { kind: "event", title: "Cook dinner" })] });
  const sent = [];
  for (let m = 0; m <= 45; m += 1) {
    const now = new Date(at("18:20").getTime() + m * 60000);
    const out = ofKind(loop.plan(Object.assign({}, state, { sent: sent.slice() }), now), "day-end");
    for (const n of out) sent.push(Object.assign({ userId: n.userId, nudgeKey: n.nudgeKey, kind: "day-end", postedAt: now.toISOString(), status: "open", until: null, covers: n.card.data.covers }));
  }
  assert.equal(sent.filter((s) => s.userId === "p1").length, 1);
  assert.equal(sent.filter((s) => s.userId === "p2").length, 1);
});

test("day end: reminders sent under the old soon/now keys are not repeated", () => {
  const state = baseState({ sent: [{ userId: "p1", nudgeKey: "day-end:2026-09-25:k-ryshi:soon", kind: "day-end", postedAt: iso("14:40"), status: "open", until: null, covers: ["k-ryshi:soon"] }] });
  const out = ofKind(loop.plan(state, at("15:12")), "day-end").filter((n) => n.userId === "p1");
  assert.equal(out[0].text, "Arya finishes Chess in 28 min (Room 3).");
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
