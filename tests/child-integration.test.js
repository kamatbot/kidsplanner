'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/js/app.js', 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test('child entry is parent-only and rejects children outside the current family', () => {
  const calls = [];
  const c = { sessionUser: { id: 'p' }, currentFamily: { kids: [{ id: 'a' }] }, activeChildViewId: null,
    isKidSession: () => c.sessionUser.role === 'kid', switchNavTab: tab => calls.push(tab),
    window: { famChildView: { render: id => calls.push(id) } } };
  vm.runInNewContext(section('function openChildView(', 'function refreshChildDate('), c);
  c.openChildView('a'); assert.deepEqual(calls, ['child', 'a']);
  c.openChildView('other'); assert.equal(calls.length, 2);
  c.sessionUser.role = 'kid'; c.openChildView('a'); assert.equal(calls.length, 2);
});

test('returning on a new date refreshes child insights without discarding same-day drafts', () => {
  let renders = 0;
  const c = { day:'2026-09-08', activeChildViewId:'a', isKidSession:()=>false,
    isoDate: d => { assert.ok(d); return c.day; },
    document:{hidden:false,querySelector:()=>({getAttribute:()=> '2026-09-08'})},
    window:{famChildView:{render:()=>renders++}} };
  vm.runInNewContext(section('function refreshChildDate(', "window.addEventListener('focus', refreshChildDate)"),c);
  c.refreshChildDate(); assert.equal(renders,0);
  c.day='2026-09-09'; c.refreshChildDate(); assert.equal(renders,1);
  c.document.hidden=true; c.refreshChildDate(); assert.equal(renders,1);
});

test('only fresh uniquely matched imports are uploaded and account switches stop continuation', async () => {
  const { compareSchoolStats, matchKidByFirstName } = require('../public/js/school-stats');
  const kids = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }];
  const uploads = []; let saved = 0;
  const c = { sessionUser: { id: 'p' }, currentFamily: { id: 'f', kids }, isKidSession: () => false,
    getSchoolStats: () => ({ old: { housePoints: 999 } }), compareSchoolStats, matchKidByFirstName,
    saveSchoolStats: () => saved++, renderSchoolStatsWidget() {}, toast() {},
    window: { auth: { saveChildSchoolStats: async (id, payload) => uploads.push([id, payload]), notifySelf: async () => {} } } };
  vm.runInNewContext(section('async function processSchoolStats(', 'async function legacyFamImportSchoolData('), c);
  assert.equal(await c.processSchoolStats(kids, [{ name: 'Alpha', housePoints: 12 }]), 1);
  assert.equal(uploads[0][0], 'a'); assert.equal(uploads[0][1].housePoints, 12);
  assert.match(uploads[0][1].importedAt, /T.*Z$/); assert.equal(saved, 1);
  assert.equal(await c.processSchoolStats([...kids, {id:'c',name:'Alpha Again'}], [{name:'Alpha',housePoints:13}]), 0);
  c.window.auth.saveChildSchoolStats = async (id, payload) => { uploads.push([id,payload]); c.sessionUser = {id:'other'}; };
  await c.processSchoolStats(kids, [{name:'Alpha',housePoints:14},{name:'Beta',housePoints:5}]);
  assert.equal(uploads.length, 2); assert.equal(saved, 1);
});

test('teaser load and completion cannot be attributed to a later day or account', async () => {
  let resolve; let renders = 0; const reports = [];
  const c = { key: 'child-a-day-1', daily5DoneKey: () => c.key,
    window: { auth: {getBrainTeaserToday: () => new Promise(r => { resolve = r; })} },
    document: {getElementById: () => ({style:{}})}, setTimeout: fn => { c.timer = fn; },
    markDaily5Done: part => reports.push(part), QUIZ: [], dayOfYear: () => 1 };
  const code = section('let brainTeaserQuestions =', 'function renderBrainTeaser(') +
    'function renderBrainTeaser(){ renders++; }' +
    section('function nextQuestion(', '/* ============================================================\n   STREAK');
  c.renders = 0; vm.createContext(c); vm.runInContext(code,c);
  const old = c.loadBrainTeaser(); c.key = 'child-b-day-2'; resolve({questions:[{}]}); await old;
  assert.equal(c.renders, 0);
  const fresh = c.loadBrainTeaser(); resolve({questions:[{}]}); await fresh;
  vm.runInContext('brainTeaserAnswered = true', c); c.nextQuestion();
  c.key = 'child-b-day-3'; c.timer(); assert.deepEqual(reports, []);
  c.nextQuestion(); assert.deepEqual(reports, []);
});

test('shared scripts and server route are wired; parent homework stays review-only', () => {
  const html = fs.readFileSync('public/index.html','utf8');
  for (const file of ['child-view','child-progress']) assert.ok(html.includes(`/js/${file}.js`));
  assert.match(fs.readFileSync('server.js','utf8'), /require\("\.\/lib\/routes\/child-insights"\)\(app, routeDeps\)/);
  const detail = section('function openHomeworkDetail(', 'async function toggleHomeworkChecklistItem(');
  assert.match(detail, /isKidSession\(\).*disabled/s);
  assert.ok(!detail.includes('Mark complete'));
});
