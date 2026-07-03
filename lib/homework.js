"use strict";
/**
 * Phase 3 — Homework hub.
 *
 * Homework is FAMILY/KID-scoped and lives SERVER-side (db.json, same pattern
 * as lib/family.js and lib/school-feeds.js) — shared across parents, and it
 * ingests server-side Phase 2 feed deadlines (see lib/school-feeds.js
 * collectFromCache(), which flags deadline events with isDeadline/
 * type:"deadline").
 *
 * Homework item shape:
 *   { id, familyId, kidId, title, subject, dueDate (YYYY-MM-DD), dueTime?,
 *     status: "todo"|"in_progress"|"done", effortMin?, source: "school"|
 *     "manual"|"ai", sourceUid?, notes?, checklist: [{text, done}],
 *     createdAt, updatedAt }
 *
 * Permissions are enforced by the CALLER (server.js routes) using the
 * exported canAccess() helper, mirroring how lib/family.js leaves auth
 * decisions to server.js while providing the primitives here.
 */
const crypto = require("crypto");
const db = require("./db");
const family = require("./family");

const STATUSES = new Set(["todo", "in_progress", "done"]);
const SOURCES = new Set(["school", "manual", "ai"]);

function root() {
  const r = db.load();
  if (!r.homework) r.homework = {};
  return r;
}

// root.homework[familyId] = [homework items...]
function famList(familyId) {
  const r = root();
  if (!r.homework[familyId]) r.homework[familyId] = [];
  return r.homework[familyId];
}

function hwId() {
  return "hw_" + crypto.randomBytes(9).toString("hex");
}

function sanitizeChecklist(checklist) {
  if (!Array.isArray(checklist)) return [];
  return checklist
    .slice(0, 50)
    .map((c) => ({
      text: String((c && c.text) || "").trim().slice(0, 200),
      done: !!(c && c.done),
    }))
    .filter((c) => c.text);
}

function sanitizeDueDate(dueDate) {
  const s = String(dueDate || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function sanitizeDueTime(dueTime) {
  const s = String(dueTime || "").trim();
  return /^\d{2}:\d{2}$/.test(s) ? s : null;
}

// ---------- CRUD ----------

// List homework for a family, optionally filtered by kidId/subject.
// Ownership scoping (kid sees only their own) is applied by the CALLER —
// this just filters by the params given, same division of labor as
// school-feeds.listFeedsForFamily / syncFamily.
function listForFamily(familyId, { kidId, subject } = {}) {
  let items = famList(familyId).slice();
  if (kidId) items = items.filter((h) => h.kidId === kidId);
  if (subject) {
    const s = String(subject).trim().toLowerCase();
    items = items.filter((h) => (h.subject || "").toLowerCase() === s);
  }
  return items.sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""));
}

function getById(familyId, id) {
  return famList(familyId).find((h) => h.id === id) || null;
}

function addHomework(familyId, { kidId, title, subject, dueDate, dueTime, effortMin, source, notes, checklist } = {}) {
  const fam = family.getFamily(familyId);
  if (!fam) return { error: "Family not found." };
  if (!kidId || !fam.kids.some((k) => k.id === kidId)) return { error: "Kid not found in this family." };
  const t = String(title || "").trim().slice(0, 200);
  if (!t) return { error: "Title is required." };
  const dd = sanitizeDueDate(dueDate);
  if (!dd) return { error: "A valid due date (YYYY-MM-DD) is required." };
  const src = SOURCES.has(source) ? source : "manual";

  const item = {
    id: hwId(),
    familyId,
    kidId,
    title: t,
    subject: String(subject || "").trim().slice(0, 60),
    dueDate: dd,
    dueTime: sanitizeDueTime(dueTime),
    status: "todo",
    effortMin: Number.isFinite(Number(effortMin)) && Number(effortMin) > 0 ? Math.round(Number(effortMin)) : null,
    source: src,
    sourceUid: null,
    notes: String(notes || "").trim().slice(0, 2000),
    checklist: sanitizeChecklist(checklist),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  famList(familyId).push(item);
  db.persist();
  return { homework: item };
}

// Updates status/fields/checklist. `patch` fields are all optional; only
// provided fields are applied. Ownership is checked by the caller before
// calling this (see canAccess below) — this function just applies the patch.
function updateHomework(familyId, id, patch = {}) {
  const item = getById(familyId, id);
  if (!item) return { error: "Homework item not found." };

  if (patch.title != null) {
    const t = String(patch.title).trim().slice(0, 200);
    if (!t) return { error: "Title cannot be empty." };
    item.title = t;
  }
  if (patch.subject != null) item.subject = String(patch.subject).trim().slice(0, 60);
  if (patch.dueDate != null) {
    const dd = sanitizeDueDate(patch.dueDate);
    if (!dd) return { error: "A valid due date (YYYY-MM-DD) is required." };
    item.dueDate = dd;
  }
  if (patch.dueTime !== undefined) item.dueTime = patch.dueTime ? sanitizeDueTime(patch.dueTime) : null;
  if (patch.status != null) {
    if (!STATUSES.has(patch.status)) return { error: "Invalid status." };
    item.status = patch.status;
  }
  if (patch.effortMin !== undefined) {
    item.effortMin = Number.isFinite(Number(patch.effortMin)) && Number(patch.effortMin) > 0
      ? Math.round(Number(patch.effortMin)) : null;
  }
  if (patch.notes != null) item.notes = String(patch.notes).trim().slice(0, 2000);
  if (patch.checklist != null) item.checklist = sanitizeChecklist(patch.checklist);

  item.updatedAt = new Date().toISOString();
  db.persist();
  return { homework: item };
}

function removeHomework(familyId, id) {
  const list = famList(familyId);
  const before = list.length;
  const filtered = list.filter((h) => h.id !== id);
  if (filtered.length === before) return { error: "Homework item not found." };
  root().homework[familyId] = filtered;
  db.persist();
  return { ok: true };
}

function toggleChecklistItem(familyId, id, index, done) {
  const item = getById(familyId, id);
  if (!item) return { error: "Homework item not found." };
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= item.checklist.length) {
    return { error: "Checklist item not found." };
  }
  item.checklist[idx].done = done === undefined ? !item.checklist[idx].done : !!done;
  item.updatedAt = new Date().toISOString();
  db.persist();
  return { homework: item };
}

// ---------- permissions ----------

// A kid may only touch homework where kidId === their own kid profile id; a
// parent may touch any homework in the family. `user` is the authenticated
// req.user; `role` is userRole(user) ("parent"|"kid") from server.js.
function canAccess(user, role, familyId, item) {
  if (!item || item.familyId !== familyId) return false;
  if (role === "kid") {
    const myKidId = user && user.data && user.data.kid && user.data.kid.kidId;
    return !!myKidId && item.kidId === myKidId;
  }
  return true; // any parent in the family may touch any homework in it
}

// ---------- ingestion from Phase 2 feed deadlines ----------

// Upserts homework from Phase 2 deadline events, keyed by sourceUid (the
// feed's iCal UID, scoped per subscription so it can't collide across kids/
// feeds — same key shape school-feeds.collectFromCache() dedups events by:
// `${subscriptionId}::${uid}`). A re-sync UPDATES the school-sourced fields
// (title/subject/dueDate/dueTime) but NEVER touches user-owned fields
// (status, notes, checklist, effortMin) so a kid's progress/notes survive
// re-ingestion. Only items with isDeadline/type:"deadline" are ingested —
// callers should already filter to those, but this defends in depth too.
function ingestDeadlines(familyId, deadlineEvents = []) {
  const list = famList(familyId);
  const bySourceUid = new Map(list.filter((h) => h.sourceUid).map((h) => [h.sourceUid, h]));
  let created = 0;
  let updated = 0;

  for (const ev of deadlineEvents) {
    if (!ev || !ev.isDeadline && ev.type !== "deadline") continue;
    if (!ev.kidId || !ev.uid || !ev.subscriptionId) continue; // need a kid + stable key to ingest
    const dueDate = ev.allDay ? ev.start : String(ev.start || "").slice(0, 10);
    if (!sanitizeDueDate(dueDate)) continue;
    const dueTime = (!ev.allDay && ev.start && ev.start.length > 10) ? ev.start.slice(11, 16) : null;
    const sourceUid = `${ev.subscriptionId}::${ev.uid}`;

    const existing = bySourceUid.get(sourceUid);
    if (existing) {
      // Update school-sourced descriptive fields only — never clobber status,
      // notes, checklist, or effortMin (the user's own progress/annotations).
      existing.title = String(ev.title || existing.title).trim().slice(0, 200);
      existing.dueDate = sanitizeDueDate(dueDate) || existing.dueDate;
      existing.dueTime = sanitizeDueTime(dueTime);
      existing.subject = existing.subject || (ev.feedLabel ? String(ev.feedLabel).slice(0, 60) : "");
      existing.updatedAt = new Date().toISOString();
      updated++;
    } else {
      const item = {
        id: hwId(),
        familyId,
        kidId: ev.kidId,
        title: String(ev.title || "Deadline").trim().slice(0, 200),
        subject: ev.feedLabel ? String(ev.feedLabel).slice(0, 60) : "",
        dueDate: sanitizeDueDate(dueDate),
        dueTime: sanitizeDueTime(dueTime),
        status: "todo",
        effortMin: null,
        source: "school",
        sourceUid,
        notes: ev.description ? String(ev.description).trim().slice(0, 2000) : "",
        checklist: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      list.push(item);
      bySourceUid.set(sourceUid, item);
      created++;
    }
  }

  if (created || updated) db.persist();
  return { created, updated };
}

// ---------- due-date grouping ----------
// Overdue / Today / This week / Later — used by both the client (rendering)
// and tests. `todayIso` defaults to real today but is injectable for tests.
function groupByDueDate(items, todayIso) {
  const today = todayIso || new Date().toISOString().slice(0, 10);
  const todayDate = new Date(today + "T00:00:00");
  const weekEnd = new Date(todayDate);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekEndIso = weekEnd.toISOString().slice(0, 10);

  const groups = { overdue: [], today: [], thisWeek: [], later: [] };
  for (const item of items) {
    if (!item.dueDate) { groups.later.push(item); continue; }
    if (item.status === "done") {
      // Completed items still need a home in the UI; keep them with their
      // natural due-date bucket rather than a separate "done" pile so
      // parents/kids see them in context (rendered with strikethrough).
    }
    if (item.dueDate < today) groups.overdue.push(item);
    else if (item.dueDate === today) groups.today.push(item);
    else if (item.dueDate <= weekEndIso) groups.thisWeek.push(item);
    else groups.later.push(item);
  }
  return groups;
}

module.exports = {
  listForFamily,
  getById,
  addHomework,
  updateHomework,
  removeHomework,
  toggleChecklistItem,
  canAccess,
  ingestDeadlines,
  groupByDueDate,
  STATUSES,
  SOURCES,
};
