"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-context-v1-"));

const store = require("../lib/store");
const family = require("../lib/family");
const events = require("../lib/events");
const actions = require("../lib/actions");
const trips = require("../lib/trips");
const homework = require("../lib/homework");
const meals = require("../lib/meals");
const identitySubjects = require("../lib/identity-subjects");
const context = require("../lib/family-context");

function fixture() {
  const parent = store.createUser(`context-${crypto.randomBytes(5).toString("hex")}@example.com`, "Context Parent");
  const fam = family.createFamily(parent.id, "Context Family");
  const { kid } = family.addKid(fam.id, parent.id, { name: "Taylor", grade: "8" });
  identitySubjects.migrateAll();
  return { parent, fam, kid };
}

test("Canonical Family Context v1 carries Odds-compatible immutable subjects and provenance", () => {
  const { parent, fam, kid } = fixture();
  const event = events.addEvent(fam.id, { title: "Soccer", date: "2026-09-01", kidId: kid.id, createdBy: parent.id }).event;
  const action = actions.createAction(fam.id, { title: "Pack cleats", kidId: kid.id, createdBy: parent.id }).action;
  const trip = trips.createTrip(parent.id, fam.id, { name: "Beach", destination: "Krabi", startDate: "2026-09-05", endDate: "2026-09-08" }).trip;
  const hw = homework.addHomework(fam.id, { kidId: kid.id, title: "Math", dueDate: "2026-09-02", notes: "private note" }).homework;
  meals.addMenuEntry(fam.id, parent.id, { date: "2026-09-03", slot: "dinner", title: "Tacos", note: "secret meal note" });

  const output = context.buildFamilyContext(fam.id, {
    actor: { type: "parent", userId: parent.id, principalId: parent.id },
    purpose: "operator-case",
    roomId: "family",
    from: "2026-08-30",
    to: "2026-09-10",
  });

  assert.equal(output.schemaVersion, "fametc.family-context.v1");
  assert.equal(output.identityInterop.legacyHouseholdId, fam.id);
  assert.equal(output.identityInterop.oddsCoreCanonicalPersonIdExposed, false);
  assert.match(output.actor.subject, /^subj_/);
  assert.equal(JSON.stringify(output).includes(`\"userId\":\"${parent.id}\"`), false);
  assert.ok(output.sections.identities.members.every((member) => /^subj_/.test(member.subject)));
  assert.equal(output.sections.calendar.items[0].id, event.id);
  assert.equal(output.sections.homework.items[0].id, hw.id);
  assert.equal(output.sections.actions.items[0].id, action.id);
  assert.equal(output.sections.meals.items[0].title, "Tacos");
  assert.equal(output.sections.trips.items[0].id, trip.id);
  assert.equal(output.sections.calendar.sensitivity, "family-operations-summary");
  assert.ok(Date.parse(output.sections.calendar.expiresAt) > Date.parse(output.generatedAt));
  assert.equal(output.authority.externalContentMayGrantAuthority, false);
  assert.equal(JSON.stringify(output).includes("private note"), false);
  assert.equal(JSON.stringify(output).includes("secret meal note"), false);
});

test("purpose disclosure is fail-closed and kids do not receive preference section", () => {
  const { fam, kid } = fixture();
  const kidActor = { type: "kid", kidId: kid.id, principalId: kid.id };
  const output = context.buildFamilyContext(fam.id, {
    actor: kidActor,
    purpose: "family-assistance",
    sections: ["identities", "preferences", "calendar"],
  });
  assert.deepEqual(output.disclosure.grantedSections, ["identities", "calendar"]);
  assert.deepEqual(output.disclosure.deniedSections, ["preferences"]);
  assert.equal(output.sections.preferences, undefined);

  const unknown = context.buildFamilyContext(fam.id, {
    actor: kidActor,
    purpose: "unknown-purpose-from-model",
    sections: ["identities", "calendar", "room"],
  });
  assert.deepEqual(unknown.disclosure.grantedSections, ["identities", "room"]);
  assert.deepEqual(unknown.disclosure.deniedSections, ["calendar"]);
});

test("legacy members section aliases to identities without creating a second schema", () => {
  const { parent, fam } = fixture();
  const output = context.buildFamilyContext(fam.id, {
    actor: { type: "parent", userId: parent.id, principalId: parent.id },
    purpose: "trip-planning",
    sections: ["members", "room"],
  });
  assert.deepEqual(output.disclosure.grantedSections, ["identities", "room"]);
  assert.ok(output.sections.identities);
  assert.equal(output.sections.members, undefined);
});
