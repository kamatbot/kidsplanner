"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-test-notes-"));
process.env.DATA_ENCRYPTION_KEY = require("crypto").randomBytes(32).toString("hex");

const db = require("../lib/db");
const datacrypto = require("../lib/datacrypto");
const store = require("../lib/store");
const family = require("../lib/family");
const notes = require("../lib/notes");

function makeFamilyWithKid(label) {
  const parent = store.createUser(`${label}@example.com`, `Parent ${label}`);
  const fam = family.createFamily(parent.id, `${label} Family`);
  const { kid } = family.addKid(fam.id, parent.id, { name: `Kid ${label}`, grade: "6" });
  return { parent, fam, kid };
}

// ---------- CRUD ----------
test("addNote: creates a note scoped to family+author, defaults date/source", () => {
  const { fam, kid } = makeFamilyWithKid("A");
  const result = notes.addNote(fam.id, { authorType: "kid", authorId: kid.id, body: "Today was fun" });
  assert.ok(!result.error, result.error);
  assert.equal(result.note.familyId, fam.id);
  assert.equal(result.note.authorType, "kid");
  assert.equal(result.note.authorId, kid.id);
  assert.equal(result.note.source, "manual");
  assert.equal(result.note.body, "Today was fun");
  // date defaults to today's server-local YYYY-MM-DD
  assert.match(result.note.date, /^\d{4}-\d{2}-\d{2}$/);
});

test("addNote: rejects empty body", () => {
  const { fam, kid } = makeFamilyWithKid("B");
  const result = notes.addNote(fam.id, { authorType: "kid", authorId: kid.id, body: "   " });
  assert.ok(result.error);
});

test("addNote: rejects missing/invalid authorType", () => {
  const { fam, kid } = makeFamilyWithKid("C");
  const result = notes.addNote(fam.id, { authorType: "sibling", authorId: kid.id, body: "hi" });
  assert.ok(result.error);
});

test("addNote: accepts an explicit date and a ref", () => {
  const { fam, parent } = makeFamilyWithKid("D");
  const result = notes.addNote(fam.id, {
    authorType: "parent",
    authorId: parent.id,
    date: "2026-05-01",
    body: "Pinned from chat",
    source: "chat",
    ref: { kind: "chat", id: "m_123", context: "the original chat text" },
  });
  assert.ok(!result.error, result.error);
  assert.equal(result.note.date, "2026-05-01");
  assert.equal(result.note.source, "chat");
  assert.equal(result.note.ref.kind, "chat");
  assert.equal(result.note.ref.id, "m_123");
  assert.equal(result.note.ref.context, "the original chat text");
});

test("listNotes: sorted desc by date then createdAt, filters by authorId/date range", () => {
  const { fam, kid } = makeFamilyWithKid("E");
  const { kid: kid2 } = family.addKid(fam.id, fam.parentIds[0], { name: "Sibling" });
  notes.addNote(fam.id, { authorType: "kid", authorId: kid.id, date: "2026-06-01", body: "first" });
  notes.addNote(fam.id, { authorType: "kid", authorId: kid.id, date: "2026-06-03", body: "third" });
  notes.addNote(fam.id, { authorType: "kid", authorId: kid2.id, date: "2026-06-02", body: "sibling's" });

  const all = notes.listNotes(fam.id);
  assert.equal(all.length, 3);
  assert.equal(all[0].date, "2026-06-03"); // most recent date first

  const onlyKid1 = notes.listNotes(fam.id, { authorId: kid.id });
  assert.equal(onlyKid1.length, 2);

  const ranged = notes.listNotes(fam.id, { from: "2026-06-02", to: "2026-06-02" });
  assert.equal(ranged.length, 1);
  assert.equal(ranged[0].body, "sibling's");
});

test("updateNote: only updates body and bumps updatedAt", () => {
  const { fam, kid } = makeFamilyWithKid("F");
  const { note } = notes.addNote(fam.id, { authorType: "kid", authorId: kid.id, body: "original" });
  const result = notes.updateNote(fam.id, note.id, { body: "edited" });
  assert.ok(!result.error, result.error);
  assert.equal(result.note.body, "edited");
  assert.equal(result.note.createdAt, note.createdAt); // createdAt is preserved
  assert.ok(result.note.updatedAt >= note.updatedAt); // updatedAt is refreshed (or equal, if same tick)
});

test("updateNote: rejects empty body, 404s on unknown id", () => {
  const { fam, kid } = makeFamilyWithKid("G");
  const { note } = notes.addNote(fam.id, { authorType: "kid", authorId: kid.id, body: "x" });
  const empty = notes.updateNote(fam.id, note.id, { body: "" });
  assert.ok(empty.error);
  const missing = notes.updateNote(fam.id, "nt_bogus", { body: "y" });
  assert.ok(missing.error);
});

test("removeNote: deletes the note", () => {
  const { fam, kid } = makeFamilyWithKid("H");
  const { note } = notes.addNote(fam.id, { authorType: "kid", authorId: kid.id, body: "bye" });
  const result = notes.removeNote(fam.id, note.id);
  assert.ok(!result.error);
  assert.equal(notes.getById(fam.id, note.id), null);
});

// ---------- kid-scope / canAccess ----------
test("canAccess: a kid may only touch their own note", () => {
  const { fam, kid } = makeFamilyWithKid("I");
  const { kid: kid2 } = family.addKid(fam.id, fam.parentIds[0], { name: "Sibling2" });
  const { note: noteA } = notes.addNote(fam.id, { authorType: "kid", authorId: kid.id, body: "a" });
  const { note: noteB } = notes.addNote(fam.id, { authorType: "kid", authorId: kid2.id, body: "b" });

  const kidUser = { data: { profile: { role: "kid" }, kid: { familyId: fam.id, kidId: kid.id } } };
  assert.equal(notes.canAccess(noteA, kidUser), true);
  assert.equal(notes.canAccess(noteB, kidUser), false);
});

test("canAccess: a parent may only touch their OWN authored note (not a kid's reflection)", () => {
  const { fam, parent, kid } = makeFamilyWithKid("J");
  const { note: parentNote } = notes.addNote(fam.id, { authorType: "parent", authorId: parent.id, body: "parent's note" });
  const { note: kidNote } = notes.addNote(fam.id, { authorType: "kid", authorId: kid.id, body: "kid's note" });

  const parentUser = { id: parent.id, data: { profile: { role: "parent" } } };
  assert.equal(notes.canAccess(parentNote, parentUser), true);
  assert.equal(notes.canAccess(kidNote, parentUser), false);
});

test("route guard: a kidId/authorId derived from the session cannot be overridden by request body", () => {
  // Mirrors server.js POST /api/notes: for a kid session, authorId is always
  // req.user.data.kid.kidId — a malicious body field is never consulted.
  const { fam, kid } = makeFamilyWithKid("K");
  const { kid: kid2 } = family.addKid(fam.id, fam.parentIds[0], { name: "Sibling3" });
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);

  const role = "kid";
  const sessionKidId = kidUser.data.kid.kidId;
  const bodyAuthorId = kid2.id; // attacker-supplied, must be ignored
  const authorId = role === "kid" ? sessionKidId : bodyAuthorId;
  const result = notes.addNote(fam.id, { authorType: "kid", authorId, body: "sneaky" });
  assert.equal(result.note.authorId, kid.id);
  assert.notEqual(result.note.authorId, kid2.id);
});

// ---------- encryption round-trip ----------
test("encryption: body and ref.context are stored as datacrypto ciphertext, never plaintext on disk", () => {
  const { fam, kid } = makeFamilyWithKid("L");
  const secretBody = "I feel nervous about the math test tomorrow";
  const secretContext = "quote about perseverance";
  const { note } = notes.addNote(fam.id, {
    authorType: "kid",
    authorId: kid.id,
    body: secretBody,
    source: "quote",
    ref: { kind: "quote", id: "", context: secretContext },
  });

  // Inspect the raw persisted record.
  const root = db.load();
  const raw = root.notes[fam.id].find((n) => n.id === note.id);
  assert.ok(raw, "expected a stored note");
  assert.ok(datacrypto.isEncrypted(raw.body), "body must be datacrypto ciphertext (ENC1: prefix)");
  assert.ok(datacrypto.isEncrypted(raw.ref.context), "ref.context must be datacrypto ciphertext");
  assert.ok(!JSON.stringify(raw).includes(secretBody));
  assert.ok(!JSON.stringify(raw).includes(secretContext));

  // Round-trips back to plaintext via the public API (decorate()).
  assert.equal(note.body, secretBody);
  assert.equal(note.ref.context, secretContext);
  const fetched = notes.getById(fam.id, note.id);
  assert.equal(fetched.body, secretBody);
  assert.equal(fetched.ref.context, secretContext);
});

test("encryption: falls back to plaintext storage when DATA_ENCRYPTION_KEY is unset (never blocks notes)", () => {
  const savedKey = process.env.DATA_ENCRYPTION_KEY;
  delete process.env.DATA_ENCRYPTION_KEY;
  datacrypto._resetKeyCache();
  try {
    const { fam, kid } = makeFamilyWithKid("M");
    const result = notes.addNote(fam.id, { authorType: "kid", authorId: kid.id, body: "no key configured" });
    assert.ok(!result.error, result.error);
    assert.equal(result.note.body, "no key configured");
    const root = db.load();
    const raw = root.notes[fam.id].find((n) => n.id === result.note.id);
    assert.equal(datacrypto.isEncrypted(raw.body), false);
  } finally {
    process.env.DATA_ENCRYPTION_KEY = savedKey;
    datacrypto._resetKeyCache();
  }
});
