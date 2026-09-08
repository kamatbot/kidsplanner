'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/js/app.js', 'utf8');

function setup() {
  const keys = ['news', 'word', 'puzzle', 'quiz', 'quote'];
  const nodes = { 'daily5-tabs': {} };
  for (const key of keys) {
    nodes[`daily5-tab-${key}`] = { id: `daily5-tab-${key}`, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, focus() { this.focused = true; } };
    nodes[`daily5-panel-${key}`] = { hidden: false, draft: `untouched-${key}`, children: [{}] };
  }
  const ctx = { scope: 'parent-today', document: { getElementById: id => nodes[id] }, daily5DoneKey: () => ctx.scope };
  vm.runInNewContext(source.slice(source.indexOf('const DAILY5_ACTIVITIES'), source.indexOf('function renderWidgets()')), ctx);
  return { ctx, nodes, keys };
}

test('Daily5 shows exactly one mounted panel and never replaces activity state', () => {
  const { ctx, nodes, keys } = setup();
  ctx.initDaily5Tabs();
  const child = nodes['daily5-panel-puzzle'].children[0];
  for (const active of keys) {
    ctx.selectDaily5Activity(active);
    for (const key of keys) {
      assert.equal(nodes[`daily5-panel-${key}`].hidden, key !== active);
      assert.equal(nodes[`daily5-tab-${key}`].attrs['aria-selected'], String(key === active));
      assert.equal(nodes[`daily5-tab-${key}`].tabIndex, key === active ? 0 : -1);
      assert.equal(nodes[`daily5-panel-${key}`].draft, `untouched-${key}`);
    }
  }
  assert.equal(nodes['daily5-panel-puzzle'].children[0], child);
});

test('arrow keys wrap, Home/End work, and non-tab keys are not intercepted', () => {
  const { ctx, nodes } = setup();
  ctx.initDaily5Tabs();
  let prevented = 0;
  const key = (id, value) => nodes['daily5-tabs'].onkeydown({ target: { id }, key: value, preventDefault() { prevented++; } });
  key('daily5-tab-news', 'ArrowLeft');
  assert.equal(nodes['daily5-tab-quote'].focused, true);
  key('daily5-tab-quote', 'ArrowRight');
  assert.equal(nodes['daily5-panel-news'].hidden, false);
  key('daily5-tab-news', 'End');
  assert.equal(nodes['daily5-panel-quote'].hidden, false);
  key('daily5-tab-quote', 'Home');
  assert.equal(nodes['daily5-panel-news'].hidden, false);
  key('other-field', 'ArrowRight');
  key('daily5-tab-news', 'Tab');
  assert.equal(prevented, 4);
});

test('refresh keeps the selected activity; a different account/day resets to News', () => {
  const { ctx, nodes } = setup();
  ctx.initDaily5Tabs();
  ctx.selectDaily5Activity('word');
  ctx.initDaily5Tabs();
  assert.equal(nodes['daily5-panel-word'].hidden, false);
  ctx.scope = 'child-tomorrow';
  ctx.initDaily5Tabs();
  assert.equal(nodes['daily5-panel-news'].hidden, false);
  ctx.selectDaily5Activity('invalid');
  assert.equal(nodes['daily5-panel-news'].hidden, false);
});

test('completed brain teaser keeps an explicit completion state in its tab', () => {
  const nodes = { 'widget-quiz': {}, 'daily5-quiz-done': {}, 'daily-quest-summary': {} };
  const ctx = { done: {}, load: () => ctx.done, daily5DoneKey: () => 'today', document: { getElementById: id => nodes[id] } };
  vm.runInNewContext(source.slice(source.indexOf('function applyDaily5Done()'), source.indexOf('const DAILY5_ACTIVITIES')), ctx);
  ctx.applyDaily5Done();
  assert.equal(nodes['widget-quiz'].hidden, false);
  assert.equal(nodes['daily5-quiz-done'].hidden, true);
  ctx.done = { bt: true, news: true };
  ctx.applyDaily5Done();
  assert.equal(nodes['widget-quiz'].hidden, true);
  assert.equal(nodes['daily5-quiz-done'].hidden, false);
  assert.match(nodes['daily-quest-summary'].textContent, /2 of 3 complete/);
});

test('compact homework preview counts unfinished work, shows two, and preserves role actions', () => {
  const nodes = { 'today-homework-list': {}, 'today-homework-count': {} };
  const ctx = {
    kid: false, isKidSession: () => ctx.kid, esc: value => value, kidColorFor: () => '#123456',
    parseIso: value => new Date(value), document: { getElementById: id => nodes[id] },
    groupHomeworkByDueDate: items => ({ overdue: [], today: items, thisWeek: [] }),
    homeworkItems: ['first', 'second', 'third', 'done'].map(id => ({ id, title: id, dueDate: '2026-09-08', status: id === 'done' ? 'done' : 'open' }))
  };
  vm.runInNewContext(source.slice(source.indexOf('function renderTodayHomeworkRow('), source.indexOf('function renderTodayHabitRow(')), ctx);
  ctx.renderTodayHomework('2026-09-08');
  assert.equal(nodes['today-homework-count'].textContent, '3 due');
  assert.equal((nodes['today-homework-list'].innerHTML.match(/<button /g) || []).length, 2);
  assert.match(nodes['today-homework-list'].innerHTML, /openHomeworkDetail/);
  assert.doesNotMatch(nodes['today-homework-list'].innerHTML, /toggleHomeworkDone|third/);
  ctx.kid = true;
  ctx.renderTodayHomework('2026-09-08');
  assert.match(nodes['today-homework-list'].innerHTML, /toggleHomeworkDone/);
  ctx.homeworkItems = ctx.homeworkItems.filter(item => item.status === 'done');
  ctx.renderTodayHomework('2026-09-08');
  assert.equal(nodes['today-homework-count'].textContent, 'All clear');
});
