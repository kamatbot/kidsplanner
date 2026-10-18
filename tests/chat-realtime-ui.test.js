'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/js/app.js'), 'utf8');
function fn(name) {
  const re = new RegExp(`(?:async )?function ${name}\\(`);
  const start = source.search(re);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2) + '\n';
}
function context(extra = {}) {
  const sandbox = { AbortController, Date, Map, Set, URL, crypto, setTimeout, clearTimeout,
    chatPendingSend: null,
    chatMessages: [], chatLastId: null, chatLastAt: null, chatPollTimer: null, chatPollAbort: null,
    sessionUser: { id: 'user' }, currentFamily: { id: 'family' },
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
  vm.runInContext(fn('mergeChatMessages') + fn('chatSendRequest') + fn('handleSendChatMessage'), c);
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

for (const boundary of ['account', 'family']) {
  test(`late fallback poll cannot enter another ${boundary}`, async () => {
    let deliver;
    const c = context({ window: { auth: { getMessages: () => new Promise(resolve => { deliver = resolve; }) } } });
    vm.runInContext(fn('mergeChatMessages') + fn('pollChatMessages'), c);
    const pending = c.pollChatMessages();
    if (boundary === 'account') c.sessionUser = { id: 'next-user' };
    else c.currentFamily = { id: 'next-family' };
    deliver([message('private')]);
    await pending;
    assert.equal(c.chatMessages.length, 0);
  });

  test(`late send cannot change another ${boundary}'s draft or messages`, async () => {
    let deliver;
    const input = { value: 'Keep this draft' };
    const c = context({ chatSending: false,
      document: { getElementById: () => input }, toast: assert.fail, scrollChatToBottom: assert.fail,
      window: { auth: { sendChatMessage: () => new Promise(resolve => { deliver = resolve; }) } } });
    vm.runInContext(fn('mergeChatMessages') + fn('chatSendRequest') + fn('handleSendChatMessage'), c);
    const pending = c.handleSendChatMessage({ preventDefault() {} });
    if (boundary === 'account') c.sessionUser = { id: 'next-user' };
    else c.currentFamily = { id: 'next-family' };
    deliver({ message: message('private') });
    await pending;
    assert.equal(c.chatMessages.length, 0);
    assert.equal(input.value, 'Keep this draft');
    assert.equal(c.chatSending, false);
  });
}

test('periodic snapshot applies moderation without dropping history or advancing receive cursor', async () => {
  const lifetime = new AbortController();
  let now = 0, snapshots = 0;
  const cursors = [];
  const c = context({ chatPollTimer: lifetime, chatLastId: 'latest',
    chatMessages: [message('old'), message('latest')], Date: { now: () => now },
    window: { auth: { getMessages: async () => { snapshots++; return [{ ...message('latest', ''), deleted: true, flagged: true }]; } } },
    chatReceivePause: async () => {},
    chatLongPollFetch: async cursor => {
      cursors.push(cursor);
      if (cursors.length === 1) { now = 59000; return [message('new1')]; }
      if (cursors.length === 2) { assert.equal(snapshots, 0); now = 61000; return [message('new2')]; }
      lifetime.abort(); return [];
    } });
  vm.runInContext(fn('mergeChatMessages') + fn('reconcileChatSnapshot') + fn('chatLongPollLoop'), c);
  await c.chatLongPollLoop(lifetime);
  assert.equal(snapshots, 1);
  assert.deepEqual(cursors, ['latest', 'new1', 'new2']);
  assert.deepEqual(Array.from(c.chatMessages, m => m.id), ['old', 'latest', 'new1', 'new2']);
  assert.equal(c.chatMessages[1].deleted, true);
  assert.equal(c.chatMessages[1].flagged, true);
});

test('snapshot cannot undo a deletion confirmed while its read was in flight', async () => {
  const lifetime = new AbortController();
  let deliver;
  const original = message('latest');
  const c = context({ chatPollTimer: lifetime, chatMessages: [original],
    window: { auth: { getMessages: () => new Promise(resolve => { deliver = resolve; }) } } });
  vm.runInContext(fn('mergeChatMessages') + fn('reconcileChatSnapshot'), c);
  const pending = c.reconcileChatSnapshot(lifetime);
  c.mergeChatMessages([{ ...original, deleted: true, text: '' }]);
  deliver([original]); await pending;
  assert.equal(c.chatMessages[0].deleted, true);
});

for (const kind of ['text', 'gif']) {
  test(`${kind} retry keeps its id after lost response; confirmed send ends retry identity`, async () => {
    const ids = [];
    let fail = true;
    const input = { value: 'Draft' };
    const c = context({ chatSending: false, document: { getElementById: () => input }, toast() {}, closeChatPickers() {}, scrollChatToBottom() {},
      window: { auth: { sendChatMessage: async (text, media, id) => {
        ids.push(id);
        if (fail) throw new Error('Response lost');
        return { message: message('confirmed', text) };
      } } } });
    vm.runInContext(fn('mergeChatMessages') + fn('chatSendRequest') + fn('handleSendChatMessage') + fn('handleSendGif'), c);
    const send = () => kind === 'text' ? c.handleSendChatMessage({ preventDefault() {} }) : c.handleSendGif('https://media.giphy.com/x.gif', '', 80, 80);
    await send(); assert.equal(input.value, 'Draft');
    fail = false; await send();
    assert.equal(ids[0], ids[1]);
    input.value = 'Draft'; await send();
    assert.notEqual(ids[1], ids[2]);
  });
}

test('retry keys change with draft, family, account and GIF selection', () => {
  const c = context();
  vm.runInContext(fn('chatSendRequest'), c);
  const keys = [c.chatSendRequest('one').id, c.chatSendRequest('two').id];
  c.currentFamily = { id: 'other' }; keys.push(c.chatSendRequest('two').id);
  c.sessionUser = { id: 'other' }; keys.push(c.chatSendRequest('two').id);
  keys.push(c.chatSendRequest('', { url: 'first.gif' }).id, c.chatSendRequest('', { url: 'second.gif' }).id);
  assert.equal(new Set(keys).size, keys.length);
});
