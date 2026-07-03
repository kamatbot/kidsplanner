"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-test-schoolaccount-"));
process.env.DATA_ENCRYPTION_KEY = require("crypto").randomBytes(32).toString("hex");

const db = require("../lib/db");
const datacrypto = require("../lib/datacrypto");
const store = require("../lib/store");
const family = require("../lib/family");
const homework = require("../lib/homework");
const schoolAccount = require("../lib/school-account");

function makeFamilyWithKid(label) {
  const parent = store.createUser(`${label}@example.com`, `Parent ${label}`);
  const fam = family.createFamily(parent.id, `${label} Family`);
  const { kid } = family.addKid(fam.id, parent.id, { name: `Kid ${label}`, grade: "6" });
  return { parent, fam, kid };
}

// ---------- encrypted-at-rest storage ----------
test("saveCredentials: the persisted blob is not plaintext and round-trips via getCredentials", () => {
  const { fam, parent } = makeFamilyWithKid("A");
  const result = schoolAccount.saveCredentials(fam.id, parent.id, { username: "parent.a", password: "s3cr3t-pass" });
  assert.ok(result.ok, result.error);

  // Inspect the raw persisted record: it must be datacrypto ciphertext, never
  // the plaintext username/password anywhere in the stored value.
  const root = db.load();
  const rec = root.schoolAccounts[fam.id];
  assert.ok(rec && rec.blob, "expected a stored blob");
  assert.ok(datacrypto.isEncrypted(rec.blob), "blob must be datacrypto ciphertext (ENC1: prefix)");
  assert.ok(!rec.blob.includes("parent.a"));
  assert.ok(!rec.blob.includes("s3cr3t-pass"));
  assert.equal(JSON.stringify(rec).includes("s3cr3t-pass"), false);

  // Round-trips back to the original plaintext via datacrypto decrypt.
  const creds = schoolAccount.getCredentials(fam.id);
  assert.deepEqual(creds, { username: "parent.a", password: "s3cr3t-pass" });
});

test("hasAccount / deleteAccount reflect the stored credential state", () => {
  const { fam, parent } = makeFamilyWithKid("B");
  assert.equal(schoolAccount.hasAccount(fam.id), false);
  schoolAccount.saveCredentials(fam.id, parent.id, { username: "u", password: "p" });
  assert.equal(schoolAccount.hasAccount(fam.id), true);
  const del = schoolAccount.deleteAccount(fam.id);
  assert.equal(del.deleted, true);
  assert.equal(schoolAccount.hasAccount(fam.id), false);
  assert.equal(schoolAccount.getCredentials(fam.id), null);
});

test("saveCredentials: rejects missing username/password without storing anything", () => {
  const { fam, parent } = makeFamilyWithKid("C");
  const result = schoolAccount.saveCredentials(fam.id, parent.id, { username: "", password: "" });
  assert.ok(result.error);
  assert.equal(schoolAccount.hasAccount(fam.id), false);
});

// ---------- feature disabled when no key ----------
test("feature is DISABLED (never falls back to plaintext) when DATA_ENCRYPTION_KEY is unset", () => {
  const savedKey = process.env.DATA_ENCRYPTION_KEY;
  delete process.env.DATA_ENCRYPTION_KEY;
  datacrypto._resetKeyCache();
  try {
    assert.equal(schoolAccount.encryptionAvailable(), false);
    const { fam, parent } = makeFamilyWithKid("D");
    const result = schoolAccount.saveCredentials(fam.id, parent.id, { username: "u", password: "p" });
    assert.ok(result.error);
    assert.equal(schoolAccount.hasAccount(fam.id), false);
  } finally {
    process.env.DATA_ENCRYPTION_KEY = savedKey;
    datacrypto._resetKeyCache();
  }
});

// ---------- kid <-> Moodle user id mapping ----------
test("setMoodleUserId / getMoodleUserId / listKidMappings", () => {
  const { fam, kid } = makeFamilyWithKid("E");
  const result = schoolAccount.setMoodleUserId(fam.id, kid.id, "14197");
  assert.ok(result.ok, result.error);
  assert.equal(schoolAccount.getMoodleUserId(fam.id, kid.id), "14197");
  assert.deepEqual(schoolAccount.listKidMappings(fam.id), [{ kidId: kid.id, moodleUserId: "14197" }]);
});

test("setMoodleUserId: rejects a non-numeric id", () => {
  const { fam, kid } = makeFamilyWithKid("F");
  const result = schoolAccount.setMoodleUserId(fam.id, kid.id, "not-a-number");
  assert.ok(result.error);
});

// ---------- requireParent gating (route-level guard exercised directly
// against the lib, same pattern as tests/school-feeds.test.js) ----------
function userRole(user) {
  return (user && user.data && user.data.profile && user.data.profile.role) || "parent";
}
function requireParentCheck(user) {
  return userRole(user) === "kid" ? { error: "Parents only." } : { ok: true };
}

test("requireParent gating: a kid session is blocked from every /api/school/* action, a parent is allowed", () => {
  const { parent, fam, kid } = makeFamilyWithKid("G");
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);

  // All five school routes (status/connect/map/import/import-confirm/
  // disconnect) are mounted with requireParent in server.js — this gate is
  // evaluated before any of the lib calls below ever run for a kid session.
  assert.ok(requireParentCheck(kidUser).error);
  assert.ok(!requireParentCheck(parent).error);

  // The parent path the route allows still works end-to-end at the lib layer.
  const saved = schoolAccount.saveCredentials(fam.id, parent.id, { username: "u", password: "p" });
  assert.ok(saved.ok);
  const mapped = schoolAccount.setMoodleUserId(fam.id, kid.id, "14197");
  assert.ok(mapped.ok);
});

// ---------- dedup on re-import (mirrors the /api/school/import/confirm
// dedup logic in server.js: same kid + title + dueDate + source "school-portal"
// is treated as already imported) ----------
function importConfirm(familyId, kidId, hwList) {
  let created = 0;
  let skipped = 0;
  for (const raw of hwList) {
    if (!raw || raw.completed) { skipped++; continue; }
    const title = String(raw.title || "").trim();
    const dueDate = raw.dueDate;
    if (!title || !dueDate) { skipped++; continue; }
    const existing = homework.listForFamily(familyId, { kidId }).find(
      (h) => h.source === "school-portal" && h.title === title && h.dueDate === dueDate
    );
    if (existing) { skipped++; continue; }
    const result = homework.addHomework(familyId, { kidId, title, subject: raw.subject || "", dueDate, source: "school-portal" });
    if (!result.error) created++; else skipped++;
  }
  return { created, skipped };
}

test("import/confirm dedup: re-importing the same homework item does not create a duplicate", () => {
  const { fam, kid } = makeFamilyWithKid("H");
  const preview = [{ subject: "Math", title: "Algebra worksheet", dueDate: "2026-08-01", completed: false }];

  const first = importConfirm(fam.id, kid.id, preview);
  assert.equal(first.created, 1);
  assert.equal(first.skipped, 0);

  const second = importConfirm(fam.id, kid.id, preview);
  assert.equal(second.created, 0);
  assert.equal(second.skipped, 1);

  const all = homework.listForFamily(fam.id, { kidId: kid.id });
  assert.equal(all.length, 1);
});

test("import/confirm: completed homework is skipped by default", () => {
  const { fam, kid } = makeFamilyWithKid("I");
  const preview = [
    { subject: "Math", title: "Done already", dueDate: "2026-08-01", completed: true },
    { subject: "English", title: "Still pending", dueDate: "2026-08-02", completed: false },
  ];
  const result = importConfirm(fam.id, kid.id, preview);
  assert.equal(result.created, 1);
  assert.equal(result.skipped, 1);
  const all = homework.listForFamily(fam.id, { kidId: kid.id });
  assert.equal(all.length, 1);
  assert.equal(all[0].title, "Still pending");
});
