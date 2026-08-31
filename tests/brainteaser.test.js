"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-test-brainteaser-"));

const store = require("../lib/store");
const family = require("../lib/family");
const db = require("../lib/db");
const brainteaser = require("../lib/brainteaser");
const {
  QUESTIONS,
  LEGACY_QUESTIONS,
  ACTIVE_QUESTIONS,
} = require("../lib/brainteaser-questions");

function makeFamilyWithKid(label) {
  const parent = store.createUser(`${label}@example.com`, `Parent ${label}`);
  const fam = family.createFamily(parent.id, `${label} Family`);
  const { kid } = family.addKid(fam.id, parent.id, { name: `Kid ${label}`, grade: "6" });
  return { parent, fam, kid };
}

// A date for each weekday, all in the same ISO week (Mon 2026-06-15 .. Sun 2026-06-21).
const WEEKDAY_DATES = {
  Mon: new Date("2026-06-15T12:00:00"),
  Tue: new Date("2026-06-16T12:00:00"),
  Wed: new Date("2026-06-17T12:00:00"),
  Thu: new Date("2026-06-18T12:00:00"),
  Fri: new Date("2026-06-19T12:00:00"),
  Sat: new Date("2026-06-20T12:00:00"),
  Sun: new Date("2026-06-21T12:00:00"),
};

test("question bank: legacy mappings stay intact and active bank has 36+ stable qids", () => {
  assert.equal(LEGACY_QUESTIONS.length, 30);
  assert.ok(ACTIVE_QUESTIONS.length >= 36);
  assert.equal(QUESTIONS.length, LEGACY_QUESTIONS.length + ACTIVE_QUESTIONS.length);
  const qids = new Set(QUESTIONS.map((q) => q.qid));
  assert.equal(qids.size, QUESTIONS.length);
  for (const q of LEGACY_QUESTIONS) {
    assert.match(q.qid, /^bt\d+$/);
    assert.equal(q.options.length, 4);
    assert.ok(q.answerIndex >= 0 && q.answerIndex < 4);
  }
  for (const q of ACTIVE_QUESTIONS) {
    assert.match(q.qid, /^bt\d+$/);
    assert.ok(Number(q.qid.slice(2)) > 30);
    assert.equal(q.options.length, 4);
    assert.equal(new Set(q.options).size, 4);
    assert.ok(q.answerIndex >= 0 && q.answerIndex < 4);
    assert.ok(q.q && q.q.length > 20);
    assert.ok(q.exp && q.exp.length > 30);
    assert.notEqual(q.q, "TODO");
  }
});

test("getToday: newly generated sets use only active challenge questions", () => {
  const { kid } = makeFamilyWithKid("A0");
  const activeIds = new Set(ACTIVE_QUESTIONS.map((q) => q.qid));
  const today = brainteaser.getToday(kid.id, WEEKDAY_DATES.Fri);
  assert.ok(today.questions.every((q) => activeIds.has(q.qid)));
  assert.equal(db.load().brainteaser[kid.id].servedBankVersion, brainteaser.SERVED_BANK_VERSION);
});

test("getToday: an old same-day elementary snapshot migrates once and preserves answered history", () => {
  const { kid } = makeFamilyWithKid("A1");
  const legacy = LEGACY_QUESTIONS[0];
  const state = db.load().brainteaser[kid.id] = {
    answered: {
      [legacy.qid]: { qid: legacy.qid, correct: false, attempts: 1, wrong: true, lastSeen: "2026-06-15T10:00:00.000Z" },
    },
    servedDate: "2026-06-15",
    servedIds: [legacy.qid],
    seenIds: [legacy.qid],
    served: [{ ...legacy, resurfaced: false }],
  };

  const first = brainteaser.getToday(kid.id, WEEKDAY_DATES.Mon);
  const snapshot = JSON.parse(JSON.stringify(first.questions));
  assert.ok(first.questions.every((q) => q.qid !== legacy.qid));
  assert.ok(first.questions.every((q) => ACTIVE_QUESTIONS.some((active) => active.qid === q.qid)));
  assert.equal(state.answered[legacy.qid].wrong, true);
  assert.equal(state.servedBankVersion, brainteaser.SERVED_BANK_VERSION);

  const second = brainteaser.getToday(kid.id, WEEKDAY_DATES.Mon);
  assert.deepEqual(second.questions, snapshot);
});

// ---------- weekday count ----------
test("countForWeekday: Mon=1 Tue=2 Wed=3 Thu=4 Fri=5 Sat=3 Sun=3", () => {
  assert.equal(brainteaser.countForWeekday(WEEKDAY_DATES.Mon), 1);
  assert.equal(brainteaser.countForWeekday(WEEKDAY_DATES.Tue), 2);
  assert.equal(brainteaser.countForWeekday(WEEKDAY_DATES.Wed), 3);
  assert.equal(brainteaser.countForWeekday(WEEKDAY_DATES.Thu), 4);
  assert.equal(brainteaser.countForWeekday(WEEKDAY_DATES.Fri), 5);
  assert.equal(brainteaser.countForWeekday(WEEKDAY_DATES.Sat), 3);
  assert.equal(brainteaser.countForWeekday(WEEKDAY_DATES.Sun), 3);
});

test("getToday: serves the weekday-appropriate count of questions", () => {
  const { fam, kid } = makeFamilyWithKid("A");
  const mon = brainteaser.getToday(kid.id, WEEKDAY_DATES.Mon);
  assert.equal(mon.count, 1);
  assert.equal(mon.questions.length, 1);
});

test("getToday: Friday serves 5 questions", () => {
  const { fam, kid } = makeFamilyWithKid("B");
  const fri = brainteaser.getToday(kid.id, WEEKDAY_DATES.Fri);
  assert.equal(fri.count, 5);
  assert.equal(fri.questions.length, 5);
});

// ---------- served set stability within a day ----------
test("getToday: the served set is stable across repeated calls on the same day", () => {
  const { fam, kid } = makeFamilyWithKid("C");
  const first = brainteaser.getToday(kid.id, WEEKDAY_DATES.Wed);
  const second = brainteaser.getToday(kid.id, WEEKDAY_DATES.Wed);
  assert.deepEqual(
    first.questions.map((q) => q.qid),
    second.questions.map((q) => q.qid)
  );
  // Options order (shuffle) is also stable, not re-shuffled per call.
  assert.deepEqual(first.questions, second.questions);
});

test("getToday: a new day re-shuffles / re-selects (served set is not forced identical across days)", () => {
  const { fam, kid } = makeFamilyWithKid("D");
  const wed = brainteaser.getToday(kid.id, WEEKDAY_DATES.Wed);
  const thu = brainteaser.getToday(kid.id, WEEKDAY_DATES.Thu);
  assert.equal(wed.count, 3);
  assert.equal(thu.count, 4); // different weekday count proves a fresh serve happened
});

test("getToday: viewed but unanswered questions do not repeat on the next day", () => {
  const { kid } = makeFamilyWithKid("D2");
  const first = brainteaser.getToday(kid.id, WEEKDAY_DATES.Mon);
  const second = brainteaser.getToday(kid.id, WEEKDAY_DATES.Tue);
  const firstIds = new Set(first.questions.map((q) => q.qid));

  assert.equal(first.count, 1);
  assert.equal(second.count, 2);
  assert.ok(second.questions.every((q) => !firstIds.has(q.qid)));
});

test("getToday: legacy state migrates servedIds into seen history", () => {
  const { kid } = makeFamilyWithKid("D3");
  const first = brainteaser.getToday(kid.id, WEEKDAY_DATES.Mon);
  const state = db.load().brainteaser[kid.id];
  delete state.seenIds;

  const second = brainteaser.getToday(kid.id, WEEKDAY_DATES.Tue);
  assert.ok(second.questions.every((q) => q.qid !== first.questions[0].qid));
  assert.ok(state.seenIds.includes(first.questions[0].qid));
});

test("getToday: exhausted history avoids the immediately previous set before rotating", () => {
  const { kid } = makeFamilyWithKid("D4");
  const state = db.load().brainteaser[kid.id] = {
    answered: {},
    servedDate: "2026-06-18",
    servedIds: ACTIVE_QUESTIONS.slice(0, 5).map((q) => q.qid),
    seenIds: QUESTIONS.map((q) => q.qid),
    served: [],
  };
  const previousIds = new Set(state.servedIds);

  const next = brainteaser.getToday(kid.id, WEEKDAY_DATES.Fri);
  assert.equal(next.questions.length, 5);
  assert.ok(next.questions.every((q) => !previousIds.has(q.qid)));
  assert.equal(new Set(next.questions.map((q) => q.qid)).size, 5);
});

// ---------- wrong -> resurface ----------
test("answer: marking a question wrong flags it for resurfacing on a later day", () => {
  const { fam, kid } = makeFamilyWithKid("E");
  const mon = brainteaser.getToday(kid.id, WEEKDAY_DATES.Mon); // 1 question
  const qid = mon.questions[0].qid;
  const ansResult = brainteaser.answer(kid.id, { qid, correct: false });
  assert.ok(!ansResult.error, ansResult.error);

  // Next day: that qid should be resurfaced (appears in the served set with resurfaced:true).
  const tue = brainteaser.getToday(kid.id, WEEKDAY_DATES.Tue); // 2 questions
  const resurfacedQ = tue.questions.find((q) => q.qid === qid);
  assert.ok(resurfacedQ, "expected the previously-wrong question to resurface");
  assert.equal(resurfacedQ.resurfaced, true);
});

test("getToday: legacy wrong answers remain valid history but never resurface", () => {
  const { kid } = makeFamilyWithKid("E0");
  const legacy = LEGACY_QUESTIONS[0];
  assert.ok(!brainteaser.answer(kid.id, { qid: legacy.qid, correct: false }).error);

  const today = brainteaser.getToday(kid.id, WEEKDAY_DATES.Fri);
  assert.ok(today.questions.every((q) => ACTIVE_QUESTIONS.some((active) => active.qid === q.qid)));
  assert.ok(today.questions.every((q) => q.qid !== legacy.qid));
  assert.equal(db.load().brainteaser[kid.id].answered[legacy.qid].wrong, true);
});

test("answer: a correct answer clears the wrong flag so it stops resurfacing", () => {
  const { fam, kid } = makeFamilyWithKid("F");
  const mon = brainteaser.getToday(kid.id, WEEKDAY_DATES.Mon);
  const qid = mon.questions[0].qid;
  brainteaser.answer(kid.id, { qid, correct: false });
  brainteaser.answer(kid.id, { qid, correct: true }); // redeemed

  const tue = brainteaser.getToday(kid.id, WEEKDAY_DATES.Tue);
  const found = tue.questions.find((q) => q.qid === qid);
  // It may still appear (pool selection is random), but never marked resurfaced.
  if (found) assert.equal(found.resurfaced, false);
});

test("answer: rejects an unknown qid", () => {
  const { fam, kid } = makeFamilyWithKid("G");
  const result = brainteaser.answer(kid.id, { qid: "bt_bogus", correct: true });
  assert.ok(result.error);
});

// ---------- option shuffle changes answerIndex ----------
test("option shuffle: a served question's answerIndex still points at the correct option (shuffled from source order)", () => {
  const { fam, kid } = makeFamilyWithKid("H");
  const today = brainteaser.getToday(kid.id, WEEKDAY_DATES.Fri);
  for (const served of today.questions) {
    const source = QUESTIONS.find((q) => q.qid === served.qid);
    const correctText = source.options[source.answerIndex];
    assert.equal(served.options[served.answerIndex], correctText);
    // Same set of option texts, just possibly reordered.
    assert.deepEqual(served.options.slice().sort(), source.options.slice().sort());
  }
});

test("option shuffle: resurfaced question's answerIndex is recomputed to match its (possibly new) option order", () => {
  const { fam, kid } = makeFamilyWithKid("I");
  const mon = brainteaser.getToday(kid.id, WEEKDAY_DATES.Mon);
  const qid = mon.questions[0].qid;
  brainteaser.answer(kid.id, { qid, correct: false });

  const tue = brainteaser.getToday(kid.id, WEEKDAY_DATES.Tue);
  const resurfacedQ = tue.questions.find((q) => q.qid === qid);
  const source = QUESTIONS.find((q) => q.qid === qid);
  const correctText = source.options[source.answerIndex];
  // Regardless of the new shuffle, answerIndex must still resolve to the
  // correct option text.
  assert.equal(resurfacedQ.options[resurfacedQ.answerIndex], correctText);
});

// ---------- kid-scope ----------
test("kid-scope: each kid has an independent brainteaser state", () => {
  const { fam, kid } = makeFamilyWithKid("J");
  const { kid: kid2 } = family.addKid(fam.id, fam.parentIds[0], { name: "Sibling" });
  const mon1 = brainteaser.getToday(kid.id, WEEKDAY_DATES.Mon);
  brainteaser.answer(kid.id, { qid: mon1.questions[0].qid, correct: false });

  const mon2 = brainteaser.getToday(kid2.id, WEEKDAY_DATES.Mon);
  // kid2's state is untouched by kid1's wrong answer.
  assert.equal(mon2.questions.length, 1);
});
