"use strict";

// Hermes' memory, reminders, undo/confirm, inbox batching and chat follow-ups
// (lib/assistant-memory.js, lib/family-assistant.js, lib/chat-followups.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-assistant-memory-"));
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
process.env.ANTHROPIC_API_KEY = "test-key";
process.env.FAM_ASSISTANT_RETRY_MS = "0";
process.env.FAM_ASSISTANT_BATCH_MS = "5";

const store = require("../lib/store");
const family = require("../lib/family");
const chat = require("../lib/chat");
const events = require("../lib/events");
const actions = require("../lib/actions");
const memory = require("../lib/assistant-memory");
const assistant = require("../lib/family-assistant");
const followups = require("../lib/chat-followups");
const hermesThreads = require("../lib/hermes-threads");
const hermesProactive = require("../lib/hermes-proactive");
const loop = require("../lib/proactive-loop");

let counter = 0;
function fixture() {
  counter += 1;
  const parent = store.createUser(`am${counter}@example.com`, `Mayur ${counter}`);
  const fam = family.createFamily(parent.id, "Memory Family");
  fam.timezone = "Asia/Bangkok";
  const ryshi = family.addKid(fam.id, parent.id, { name: "Ryshi" }).kid;
  return { parent, fam, ryshi, scope: hermesThreads.scopeFor(parent.id) };
}
function say(scopeKey, parent, text) {
  return chat.sendMessage(scopeKey, { senderType: "parent", senderId: parent.id, postedByUserId: parent.id, text }).message;
}
function mockClaude(responses) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const next = responses.shift();
    if (!next) throw new Error("unexpected call");
    if (next.status) return { ok: false, status: next.status, headers: { get: () => null }, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => next };
  };
  return { calls, restore() { global.fetch = original; } };
}
const toolUse = (name, input, id = name) => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id, name, input }] });
const say_ = (text) => ({ stop_reason: "end_turn", content: [{ type: "text", text }] });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const iso = (day, hhmm) => new Date(`${day}T${hhmm}:00+07:00`).toISOString();
function press(fam, parent, message, actionId) {
  const member = hermesThreads.memberFor(fam, parent.id);
  return hermesThreads.applyAction({ fam, member, messageId: message.id, actionId });
}

// ---------------------------------------------------------------- routines
test("routines are learned from one-off calendar entries and gaps are spotted", () => {
  const today = "2026-11-15"; // a Sunday
  const past = ["2026-11-10", "2026-11-03", "2026-10-27", "2026-10-13"].map((date) => ({ id: date, title: "Swimming", date, time: "16:00", endTime: "17:00", kidId: "k1" }));
  past.push({ id: "w", title: "Dentist", date: "2026-11-11" });
  past.push({ id: "r", title: "Piano", date: "2026-11-12", repeat: "weekly", recurring: true });
  const routines = memory.learnRoutines(past, today);
  assert.deepEqual(routines.map((r) => [r.title, r.weekday, r.time, r.weeks]), [["Swimming", "tue", "16:00", 4]]);
  const gaps = memory.routineGaps(routines, [], "2026-11-16", "2026-11-22");
  assert.deepEqual(gaps.map((g) => g.date), ["2026-11-17"]);
  assert.deepEqual(memory.routineGaps(routines, [{ title: "swimming lesson", date: "2026-11-17", kidId: "k1" }], "2026-11-16", "2026-11-22"), []);
  // Stopped two weeks ago: no longer a routine.
  assert.deepEqual(memory.learnRoutines(past.filter((e) => e.date < "2026-11-01"), today), []);
});

test("the Sunday card offers to add a missing routine and its button adds it", () => {
  const { parent, fam, ryshi } = fixture();
  for (const date of ["2026-11-10", "2026-11-03", "2026-10-27"]) events.addEvent(fam.id, { title: "Swimming", date, time: "16:00", endTime: "17:00", kidId: ryshi.id });
  const now = new Date(iso("2026-11-15", "18:00"));
  const state = hermesProactive.buildState(fam, now);
  assert.equal(state.nextWeekGaps.length, 1);
  const nudges = loop.plan(state, now).filter((n) => n.card.kind === "routine-gap");
  assert.equal(nudges.length, 1);
  assert.match(nudges[0].text, /Swimming usually happens on Tues/);
  const posted = hermesThreads.postNudge(fam, nudges[0], { now, internal: true });
  const out = press(fam, parent, posted.message, "add-routine:0");
  assert.equal(out.message.card.actions[0].done, true);
  assert.ok(events.listEvents(fam.id, { from: "2026-11-17", to: "2026-11-17" }).some((e) => e.title === "Swimming" && e.time === "16:00"));
  // Turning the topic off stops it.
  hermesThreads.setHelpsWith(fam, { routines: false });
  assert.equal(loop.plan(hermesProactive.buildState(fam, now), now).filter((n) => n.card.kind === "routine-gap").length, 0);
});

// ---------------------------------------------------------------- notes
test("remember saves a note that later replies see, forget removes it", async () => {
  const { parent, fam, scope } = fixture();
  const claude = mockClaude([toolUse("remember", { text: "Dinner is at 7pm" }), say_("Got it."), say_("Dinner is at 7.")]);
  try {
    await assistant.respond({ fam, scopeKey: scope, message: say(scope, parent, "remember dinner is at 7pm") });
    await assistant.respond({ fam, scopeKey: scope, message: say(scope, parent, "when is dinner?") });
  } finally { claude.restore(); }
  const notes = memory.listNotes(fam.id);
  assert.deepEqual(notes.map((n) => n.text), ["Dinner is at 7pm"]);
  assert.match(claude.calls[2].body.system[1].text, /Dinner is at 7pm/);
  memory.removeNote(fam.id, notes[0].id);
  assert.equal(memory.listNotes(fam.id).length, 0);
});

// ---------------------------------------------------------------- reminders
test("remind me: the reminder buzzes on time, even in quiet hours, and can be snoozed", async () => {
  const { parent, fam, scope } = fixture();
  const claude = mockClaude([toolUse("set_reminder", { text: "Call the dentist", date: "2099-01-05", time: "22:00" }), say_("I'll remind you at 10pm.")]);
  try { await assistant.respond({ fam, scopeKey: scope, message: say(scope, parent, "remind me at 10pm to call the dentist") }); }
  finally { claude.restore(); }
  const [reminder] = memory.listReminders(fam.id);
  assert.equal(reminder.at, iso("2099-01-05", "22:00"));
  const early = new Date(iso("2099-01-05", "21:59"));
  assert.equal(loop.plan(hermesProactive.buildState(fam, early), early).filter((n) => n.card.kind === "reminder").length, 0);
  const now = new Date(iso("2099-01-05", "22:00"));
  const due = loop.plan(hermesProactive.buildState(fam, now), now).filter((n) => n.card.kind === "reminder");
  assert.equal(due.length, 1);
  assert.equal(due[0].text, "Reminder: Call the dentist");
  const posted = hermesThreads.postNudge(fam, due[0], { now, internal: true });
  memory.updateReminder(fam.id, reminder.id, { status: "sent" });
  const snoozed = hermesThreads.applyAction({ fam, member: hermesThreads.memberFor(fam, parent.id), messageId: posted.message.id, actionId: "reminder-snooze", now });
  assert.equal(snoozed.message.card.state.status, "snoozed");
  assert.equal(memory.getReminder(fam.id, reminder.id).status, "pending");
  const later = new Date(now.getTime() + 30 * 60000);
  const again = loop.plan(hermesProactive.buildState(fam, later), later).filter((n) => n.card.kind === "reminder");
  assert.equal(again[0].nudgeKey, `reminder:${reminder.id}:1`);
});

test("a reminder in the past is refused back to the model", async () => {
  const { parent, fam, scope } = fixture();
  const claude = mockClaude([toolUse("set_reminder", { text: "x", date: "2001-01-01", time: "09:00" }), say_("That time has passed.")]);
  try { await assistant.respond({ fam, scopeKey: scope, message: say(scope, parent, "remind me yesterday") }); }
  finally { claude.restore(); }
  assert.equal(claude.calls[1].body.messages.at(-1).content[0].is_error, true);
  assert.equal(memory.listReminders(fam.id).length, 0);
});

// ---------------------------------------------------------------- undo / confirm
test("a reply that changed something carries Undo, and Undo reverses it", async () => {
  const { parent, fam, scope } = fixture();
  const claude = mockClaude([toolUse("add_event", { title: "Swim", date: "2099-02-03", time: "16:00" }), say_("Added Swim.")]);
  let reply;
  try { reply = await assistant.respond({ fam, scopeKey: scope, message: say(scope, parent, "add swim tuesday 4pm") }); }
  finally { claude.restore(); }
  assert.equal(reply.message.card.kind, "assistant-done");
  assert.equal(events.listEvents(fam.id, { from: "2099-02-03", to: "2099-02-03" }).length, 1);
  const out = press(fam, parent, reply.message, "undo");
  assert.equal(out.message.card.state.label, "Undone");
  assert.equal(events.listEvents(fam.id, { from: "2099-02-03", to: "2099-02-03" }).length, 0);
});

test("'undo that' restores an updated to-do through the tool", async () => {
  const { parent, fam, scope } = fixture();
  const todo = actions.createAction(fam.id, { title: "Buy milk", createdBy: parent.id }).action;
  const claude = mockClaude([
    toolUse("update_todo", { actionId: todo.id, patch: { title: "Buy oat milk", status: "done" } }), say_("Done."),
    toolUse("undo_last", {}), say_("Undone."),
  ]);
  try {
    await assistant.respond({ fam, scopeKey: fam.id, message: say(fam.id, parent, "@Hermes mark milk done, oat milk") });
    assert.equal(actions.getById(fam.id, todo.id).status, "done");
    await assistant.respond({ fam, scopeKey: fam.id, message: say(fam.id, parent, "@Hermes undo that") });
  } finally { claude.restore(); }
  const back = actions.getById(fam.id, todo.id);
  assert.equal(back.title, "Buy milk");
  assert.equal(back.status, "open");
});

test("repeating events wait for Confirm; Cancel leaves the calendar alone", async () => {
  const { parent, fam, scope } = fixture();
  const claude = mockClaude([
    toolUse("add_event", { title: "Piano", date: "2099-03-02", time: "17:00", repeat: "weekly" }), say_("Piano every Monday is ready to add."),
    toolUse("add_event", { title: "Chess", date: "2099-03-03", repeat: "weekly" }), say_("Chess is ready."),
  ]);
  let first, second;
  try {
    first = await assistant.respond({ fam, scopeKey: scope, message: say(scope, parent, "piano every monday 5pm") });
    second = await assistant.respond({ fam, scopeKey: scope, message: say(scope, parent, "chess every tuesday") });
  } finally { claude.restore(); }
  assert.match(claude.calls[0].body.messages.length ? JSON.stringify(claude.calls[1].body.messages.at(-1)) : "", /HELD_FOR_CONFIRMATION/);
  assert.equal(first.message.card.kind, "assistant-confirm");
  assert.equal(events.listEvents(fam.id, { from: "2099-03-01", to: "2099-03-31" }).length, 0);
  const confirmed = press(fam, parent, first.message, "confirm");
  assert.match(confirmed.message.card.state.label, /Done · 1 change/);
  assert.equal(events.listEvents(fam.id, { from: "2099-03-01", to: "2099-03-31" }).filter((e) => e.title === "Piano").length, 5);
  press(fam, parent, second.message, "cancel");
  assert.equal(events.listEvents(fam.id, { from: "2099-03-01", to: "2099-03-31" }).filter((e) => e.title === "Chess").length, 0);
});

// ---------------------------------------------------------------- inbox, retry, caching
test("three quick messages get one reply; a busy API is retried once", async () => {
  const { parent, fam, scope } = fixture();
  const claude = mockClaude([{ status: 529 }, say_("Milk, eggs and bread are noted.")]);
  try {
    for (const text of ["need milk", "and eggs", "and bread"]) assistant.handleAsync({ fam, scopeKey: scope, message: say(scope, parent, text) });
    for (let i = 0; i < 50 && chat.listMessages(scope).filter((m) => m.senderType === "agent").length === 0; i += 1) await wait(10);
  } finally { claude.restore(); }
  assert.equal(claude.calls.length, 2);
  assert.match(claude.calls[1].body.messages.at(-1).content, /need milk\n.*and eggs\n.*and bread/);
  assert.equal(chat.listMessages(scope).filter((m) => m.senderType === "agent").length, 1);
  assert.equal(memory.inboxTake(scope), null);
});

test("a message interrupted by a restart is answered on recovery", async () => {
  const { parent, fam, scope } = fixture();
  const msg = say(scope, parent, "what's on today?");
  memory.inboxAdd(scope, fam.id, msg.id);
  const claude = mockClaude([say_("Nothing today.")]);
  try {
    assert.equal(assistant.recover(), 1);
    for (let i = 0; i < 50 && !chat.listMessages(scope).some((m) => m.senderType === "agent"); i += 1) await wait(10);
  } finally { claude.restore(); }
  assert.equal(chat.listMessages(scope).at(-1).text, "Nothing today.");
});

// ---------------------------------------------------------------- chat follow-ups
function chatAt(fam, sender, text, createdAt) {
  const isKid = sender.kid;
  const msg = chat.sendMessage(fam.id, isKid
    ? { senderType: "kid", senderId: sender.kid.id, postedByUserId: sender.userId || null, text }
    : { senderType: "parent", senderId: sender.id, postedByUserId: sender.id, text }).message;
  if (createdAt) msg.createdAt = createdAt;
  return msg;
}

test("chat follow-ups: a forgotten request reaches the parent later; kid-owned items never alert parents", async () => {
  const { parent, fam, ryshi } = fixture();
  const ask = chatAt(fam, parent, "Can someone buy milk today?");
  const kidTask = chatAt(fam, parent, "Ryshi please pack your PE kit");
  const fact = chatAt(fam, parent, "FYI swim moved to Thursdays for good");
  const scanAt = new Date(Date.now() + 15 * 60000);
  const claude = mockClaude([{ stop_reason: "tool_use", content: [{ type: "tool_use", id: "r", name: "report", input: {
    newItems: [
      { text: "Buy milk", sourceMessageId: ask.id, ownerType: "anyone", askedById: parent.id },
      { text: "Pack PE kit", sourceMessageId: kidTask.id, ownerType: "kid", ownerId: ryshi.id, askedById: parent.id },
    ],
    resolvedIds: [], facts: [{ text: "Swim is on Thursdays", sourceMessageId: fact.id }], outdatedNoteIds: [],
  } }] }]);
  try { assert.deepEqual(await followups.scan(fam, scanAt), { added: 2 }); }
  finally { claude.restore(); }
  assert.equal(claude.calls[0].body.tool_choice.name, "report");
  assert.deepEqual(memory.listNotes(fam.id).map((n) => [n.text, n.source]), [["Swim is on Thursdays", "chat"]]);
  // Nothing new to read: no second call.
  assert.equal(followups.pendingMessages(fam, new Date(scanAt.getTime() + 30 * 60000)), null);

  for (const f of memory.listFollowUps(fam.id)) memory.updateFollowUp(fam.id, f.id, { createdAt: iso("2099-05-05", "08:00") });
  const soon = new Date(iso("2099-05-05", "10:00"));
  assert.equal(loop.plan(hermesProactive.buildState(fam, soon), soon).filter((n) => n.card.kind === "chat-followup").length, 0);
  const later = new Date(iso("2099-05-05", "11:30"));
  const state = hermesProactive.buildState(fam, later);
  const nudges = loop.plan(state, later).filter((n) => n.card.kind === "chat-followup");
  assert.deepEqual(nudges.map((n) => [n.userId, n.text.startsWith("Still open: Buy milk.")]), [[parent.id, true]]);
  const posted = hermesThreads.postNudge(fam, nudges[0], { internal: true });
  press(fam, parent, posted.message, "followup-todo");
  assert.ok(actions.listActions(fam.id, {}).some((a) => a.title === "Buy milk"));
  const item = memory.listFollowUps(fam.id).find((f) => f.text === "Buy milk");
  assert.equal(item.status, "todo");
  const kidItem = memory.listFollowUps(fam.id).find((f) => f.text === "Pack PE kit");
  assert.deepEqual(hermesProactive.followUpFacts(fam, state.today, "Asia/Bangkok", later).find((f) => f.id === kidItem.id).userIds, []);
});

test("a follow-up that a to-do already covers never fires", () => {
  const { parent, fam } = fixture();
  memory.addFollowUp(fam.id, { text: "Book the dentist", ownerType: "anyone", createdAt: new Date(Date.now() - 5 * 3600000).toISOString() });
  actions.createAction(fam.id, { title: "Dentist booking for Ryshi", createdBy: parent.id });
  const now = new Date();
  const [fact] = hermesProactive.followUpFacts(fam, hermesProactive.dateKey(now, "Asia/Bangkok"), "Asia/Bangkok", now);
  assert.equal(fact.handled, true);
});

// ---------------------------------------------------------------- morning summary
test("morning summary is opt-in and lists today's plan", () => {
  const { fam, ryshi } = fixture();
  events.addEvent(fam.id, { title: "Football", date: "2099-04-06", time: "16:00", kidId: ryshi.id });
  const now = new Date(iso("2099-04-06", "07:05"));
  assert.equal(loop.plan(hermesProactive.buildState(fam, now), now).filter((n) => n.card.kind === "morning").length, 0);
  hermesThreads.setHelpsWith(fam, { summaries: true });
  const [morning] = loop.plan(hermesProactive.buildState(fam, now), now).filter((n) => n.card.kind === "morning");
  assert.match(morning.text, /Good morning/);
  assert.deepEqual(morning.card.lines, ["16:00 · Football · Ryshi"]);
});
