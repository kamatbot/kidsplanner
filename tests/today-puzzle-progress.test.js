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

test('Wednesday completion requires both the Sudoku and the mental math answer', async () => {
  const h = setup();
  Object.assign(h.elements, { 'puzzle-mental-math': {}, 'mental-math-answer': {value:''}, 'mental-math-feedback': {} });
  h.context.esc = String;
  h.context.window.auth.getDailyPuzzle = async () => ({ available:true,date:h.context.day,type:'sudoku',sudoku:{puzzle:'00',solution:'12'},mentalMath:{title:'Multiply by 25',prompt:'48 × 25',answer:'1200',explanation:'Divide by4, multiply by100.'} });
  await h.context.loadDailyPuzzle();
  h.inputs().forEach((input,index) => { input.value = String(index + 1); });
  h.context.checkDailyPuzzle();
  assert.equal(h.storage.get(h.context.daily5DoneKey()), undefined);
  assert.match(h.elements['puzzle-status'].textContent,/mental math shortcut/);
  h.elements['mental-math-answer'].value = '12';
  h.context.checkMentalMath();
  assert.equal(h.storage.get(h.context.daily5DoneKey())?.puzzle,undefined);
  h.elements['mental-math-answer'].value = '1,200';
  h.context.checkMentalMath();
  assert.equal(h.storage.get(h.context.daily5DoneKey()).puzzle,true);
  h.elements['mental-math-answer'].value = '0';
  h.context.resetMentalMath();
  assert.equal(h.storage.get(h.context.daily5DoneKey()).puzzle,undefined);
});

test('scheduled multiple choice requires a correct answer and rejects stale-account answers', async () => {
  const h=setup(); h.context.esc=String;
  h.elements['academic-feedback']={};
  const buttons=Array.from({length:4},()=>({setAttribute(){}}));
  h.context.document.querySelectorAll=()=>buttons;
  h.context.window.auth.getDailyPuzzle=async()=>({available:true,date:h.context.day,type:'sat',question:{id:'one',passage:'Evidence',prompt:'Which?',options:['A','B','C','D'],answerIndex:2,explanations:['No','No','Yes','No']}});
  await h.context.loadDailyPuzzle();
  h.context.answerAcademicChallenge(0);
  assert.equal(h.storage.get(h.context.daily5DoneKey()),undefined);
  assert.match(h.elements['academic-feedback'].innerHTML,/try again/);
  h.context.answerAcademicChallenge(2);
  assert.equal(h.storage.get(h.context.daily5DoneKey()).puzzle,true);
  assert.ok(buttons.every(button=>button.disabled));
  h.context.sessionUser.id='another';
  h.context.answerAcademicChallenge(2);
  assert.equal(h.storage.get(h.context.daily5DoneKey()),undefined);
});


test('a puzzle response crossing local midnight cannot become the new day’s challenge', async () => {
  const h = setup(); let resolve;
  h.context.window.auth.getDailyPuzzle = () => new Promise(done => { resolve = done; });
  const pending = h.context.loadDailyPuzzle();
  h.context.day = '2026-09-08';
  resolve({available:true,date:'2026-09-07',type:'sudoku',sudoku:{puzzle:'00',solution:'12'}});
  await pending;
  assert.equal(h.context.currentDailyPuzzle, null);
  assert.equal(h.storage.size, 0);
});
