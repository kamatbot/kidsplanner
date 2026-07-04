"use strict";
/**
 * Notes — a running family/kid journal fed by manual entries and "pin to
 * notes" actions from other surfaces (quote-of-the-day reflections, chat
 * pins, SAT word reflections, news reflections, mood/social check-ins).
 *
 * Notes are FAMILY-scoped (root.notes[familyId] = [...]) same storage shape
 * as lib/homework.js. Ownership: a kid may only see/edit their OWN notes
 * (authorId === their kidId); a parent may see the whole family's notes and
 * may filter by ?authorId=. Only the author may update/delete a note (see
 * canAccess below) — unlike homework, a parent does NOT get edit rights over
 * a kid's note by default (these are personal reflections), only read access
 * within the family.
 *
 * Encryption at rest: `body` and `ref.context` (free-text kid reflections/
 * quoted content) are encrypted with lib/datacrypto.js the same way
 * lib/school-account.js encrypts credentials — a second, field-level
 * encryption layer independent of (and in addition to) the whole-db.json
 * encryption in lib/db.js. When no DATA_ENCRYPTION_KEY is configured we fall
 * back to storing plaintext (matching lib/db.js's own fallback behavior for
 * dev/unconfigured deployments) rather than refusing to store notes at all.
 */
const crypto = require("crypto");
const db = require("./db");
const family = require("./family");
const datacrypto = require("./datacrypto");

const SOURCES = new Set(["manual", "quote", "sat", "chat", "social", "news"]);

function root() {
  const r = db.load();
  if (!r.notes) r.notes = {};
  return r;
}

// root.notes[familyId] = [notes...]
function famList(familyId) {
  const r = root();
  if (!r.notes[familyId]) r.notes[familyId] = [];
  return r.notes[familyId];
}

function noteId() {
  return "nt_" + crypto.randomBytes(9).toString("hex");
}

function todayLocalYMD() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function sanitizeDate(date) {
  const s = String(date || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

// ---------- field-level encrypt/decrypt ----------

function encField(plaintext) {
  const key = datacrypto.loadKey();
  if (!key) return String(plaintext || "");
  return datacrypto.encrypt(String(plaintext || ""), key);
}

function decField(stored) {
  if (typeof stored !== "string" || !datacrypto.isEncrypted(stored)) return stored || "";
  const key = datacrypto.loadKey();
  if (!key) return ""; // ciphertext present but no key available — never leak ciphertext
  try {
    return datacrypto.decrypt(stored, key);
  } catch (e) {
    return ""; // wrong/rotated key or corrupted blob — never surface raw ciphertext
  }
}

// Returns a shallow copy of the note with body/ref.context decrypted for
// callers (API responses, tests). The underlying stored object always keeps
// the encrypted (or plaintext-if-unconfigured) values.
function decorate(note) {
  if (!note) return note;
  const out = Object.assign({}, note, { body: decField(note.body) });
  if (note.ref) out.ref = Object.assign({}, note.ref, { context: decField(note.ref.context) });
  return out;
}

function sanitizeRef(ref) {
  if (!ref || typeof ref !== "object") return null;
  const kind = String(ref.kind || "").trim().slice(0, 40);
  const id = String(ref.id || "").trim().slice(0, 200);
  const context = String(ref.context || "").trim().slice(0, 4000);
  if (!kind && !id && !context) return null;
  return { kind, id, context: encField(context) };
}

// ---------- CRUD ----------

function addNote(familyId, { authorType, authorId, date, body, source, ref } = {}) {
  const fam = family.getFamily(familyId);
  if (!fam) return { error: "Family not found." };
  if (authorType !== "kid" && authorType !== "parent") return { error: "Invalid author type." };
  if (!authorId) return { error: "Missing author." };
  const b = String(body || "").trim().slice(0, 4000);
  if (!b) return { error: "Note body is required." };
  const src = SOURCES.has(source) ? source : "manual";
  const d = sanitizeDate(date) || todayLocalYMD();

  const note = {
    id: noteId(),
    familyId,
    authorType,
    authorId,
    date: d,
    body: encField(b),
    source: src,
    ref: sanitizeRef(ref),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  famList(familyId).push(note);
  db.persist();
  return { note: decorate(note) };
}

// desc by date then createdAt (most recent first)
function listNotes(familyId, { authorId, from, to } = {}) {
  let items = famList(familyId).slice();
  if (authorId) items = items.filter((n) => n.authorId === authorId);
  const fromD = sanitizeDate(from);
  const toD = sanitizeDate(to);
  if (fromD) items = items.filter((n) => n.date >= fromD);
  if (toD) items = items.filter((n) => n.date <= toD);
  items.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
  return items.map(decorate);
}

// Internal getById returns the RAW (encrypted) note — used by canAccess/
// update/remove which don't need decrypted content. Routes that need the
// decrypted note should use getByIdDecorated.
function getByIdRaw(familyId, id) {
  return famList(familyId).find((n) => n.id === id) || null;
}

function getById(familyId, id) {
  return decorate(getByIdRaw(familyId, id));
}

function updateNote(familyId, id, { body } = {}) {
  const note = getByIdRaw(familyId, id);
  if (!note) return { error: "Note not found." };
  const b = String(body || "").trim().slice(0, 4000);
  if (!b) return { error: "Note body is required." };
  note.body = encField(b);
  note.updatedAt = new Date().toISOString();
  db.persist();
  return { note: decorate(note) };
}

function removeNote(familyId, id) {
  const list = famList(familyId);
  const before = list.length;
  const filtered = list.filter((n) => n.id !== id);
  if (filtered.length === before) return { error: "Note not found." };
  root().notes[familyId] = filtered;
  db.persist();
  return { ok: true };
}

// ---------- permissions ----------
// Only the author may update/delete their own note. Any family member (kid
// or parent) may READ any note within their own family via listNotes/
// getById scoping done by the caller (server.js routes) — this function
// gates WRITE access only.
function canAccess(note, user) {
  if (!note) return false;
  const role = (user && user.data && user.data.profile && user.data.profile.role) || "parent";
  if (role === "kid") {
    const myKidId = user && user.data && user.data.kid && user.data.kid.kidId;
    return !!myKidId && note.authorId === myKidId && note.authorType === "kid";
  }
  return note.authorId === user.id && note.authorType === "parent";
}

module.exports = {
  addNote,
  listNotes,
  getById,
  updateNote,
  removeNote,
  canAccess,
  SOURCES,
};
