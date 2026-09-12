"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-test-wordbank-"));

const store = require("../lib/store");
const family = require("../lib/family");
const wordbank = require("../lib/wordbank");
const { WORDS } = require("../lib/sat-words");

function makeFamilyWithKid(label) {
  const parent = store.createUser(`${label}@example.com`, `Parent ${label}`);
  const fam = family.createFamily(parent.id, `${label} Family`);
  const { kid } = family.addKid(fam.id, parent.id, { name: `Kid ${label}`, grade: "6" });
  return { parent, fam, kid };
}

test("sat-words: exports a complete same-part-of-speech pool with the expected shape", () => {
  assert.ok(WORDS.length >= 30);
  for (const pos of new Set(WORDS.map(w => w.pos))) assert.ok(WORDS.filter(w => w.pos === pos).length >= 4, pos);
  for (const w of WORDS) {
    assert.equal(typeof w.word, "string");
    assert.equal(typeof w.pos, "string");
    assert.equal(typeof w.def, "string");
    assert.equal(typeof w.example, "string");
  }
});

// ---------- interact ----------
test("interact: creates an entry in 'learning' state and increments seenCount", () => {
  const { fam, kid } = makeFamilyWithKid("A");
  const word = WORDS[0].word;
  const result = wordbank.interact(kid.id, { word, correct: true });
  assert.ok(!result.error, result.error);
  assert.equal(result.entry.word, word);
  assert.equal(result.entry.state, "learning");
  assert.equal(result.entry.seenCount, 1);
  assert.equal(result.entry.correctCount, 1);
});

test("interact: rejects an unknown word", () => {
  const { fam, kid } = makeFamilyWithKid("B");
  const result = wordbank.interact(kid.id, { word: "notarealsatword", correct: true });
  assert.ok(result.error);
});

test("interact: promotes to 'mastered' once correctCount reaches 3", () => {
  const { fam, kid } = makeFamilyWithKid("C");
  const word = WORDS[1].word;
  wordbank.interact(kid.id, { word, correct: true });
  wordbank.interact(kid.id, { word, correct: false });
  let result = wordbank.interact(kid.id, { word, correct: true });
  assert.equal(result.entry.correctCount, 2);
  assert.equal(result.entry.state, "learning"); // not yet mastered
  result = wordbank.interact(kid.id, { word, correct: true });
  assert.equal(result.entry.correctCount, 3);
  assert.equal(result.entry.state, "mastered");
});

test("interact: wrong answers increment wrongCount without promoting", () => {
  const { fam, kid } = makeFamilyWithKid("D");
  const word = WORDS[2].word;
  wordbank.interact(kid.id, { word, correct: false });
  const result = wordbank.interact(kid.id, { word, correct: false });
  assert.equal(result.entry.wrongCount, 2);
  assert.equal(result.entry.correctCount, 0);
  assert.equal(result.entry.state, "learning");
});

test("interact: word matching is case-insensitive but stores the canonical word", () => {
  const { fam, kid } = makeFamilyWithKid("E");
  const word = WORDS[3].word;
  const result = wordbank.interact(kid.id, { word: word.toUpperCase(), correct: true });
  assert.equal(result.entry.word, word);
});

// ---------- placement ----------
test("placement: marks given words as 'known' and reports stats", () => {
  const { fam, kid } = makeFamilyWithKid("F");
  const known = [WORDS[4].word, WORDS[5].word];
  const result = wordbank.placement(kid.id, { known });
  assert.ok(!result.error, result.error);
  assert.equal(result.stats.known, 2);
  const { words } = wordbank.listWords(kid.id);
  const entry = words.find((w) => w.word === WORDS[4].word);
  assert.equal(entry.state, "known");
});

test("placement: ignores unknown words silently", () => {
  const { fam, kid } = makeFamilyWithKid("G");
  const result = wordbank.placement(kid.id, { known: ["not-a-word", WORDS[6].word] });
  assert.ok(!result.error, result.error);
  assert.equal(result.stats.known, 1);
});

test("placement: rejects a non-array `known`", () => {
  const { fam, kid } = makeFamilyWithKid("H");
  const result = wordbank.placement(kid.id, { known: "not-an-array" });
  assert.ok(result.error);
});

// ---------- quiz ----------
test("quiz: returns needMore when fewer than 2 quizzable words exist", () => {
  const { fam, kid } = makeFamilyWithKid("I");
  const result = wordbank.quiz(kid.id, { n: 5 });
  assert.deepEqual(result.questions, []);
  assert.equal(result.needMore, true);
});

test("quiz: builds questions with 4 options and a valid answerIndex from mastered/known words", () => {
  const { fam, kid } = makeFamilyWithKid("J");
  wordbank.placement(kid.id, { known: [WORDS[0].word, WORDS[1].word, WORDS[2].word] });
  const result = wordbank.quiz(kid.id, { n: 2 });
  assert.ok(!result.needMore);
  assert.equal(result.questions.length, 2);
  for (const q of result.questions) {
    assert.equal(typeof q.word, "string");
    assert.match(q.prompt, /^Which word means: /);
    assert.equal(q.options.length, 4);
    assert.ok(q.options.includes(q.word));
    assert.equal(q.options[q.answerIndex], q.word);
    // no duplicate options
    assert.equal(new Set(q.options).size, 4);
  }
});

test("quiz: falls back to any seen word when fewer than 2 mastered/known exist", () => {
  const { fam, kid } = makeFamilyWithKid("K");
  wordbank.interact(kid.id, { word: WORDS[0].word, correct: false });
  wordbank.interact(kid.id, { word: WORDS[1].word, correct: false });
  const result = wordbank.quiz(kid.id, { n: 5 });
  assert.ok(!result.needMore);
  assert.ok(result.questions.length > 0);
});

// ---------- kid-scope ----------
test("kid-scope: each kid has an independent word bank", () => {
  const { fam, kid } = makeFamilyWithKid("L");
  const { kid: kid2 } = family.addKid(fam.id, fam.parentIds[0], { name: "Sibling" });
  wordbank.interact(kid.id, { word: WORDS[0].word, correct: true });
  const { words: wordsForKid1 } = wordbank.listWords(kid.id);
  const { words: wordsForKid2 } = wordbank.listWords(kid2.id);
  assert.equal(wordsForKid1.length, 1);
  assert.equal(wordsForKid2.length, 0);
});

test('every quiz option matches the answer part of speech with four unique choices', () => {
  const { kid } = makeFamilyWithKid('parts');
  wordbank.placement(kid.id, { known: WORDS.map(w => w.word) });
  const byWord = new Map(WORDS.map(w => [w.word, w]));
  for (let i = 0; i < 12; i++) {
    for (const q of wordbank.quiz(kid.id, { n: 20 }).questions) {
      assert.equal(new Set(q.options).size, 4);
      assert.equal(q.options[q.answerIndex], q.word);
      for (const option of q.options) assert.equal(byWord.get(option).pos, byWord.get(q.word).pos);
    }
  }
});

test('bundled web and iOS placement words remain valid entries in the expanded server bank', () => {
  const vm = require('node:vm');
  const web = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
  const literal = web.match(/const SAT_WORDS = (\[[\s\S]*?\n\]);/)[1];
  const webWords = JSON.parse(JSON.stringify(vm.runInNewContext(literal)));
  assert.deepEqual(webWords, WORDS.slice(0, 35));
  const swift = fs.readFileSync(path.join(__dirname, '../ios/FamETC/Domain/DailyContent.swift'), 'utf8');
  const rows = [...swift.matchAll(/\.init\(word: ("(?:[^"\\]|\\.)*"), pos: ("[^"]*"), def: ("(?:[^"\\]|\\.)*"), example: ("(?:[^"\\]|\\.)*")\)/g)].map(m => Object.fromEntries(['word','pos','def','example'].map((k,i) => [k,JSON.parse(m[i+1])])));
  assert.deepEqual(rows, webWords);
});

test('web daily activity renders the three authored contexts for each shared word', async () => {
  const vm = require('node:vm');
  const { getDailyVocabulary } = require('../lib/vocabulary-challenges');
  const source = fs.readFileSync(path.join(__dirname, '../public/js/sat.js'), 'utf8');
  const fn = source.slice(source.indexOf('let dailyVocabulary'), source.indexOf('function submitSatPlacement'));
  for (let index = 0; index < WORDS.length; index++) {
    const date = new Date(Date.UTC(2026, 8, 13 + index)).toISOString().slice(0, 10);
    const edition = getDailyVocabulary(date);
    const container = { innerHTML: '' };
    const context = { currentSatWord: null, SAT_WORDS: WORDS,
      document: { getElementById: id => id === 'sat-activity' ? container : null, querySelector: () => null },
      window: { auth: { getDailyVocabulary: async requested => { assert.equal(requested, date); return edition; } } },
      daily5DoneKey: () => `child:${date}`, isoDate: () => date, loadPathOddsQuestWidget() {}, esc: s => s };
    vm.runInNewContext(fn, context);
    await context.renderSatActivity();
    const options = [...container.innerHTML.matchAll(/class="fam-sat-opt"[^>]*>(.*?)<\/button>/g)].map(m => m[1]);
    assert.equal(new Set(options).size, 3);
    assert.deepEqual(options, edition.challenge.options.map(option => option.text));
    assert.equal(context.currentSatWord.word, edition.word.word);
  }
});


test('legacy dates preserve the old daily pool while new dates use the shared endpoint', () => {
  const { LEGACY_DAILY_WORDS } = require('../lib/sat-words');
  const { getDailyVocabulary } = require('../lib/vocabulary-challenges');
  const rotation = Array.from({ length: 30 }, (_, index) => getDailyVocabulary(new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10)).word);
  assert.deepEqual(rotation, LEGACY_DAILY_WORDS);
  const native = fs.readFileSync(path.join(__dirname, '../ios/FamETC/Networking/APIClient.swift'), 'utf8');
  const web = fs.readFileSync(path.join(__dirname, '../public/js/auth.js'), 'utf8');
  assert.ok(native.includes('/api/enrichment/vocabulary/today?date='));
  assert.ok(web.includes('/api/enrichment/vocabulary/today?date='));
});
