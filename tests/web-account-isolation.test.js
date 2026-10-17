'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync('public/js/app.js', 'utf8');
const util = fs.readFileSync('public/js/util.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const login = fs.readFileSync('public/login.html', 'utf8');

function fn(name, source = app) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  const next = source.slice(start + 1).search(/\n(?:async )?function \w+\(/);
  return source.slice(start, next < 0 ? undefined : start + 1 + next) + '\n';
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const event = (id, title) => ({ id, title, date: '2026-10-18', kidId: null });
function harness(storage = new Map()) {
  const messages = [], posts = [], ordered = [];
  const c = {
    sessionUser: { id: 'parent-a', role: 'parent' }, currentFamily: { id: 'family-a' },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    famEventsSync: null, swRegistration: null, webPushSessionTask: Promise.resolve(),
    activeChildViewId: null, resetCompanionSession() {}, clearReminderTimers() { ordered.push('clear-reminders'); },
    renderCalendar() {}, renderTodayScreen() {}, scheduleReminders() {},
    toast: message => messages.push(message), navigator: {},
    window: { location: { href: '/app' }, auth: {
      getCalendarEvents: async () => [],
      addCalendarEvent: async payload => { posts.push({ user: c.sessionUser.id, ...payload }); return { event: event('ev_added', payload.title) }; },
      signOut: async () => { ordered.push('logout'); },
      subscribeWebPush: async sub => { ordered.push(`bind:${c.sessionUser.id}:${sub.endpoint}`); },
      unsubscribeWebPush: async endpoint => { ordered.push(`detach:${endpoint}`); },
    } },
  };
  vm.createContext(c);
  vm.runInContext(util + ['loadFamilyEvents', 'saveEvent', 'handleLogout', 'syncBrowserPush', 'detachBrowserPush'].map(name => fn(name)).join('\n'), c);
  return { c, storage, messages, posts, ordered };
}
function switchToB(c) {
  c.sessionUser = { id: 'parent-b', role: 'parent' };
  c.currentFamily = { id: 'family-b' };
  c.resetFamilyEventCache();
  vm.runInContext('famEventsSync = null', c);
}

test('shared browser preserves but never replays unknown legacy events or another account queue', async () => {
  const { c, storage, posts } = harness();
  const legacy = JSON.stringify([event('legacy', 'Unknown private appointment')]);
  storage.set('fam_events', legacy);
  assert.equal(c.getEvents().length, 0);
  c.saveEvents([event('ev_a', 'A private appointment'), event('pending-a', 'A offline appointment')]);
  switchToB(c);
  assert.equal(c.getEvents().length, 0);
  c.window.auth.getCalendarEvents = async () => { throw new Error('offline'); };
  await c.loadFamilyEvents();
  assert.equal(c.getEvents().length, 0);
  c.window.auth.getCalendarEvents = async () => [event('ev_b', 'B appointment')];
  await c.loadFamilyEvents();
  assert.deepEqual(Array.from(c.getEvents(), row => row.title), ['B appointment']);
  assert.equal(posts.length, 0);
  assert.equal(storage.get('fam_events'), legacy, 'quarantine must remain recoverable');
  c.sessionUser = { id: 'parent-a', role: 'parent' }; c.currentFamily = { id: 'family-a' };
  assert.deepEqual(Array.from(c.getEvents(), row => row.title), ['A private appointment', 'A offline appointment']);
});

test('an old account calendar response cannot overwrite the next account cache or post old pending entries', async () => {
  const { c, posts } = harness();
  const old = deferred();
  c.saveEvents([event('pending-a', 'A only')]);
  c.window.auth.getCalendarEvents = () => old.promise;
  const loadingA = c.loadFamilyEvents();
  await tick();
  switchToB(c);
  c.window.auth.getCalendarEvents = async () => [event('ev_b', 'B only')];
  await c.loadFamilyEvents();
  old.resolve([event('ev_a', 'A server result')]);
  await loadingA;
  assert.equal(posts.length, 0);
  assert.deepEqual(Array.from(c.getEvents(), row => row.title), ['B only']);
});

test('an in-flight queued upload stops before the remaining old entries after account switch', async () => {
  const { c, posts } = harness();
  const upload = deferred();
  c.saveEvents([event('first-a', 'A first'), event('second-a', 'A second')]);
  c.window.auth.addCalendarEvent = payload => { posts.push({ user: c.sessionUser.id, title: payload.title }); return upload.promise; };
  const syncing = c.loadFamilyEvents();
  await tick();
  switchToB(c);
  c.saveEvents([event('ev_b', 'B only')]);
  upload.resolve({ event: event('ev_a', 'A first') });
  await syncing;
  assert.deepEqual(posts, [{ user: 'parent-a', title: 'A first' }]);
  assert.deepEqual(Array.from(c.getEvents(), row => row.title), ['B only']);
});

test('late failed save cannot enqueue an old account form into the new account', async () => {
  const { c } = harness();
  const request = deferred();
  const fields = { 'event-audience': 'family', 'event-title': 'A private form', 'event-date': '2026-10-18' };
  c.document = { getElementById: id => ({ value: fields[id] || '' }), querySelector: () => ({ value: 'other' }) };
  c.chatEventComposerSource = null; c.editingEventId = null;
  c.window.auth.addCalendarEvent = () => request.promise;
  const saving = c.saveEvent({ preventDefault() {} });
  switchToB(c);
  request.reject(new Error('offline'));
  await saving;
  assert.equal(c.getEvents().length, 0);
});

test('existing browser subscription is rebound on login; stale account lookup cannot bind after a switch', async () => {
  const { c, ordered } = harness();
  const subscription = { endpoint: 'https://push/shared' };
  const registration = { pushManager: { getSubscription: async () => subscription } };
  await c.syncBrowserPush(registration);
  switchToB(c);
  await c.syncBrowserPush(registration);
  assert.deepEqual(ordered, ['bind:parent-a:https://push/shared', 'bind:parent-b:https://push/shared']);
  const pending = deferred();
  const stale = c.syncBrowserPush({ pushManager: { getSubscription: () => pending.promise } });
  await tick();
  c.sessionUser = { id: 'parent-c', role: 'parent' };
  pending.resolve(subscription);
  await stale;
  assert.equal(ordered.length, 2);
});

test('logout detaches notifications while authenticated, stops local delivery, then revokes session and clears event visibility', async () => {
  const { c, ordered } = harness();
  c.saveEvents([event('ev_a', 'A private')]);
  c.navigator.serviceWorker = {};
  c.swRegistration = {
    pushManager: { getSubscription: async () => ({ endpoint: 'https://push/shared', unsubscribe: async () => { ordered.push('browser-unsubscribe'); return true; } }) },
    getNotifications: async () => [{ close() { ordered.push('close-notification'); } }],
  };
  await c.handleLogout();
  assert.deepEqual(ordered, ['detach:https://push/shared', 'browser-unsubscribe', 'close-notification', 'logout', 'clear-reminders']);
  assert.equal(c.sessionUser, null);
  assert.equal(c.getEvents().length, 0);
  assert.equal(c.window.location.href, '/login');
});

test('failed ownership transfer disables the existing browser subscription instead of keeping old-account delivery', async () => {
  const { c } = harness();
  let removed = false;
  c.window.auth.subscribeWebPush = async () => { throw new Error('Offline'); };
  const subscription = { endpoint: 'https://push/old-account', unsubscribe: async () => { removed = true; return true; } };
  await assert.rejects(c.syncBrowserPush({ pushManager: { getSubscription: async () => subscription } }), /Offline/);
  assert.equal(removed, true);
});

test('failed logout keeps the current account available for retry instead of displaying a different account', async () => {
  const { c, messages } = harness();
  c.window.auth.signOut = async () => { throw new Error('Server unavailable. Try again.'); };
  await c.handleLogout();
  assert.equal(c.sessionUser.id, 'parent-a');
  assert.equal(c.window.location.href, '/app');
  assert.match(messages[0], /Try again/);
});

test('rejected optional push lookup cannot block logout from the family-load recovery screen', async () => {
  const { c, ordered } = harness();
  let recoveryVisible = false;
  const panel = { classList: { add() { recoveryVisible = true; }, remove() { recoveryVisible = false; } }, querySelector: () => ({ focus() {} }) };
  c.document = { getElementById: () => panel };
  Object.assign(c, { companionState: {}, applyRoleScopingToUI() {}, hideFirstRunPanel() {}, isKidSession: () => false });
  c.window.auth.getMe = async () => ({ user: { id: 'parent-a', role: 'parent' } });
  c.window.auth.getFamilies = async () => { throw new Error('Family unavailable'); };
  vm.runInContext(fn('bootstrapSession'), c);
  assert.equal(await c.bootstrapSession(), false);
  assert.equal(recoveryVisible, true);
  c.navigator.serviceWorker = {};
  c.swRegistration = { pushManager: { getSubscription: async () => { throw new Error('Push lookup unavailable'); } } };
  await c.handleLogout();
  assert.ok(ordered.includes('logout'), 'session revocation must still be reached');
  assert.equal(c.sessionUser, null);
  assert.equal(c.currentFamily, null);
  assert.equal(c.getEvents().length, 0);
  assert.ok(ordered.includes('clear-reminders'));
  assert.equal(c.window.location.href, '/login?notifications=cleanup-failed');
  assert.equal(c.handleLogout.pending, false);
});

test('login reports incomplete notification cleanup while keeping account switching available', () => {
  const notice = { hidden: true };
  const context = { URLSearchParams, window: { location: { search: '?notifications=cleanup-failed' } }, document: { getElementById: () => notice } };
  vm.runInNewContext(fn('showNotificationCleanupNotice', login), context);
  assert.equal(notice.hidden, false);
  assert.match(login, /You’re signed out, but notification cleanup couldn’t finish/);
  assert.match(login, /id="role-choice"/);
  assert.match(login, /id="login-form"/);
  notice.hidden = true;
  context.window.location.search = '';
  context.showNotificationCleanupNotice();
  assert.equal(notice.hidden, true);
});

test('initial family loading failure exposes retry/sign-out and never offers accidental family creation', async () => {
  const { c } = harness();
  let firstRun = false, recovery = false;
  const classes = { add() { recovery = true; }, remove() { recovery = false; } };
  c.document = { getElementById: () => ({ classList: classes, querySelector: () => ({ focus() {} }) }) };
  Object.assign(c, {
    companionState: {}, applyRoleScopingToUI() {}, hideFirstRunPanel() { firstRun = false; },
    showFirstRunPanel() { firstRun = true; }, isKidSession: () => false,
  });
  c.window.auth.getMe = async () => ({ user: { id: 'parent-a', role: 'parent' } });
  c.window.auth.getFamilies = async () => { throw new Error('500'); };
  c.window.auth.getTrips = async () => [];
  vm.runInContext(fn('bootstrapSession'), c);
  assert.equal(await c.bootstrapSession(), false);
  assert.equal(recovery, true);
  assert.equal(firstRun, false);
  const recoveryMarkup = html.slice(html.indexOf('id="family-load-error-panel"'), html.indexOf('APP SHELL'));
  assert.match(recoveryMarkup, /window\.location\.reload\(\)/);
  assert.match(recoveryMarkup, /handleLogout\(\)/);
  c.window.auth.getFamilies = async () => [];
  assert.equal(await c.bootstrapSession(), true);
  assert.equal(recovery, false);
  assert.equal(firstRun, true);
});
