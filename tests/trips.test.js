"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-test-trips-"));

const store = require("../lib/store");
const family = require("../lib/family");
const trips = require("../lib/trips");

let n = 0;
function freshParent(label) {
  n++;
  return store.createUser(`${label}${n}@example.com`, `Parent ${label}${n}`);
}
function makeOwner(label) {
  const parent = freshParent(label);
  const fam = family.createFamily(parent.id, `${label} Family`);
  return { parent, fam };
}
function makeGuest(label) {
  return freshParent(label); // a user with no family = a guest
}
function makeTrip(label) {
  const { parent, fam } = makeOwner(label);
  const { trip } = trips.createTrip(parent.id, fam.id, {
    name: `${label} Trip`, destination: "Lisbon, PT", startDate: "2026-08-01", endDate: "2026-08-10",
  });
  return { owner: parent, fam, trip };
}

// ---------- create / validate ----------
test("createTrip: creates a trip with the owner as first member", () => {
  const { owner, fam, trip } = makeTrip("A");
  assert.ok(!trip.error, trip.error);
  assert.equal(trip.ownerUserId, owner.id);
  assert.equal(trip.familyId, fam.id);
  assert.equal(trip.members.length, 1);
  assert.equal(trip.members[0].userId, owner.id);
  assert.equal(trip.members[0].role, "owner");
  assert.equal(trip.inviteCode.length, 24);
  assert.deepEqual(trip.itinerary, []);
  assert.deepEqual(trip.activity, []);
});

test("createTrip: a guest with no family can own a trip (familyId null)", () => {
  const guest = makeGuest("G");
  const result = trips.createTrip(guest.id, null, { name: "Guest Trip", destination: "Rome", startDate: "2026-09-01", endDate: "2026-09-05" });
  assert.ok(!result.error, result.error);
  assert.equal(result.trip.familyId, null);
});

test("createTrip: rejects missing name or invalid/backwards dates", () => {
  const owner = freshParent("V");
  assert.ok(trips.createTrip(owner.id, null, { name: "", startDate: "2026-08-01", endDate: "2026-08-05" }).error);
  assert.ok(trips.createTrip(owner.id, null, { name: "X", startDate: "not-a-date", endDate: "2026-08-05" }).error);
  assert.ok(trips.createTrip(owner.id, null, { name: "X", startDate: "2026-08-10", endDate: "2026-08-05" }).error);
});

test("updateTrip: rename and change dates", () => {
  const { trip } = makeTrip("B");
  const result = trips.updateTrip(trip.id, { name: "New Name", destination: "Porto" });
  assert.ok(!result.error, result.error);
  assert.equal(result.trip.name, "New Name");
  assert.equal(result.trip.destination, "Porto");
  assert.equal(trips.updateTrip(trip.id, { name: "" }).error, "Trip name cannot be empty.");
  assert.equal(trips.updateTrip("trip_bogus", { name: "X" }).error, "Trip not found.");
});

// ---------- join by code ----------
test("join by code: adds an editor, is idempotent, and enforces the 12-member cap", () => {
  const { owner, trip } = makeTrip("C");
  const guest1 = makeGuest("J1");
  const joined = trips.joinByCode(trip.inviteCode, guest1.id);
  assert.ok(!joined.error, joined.error);
  assert.equal(joined.trip.members.length, 2);
  assert.equal(trips.memberRole(joined.trip, guest1.id), "editor");
  assert.match(joined.trip.activity[joined.trip.activity.length - 1].text, /joined the trip/);

  // idempotent re-join
  const rejoined = trips.joinByCode(trip.inviteCode, guest1.id);
  assert.ok(!rejoined.error);
  assert.equal(rejoined.trip.members.length, 2);

  // fill to the cap (owner + guest1 already = 2, need 10 more to hit 12)
  for (let i = 0; i < 10; i++) {
    const g = makeGuest(`Cap${i}`);
    const r = trips.joinByCode(trip.inviteCode, g.id);
    assert.ok(!r.error, r.error);
  }
  assert.equal(trips.getTrip(trip.id).members.length, 12);
  const overflow = makeGuest("Overflow");
  const rejected = trips.joinByCode(trip.inviteCode, overflow.id);
  assert.equal(rejected.error, "This trip already has the maximum number of members.");
});

test("join by code: an unknown or disabled code returns the same non-leaking error", () => {
  const { trip } = makeTrip("D");
  const bogus = trips.joinByCode("NOTAREALCODE0000000000", makeGuest("K1").id);
  assert.equal(bogus.error, "That invite link isn't valid or has been turned off.");

  trips.disableInvite(trip.id, trip.ownerUserId);
  const disabled = trips.joinByCode(trip.inviteCode, makeGuest("K2").id);
  assert.equal(disabled.error, bogus.error);
});

test("previewByCode: returns a summary without member userIds/emails", () => {
  const { trip } = makeTrip("E");
  const preview = trips.previewByCode(trip.inviteCode);
  assert.ok(!preview.error);
  assert.equal(preview.trip.id, trip.id);
  assert.equal(preview.trip.memberCount, 1);
  assert.equal(preview.trip.members, undefined);
});

// ---------- invite regenerate / disable (owner-only) ----------
test("regenerateInvite / disableInvite: owner-only", () => {
  const { trip } = makeTrip("F");
  const guest = makeGuest("F1");
  trips.joinByCode(trip.inviteCode, guest.id);

  const deniedRegen = trips.regenerateInvite(trip.id, guest.id);
  assert.equal(deniedRegen.error, "Only the trip owner can regenerate the invite link.");
  const oldCode = trips.getTrip(trip.id).inviteCode;
  const okRegen = trips.regenerateInvite(trip.id, trip.ownerUserId);
  assert.ok(!okRegen.error);
  assert.notEqual(okRegen.inviteCode, oldCode);

  const deniedDisable = trips.disableInvite(trip.id, guest.id);
  assert.equal(deniedDisable.error, "Only the trip owner can disable the invite link.");
  const okDisable = trips.disableInvite(trip.id, trip.ownerUserId);
  assert.ok(!okDisable.error);
  assert.equal(trips.getTrip(trip.id).inviteCode, null);
});

// ---------- membership removal ----------
test("removeMember: owner can remove an editor; editor can self-leave; nobody can remove the owner", () => {
  const { trip } = makeTrip("G");
  const editor = makeGuest("G1");
  const editor2 = makeGuest("G2");
  trips.joinByCode(trip.inviteCode, editor.id);
  trips.joinByCode(trip.inviteCode, editor2.id);

  // editor cannot remove another editor
  const denied = trips.removeMember(trip.id, editor.id, editor2.id);
  assert.equal(denied.error, "Only the trip owner can remove another member.");

  // editor can remove themselves
  const selfLeave = trips.removeMember(trip.id, editor.id, editor.id);
  assert.ok(!selfLeave.error);
  assert.equal(trips.memberRole(trips.getTrip(trip.id), editor.id), null);

  // owner can remove the remaining editor
  const ownerRemoves = trips.removeMember(trip.id, trip.ownerUserId, editor2.id);
  assert.ok(!ownerRemoves.error);

  // owner can't be removed this way
  const ownerSelf = trips.removeMember(trip.id, trip.ownerUserId, trip.ownerUserId);
  assert.equal(ownerSelf.error, "The owner can't be removed — delete the trip instead.");
});

// ---------- itinerary CRUD + move ordering ----------
test("itinerary: add assigns increasing per-day order", () => {
  const { trip, owner } = makeTrip("H");
  const a = trips.addItineraryItem(trip.id, owner.id, { date: "2026-08-01", title: "Museum", category: "sight" });
  const b = trips.addItineraryItem(trip.id, owner.id, { date: "2026-08-01", title: "Lunch", category: "food" });
  const c = trips.addItineraryItem(trip.id, owner.id, { date: "2026-08-02", title: "Beach", category: "activity" });
  assert.equal(a.item.order, 0);
  assert.equal(b.item.order, 1);
  assert.equal(c.item.order, 0); // different day, own sequence
});

test("itinerary: rejects bad date, empty title, invalid category, bad time", () => {
  const { trip, owner } = makeTrip("I");
  assert.ok(trips.addItineraryItem(trip.id, owner.id, { date: "bogus", title: "X", category: "food" }).error);
  assert.ok(trips.addItineraryItem(trip.id, owner.id, { date: "2026-08-01", title: "", category: "food" }).error);
  assert.ok(trips.addItineraryItem(trip.id, owner.id, { date: "2026-08-01", title: "X", category: "nope" }).error);
  assert.ok(trips.addItineraryItem(trip.id, owner.id, { date: "2026-08-01", title: "X", category: "food", time: "not-a-time" }).error);
});

test("itinerary: move reorders within a day and across days", () => {
  const { trip, owner } = makeTrip("J");
  const a = trips.addItineraryItem(trip.id, owner.id, { date: "2026-08-01", title: "A", category: "sight" }).item;
  const b = trips.addItineraryItem(trip.id, owner.id, { date: "2026-08-01", title: "B", category: "sight" }).item;
  const c = trips.addItineraryItem(trip.id, owner.id, { date: "2026-08-01", title: "C", category: "sight" }).item;
  // move C before B: A, C, B
  const moved = trips.moveItineraryItem(trip.id, c.id, { date: "2026-08-01", beforeId: b.id });
  assert.ok(!moved.error, moved.error);
  const day1 = moved.trip.itinerary.filter((i) => i.date === "2026-08-01").sort((x, y) => x.order - y.order);
  assert.deepEqual(day1.map((i) => i.id), [a.id, c.id, b.id]);

  // move A to a new day, appended (beforeId null)
  const moved2 = trips.moveItineraryItem(trip.id, a.id, { date: "2026-08-02", beforeId: null });
  assert.ok(!moved2.error);
  const day2 = moved2.trip.itinerary.filter((i) => i.date === "2026-08-02");
  assert.equal(day2.length, 1);
  assert.equal(day2[0].order, 0);
  // old day reindexed to stay contiguous (0,1)
  const day1After = moved2.trip.itinerary.filter((i) => i.date === "2026-08-01").sort((x, y) => x.order - y.order);
  assert.deepEqual(day1After.map((i) => i.order), [0, 1]);
});

test("itinerary: vote toggle is idempotent per user", () => {
  const { trip, owner } = makeTrip("K");
  const item = trips.addItineraryItem(trip.id, owner.id, { date: "2026-08-01", title: "X", category: "food" }).item;
  const voted = trips.toggleVote(trip.id, item.id, owner.id);
  assert.deepEqual(voted.item.votes, [owner.id]);
  const unvoted = trips.toggleVote(trip.id, item.id, owner.id);
  assert.deepEqual(unvoted.item.votes, []);
});

test("itinerary: comments add, delete (owner or author), and flag", () => {
  const { trip, owner } = makeTrip("L");
  const editor = makeGuest("L1");
  trips.joinByCode(trip.inviteCode, editor.id);
  const item = trips.addItineraryItem(trip.id, owner.id, { date: "2026-08-01", title: "X", category: "food" }).item;

  const c1 = trips.addComment(trip.id, item.id, editor.id, "Looks great!");
  assert.ok(!c1.error, c1.error);
  assert.equal(c1.comment.flagged, false);
  assert.ok(trips.addComment(trip.id, item.id, editor.id, "   ").error); // empty after trim

  // a random third party can't delete the editor's comment
  const stranger = makeGuest("L2");
  const deniedDelete = trips.removeComment(trip.id, item.id, c1.comment.id, stranger.id);
  assert.ok(deniedDelete.error);

  // flag it
  const flagged = trips.flagComment(trip.id, item.id, c1.comment.id, stranger.id, "off-topic");
  assert.ok(!flagged.error);
  assert.equal(trips.getComment(trips.getTrip(trip.id), item.id, c1.comment.id).flagged, true);

  // owner can delete any comment
  const ownerDelete = trips.removeComment(trip.id, item.id, c1.comment.id, owner.id);
  assert.ok(!ownerDelete.error);
  assert.equal(trips.getComment(trips.getTrip(trip.id), item.id, c1.comment.id), null);

  // author can delete their own
  const c2 = trips.addComment(trip.id, item.id, editor.id, "Second comment").comment;
  const authorDelete = trips.removeComment(trip.id, item.id, c2.id, editor.id);
  assert.ok(!authorDelete.error);
});

test("itinerary: delete removes the item and reindexes the remaining day", () => {
  const { trip, owner } = makeTrip("M");
  const a = trips.addItineraryItem(trip.id, owner.id, { date: "2026-08-01", title: "A", category: "sight" }).item;
  const b = trips.addItineraryItem(trip.id, owner.id, { date: "2026-08-01", title: "B", category: "sight" }).item;
  const removed = trips.removeItineraryItem(trip.id, a.id);
  assert.ok(!removed.error);
  const remaining = trips.getTrip(trip.id).itinerary;
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, b.id);
  assert.equal(remaining[0].order, 0);
  assert.ok(trips.removeItineraryItem(trip.id, "ti_bogus").error);
});

// ---------- ideas bucket (v1.1) ----------
test("itinerary: addItineraryItem with no date creates an idea (date: null)", () => {
  const { trip, owner } = makeTrip("H2");
  const idea = trips.addItineraryItem(trip.id, owner.id, { title: "Rent bikes", category: "activity" });
  assert.ok(!idea.error, idea.error);
  assert.equal(idea.item.date, null);
  const idea2 = trips.addItineraryItem(trip.id, owner.id, { date: "", title: "Try the market", category: "food" });
  assert.ok(!idea2.error, idea2.error);
  assert.equal(idea2.item.date, null);
  assert.equal(idea2.item.order, 1); // shares the null-date group's own order sequence
  assert.ok(trips.addItineraryItem(trip.id, owner.id, { date: "not-a-date", title: "X", category: "food" }).error);
});

test("itinerary: updateItineraryItem can clear a date to null (empty string) and set one", () => {
  const { trip, owner } = makeTrip("H3");
  const scheduled = trips.addItineraryItem(trip.id, owner.id, { date: "2026-08-01", title: "Museum", category: "sight" }).item;
  const cleared = trips.updateItineraryItem(trip.id, scheduled.id, { date: "" });
  assert.ok(!cleared.error, cleared.error);
  assert.equal(cleared.item.date, null);
  const rescheduled = trips.updateItineraryItem(trip.id, scheduled.id, { date: "2026-08-02" });
  assert.ok(!rescheduled.error, rescheduled.error);
  assert.equal(rescheduled.item.date, "2026-08-02");
  assert.ok(trips.updateItineraryItem(trip.id, scheduled.id, { date: "bogus" }).error);
});

test("itinerary: moveItineraryItem(date: null) moves a scheduled item to the ideas group and back, keeping order integrity", () => {
  const { trip, owner } = makeTrip("H4");
  const a = trips.addItineraryItem(trip.id, owner.id, { date: "2026-08-01", title: "A", category: "sight" }).item;
  const b = trips.addItineraryItem(trip.id, owner.id, { date: "2026-08-01", title: "B", category: "sight" }).item;
  const idea = trips.addItineraryItem(trip.id, owner.id, { title: "Idea1", category: "activity" }).item;

  // day -> ideas
  const toIdeas = trips.moveItineraryItem(trip.id, a.id, { date: null, beforeId: idea.id });
  assert.ok(!toIdeas.error, toIdeas.error);
  const ideasGroup = toIdeas.trip.itinerary.filter((i) => i.date === null).sort((x, y) => x.order - y.order);
  assert.deepEqual(ideasGroup.map((i) => i.id), [a.id, idea.id]);
  // source day reindexed to stay contiguous
  const day1 = toIdeas.trip.itinerary.filter((i) => i.date === "2026-08-01").sort((x, y) => x.order - y.order);
  assert.deepEqual(day1.map((i) => [i.id, i.order]), [[b.id, 0]]);

  // ideas -> day
  const backToDay = trips.moveItineraryItem(trip.id, a.id, { date: "2026-08-03", beforeId: null });
  assert.ok(!backToDay.error, backToDay.error);
  assert.equal(trips.getItineraryItem(backToDay.trip, a.id).date, "2026-08-03");
  const ideasAfter = backToDay.trip.itinerary.filter((i) => i.date === null);
  assert.deepEqual(ideasAfter.map((i) => [i.id, i.order]), [[idea.id, 0]]); // reindexed
});

// ---------- checklists (v1.1) ----------
test("checklists: shared list create/rename/delete, default-init on a trip predating the field", () => {
  const { trip, owner } = makeTrip("CK1");
  delete trips.getTrip(trip.id).checklists; // simulate a trip that predates v1.1
  const created = trips.addSharedChecklist(trip.id, owner.id, "Beach gear");
  assert.ok(!created.error, created.error);
  assert.equal(created.checklist.kind, "shared");
  assert.equal(created.checklist.title, "Beach gear");
  assert.equal(created.checklist.ownerUserId, null);
  assert.match(trips.getTrip(trip.id).activity.slice(-1)[0].text, /Beach gear/);

  const renamed = trips.updateChecklistTitle(trip.id, created.checklist.id, "Beach & pool gear");
  assert.ok(!renamed.error);
  assert.equal(renamed.checklist.title, "Beach & pool gear");
  assert.equal(trips.updateChecklistTitle(trip.id, created.checklist.id, "  ").error, "Checklist title cannot be empty.");

  const removed = trips.removeChecklist(trip.id, created.checklist.id);
  assert.ok(!removed.error);
  assert.equal(trips.getChecklist(trips.getTrip(trip.id), created.checklist.id), null);
});

test("checklists: get-or-create personal list is idempotent and titled from the given name", () => {
  const { trip, owner } = makeTrip("CK2");
  const first = trips.getOrCreatePersonalChecklist(trip.id, owner.id, "Owner's packing");
  assert.ok(!first.error, first.error);
  assert.equal(first.checklist.kind, "personal");
  assert.equal(first.checklist.ownerUserId, owner.id);
  assert.equal(first.checklist.title, "Owner's packing");
  const second = trips.getOrCreatePersonalChecklist(trip.id, owner.id, "Owner's packing");
  assert.equal(second.checklist.id, first.checklist.id);
  assert.equal(trips.getTrip(trip.id).checklists.filter((c) => c.ownerUserId === owner.id).length, 1);
  // no activity entry for personal-list creation (shared-only)
  assert.equal(trips.getTrip(trip.id).activity.length, 0);
});

test("checklists: items add/toggle (doneBy stamping)/remove", () => {
  const { trip, owner } = makeTrip("CK3");
  const editor = makeGuest("CK3e");
  trips.joinByCode(trip.inviteCode, editor.id);
  const list = trips.addSharedChecklist(trip.id, owner.id, "Packing").checklist;

  const added = trips.addChecklistItem(trip.id, list.id, owner.id, { text: "Passports" });
  assert.ok(!added.error, added.error);
  assert.equal(added.item.done, false);
  assert.equal(added.item.doneBy, null);
  assert.ok(trips.addChecklistItem(trip.id, list.id, owner.id, { text: "  " }).error);

  const toggledOn = trips.updateChecklistItem(trip.id, list.id, added.item.id, editor.id, { done: true });
  assert.ok(!toggledOn.error, toggledOn.error);
  assert.equal(toggledOn.item.done, true);
  assert.equal(toggledOn.item.doneBy, editor.id);

  const toggledOff = trips.updateChecklistItem(trip.id, list.id, added.item.id, owner.id, { done: false });
  assert.equal(toggledOff.item.done, false);
  assert.equal(toggledOff.item.doneBy, null);

  const removed = trips.removeChecklistItem(trip.id, list.id, added.item.id);
  assert.ok(!removed.error);
  assert.equal(trips.getChecklistItem(trips.getTrip(trip.id), list.id, added.item.id), null);
});

// ---------- flights / lodging CRUD ----------
test("flights: add/update/remove, requires at least airline or flight number", () => {
  const { trip, owner } = makeTrip("N");
  assert.ok(trips.addFlight(trip.id, owner.id, {}).error);
  const added = trips.addFlight(trip.id, owner.id, { airline: "TAP", flightNo: "TP123", from: "jfk", to: "lis" });
  assert.ok(!added.error, added.error);
  assert.equal(added.flight.from, "JFK");
  assert.equal(added.flight.to, "LIS");
  const updated = trips.updateFlight(trip.id, added.flight.id, { confirmation: "ABC123" });
  assert.equal(updated.flight.confirmation, "ABC123");
  const removed = trips.removeFlight(trip.id, added.flight.id);
  assert.ok(!removed.error);
  assert.ok(trips.removeFlight(trip.id, added.flight.id).error);
});

test("lodging: add/update/remove, requires a name", () => {
  const { trip, owner } = makeTrip("O");
  assert.ok(trips.addLodging(trip.id, owner.id, { address: "somewhere" }).error);
  const added = trips.addLodging(trip.id, owner.id, { name: "Hotel Lisboa", checkIn: "Aug 1", checkOut: "Aug 10" });
  assert.ok(!added.error, added.error);
  const updated = trips.updateLodging(trip.id, added.lodging.id, { note: "Free breakfast" });
  assert.equal(updated.lodging.note, "Free breakfast");
  const removed = trips.removeLodging(trip.id, added.lodging.id);
  assert.ok(!removed.error);
  assert.ok(trips.removeLodging(trip.id, added.lodging.id).error);
});

// ---------- accessFor matrix ----------
test("accessFor: owner and editor are 'member'", () => {
  const { trip, owner } = makeTrip("P");
  const editor = makeGuest("P1");
  trips.joinByCode(trip.inviteCode, editor.id);
  assert.equal(trips.accessFor(owner, trips.getTrip(trip.id)), "member");
  assert.equal(trips.accessFor(editor, trips.getTrip(trip.id)), "member");
});

test("accessFor: a kid in the trip's owning family gets kid-read", () => {
  const { trip, fam } = makeTrip("Q");
  const { kid } = family.addKid(fam.id, fam.parentIds[0], { name: "Kiddo" });
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
  assert.equal(trips.accessFor(kidUser, trips.getTrip(trip.id)), "kid-read");
});

test("accessFor: a kid whose family has a PARENT on the trip (not the trip's nominal family) gets kid-read", () => {
  const { trip } = makeTrip("R");
  // a second family whose parent joins the trip as an editor
  const { parent: coParent, fam: otherFam } = makeOwner("R-other");
  trips.joinByCode(trip.inviteCode, coParent.id);
  const { kid } = family.addKid(otherFam.id, coParent.id, { name: "OtherKid" });
  const kidUser = store.findOrCreateKidUser(otherFam.id, kid.id, kid.name);
  assert.equal(trips.accessFor(kidUser, trips.getTrip(trip.id)), "kid-read");
});

test("accessFor: a kid of an unrelated family gets null", () => {
  const { trip } = makeTrip("S");
  const { fam: unrelatedFam } = makeOwner("S-unrelated");
  const { kid } = family.addKid(unrelatedFam.id, unrelatedFam.parentIds[0], { name: "Unrelated" });
  const kidUser = store.findOrCreateKidUser(unrelatedFam.id, kid.id, kid.name);
  assert.equal(trips.accessFor(kidUser, trips.getTrip(trip.id)), null);
});

test("accessFor: a stranger (no membership, no kid link) gets null", () => {
  const { trip } = makeTrip("T");
  const stranger = makeGuest("T1");
  assert.equal(trips.accessFor(stranger, trips.getTrip(trip.id)), null);
});

test("accessFor: kid-read is GET-only in intent — mutation is blocked at the ROUTE layer, not here (this proves the value the route checks)", () => {
  const { trip, fam } = makeTrip("U");
  const { kid } = family.addKid(fam.id, fam.parentIds[0], { name: "Kiddo2" });
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
  assert.equal(trips.accessFor(kidUser, trips.getTrip(trip.id)), "kid-read");
});

// ---------- activity feed cap ----------
test("logActivity: caps trip.activity at the most recent 50 entries", () => {
  const { trip } = makeTrip("V2");
  const live = trips.getTrip(trip.id);
  for (let i = 0; i < 60; i++) trips.logActivity(live, live.ownerUserId, `event ${i}`);
  assert.equal(live.activity.length, 50);
  assert.equal(live.activity[0].text, "event 10"); // oldest 10 dropped
  assert.equal(live.activity[49].text, "event 59");
});

// ---------- delete trip ----------
test("deleteTrip: owner-only, removes the trip entirely", () => {
  const { trip } = makeTrip("W");
  const editor = makeGuest("W1");
  trips.joinByCode(trip.inviteCode, editor.id);
  const denied = trips.deleteTrip(trip.id, editor.id);
  assert.equal(denied.error, "Only the trip owner can delete the trip.");
  const ok = trips.deleteTrip(trip.id, trip.ownerUserId);
  assert.ok(!ok.error);
  assert.equal(trips.getTrip(trip.id), null);
});

// ---------- serializers ----------
test("publicTrip: never leaks emails, assigns deterministic palette colors by member index", () => {
  const { trip, owner } = makeTrip("X");
  const editor = makeGuest("X1");
  trips.joinByCode(trip.inviteCode, editor.id);
  const resolveName = (id) => (id === owner.id ? owner.data.profile.name : (id === editor.id ? editor.data.profile.name : null));
  const pub = trips.publicTrip(trips.getTrip(trip.id), resolveName);
  assert.equal(pub.members.length, 2);
  assert.equal(pub.members[0].color, trips.PALETTE[0]);
  assert.equal(pub.members[1].color, trips.PALETTE[1]);
  for (const m of pub.members) {
    assert.equal(Object.prototype.hasOwnProperty.call(m, "email"), false);
  }
});
