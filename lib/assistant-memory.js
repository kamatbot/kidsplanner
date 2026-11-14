"use strict";

/**
 * What Hermes keeps between conversations (lib/family-assistant.js).
 *
 * Hermes is stateless per reply, so anything it should still know tomorrow
 * lives here, in the family's encrypted db root `assistantMemory[familyId]`:
 *
 *   notes      facts a parent asked Hermes to remember, plus a few it learned
 *              from parents' chat messages ("dinner is at 7", "swim moved to
 *              Thursdays"). Loaded into every reply. Parents see and delete
 *              them in Settings.
 *   reminders  "remind me at 5 to call the dentist": fired on time by the
 *              proactive loop into the parent's Hermes thread.
 *   followUps  requests and promises spotted in family chat ("can someone buy
 *              milk?") that nobody has acted on yet (lib/chat-followups.js).
 *   changes    the undo log: every write Hermes made, grouped by the request
 *              that caused it, with what each record looked like before.
 *   held       writes waiting for a parent's Confirm tap.
 *   inbox      parent messages waiting for an answer, so a restart mid-reply
 *              doesn't drop them.
 *
 * Routines are not stored: they are re-learned from the calendar's own
 * history (learnRoutines), so they can never drift from what really happened.
 * Store only what can't be looked up again.
 */

const crypto = require("crypto");
const db = require("./db");

const MAX_NOTES = 40;
const MAX_LEARNED_NOTES = 20;
const MAX_NOTE_CHARS = 200;
const MAX_REMINDERS = 60;
const MAX_FOLLOWUPS = 40;
const MAX_CHANGES = 60;
const CHANGE_TTL_MS = 3 * 86400000;
const HELD_TTL_MS = 86400000;
const REMINDER_KEEP_MS = 7 * 86400000;
const FOLLOWUP_KEEP_MS = 10 * 86400000;

function newId(prefix) { return `${prefix}_${crypto.randomBytes(6).toString("hex")}`; }
function clean(value, max) {
  return Array.from(String(value == null ? "" : value).replace(/\s+/g, " ").trim()).slice(0, max).join("");
}
function normTitle(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

function memoryFor(familyId) {
  const root = db.load();
  if (!root.assistantMemory) root.assistantMemory = {};
  if (!root.assistantMemory[familyId]) root.assistantMemory[familyId] = {};
  const m = root.assistantMemory[familyId];
  for (const key of ["notes", "reminders", "followUps", "changes"]) if (!Array.isArray(m[key])) m[key] = [];
  for (const key of ["held", "scan"]) if (!m[key] || typeof m[key] !== "object") m[key] = {};
  return m;
}
function save() { db.persist(); }

// ---------------------------------------------------------------- notes
function listNotes(familyId) { return memoryFor(familyId).notes.slice(); }

function addNote(familyId, { text, by = null, source = "parent", messageId = null } = {}) {
  const body = clean(text, MAX_NOTE_CHARS);
  if (!body) return { error: "A note needs text." };
  const m = memoryFor(familyId);
  const existing = m.notes.find((n) => normTitle(n.text) === normTitle(body));
  if (existing) return { note: existing, existing: true };
  const note = { id: newId("note"), text: body, by, source: source === "chat" ? "chat" : "parent", messageId, at: new Date().toISOString() };
  m.notes.push(note);
  // Learned notes make room first; a parent's own notes go only when the list is full.
  const learned = m.notes.filter((n) => n.source === "chat");
  if (learned.length > MAX_LEARNED_NOTES) m.notes.splice(m.notes.indexOf(learned[0]), 1);
  while (m.notes.length > MAX_NOTES) m.notes.shift();
  save();
  return { note };
}

function removeNote(familyId, noteId, { onlyLearned = false } = {}) {
  const m = memoryFor(familyId);
  const i = m.notes.findIndex((n) => n.id === noteId && (!onlyLearned || n.source === "chat"));
  if (i < 0) return { error: "Note not found." };
  const [note] = m.notes.splice(i, 1);
  save();
  return { note };
}

// ---------------------------------------------------------------- reminders
function addReminder(familyId, { userId, text, at, createdBy = null, messageId = null }) {
  const body = clean(text, 200);
  const ms = Date.parse(at);
  if (!body) return { error: "A reminder needs text." };
  if (!Number.isFinite(ms)) return { error: "A reminder needs a valid time." };
  const m = memoryFor(familyId);
  // The same request retried by the model (or a resent message) never sets two.
  const dup = m.reminders.find((r) => r.status === "pending" && r.userId === userId && r.at === new Date(ms).toISOString() && normTitle(r.text) === normTitle(body));
  if (dup) return { reminder: dup, existing: true };
  const reminder = { id: newId("rem"), userId, text: body, at: new Date(ms).toISOString(), status: "pending", createdBy, messageId, createdAt: new Date().toISOString(), snoozes: 0 };
  m.reminders.push(reminder);
  prune(m, Date.now());
  save();
  return { reminder };
}
function getReminder(familyId, id) { return memoryFor(familyId).reminders.find((r) => r.id === id) || null; }
function updateReminder(familyId, id, patch) {
  const r = getReminder(familyId, id);
  if (!r) return null;
  Object.assign(r, patch);
  save();
  return r;
}
function listReminders(familyId) { return memoryFor(familyId).reminders.slice(); }

// ---------------------------------------------------------------- chat follow-ups
function listFollowUps(familyId) { return memoryFor(familyId).followUps.slice(); }
function getFollowUp(familyId, id) { return memoryFor(familyId).followUps.find((f) => f.id === id) || null; }
function addFollowUp(familyId, item) {
  const m = memoryFor(familyId);
  if (item.sourceMessageId && m.followUps.some((f) => f.sourceMessageId === item.sourceMessageId && normTitle(f.text) === normTitle(item.text))) return null;
  const entry = Object.assign({ id: newId("fu"), status: "open", createdAt: new Date().toISOString(), snoozes: 0, nudgeAt: null }, item);
  m.followUps.push(entry);
  prune(m, Date.now());
  save();
  return entry;
}
function updateFollowUp(familyId, id, patch) {
  const f = getFollowUp(familyId, id);
  if (!f) return null;
  Object.assign(f, patch);
  save();
  return f;
}

// ---------------------------------------------------------------- undo log
function recordChange(familyId, change) {
  const m = memoryFor(familyId);
  m.changes.push(Object.assign({ id: newId("chg"), at: new Date().toISOString(), undone: false }, change));
  prune(m, Date.now());
  save();
}
function changesFor(familyId, requestId) {
  return memoryFor(familyId).changes.filter((c) => c.requestId === requestId && !c.undone);
}
/** The newest request by this parent that still has changes to undo. */
function lastRequestWithChanges(familyId, userId, { exceptRequestId = null } = {}) {
  const list = memoryFor(familyId).changes;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const c = list[i];
    if (!c.undone && c.userId === userId && c.requestId !== exceptRequestId) return c.requestId;
  }
  return null;
}
function markUndone(familyId, ids) {
  const set = new Set(ids);
  for (const c of memoryFor(familyId).changes) if (set.has(c.id)) c.undone = true;
  save();
}

// ---------------------------------------------------------------- held for Confirm
function holdWrites(familyId, entry) {
  const m = memoryFor(familyId);
  const id = newId("hold");
  m.held[id] = Object.assign({ id, createdAt: new Date().toISOString(), status: "pending" }, entry);
  prune(m, Date.now());
  save();
  return m.held[id];
}
function getHeld(familyId, id) {
  const h = memoryFor(familyId).held[id];
  if (!h) return null;
  if (Date.now() - Date.parse(h.createdAt) > HELD_TTL_MS && h.status === "pending") h.status = "expired";
  return h;
}
function finishHeld(familyId, id, status) {
  const h = memoryFor(familyId).held[id];
  if (h) { h.status = status; save(); }
  return h;
}

// ---------------------------------------------------------------- inbox (restart safety)
function inbox() {
  const root = db.load();
  if (!root.assistantInbox || typeof root.assistantInbox !== "object") root.assistantInbox = {};
  return root.assistantInbox;
}
function inboxAdd(scopeKey, familyId, messageId) {
  const box = inbox();
  const entry = box[scopeKey] || { familyId, messageIds: [], at: new Date().toISOString() };
  if (!entry.messageIds.includes(messageId)) entry.messageIds.push(messageId);
  entry.at = new Date().toISOString();
  box[scopeKey] = entry;
  save();
}
function inboxTake(scopeKey) {
  const box = inbox();
  const entry = box[scopeKey] || null;
  return entry ? { ...entry, messageIds: entry.messageIds.slice() } : null;
}
function inboxDone(scopeKey, messageIds) {
  const box = inbox();
  const entry = box[scopeKey];
  if (!entry) return;
  entry.messageIds = entry.messageIds.filter((id) => !messageIds.includes(id));
  if (!entry.messageIds.length) delete box[scopeKey];
  save();
}
function inboxEntries() { return Object.entries(inbox()).map(([scopeKey, e]) => ({ scopeKey, ...e })); }

// ---------------------------------------------------------------- scan state
function scanState(familyId) { return memoryFor(familyId).scan; }
function setScanState(familyId, patch) { Object.assign(memoryFor(familyId).scan, patch); save(); }

function prune(m, nowMs) {
  m.changes = m.changes.filter((c) => nowMs - Date.parse(c.at) < CHANGE_TTL_MS).slice(-MAX_CHANGES);
  m.reminders = m.reminders.filter((r) => r.status === "pending" || nowMs - Date.parse(r.at) < REMINDER_KEEP_MS).slice(-MAX_REMINDERS);
  m.followUps = m.followUps.filter((f) => f.status === "open" || nowMs - Date.parse(f.createdAt) < FOLLOWUP_KEEP_MS).slice(-MAX_FOLLOWUPS);
  for (const [id, h] of Object.entries(m.held)) if (nowMs - Date.parse(h.createdAt) > 3 * HELD_TTL_MS) delete m.held[id];
}

// ---------------------------------------------------------------- routines
// A routine is something the calendar shows happening on the same weekday,
// for the same kid, in at least 3 of the last 6 weeks, and in 2 of the last 3
// (so a finished term stops counting). Repeating events are already known to
// the calendar, so only one-off entries teach anything new.
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const LOOKBACK_WEEKS = 6;
function dayDiff(a, b) { return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000); }
function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function weekdayOf(ymd) { return WEEKDAYS[new Date(`${ymd}T00:00:00Z`).getUTCDay()]; }
function mostCommon(values) {
  const counts = new Map();
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  let best = null, n = 0;
  for (const [v, c] of counts) if (c > n) { best = v; n = c; }
  return best;
}

function learnRoutines(eventsInWindow, today) {
  const groups = new Map();
  for (const e of eventsInWindow || []) {
    if (!e || e.recurring || (e.repeat && e.repeat !== "none")) continue;
    if (e.sourceType === "school" || e.sourceType === "school-api") continue;
    if (!e.date || e.date >= today || dayDiff(today, e.date) > LOOKBACK_WEEKS * 7) continue;
    const title = normTitle(e.title);
    if (!title) continue;
    const key = `${e.kidId || ""}|${title}|${weekdayOf(e.date)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const routines = [];
  for (const list of groups.values()) {
    const weeksAgo = new Set(list.map((e) => Math.floor((dayDiff(today, e.date) - 1) / 7)));
    const recent = [0, 1, 2].filter((w) => weeksAgo.has(w)).length;
    if (weeksAgo.size < 3 || recent < 2) continue;
    const latest = list.reduce((a, b) => (a.date > b.date ? a : b));
    routines.push({
      title: clean(latest.title, 80),
      kidId: latest.kidId || null,
      weekday: weekdayOf(latest.date),
      time: mostCommon(list.map((e) => e.time)) || null,
      endTime: mostCommon(list.map((e) => e.endTime)) || null,
      category: latest.category || "other",
      weeks: weeksAgo.size,
      outOf: LOOKBACK_WEEKS,
    });
  }
  return routines.sort((a, b) => WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday) || String(a.time).localeCompare(String(b.time)));
}

/** Routine days in [from, to] with nothing like it on the calendar. */
function routineGaps(routines, eventsInRange, from, to) {
  const gaps = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const onDay = (eventsInRange || []).filter((e) => e && e.date === day);
    for (const r of routines) {
      if (r.weekday !== weekdayOf(day)) continue;
      const title = normTitle(r.title);
      const present = onDay.some((e) => {
        const t = normTitle(e.title);
        return (t === title || t.includes(title) || title.includes(t)) && (!r.kidId || !e.kidId || e.kidId === r.kidId);
      });
      if (!present) gaps.push(Object.assign({ date: day }, r));
    }
  }
  return gaps;
}

module.exports = {
  normTitle,
  memoryFor,
  listNotes, addNote, removeNote,
  addReminder, getReminder, updateReminder, listReminders,
  listFollowUps, getFollowUp, addFollowUp, updateFollowUp,
  recordChange, changesFor, lastRequestWithChanges, markUndone,
  holdWrites, getHeld, finishHeld,
  inboxAdd, inboxTake, inboxDone, inboxEntries,
  scanState, setScanState,
  learnRoutines, routineGaps,
  _internal: { addDays, weekdayOf },
};
