'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { practiceWords } = require('../lib/crossword-practice');
const { getDailyVocabulary } = require('../lib/vocabulary-challenges');
const word = getDailyVocabulary('2026-09-21').word.word;
const entry = { word, state: 'learning', seenCount: 1, wrongCount: 1, lastSeen: '2026-09-21T12:00:00Z' };
test('practice distinguishes recorded weekly mistakes from skipped words without guessing old mistakes', () => {
  const unseen = practiceWords('2026-09-26', []);
  assert.ok(unseen.length > 0 && unseen.every(item => item.reason === 'untried' && item.definition));
  assert.equal(practiceWords('2026-09-26', [entry]).some(item => item.word === word), false);
  const missed = practiceWords('2026-09-26', [{ ...entry, lastWrongAt: '2026-09-21T12:00:00Z' }]);
  assert.equal(missed[0].word, word);
  assert.equal(missed[0].reason, 'missed');
  assert.equal(practiceWords('2026-09-26', [{ ...entry, lastWrongAt: '2026-09-20T23:59:59Z' }]).some(item => item.word === word), false);
  assert.equal(practiceWords('2026-09-26', [{ ...entry, lastWrongAt: '2026-09-27T00:00:00Z' }]).some(item => item.word === word), false);
});
test('practice uses only supplied player records, excludes known unattempted words and future dates', () => {
  const one = practiceWords('2026-09-21', []);
  assert.deepEqual(one.map(item => item.word), [word]);
  assert.deepEqual(practiceWords('2026-09-21', [{ word, state: 'known', seenCount: 0 }]), []);
  assert.equal(practiceWords('2026-09-26', []).find(item => item.word === word).reason, 'untried');
  assert.deepEqual(practiceWords('bad', []), []);
});
