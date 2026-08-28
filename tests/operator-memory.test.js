"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-family-memory-"));
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");

const store = require("../lib/store");
const family = require("../lib/family");
const identitySubjects = require("../lib/identity-subjects");
const memoryModule = require("../lib/operator-memory");
const operatorStore = require("../lib/operator-store");

function fixture() {
  const parent = store.createUser(`memory-${crypto.randomBytes(4).toString("hex")}@example.com`, "Memory Parent");
  const fam = family.createFamily(parent.id, "Memory Family");
  const kid = family.addKid(fam.id, parent.id, { name: "Ari", grade: "7" }).kid;
  identitySubjects.migrateAll();
  const kidSubject = identitySubjects.subjectForPrincipal("kid", fam.id, kid.id);
  return {
    parent, fam, kid, kidSubject,
    parentActor: { type: "parent", userId: parent.id, principalId: parent.id },
    kidActor: { type: "kid", kidId: kid.id, principalId: kid.id, userId: parent.id },
  };
}

test("Hermes memory proposals stay pending until a parent approves them", (t) => {
  let Database;
  try { Database = require("better-sqlite3"); } catch (error) { t.skip("better-sqlite3 unavailable"); return; }
  const f = fixture();
  const service = memoryModule.createOperatorMemory();
  const proposed = service.propose(f.fam.id, f.parentActor, {
    scope: "household",
    key: "preferred-airport-arrival-buffer",
    kind: "preference",
    value: { minutes: 120 },
    confidence: 0.9,
    sensitivity: "personal-preferences",
    provenance: { sourceType: "conversation", sourceRef: "m_memory_1", productId: "fametc" },
  });
  assert.equal(proposed.state, "pending");
  assert.deepEqual(service.list(f.fam.id, f.parentActor), []);
  assert.equal(service.list(f.fam.id, f.parentActor, { state: "pending" }).length, 1);

  const approved = service.decide(f.fam.id, proposed.id, f.parentActor, "approve");
  assert.equal(approved.state, "active");
  assert.deepEqual(service.list(f.fam.id, f.parentActor)[0].value, { minutes: 120 });

  const rawDb = new Database(operatorStore.DEFAULT_DB_FILE, { readonly: true });
  const row = rawDb.prepare("SELECT value_secret, provenance_secret FROM operator_memories WHERE id = ?").get(proposed.id);
  rawDb.close();
  assert.equal(String(row.value_secret).includes("minutes"), false);
  assert.equal(String(row.provenance_secret).includes("conversation"), false);
  service.close();
});

test("person-scoped memory uses immutable FamETC subjects and kids cannot target siblings", (t) => {
  try { require("better-sqlite3"); } catch (error) { t.skip("better-sqlite3 unavailable"); return; }
  const f = fixture();
  const sibling = family.addKid(f.fam.id, f.parent.id, { name: "Sibling" }).kid;
  const siblingSubject = identitySubjects.ensureKidSubject(f.fam.id, sibling.id);
  const service = memoryModule.createOperatorMemory();

  const own = service.propose(f.fam.id, f.kidActor, {
    scope: "person",
    subjectId: f.kidSubject.id,
    key: "homework-work-style",
    kind: "preference",
    value: "short sessions",
  });
  assert.equal(own.subjectId, f.kidSubject.id);
  assert.throws(
    () => service.propose(f.fam.id, f.kidActor, {
      scope: "person", subjectId: siblingSubject.id, key: "sibling-secret", kind: "fact", value: "x",
    }),
    (error) => error.code === "OPERATOR_MEMORY_SCOPE_DENIED",
  );
  service.close();
});

test("parents can edit/delete active memory while kids see only safe active memory", (t) => {
  try { require("better-sqlite3"); } catch (error) { t.skip("better-sqlite3 unavailable"); return; }
  const f = fixture();
  const service = memoryModule.createOperatorMemory();
  const household = service.createByParent(f.fam.id, f.parentActor, {
    scope: "household", key: "default-dinner-window", kind: "preference", value: "18:30", sensitivity: "personal-preferences",
  });
  const sensitive = service.createByParent(f.fam.id, f.parentActor, {
    scope: "person", subjectId: f.kidSubject.id, key: "private-admin-note", kind: "fact", value: "private", sensitivity: "sensitive",
  });
  assert.equal(service.list(f.fam.id, f.kidActor).some((item) => item.id === household.id), true);
  assert.equal(service.list(f.fam.id, f.kidActor).some((item) => item.id === sensitive.id), false);

  const updated = service.updateByParent(f.fam.id, household.id, f.parentActor, { value: "19:00", confidence: 0.8 });
  assert.equal(updated.value, "19:00");
  assert.equal(updated.confidence, 0.8);
  assert.equal(service.removeByParent(f.fam.id, household.id, f.parentActor), true);
  assert.equal(service.list(f.fam.id, f.parentActor).some((item) => item.id === household.id), false);
  service.close();
});

test("expired memory is not disclosed and rejected proposals never become active", (t) => {
  try { require("better-sqlite3"); } catch (error) { t.skip("better-sqlite3 unavailable"); return; }
  const f = fixture();
  const service = memoryModule.createOperatorMemory();
  service.createByParent(f.fam.id, f.parentActor, {
    scope: "household", key: "expired", kind: "fact", value: "old", expiresAt: new Date(Date.now() - 1000).toISOString(),
  });
  const pending = service.propose(f.fam.id, f.parentActor, { scope: "household", key: "wrong", kind: "fact", value: "no" });
  service.decide(f.fam.id, pending.id, f.parentActor, "reject");
  assert.equal(service.list(f.fam.id, f.parentActor).length, 0);
  assert.equal(service.list(f.fam.id, f.parentActor, { state: "rejected" }).some((item) => item.id === pending.id), true);
  service.close();
});
