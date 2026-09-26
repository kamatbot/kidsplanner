'use strict';
/*
 * Web Today-page Hermes strip (docs/HERMES-THREADS-CONTRACT.md §8). Follows
 * the extraction style of tests/hermes-thread-ui.test.js: pull just the
 * function(s) under test out of app.js by source text and run them in a small
 * vm sandbox, rather than loading the whole file (which assumes a real DOM).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/js/app.js'), 'utf8');

function fn(name) {
  const re = new RegExp(`(?:async )?function ${name}\\(`);
  const start = source.search(re);
  assert.ok(start >= 0, name);
  const next = source.slice(start + 1).search(/\n(?:async )?function \w+\(/);
  return source.slice(start, next < 0 ? undefined : start + 1 + next) + '\n';
}

const esc = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const NOW = Date.parse('2026-09-26T12:00:00.000Z');
const hoursAgo = (h) => new Date(NOW - h * 3600 * 1000).toISOString();

// A minimal open, actionable hermes-nudge candidate; override per test.
function nudge(overrides = {}) {
  return Object.assign({
    id: 'm1', senderType: 'agent', deleted: false,
    card: { type: 'hermes-nudge', state: { status: 'open' }, actions: [{ id: 'later', label: 'In 30 min', style: 'secondary' }] },
    text: 'Ryshi finishes in 30 min.',
    createdAt: hoursAgo(1),
  }, overrides);
}

test('an actionable card (a button with no "open" that is not done) shows within 18h and hides once older', () => {
  const c = {};
  vm.createContext(c);
  vm.runInContext(fn('todayHermesStripItems'), c);

  const within = nudge({ id: 'a', createdAt: hoursAgo(17) });
  const older = nudge({ id: 'b', createdAt: hoursAgo(19) });
  assert.deepEqual(c.todayHermesStripItems([within], NOW).map((m) => m.id), ['a']);
  assert.deepEqual(c.todayHermesStripItems([older], NOW).map((m) => m.id), []);
});

test('a status-only card (no actionable button, e.g. "school ended now") shows within 2h and hides once older', () => {
  const c = {};
  vm.createContext(c);
  vm.runInContext(fn('todayHermesStripItems'), c);

  const statusCard = { type: 'hermes-nudge', state: { status: 'open' }, actions: [] };
  const within = nudge({ id: 'a', card: statusCard, createdAt: hoursAgo(1) });
  const older = nudge({ id: 'b', card: statusCard, createdAt: hoursAgo(3) });
  assert.deepEqual(c.todayHermesStripItems([within], NOW).map((m) => m.id), ['a']);
  assert.deepEqual(c.todayHermesStripItems([older], NOW).map((m) => m.id), []);
});

test('an action with "open" set does not count as actionable, so its card only gets the 2h status window', () => {
  const c = {};
  vm.createContext(c);
  vm.runInContext(fn('todayHermesStripItems'), c);

  const openOnlyCard = { type: 'hermes-nudge', state: { status: 'open' }, actions: [{ id: 'open-homework', label: 'Open homework', style: 'primary', open: 'homework' }] };
  const withinStatusWindow = nudge({ id: 'a', card: openOnlyCard, createdAt: hoursAgo(1) });
  const pastStatusButWithinActionableWindow = nudge({ id: 'b', card: openOnlyCard, createdAt: hoursAgo(10) });
  assert.deepEqual(c.todayHermesStripItems([withinStatusWindow], NOW).map((m) => m.id), ['a']);
  assert.deepEqual(c.todayHermesStripItems([pastStatusButWithinActionableWindow], NOW).map((m) => m.id), []);
});

test('a "done" action does not count as actionable, so its card only gets the 2h status window', () => {
  const c = {};
  vm.createContext(c);
  vm.runInContext(fn('todayHermesStripItems'), c);

  const doneOnlyCard = { type: 'hermes-nudge', state: { status: 'open' }, actions: [{ id: 'later', label: 'In 30 min', style: 'secondary', done: true, doneLabel: 'Snoozed' }] };
  const withinStatusWindow = nudge({ id: 'a', card: doneOnlyCard, createdAt: hoursAgo(1) });
  const pastStatusButWithinActionableWindow = nudge({ id: 'b', card: doneOnlyCard, createdAt: hoursAgo(10) });
  assert.deepEqual(c.todayHermesStripItems([withinStatusWindow], NOW).map((m) => m.id), ['a']);
  assert.deepEqual(c.todayHermesStripItems([pastStatusButWithinActionableWindow], NOW).map((m) => m.id), []);
});

test('resolved, snoozed, dismissed and deleted cards never show, even freshly posted', () => {
  const c = {};
  vm.createContext(c);
  vm.runInContext(fn('todayHermesStripItems'), c);

  const done = nudge({ id: 'a', card: { type: 'hermes-nudge', state: { status: 'done', label: 'Dinner planned' }, actions: [] } });
  const snoozed = nudge({ id: 'b', card: { type: 'hermes-nudge', state: { status: 'snoozed', label: 'Snoozed 30 min' }, actions: [{ id: 'later', label: 'In 30 min' }] } });
  const dismissed = nudge({ id: 'c', card: { type: 'hermes-nudge', state: { status: 'dismissed', label: 'Dismissed' }, actions: [] } });
  const deleted = nudge({ id: 'd', deleted: true });
  assert.deepEqual(c.todayHermesStripItems([done, snoozed, dismissed, deleted], NOW), []);
});

test('shows at most 2 candidates, newest first', () => {
  const c = {};
  vm.createContext(c);
  vm.runInContext(fn('todayHermesStripItems'), c);

  const oldest = nudge({ id: 'a', createdAt: hoursAgo(3) });
  const middle = nudge({ id: 'b', createdAt: hoursAgo(2) });
  const newest = nudge({ id: 'c', createdAt: hoursAgo(1) });
  assert.deepEqual(c.todayHermesStripItems([oldest, middle, newest], NOW).map((m) => m.id), ['c', 'b']);
});

test('the strip is hidden when there are no candidates', () => {
  const el = { hidden: false, innerHTML: 'stale' };
  const c = {
    esc, hermesMessages: [],
    document: { getElementById: (id) => (id === 'today-hermes-strip' ? el : null) },
  };
  vm.createContext(c);
  vm.runInContext(fn('todayHermesStripItems') + fn('renderHermesNudgeButton') + fn('renderTodayHermesStripRow') + fn('renderTodayHermesStrip'), c);
  c.renderTodayHermesStrip();
  assert.equal(el.hidden, true);
  assert.equal(el.innerHTML, '');
});

test('a shown row\'s text opens the Hermes chat and its buttons dispatch through handleHermesNudgeButton', () => {
  const el = { hidden: true, innerHTML: '' };
  // Recent-relative-to-real-now so it clears both the 2h and 18h windows
  // regardless of when the suite runs; renderTodayHermesStrip has no nowMs hook.
  const message = nudge({ id: 'm1', createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(), text: 'Ryshi finishes in 30 min.' });
  const c = {
    esc, hermesMessages: [message],
    document: { getElementById: (id) => (id === 'today-hermes-strip' ? el : null) },
  };
  vm.createContext(c);
  vm.runInContext(fn('todayHermesStripItems') + fn('renderHermesNudgeButton') + fn('renderTodayHermesStripRow') + fn('renderTodayHermesStrip'), c);
  c.renderTodayHermesStrip();

  assert.equal(el.hidden, false);
  assert.match(el.innerHTML, /Ryshi finishes in 30 min\./);
  assert.match(el.innerHTML, /class="fr-hermes-open" onclick="openHermesChat\(\)"/);
  assert.match(el.innerHTML, /data-action-id="later"[^>]*onclick="handleHermesNudgeButton\(this\)"/);
});
