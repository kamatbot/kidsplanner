'use strict';
/*
 * Web Hermes tab (docs/HERMES-THREADS-CONTRACT.md §8 governs the underlying
 * hermes-nudge card contract; the "Waiting on you" selection below is
 * narrower by design — only actionable cards, since a status-only card like
 * "school ended now" doesn't belong on an inbox-style waiting list). Follows
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
  vm.runInContext(fn('hermesPendingItems'), c);

  const within = nudge({ id: 'a', createdAt: hoursAgo(17) });
  const older = nudge({ id: 'b', createdAt: hoursAgo(19) });
  assert.deepEqual(c.hermesPendingItems([within], NOW).map((m) => m.id), ['a']);
  assert.deepEqual(c.hermesPendingItems([older], NOW).map((m) => m.id), []);
});

test('a status-only card (no actionable button, e.g. "school ended now") never shows, even freshly posted', () => {
  const c = {};
  vm.createContext(c);
  vm.runInContext(fn('hermesPendingItems'), c);

  const statusCard = { type: 'hermes-nudge', state: { status: 'open' }, actions: [] };
  const fresh = nudge({ id: 'a', card: statusCard, createdAt: hoursAgo(0.1) });
  assert.deepEqual(c.hermesPendingItems([fresh], NOW), []);
});

test('an action with "open" set does not count as actionable, so its card never shows here', () => {
  const c = {};
  vm.createContext(c);
  vm.runInContext(fn('hermesPendingItems'), c);

  const openOnlyCard = { type: 'hermes-nudge', state: { status: 'open' }, actions: [{ id: 'open-homework', label: 'Open homework', style: 'primary', open: 'homework' }] };
  const fresh = nudge({ id: 'a', card: openOnlyCard, createdAt: hoursAgo(1) });
  assert.deepEqual(c.hermesPendingItems([fresh], NOW), []);
});

test('a "done" action does not count as actionable, so a card with only a done action never shows here', () => {
  const c = {};
  vm.createContext(c);
  vm.runInContext(fn('hermesPendingItems'), c);

  const doneOnlyCard = { type: 'hermes-nudge', state: { status: 'open' }, actions: [{ id: 'later', label: 'In 30 min', style: 'secondary', done: true, doneLabel: 'Snoozed' }] };
  const fresh = nudge({ id: 'a', card: doneOnlyCard, createdAt: hoursAgo(1) });
  assert.deepEqual(c.hermesPendingItems([fresh], NOW), []);
});

test('resolved, snoozed, dismissed and deleted cards never show, even freshly posted', () => {
  const c = {};
  vm.createContext(c);
  vm.runInContext(fn('hermesPendingItems'), c);

  const done = nudge({ id: 'a', card: { type: 'hermes-nudge', state: { status: 'done', label: 'Dinner planned' }, actions: [] } });
  const snoozed = nudge({ id: 'b', card: { type: 'hermes-nudge', state: { status: 'snoozed', label: 'Snoozed 30 min' }, actions: [{ id: 'later', label: 'In 30 min' }] } });
  const dismissed = nudge({ id: 'c', card: { type: 'hermes-nudge', state: { status: 'dismissed', label: 'Dismissed' }, actions: [] } });
  const deleted = nudge({ id: 'd', deleted: true });
  assert.deepEqual(c.hermesPendingItems([done, snoozed, dismissed, deleted], NOW), []);
});

test('shows at most `limit` candidates, newest first, defaulting to 3', () => {
  const c = {};
  vm.createContext(c);
  vm.runInContext(fn('hermesPendingItems'), c);

  const oldest = nudge({ id: 'a', createdAt: hoursAgo(4) });
  const third = nudge({ id: 'b', createdAt: hoursAgo(3) });
  const middle = nudge({ id: 'c', createdAt: hoursAgo(2) });
  const newest = nudge({ id: 'd', createdAt: hoursAgo(1) });
  const all = [oldest, third, middle, newest];
  assert.deepEqual(c.hermesPendingItems(all, NOW, 2).map((m) => m.id), ['d', 'c']);
  assert.deepEqual(c.hermesPendingItems(all, NOW).map((m) => m.id), ['d', 'c', 'b']); // default limit 3
  assert.deepEqual(c.hermesPendingItems(all, NOW, Infinity).map((m) => m.id), ['d', 'c', 'b', 'a']); // badge: no cap
});

test('a pending row shows the message text and its buttons dispatch through handleHermesNudgeButton', () => {
  const c = { esc, renderHermesNudgeButton: (id, a) => `<button data-message-id="${id}" data-action-id="${a.id}" onclick="handleHermesNudgeButton(this)"></button>` };
  vm.createContext(c);
  vm.runInContext(fn('renderHermesPendingRow'), c);

  const message = nudge({ id: 'm1', text: 'Ryshi finishes in 30 min.' });
  const html = c.renderHermesPendingRow(message);
  assert.match(html, /Ryshi finishes in 30 min\./);
  assert.match(html, /data-action-id="later"[^>]*onclick="handleHermesNudgeButton\(this\)"/);
});

test('an approval row shows its proposal lines (at most 3); other kinds stay text-only', () => {
  const c = { esc, renderHermesNudgeButton: (id, a) => `<button data-action-id="${a.id}"></button>` };
  vm.createContext(c);
  vm.runInContext(fn('renderHermesPendingRow'), c);

  const approval = { id: 'm9', text: 'Hermes needs your OK to add “Science fair” to the calendar.', card: { type: 'hermes-nudge', kind: 'approval', lines: ['When · Thu, Oct 1 · 16:00–17:00', 'For · Taylor', 'Notes · Bring the model', 'Extra'], actions: [{ id: 'approve' }, { id: 'reject' }], state: { status: 'open' } } };
  const html = c.renderHermesPendingRow(approval);
  assert.match(html, /hermes-pending-lines/);
  assert.ok(html.includes('When · Thu, Oct 1 · 16:00–17:00') && html.includes('Notes · Bring the model'));
  assert.ok(!html.includes('Extra'), 'at most 3 lines');

  const plain = c.renderHermesPendingRow(Object.assign({}, approval, { card: Object.assign({}, approval.card, { kind: 'home-parent' }) }));
  assert.ok(!plain.includes('hermes-pending-lines'));
});

test('the nav badge counts actionable open cards within 18h with no cap, and hides at 0', () => {
  const badge = { textContent: '', hidden: false };
  const store = { 'sidebar-hermes-badge': badge };
  const c = {
    hermesMessages: [],
    document: { getElementById: (id) => store[id] || null },
  };
  vm.createContext(c);
  vm.runInContext(fn('hermesPendingItems') + fn('updateHermesBadge'), c);

  c.updateHermesBadge();
  assert.equal(badge.textContent, 0);
  assert.equal(badge.hidden, true);

  c.hermesMessages = Array.from({ length: 5 }, (_, i) => nudge({ id: `m${i}`, createdAt: hoursAgo(1) }));
  c.updateHermesBadge();
  assert.equal(badge.textContent, 5); // no cap, unlike the page's 3-row "Waiting on you" list
  assert.equal(badge.hidden, false);

  // Kid sessions/phone have no sidebar element for this badge — safe no-op.
  c.document.getElementById = () => null;
  assert.doesNotThrow(() => c.updateHermesBadge());
});

test('renderHermesPage is a no-op while the tab is inactive, and shows the empty state when there are no messages', () => {
  let active = false;
  const panel = { classList: { contains: () => active } };
  const pending = { hidden: false };
  const pendingList = { innerHTML: 'stale' };
  const messagesEl = { innerHTML: 'stale', scrollHeight: 0, scrollTop: 0, clientHeight: 0 };
  const store = { 'tab-hermes': panel, 'hermes-pending': pending, 'hermes-pending-list': pendingList, 'hermes-page-messages': messagesEl };
  const c = {
    hermesMessages: [], hermesLoaded: true, hermesAvailable: true,
    document: { getElementById: (id) => store[id] || null },
  };
  vm.createContext(c);
  vm.runInContext(fn('hermesPendingItems') + fn('renderHermesPendingRow') + fn('renderHermesPage'), c);

  c.renderHermesPage();
  assert.equal(messagesEl.innerHTML, 'stale', 'no DOM writes while the tab is inactive');

  active = true;
  c.renderHermesPage();
  assert.match(messagesEl.innerHTML, /Hermes checks in here/);
  assert.equal(pending.hidden, true); // no actionable cards
});

test('renderHermesPage shows the unavailable notice when hermesAvailable is false', () => {
  const panel = { classList: { contains: () => true } };
  const messagesEl = { innerHTML: '', scrollHeight: 0, scrollTop: 0, clientHeight: 0 };
  const store = { 'tab-hermes': panel, 'hermes-page-messages': messagesEl };
  const c = {
    hermesMessages: [], hermesLoaded: true, hermesAvailable: false,
    document: { getElementById: (id) => store[id] || null },
  };
  vm.createContext(c);
  vm.runInContext(fn('renderHermesPage'), c);

  c.renderHermesPage();
  assert.match(messagesEl.innerHTML, /Hermes isn.t available right now\./);
});

test('the ?chat=hermes deep link calls switchNavTab(\'hermes\') from init(), replacing the old dock/slide-over open', async () => {
  const calls = [];
  const c = {
    URLSearchParams,
    window: { location: { search: '?chat=hermes' } },
    document: { addEventListener: () => {} },
    migrateLegacyStorage: () => {},
    bootstrapSession: async () => true,
    showDashboard: () => {},
    switchNavTab: (tab) => calls.push(tab),
    openChildView: () => assert.fail('no ?child= in this URL'),
    startKidRequestPolling: () => {},
    renderInstallAppControl: () => {},
    registerServiceWorker: () => Promise.resolve(),
    renderNotificationsControl: () => {},
    startReminderLoop: () => {},
  };
  vm.createContext(c);
  vm.runInContext(fn('init'), c);

  await c.init();
  assert.deepEqual(calls, ['hermes']);
});
