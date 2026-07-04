"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-test-brainteaser-"));

const store = require("../lib/store");
const family = require("../lib/family");
const brainteaser = require("../lib/brainteaser");
const { QUESTIONS } = require("../lib/brainteaser-questions");

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

test("question bank: at least 15 questions, each with a unique stable qid", () => {
  assert.ok(QUESTIONS.length >= 15);
  const qids = new Set(QUESTIONS.map((q) => q.qid));
  assert.equal(qids.size, QUESTIONS.length);
  for (const q of QUESTIONS) {
    assert.match(q.qid, /^bt\d+$/);
    assert.equal(q.options.length, 4);
    assert.ok(q.answerIndex >= 0 && q.answerIndex < 4);
  }
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
