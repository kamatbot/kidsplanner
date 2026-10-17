'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/js/trips.js'), 'utf8');
function fn(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2) + '\n';
}
function context(extra = {}) {
  return vm.createContext({ AbortController, Date, Map, crypto, setTimeout, clearTimeout,
    currentTripId: 'trip-one', currentUserId: 'user', tripChatMessages: [], tripChatLastId: null,
    tripChatScope: null, tripChatPendingSend: null, tripChatSending: false,
    tripChatPollTimer: null, TRIP_CHAT_BACKOFF_MS: [2000], document: { hidden: false },
    renderTripChatMessages() {}, tripScrollChatToBottom() {}, toast() {}, ...extra });
}
const message = (id, text = id) => ({ id, text, createdAt: '2026-10-18T00:00:00Z' });

test('trip snapshot refresh retains history, applies moderation and preserves insertion cursor', async () => {
  const lifetime = new AbortController();
  let now = 0, snapshots = 0;
  const cursors = [];
  const c = context({ tripChatPollTimer: lifetime, tripChatLastId: 'latest',
    tripChatMessages: [message('old'), message('latest')], Date: { now: () => now },
    tripChatReceivePause: async () => {},
    window: { auth: { getTripChatMessages: async (trip, opts) => {
      assert.equal(trip, 'trip-one'); assert.equal(opts.limit, 200); snapshots++;
      return [{ ...message('latest', ''), deleted: true, flagged: true }];
    } } },
    tripChatLongPollFetch: async (trip, cursor) => {
      assert.equal(trip, 'trip-one'); cursors.push(cursor);
      if (cursors.length === 1) { now = 59000; return [message('new1')]; }
      if (cursors.length === 2) { assert.equal(snapshots, 0); now = 61000; return [message('new2')]; }
      lifetime.abort(); return [];
    } });
  vm.runInContext(fn('tripMergeChatMessages') + fn('tripChatLongPollLoop'), c);
  await c.tripChatLongPollLoop(lifetime);
  assert.equal(snapshots, 1);
  assert.deepEqual(cursors, ['latest', 'new1', 'new2']);
  assert.deepEqual(Array.from(c.tripChatMessages, m => m.id), ['old', 'latest', 'new1', 'new2']);
  assert.equal(c.tripChatMessages[1].deleted, true);
  assert.equal(c.tripChatMessages[1].flagged, true);
});

test('old trip receive cannot merge into a replacement loop', async () => {
  const lifetime = new AbortController();
  let deliver;
  const c = context({ tripChatPollTimer: lifetime,
    tripChatLongPollFetch: () => new Promise(resolve => { deliver = resolve; }) });
  vm.runInContext(fn('tripMergeChatMessages') + fn('tripChatLongPollLoop'), c);
  const pending = c.tripChatLongPollLoop(lifetime);
  lifetime.abort(); c.currentTripId = 'trip-two'; c.tripChatPollTimer = new AbortController();
  deliver([message('private')]); await pending;
  assert.equal(c.tripChatMessages.length, 0);
});

test('late initial trip snapshot cannot enter a different room', async () => {
  let deliver;
  const c = context({ window: { auth: { getTripChatMessages: () => new Promise(resolve => { deliver = resolve; }) } } });
  vm.runInContext(fn('tripMergeChatMessages') + fn('tripLoadChat'), c);
  const pending = c.tripLoadChat();
  c.currentTripId = 'trip-two'; deliver([message('private')]); await pending;
  assert.equal(c.tripChatMessages.length, 0);
});

test('uncertain trip send reuses its key, preserves draft, and changes key for a new room', async () => {
  const ids = [];
  let fail = true;
  const input = { value: 'Draft' };
  const c = context({ document: { getElementById: () => input },
    window: { auth: { sendTripChatMessage: async (trip, text, media, id) => {
      ids.push(id);
      if (fail) throw new Error('Response lost');
      input.value = 'New draft'; return { message: message('sent', text) };
    } } } });
  vm.runInContext(fn('tripMergeChatMessages') + fn('tripSendChatMessage'), c);
  const send = () => c.tripSendChatMessage({ preventDefault() {} });
  await send(); assert.equal(input.value, 'Draft');
  fail = false; await send();
  assert.equal(ids[0], ids[1]); assert.equal(input.value, 'New draft');
  input.value = 'Draft'; await send(); assert.notEqual(ids[1], ids[2]);
  fail = true; input.value = 'Draft'; await send();
  c.currentTripId = 'trip-two'; await send(); assert.notEqual(ids[3], ids[4]);
});

test('fast empty trip response backs off instead of spinning', async () => {
  const lifetime = new AbortController();
  let delay;
  const c = context({ tripChatPollTimer: lifetime, tripChatLongPollFetch: async () => [],
    tripChatReceivePause: async (_, ms) => { delay = ms; lifetime.abort(); } });
  vm.runInContext(fn('tripMergeChatMessages') + fn('tripChatLongPollLoop'), c);
  await c.tripChatLongPollLoop(lifetime);
  assert.ok(delay > 0 && delay <= 1000);
});
