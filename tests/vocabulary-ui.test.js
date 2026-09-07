'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/js/sat.js', 'utf8');

function harness(getDailyVocabulary) {
  const elements = Object.fromEntries(['sat-activity', 'sat-word', 'sat-pos', 'sat-def', 'sat-example', 'sat-activity-feedback'].map(id => [id, {}]));
  const buttons = Array.from({ length: 3 }, () => ({ disabled: false }));
  let credits = 0;
  const sandbox = {
    document: { getElementById: id => elements[id], querySelector: () => null, querySelectorAll: () => buttons },
    window: { auth: { getDailyVocabulary, wordBankInteract: async () => ({}) } },
    currentSatWord: null, daily5DoneKey: () => 'account-day', isoDate: date => date.toISOString().slice(0, 10),
    loadPathOddsQuestWidget: () => {}, esc: value => String(value), load: () => true, SAT_WORDS: [],
    markDaily5Done: () => credits++,
  };
  vm.runInNewContext(source.slice(0, source.indexOf('function mergeWordBankEntry')), sandbox);
  return { sandbox, elements, buttons, credits: () => credits };
}
function payload() {
  const word = { word: 'lucid', pos: 'adj.', def: 'clear and understandable', example: 'The lucid explanation helped.' };
  return { date: new Date().toISOString().slice(0, 10), word, weekWords: Array(7).fill(word), challenge: { id: 'lucid', prompt: 'Which sentence misuses lucid?', answerIndex: 1, options: [
    { text: 'Her lucid instructions were easy to follow.', explanation: 'The instructions are clear.' },
    { text: 'The lucid boulder weighed a ton.', explanation: 'Lucid describes clarity, not weight.' },
    { text: 'He gave a lucid account of the event.', explanation: 'The account is understandable.' },
  ] } };
}
test('shared challenge offers three sentences and explains the misuse and both valid uses', async () => {
  const h = harness(async () => payload());
  await h.sandbox.renderSatActivity();
  assert.equal(h.elements['sat-word'].textContent, 'lucid');
  assert.equal((h.elements['sat-activity'].innerHTML.match(/onclick="answerSatActivity/g) || []).length, 3);
  assert.match(h.elements['sat-activity'].innerHTML, /This week’s shared vocabulary/);
  assert.equal((h.elements['sat-activity'].innerHTML.match(/<dt>/g) || []).length, 7);
  await h.sandbox.answerSatActivity(1);
  assert.match(h.elements['sat-activity-feedback'].innerHTML, /You found the misuse/);
  for (const option of payload().challenge.options) assert.ok(h.elements['sat-activity-feedback'].innerHTML.includes(option.explanation));
  assert.equal(h.buttons.every(button => button.disabled), true);
  assert.equal(h.credits(), 0);
});
test('offline vocabulary provides Retry and recovers without a substitute word', async () => {
  let offline = true;
  const h = harness(async () => { if (offline) throw Error('offline'); return payload(); });
  await h.sandbox.renderSatActivity();
  assert.equal(h.sandbox.currentSatWord, null);
  assert.match(h.elements['sat-activity'].innerHTML, /Retry/);
  offline = false;
  await h.sandbox.renderSatActivity();
  assert.equal(h.sandbox.currentSatWord.word, 'lucid');
});
test('a response from the previous account cannot reveal its vocabulary state', async () => {
  let resolve;
  const h = harness(() => new Promise(done => { resolve = done; }));
  const pending = h.sandbox.renderSatActivity();
  h.sandbox.daily5DoneKey = () => 'different-account';
  resolve(payload());
  await pending;
  assert.equal(h.sandbox.currentSatWord, null);
  assert.doesNotMatch(h.elements['sat-activity'].innerHTML, /answerSatActivity/);
});

test('wrong-date and undated vocabulary payloads remain unavailable with Retry', async () => {
  for (const date of ['2000-01-01', undefined]) {
    const h = harness(async () => ({ ...payload(), date }));
    await h.sandbox.renderSatActivity();
    assert.equal(h.sandbox.currentSatWord, null);
    assert.match(h.elements['sat-activity'].innerHTML, /Retry/);
    assert.doesNotMatch(h.elements['sat-activity'].innerHTML, /answerSatActivity/);
  }
});
