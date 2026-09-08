'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/js/child-view.js'), 'utf8');
function setup(overrides = {}) {
  const nodes = Object.fromEntries(['child-nav', 'tab-child'].map(id => [id, { innerHTML: '', hidden: false, setAttribute() {} }]));
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : ['2026-09-08T12:00:00'])); } }
  const context = { Date: Clock, document: { getElementById: id => nodes[id] }, sessionUser: { id: 'parent' }, currentFamily: { id: 'family', kids: [{ id: 'one', name: 'One <img>' }, { id: 'two', name: 'Two' }] },
    isKidSession() { return context.sessionUser?.role === 'kid'; }, isoDate: date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    kidAvatarMarkup: () => '<span class="kid-profile-avatar">O</span>', esc: v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    auth: { getChildInsights: async id => ({ kidId: id, date: '2026-09-08', daily5: { date: '2026-09-08', parts: {} } }), getHomework: async () => [], getGoals: async () => [], getActivities: async () => [], ...overrides },
  };
  context.window = context; vm.runInNewContext(source, context); return { context, nodes, view: context.famChildView };
}
test('parent navigation scopes selected child and never renders for kid sessions', async () => {
  const { context, nodes, view } = setup(); await view.render('one');
  assert.match(nodes['child-nav'].innerHTML, /One &lt;img>/); assert.equal((nodes['child-nav'].innerHTML.match(/aria-current="page"/g) || []).length, 1);
  context.sessionUser = { role: 'kid' }; await view.render('one'); assert.equal(nodes['tab-child'].innerHTML, ''); assert.equal(nodes['child-nav'].hidden, true);
});
test('synced Daily 5 without completions shows not done; failed sources identify recovery', async () => {
  const { nodes, view } = setup({ getGoals: async () => { throw new Error('offline'); } }); await view.render('one');
  const html = nodes['tab-child'].innerHTML;
  assert.match(html, /0 of 5 done/); assert.equal((html.match(/>Not done</g) || []).length, 5); assert.match(html, /Habits unavailable/); assert.match(html, /No child-specific school snapshot/);
  assert.doesNotMatch(html, /0 completed|>0<|onclick=|mark.*done/i); assert.match(html, /Set home plan/);
});
test('habit counts use exactly the seven displayed local dates; Daily 5 ignores invalid timestamps', async () => {
  const { nodes, view } = setup({ getGoals: async () => [{ kidId: 'one', type: 'habit', title: 'Read', checks: ['2026-09-01', '2026-09-02', '2026-09-08', '2026-09-08', '2026-09-09'] }], getChildInsights: async () => ({ kidId: 'one', date: '2026-09-08', daily5: { date: '2026-09-08', parts: { news: { status: 'completed', updatedAt: '2026-09-08T08:00:00Z' }, word: { status: 'completed', updatedAt: 'invalid' }, quote: { status: 'started', updatedAt: '2026-09-08T09:00:00Z' } } } }) });
  await view.render('one'); const html = nodes['tab-child'].innerHTML;
  assert.match(html, /2 of 7 days recorded/); assert.match(html, /1 of 5 done/); assert.equal((html.match(/>Done</g) || []).length, 1); assert.equal((html.match(/>Not done</g) || []).length, 4); assert.match(html, /2026-09-02: checked in/); assert.doesNotMatch(html, /2026-09-01: checked in/);
});
test('house points use the newest valid extension import for the selected child only', async () => {
  const { context, nodes, view } = setup({ getChildInsights: async id => ({ kidId: id, date: '2026-09-08', schoolStats: { housePoints: 12, importedAt: '2026-09-08T08:00:00Z' } }) });
  const cache = { one: { housePoints: 0, updatedAt: Date.parse('2026-09-08T09:00:00Z') }, two: { housePoints: 999, updatedAt: Date.parse('2026-09-08T10:00:00Z') } };
  context.famGetSchoolStats = () => cache;
  await view.render('one'); assert.match(nodes['tab-child'].innerHTML, /cv-point-value">0</); assert.doesNotMatch(nodes['tab-child'].innerHTML, /999/);
  cache.one.updatedAt = Date.parse('2026-09-08T07:00:00Z');
  await view.render('one'); assert.match(nodes['tab-child'].innerHTML, /cv-point-value">12</);
  cache.one.updatedAt = 'invalid';
  await view.render('one'); assert.match(nodes['tab-child'].innerHTML, /cv-point-value">12</);
  delete cache.one;
  await view.render('one'); assert.match(nodes['tab-child'].innerHTML, /cv-point-value">12</);
});
test('desktop navigation never switches to Today-only or intermediate-width compression', () => {
  const read = name => fs.readFileSync(require('node:path').join(__dirname, '../public/css', name), 'utf8');
  assert.doesNotMatch(read('today-home.css'), /#tab-today\.active\) \.app-sidebar/);
  assert.doesNotMatch(read('styles.css'), /@media \(max-width: 1280px\)/);
  assert.doesNotMatch(read('child-view.css'), /min-width: 901px\) and \(max-width: 1280px/);
});
test('late child and account responses cannot replace current private content', async () => {
  let resolve; const deferred = new Promise(r => { resolve = r; });
  const { context, nodes, view } = setup({ getChildInsights: id => id === 'one' ? deferred : Promise.resolve({ kidId: id, date: '2026-09-08' }) });
  const old = view.render('one'); await view.render('two'); resolve({ kidId: 'one', date: '2026-09-08', schoolStats: { housePoints: 999, importedAt: '2026-09-08T01:00:00Z' } }); await old;
  assert.match(nodes['tab-child'].innerHTML, /<h1>Two<\/h1>/); assert.doesNotMatch(nodes['tab-child'].innerHTML, /999/);
  let finish; context.auth.getChildInsights = () => new Promise(r => { finish = r; }); const loading = view.render('one'); view.clear(); finish({ kidId: 'one', date: '2026-09-08' }); await loading; assert.equal(nodes['tab-child'].innerHTML, '');
});
test('weekly ECA selection is child/day scoped and parent plan is explicit', async () => {
  const { nodes, view } = setup({ getActivities: async () => [{ kidId: 'one', name: 'Swimming', schedule: [{ day: 'tue', start: '15:30', end: '16:30' }] }, { kidId: 'two', name: 'Private sibling activity', schedule: [{ day: 'tue', start: '15:00' }] }], getChildInsights: async () => ({ kidId: 'one', date: '2026-09-08', homePlan: { date: '2026-09-08', homeTime: '17:10', pickupLabel: '<script>' } }) });
  await view.render('one'); const html = nodes['tab-child'].innerHTML;
  assert.match(html, /Swimming/); assert.match(html, /17:10/); assert.match(html, /&lt;script>/); assert.doesNotMatch(html, /Private sibling activity|<script>/); assert.match(html, /Expected · parent plan/);
});
test('school description is escaped and full homework route selects this child', async () => {
  const { context, nodes, view } = setup({ getHomework: async () => [{ id: 'h', kidId: 'one', title: 'Science', schoolDescription: '<b>Explain condensation</b>', notes: 'Secondary notes' }] });
  context.activeKidId = 'two'; let switches = 0; let tab;
  context.renderKidSwitcher = () => { switches++; }; context.switchNavTab = value => { tab = value; };
  await view.render('one'); assert.match(nodes['tab-child'].innerHTML, /&lt;b>Explain condensation/);
  nodes['tab-child'].onclick({ target: { closest: () => ({ dataset: { cvAction: 'all-homework' } }) } });
  assert.equal(context.activeKidId, 'one'); assert.equal(switches, 1); assert.equal(tab, 'homework');
});
test('habit markers retain block dimensions and child layout owns its spacing', () => {
  const css = fs.readFileSync(require('node:path').join(__dirname, '../public/css/child-view.css'), 'utf8');
  assert.doesNotMatch(css, /\.cv-habit > div > span/);
  assert.match(css, /\.cv-day i \{ display: block; width: 14px; height: 14px/);
  assert.match(css, /\.main-content:has\(#tab-child:not\(\[hidden\]\)\) \{ padding: 0/);
  assert.match(css, /#child-nav \{ display: flex; order: 10; flex: 0 0 100%/);
  assert.match(css, /@media \(min-width: 901px\) \{[\s\S]*?\.main-content-wrap:has\(#tab-child:not\(\[hidden\]\)\):has\(#chat-dock\.chat-force-open:not\(\[hidden\]\)\) \.main-content \{ margin-right: 56px; \}/);
  assert.match(css, /\.cv-panel \.cv-footer \{ max-width: calc\(100% - 64px\); justify-content: flex-start; \}/);
  assert.match(css, /@media \(min-width: 901px\) \{[\s\S]*?\.cv-habit \{ padding-top: 12px; padding-bottom: 12px; \}/);
});
test('failed insight load cannot expose a blank editor that replaces an existing plan', async () => {
  const { nodes, view } = setup({ getChildInsights: async () => { throw new Error('offline'); } });
  await view.render('one');
  assert.match(nodes['tab-child'].innerHTML, /data-cv-action="edit-plan" disabled/);
  assert.match(nodes['tab-child'].innerHTML, />Unavailable<\/strong>/);
  assert.match(nodes['tab-child'].innerHTML, /Couldn’t sync progress/);
  assert.doesNotMatch(nodes['tab-child'].innerHTML, />Not done</);
  nodes['tab-child'].onclick({ target: { closest: () => ({ dataset: { cvAction: 'edit-plan' } }) } });
  assert.doesNotMatch(nodes['tab-child'].innerHTML, /class="cv-plan-form"/);
});
