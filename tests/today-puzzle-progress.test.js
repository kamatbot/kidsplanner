'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/js/app.js'), 'utf8');

function setup() {
  const storage = new Map();
  const elements = Object.fromEntries(['widget-puzzle', 'puzzle-grid-wrap', 'puzzle-clues', 'puzzle-status', 'puzzle-retry-btn', 'puzzle-title', 'puzzle-icon', 'puzzle-instructions'].map((id) => [id, { hidden: false, innerHTML: '', textContent: '' }]));
  let inputs = [];
  const context = {
    sessionUser: { id: 'ryshi' },
    currentDailyPuzzle: null, currentPuzzleProgressKey: null, currentPuzzleCompletionKey: null, puzzleRequestToken: 0,
    day: '2026-09-07',
    document: { getElementById: (id) => elements[id], querySelectorAll: () => inputs },
    isoDate: () => context.day,
    daily5DoneKey: () => `${context.sessionUser.id}_${context.day}`,
    load: (key) => storage.get(key), save: (key, value) => storage.set(key, value),
    applyDaily5Done() {},
    markDaily5Done: (part) => { storage.set(context.daily5DoneKey(), { ...storage.get(context.daily5DoneKey()), [part]: true }); },
    renderDailyPuzzle: () => { inputs = ['1', '2'].map((solution) => ({ value: '', dataset: { solution }, classList: { add() {}, remove() {} } })); },
    window: { auth: { getDailyPuzzle: async () => ({ available: true, date: context.day, type: 'sudoku', sudoku: { puzzle: '00', solution: '12' } }) } },
  };
  const loadCode = source.slice(source.indexOf('async function loadDailyPuzzle('), source.indexOf('function renderDailyPuzzle('));
  const checkCode = source.slice(source.indexOf('function clearDailyPuzzle('), source.indexOf('/* ============================================================\n   BRAIN TEASER'));
  vm.runInNewContext(loadCode + checkCode, context);
  return { context, storage, elements, inputs: () => inputs };
}

test('puzzle progress survives reload, credits a solved board once, and Clear resets credit', async () => {
  const h = setup();
  await h.context.loadDailyPuzzle();
  h.inputs()[0].value = '1';
  h.elements['puzzle-grid-wrap'].oninput({});
  h.context.checkDailyPuzzle();
  assert.match(h.elements['puzzle-status'].textContent, /1 square/);
  assert.equal(h.storage.get(h.context.daily5DoneKey()), undefined);
  await h.context.loadDailyPuzzle();
  assert.equal(h.inputs()[0].value, '1');
  h.inputs()[1].value = '2';
  h.context.checkDailyPuzzle();
  h.context.checkDailyPuzzle();
  assert.deepEqual({ ...h.storage.get(h.context.daily5DoneKey()) }, { puzzle: true });
  await h.context.loadDailyPuzzle();
  assert.match(h.elements['puzzle-status'].textContent, /Puzzle complete/);
  h.context.clearDailyPuzzle();
  assert.deepEqual(h.inputs().map((input) => input.value), ['', '']);
  assert.equal(h.storage.get(h.context.daily5DoneKey()).puzzle, undefined);
  await h.context.loadDailyPuzzle();
  assert.deepEqual(h.inputs().map((input) => input.value), ['', '']);
});

test('account switches, date changes and exact board changes cannot restore another board', async () => {
  const h = setup();
  await h.context.loadDailyPuzzle();
  h.inputs()[0].value = '1';
  h.context.saveDailyPuzzleProgress();
  h.context.sessionUser = { id: 'sibling' };
  h.context.checkDailyPuzzle();
  assert.equal(h.storage.get(h.context.daily5DoneKey()), undefined);
  await h.context.loadDailyPuzzle();
  assert.equal(h.inputs()[0].value, '');
  h.context.sessionUser = { id: 'ryshi' };
  h.context.day = '2026-09-08';
  await h.context.loadDailyPuzzle();
  assert.equal(h.inputs()[0].value, '');
  h.context.day = '2026-09-07';
  h.context.window.auth.getDailyPuzzle = async () => ({ available: true, date: h.context.day, type: 'sudoku', sudoku: { puzzle: '00', solution: '21' } });
  await h.context.loadDailyPuzzle();
  assert.equal(h.inputs()[0].value, '');
});

test('editing a solved board removes completion and credit, while navigation keys preserve them', async () => {
  const h = setup();
  await h.context.loadDailyPuzzle();
  h.inputs()[0].value = '1';
  h.inputs()[1].value = '2';
  h.context.checkDailyPuzzle();
  const status = h.elements['puzzle-status'].textContent;
  h.elements['puzzle-grid-wrap'].onkeyup({ key: 'ArrowRight' });
  assert.equal(h.storage.get(h.context.currentPuzzleProgressKey).solved, true);
  assert.equal(h.storage.get(h.context.daily5DoneKey()).puzzle, true);
  assert.equal(h.elements['puzzle-status'].textContent, status);
  h.inputs()[1].value = '9';
  h.elements['puzzle-grid-wrap'].oninput({ inputType: 'insertText' });
  assert.equal(h.storage.get(h.context.currentPuzzleProgressKey).solved, false);
  assert.equal(h.storage.get(h.context.daily5DoneKey()).puzzle, undefined);
  assert.equal(h.elements['puzzle-status'].textContent, '');
  await h.context.loadDailyPuzzle();
  assert.equal(h.inputs()[1].value, '9');
  assert.doesNotMatch(h.elements['puzzle-status'].textContent, /complete|correct/i);
  h.context.checkDailyPuzzle();
  assert.match(h.elements['puzzle-status'].textContent, /take another look/);
  assert.equal(h.storage.get(h.context.daily5DoneKey()).puzzle, undefined);
});

test('failed puzzle load keeps recovery visible and cannot produce empty-board success', async () => {
  const h = setup();
  h.context.window.auth.getDailyPuzzle = async () => { throw new Error('offline'); };
  await h.context.loadDailyPuzzle();
  assert.equal(h.elements['widget-puzzle'].hidden, false);
  assert.equal(h.elements['puzzle-retry-btn'].hidden, false);
  h.context.checkDailyPuzzle();
  assert.match(h.elements['puzzle-status'].textContent, /Could not load/);
  assert.equal(h.storage.size, 0);
});
