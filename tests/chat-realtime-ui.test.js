'use strict';
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
function context(extra = {}) {
  const sandbox = { AbortController, Date, Map, Set, URL, setTimeout, clearTimeout,
    chatMessages: [], chatLastId: null, chatLastAt: null, chatPollTimer: null, chatPollAbort: null,
    CHAT_BACKOFF_MS: [2000], document: { hidden: false }, renderChatMessages() {}, ...extra };
  return vm.createContext(sandbox);
}
const message = (id, text = id) => ({ id, text, createdAt: '2026-09-26T12:00:00.000Z' });

test('merge preserves equal-timestamp receive order and skips duplicate renders', () => {
  let renders = 0;
  const c = context({ renderChatMessages: () => renders++ });
  vm.runInContext(fn('mergeChatMessages'), c);
  c.mergeChatMessages([message('z'), message('a')]);
  c.mergeChatMessages([message('z')]);
  assert.equal(renders, 1);
  c.mergeChatMessages([message('a', 'edited')]);
  assert.deepEqual(Array.from(c.chatMessages, m => m.id), ['z', 'a']);
  assert.equal(c.chatMessages[1].text, 'edited');
});

test('receive rearms immediately with its own cursor despite concurrent send', async () => {
  const lifetime = new AbortController();
  const cursors = [];
  let pauses = 0;
  const c = context({ chatPollTimer: lifetime, chatLastId: 'm1',
    chatReceivePause: async () => pauses++,
    chatLongPollFetch: async cursor => {
      cursors.push(cursor);
      if (cursors.length === 1) { c.chatLastId = 'sent-later'; return [message('m2')]; }
      lifetime.abort(); return [];
    } });
  vm.runInContext(fn('mergeChatMessages') + fn('chatLongPollLoop'), c);
  await c.chatLongPollLoop(lifetime);
  assert.deepEqual(cursors, ['m1', 'm2']);
  assert.equal(pauses, 0);
});

test('stopped receive cannot revive or merge after a new loop starts', async () => {
  let deliver;
  const old = new AbortController();
  const c = context({ chatPollTimer: old, chatLongPollFetch: () => new Promise(resolve => { deliver = resolve; }) });
  vm.runInContext(fn('mergeChatMessages') + fn('chatLongPollLoop'), c);
  const pending = c.chatLongPollLoop(old);
  old.abort(); c.chatPollTimer = new AbortController();
  deliver([message('stale')]);
  await pending;
  assert.equal(c.chatMessages.length, 0);
});

test('fast empty responses back off without spinning', async () => {
  const lifetime = new AbortController();
  let paused;
  const c = context({ chatPollTimer: lifetime, chatLongPollFetch: async () => [],
    chatReceivePause: async (_, ms) => { paused = ms; lifetime.abort(); } });
  vm.runInContext(fn('mergeChatMessages') + fn('chatLongPollLoop'), c);
  await c.chatLongPollLoop(lifetime);
  assert.ok(paused > 0 && paused <= 1000);
});

test('hidden-tab wait removes its listeners on stop', async () => {
  const listeners = new Map();
  const lifetime = new AbortController();
  const c = context({ document: { hidden: true,
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name) } });
  vm.runInContext(fn('chatReceivePause'), c);
  const waiting = c.chatReceivePause(lifetime.signal);
  assert.equal(listeners.size, 1);
  lifetime.abort(); await waiting;
  assert.equal(listeners.size, 0);
});

test('late initial snapshot keeps sends confirmed while it was in flight', async () => {
  let deliver;
  const c = context({ sessionUser: { id: 'user' }, currentFamily: { id: 'family' },
    chatMessages: [message('initial')], scrollChatToBottom() {}, toast: assert.fail,
    window: { auth: { getMessages: () => new Promise(resolve => { deliver = resolve; }) } } });
  vm.runInContext(fn('mergeChatMessages') + fn('loadChatMessages'), c);
  const pending = c.loadChatMessages();
  c.mergeChatMessages([message('sent')]);
  deliver([message('initial')]); await pending;
  assert.deepEqual(Array.from(c.chatMessages, m => m.id), ['initial', 'sent']);
});

test('news cards escape content and reject unsafe or credential-bearing URLs', () => {
  const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  const c = context({ esc });
  vm.runInContext(fn('renderChatCard'), c);
  const html = c.renderChatCard({ type: 'news', title: '<script>', source: 'A & B', url: 'https://example.com/story?q="' });
  assert.match(html, /&lt;script>/);
  assert.match(html, /A &amp; B/);
  assert.match(html, /rel="noopener noreferrer"/);
  for (const url of ['javascript:alert(1)', 'http://example.com', 'https://user:password@example.com', '/local']) {
    assert.equal(c.renderChatCard({ type: 'news', title: 'Unsafe', url }), '');
  }
});

test('send lock releases after success and failure and preserves a newer draft', async () => {
  const input = { value: 'First' };
  let sends = 0, fail = false;
  const c = context({ chatSending: false, sessionUser: { id: 'user' },
    document: { getElementById: () => input }, toast() {}, scrollChatToBottom() {},
    window: { auth: { sendChatMessage: async text => {
      sends++;
      if (fail) throw new Error('offline');
      input.value = 'New draft';
      return { message: message('sent-' + sends, text) };
    } } } });
  vm.runInContext(fn('mergeChatMessages') + fn('handleSendChatMessage'), c);
  await c.handleSendChatMessage({ preventDefault() {} });
  assert.equal(c.chatSending, false);
  assert.equal(input.value, 'New draft');
  await c.handleSendChatMessage({ preventDefault() {} });
  assert.equal(sends, 2);
  input.value = 'Retry draft';
  fail = true;
  await c.handleSendChatMessage({ preventDefault() {} });
  assert.equal(c.chatSending, false);
  fail = false;
  await c.handleSendChatMessage({ preventDefault() {} });
  assert.equal(sends, 4);
});
