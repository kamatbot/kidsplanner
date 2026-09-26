'use strict';
/*
 * Web client UI for the private Hermes thread (docs/HERMES-THREADS-CONTRACT.md).
 * Follows the extraction style of tests/chat-realtime-ui.test.js: pull just the
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

function makeEl(overrides = {}) {
  const initialClasses = overrides.classes || [];
  delete overrides.classes;
  return Object.assign({
    hidden: false,
    innerHTML: '',
    placeholder: '',
    scrollHeight: 0, scrollTop: 0, clientHeight: 0,
    children: [],
    querySelector: () => null,
    setAttribute() {}, getAttribute() { return null; },
    classList: {
      set: new Set(initialClasses),
      add(...toks) { toks.forEach((t) => this.set.add(t)); },
      remove(...toks) { toks.forEach((t) => this.set.delete(t)); },
      contains(t) { return this.set.has(t); },
      toggle(t, force) {
        const want = force === undefined ? !this.set.has(t) : !!force;
        if (want) this.set.add(t); else this.set.delete(t);
        return want;
      },
    },
  }, overrides);
}

test('hermes-nudge card renders violet/outline buttons while open, and a quiet chip once resolved', () => {
  const c = { esc };
  vm.createContext(c);
  vm.runInContext(fn('renderHermesNudgeButton') + fn('renderHermesNudgeCard'), c);

  const openCard = {
    type: 'hermes-nudge', title: 'Dinner tonight',
    lines: ['Paneer wraps · 20 min · you have 7 of 9'],
    actions: [
      { id: 'open-homework', label: 'Open homework', style: 'primary', open: 'homework' },
      { id: 'later', label: 'In 30 min', style: 'secondary', done: false },
    ],
    state: { status: 'open', label: null },
  };
  const openHtml = c.renderHermesNudgeCard({ id: 'm1', card: openCard });
  assert.match(openHtml, /chat-card-title">Dinner tonight/);
  assert.match(openHtml, /hermes-nudge-btn-primary[^>]*data-action-id="open-homework" data-open="homework" onclick="handleHermesNudgeButton\(this\)">Open homework/);
  assert.match(openHtml, /hermes-nudge-btn-secondary[^>]*data-message-id="m1" data-action-id="later" data-open="" onclick="handleHermesNudgeButton\(this\)">In 30 min/);
  assert.doesNotMatch(openHtml, /disabled/);
  assert.doesNotMatch(openHtml, /hermes-nudge-resolved/);

  // A done action is disabled and shows doneLabel, or "label ✓" without one.
  const doneActionCard = { ...openCard, actions: [
    { id: 'later', label: 'In 30 min', style: 'secondary', done: true, doneLabel: 'Snoozed' },
    { id: 'skip', label: 'Skip', style: 'secondary', done: true },
  ] };
  const doneActionHtml = c.renderHermesNudgeCard({ id: 'm1', card: doneActionCard });
  assert.match(doneActionHtml, /disabled[^>]*data-action-id="later"[^>]*>Snoozed</);
  assert.match(doneActionHtml, /disabled[^>]*data-action-id="skip"[^>]*>Skip ✓</);

  // Resolved state: no buttons, just the quiet label chip.
  const resolvedCard = { ...openCard, state: { status: 'done', label: 'Dinner planned' } };
  const resolvedHtml = c.renderHermesNudgeCard({ id: 'm1', card: resolvedCard });
  assert.doesNotMatch(resolvedHtml, /hermes-nudge-btn/);
  assert.match(resolvedHtml, /hermes-nudge-resolved">Dinner planned</);

  // Lines cap at 7 (a week-draft card lists seven dinners) and text is escaped.
  const manyLines = { ...openCard, lines: Array.from({ length: 9 }, (_, i) => `Day ${i + 1}`) };
  const manyLinesHtml = c.renderHermesNudgeCard({ id: 'm1', card: manyLines });
  assert.equal((manyLinesHtml.match(/<li>/g) || []).length, 7);
  const xssCard = { ...openCard, title: '<script>x</script>', lines: ['<img src=x>'] };
  const xssHtml = c.renderHermesNudgeCard({ id: 'm1', card: xssCard });
  assert.doesNotMatch(xssHtml, /<script>x<\/script>|<img src=x>/);
  assert.match(xssHtml, /&lt;script&gt;x&lt;\/script&gt;/);

  // Not a hermes-nudge card, or no card at all: render nothing.
  assert.equal(c.renderHermesNudgeCard({ id: 'm1', card: { type: 'news' } }), '');
  assert.equal(c.renderHermesNudgeCard({ id: 'm1' }), '');
});

test('hermes-nudge "open" buttons navigate client-side only and never call fetch', () => {
  const navCalls = [];
  const c = {
    switchNavTab: (tab) => navCalls.push(tab),
    location: {},
    fetch: () => { throw new Error('open actions must not call fetch'); },
  };
  vm.createContext(c);
  vm.runInContext(fn('handleHermesNudgeOpen'), c);

  c.handleHermesNudgeOpen('homework');
  c.handleHermesNudgeOpen('goals');
  c.handleHermesNudgeOpen('today');
  c.handleHermesNudgeOpen('meals');
  c.handleHermesNudgeOpen('not-a-real-target'); // unknown open: plain text, no-op

  assert.deepEqual(navCalls, ['homework', 'goals', 'today']);
  assert.equal(c.location.href, '/meals');
});

test('a non-open hermes-nudge action POSTs to the actions endpoint, replaces the message by id, and appends unseen follow-ups', async () => {
  const calls = [];
  const original = {
    id: 'm1', senderType: 'agent', senderId: 'hermes', createdAt: '2026-09-26T08:00:00.000Z',
    card: { type: 'hermes-nudge', state: { status: 'open' }, actions: [{ id: 'later', label: 'In 30 min' }] },
  };
  const updated = { ...original, card: { type: 'hermes-nudge', state: { status: 'snoozed', label: 'Snoozed 30 min' } } };
  const followUp = { id: 'm2', senderType: 'agent', senderId: 'hermes', createdAt: '2026-09-26T08:30:00.000Z', text: 'Following up' };
  let renders = 0;
  let stripRenders = 0;
  const c = {
    hermesMessages: [original, followUp], // followUp already shown — must not be duplicated
    fetch: async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({ message: updated, messages: [followUp] }) }; },
    renderHermesMessages: () => renders++,
    renderTodayHermesStrip: () => stripRenders++, // Today strip (contract §8) picks up the resolved card
    toast: () => assert.fail('should not toast on success'),
  };
  vm.createContext(c);
  vm.runInContext(fn('hermesApi') + fn('handleHermesNudgeAction'), c);

  const btn = { disabled: false };
  await c.handleHermesNudgeAction('m1', 'later', btn);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/hermes/thread/messages/m1/actions');
  assert.equal(calls[0].opts.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { action: 'later' });
  assert.equal(btn.disabled, true, 'button stays disabled through a successful round trip');
  assert.deepEqual(c.hermesMessages.map((m) => m.id), ['m1', 'm2']); // replaced, no duplicate append
  assert.equal(c.hermesMessages[0].card.state.status, 'snoozed');
  assert.equal(renders, 1);
  assert.equal(stripRenders, 1);
});

test('a failed hermes-nudge action re-enables the button and surfaces the error', async () => {
  let toasted = null;
  const c = {
    hermesMessages: [{ id: 'm1', card: { type: 'hermes-nudge' } }],
    fetch: async () => ({ ok: false, status: 403, json: async () => ({ error: 'Not allowed' }) }),
    renderHermesMessages: () => assert.fail('should not re-render on failure'),
    toast: (msg) => { toasted = msg; },
  };
  vm.createContext(c);
  vm.runInContext(fn('hermesApi') + fn('handleHermesNudgeAction'), c);

  const btn = { disabled: false };
  await c.handleHermesNudgeAction('m1', 'later', btn);
  assert.equal(btn.disabled, false);
  assert.match(toasted, /Not allowed/);
});

test('the family room render path is untouched; an active Hermes room leaves #chat-messages alone', () => {
  let badgeCalls = 0;
  let tabsCalls = 0;
  const el = makeEl({ scrollHeight: 50, scrollTop: 50, clientHeight: 50, innerHTML: 'SENTINEL' });
  const c = {
    chatMessages: [],
    chatActiveRoom: 'family',
    chatRoomDot: { family: false, hermes: false },
    document: { getElementById: (id) => (id === 'chat-messages' ? el : null) },
    updateChatUnreadBadge: () => badgeCalls++,
    renderChatRoomTabs: () => tabsCalls++,
  };
  vm.createContext(c);
  vm.runInContext(fn('renderChatMessages'), c);

  c.renderChatMessages();
  assert.match(el.innerHTML, /Say hi/); // original family empty-state copy, byte-for-byte
  assert.equal(badgeCalls, 1);
  assert.equal(tabsCalls, 0);

  el.innerHTML = 'SENTINEL';
  c.chatActiveRoom = 'hermes';
  c.renderChatMessages();
  assert.equal(el.innerHTML, 'SENTINEL'); // never touched while Hermes is showing
  assert.equal(c.chatRoomDot.family, false); // re-renders aren't news
  assert.equal(tabsCalls, 0);
  assert.equal(badgeCalls, 1); // no further family DOM work happened
});

test('the Family dot lights only for new family messages while Hermes is open', () => {
  let tabsCalls = 0;
  const c = {
    chatMessages: [], chatLastAt: null, chatLastId: null,
    chatActiveRoom: 'hermes',
    chatRoomDot: { family: false, hermes: false },
    renderChatMessages() {},
    renderChatRoomTabs: () => tabsCalls++,
  };
  vm.createContext(c);
  vm.runInContext(fn('mergeChatMessages'), c);
  c.mergeChatMessages([{ id: 'a', createdAt: '2026-09-26T09:00:00Z' }]); // initial load: cursor was null
  assert.equal(c.chatRoomDot.family, false);
  c.mergeChatMessages([{ id: 'b', createdAt: '2026-09-26T09:05:00Z' }]); // a new message on top of history
  assert.equal(c.chatRoomDot.family, true);
  assert.equal(tabsCalls, 1);
});

test('openHermesChat (the ?chat=hermes deep link target) selects the Hermes chip and opens the dock/slide-over', () => {
  const store = new Map();
  ['chat-room-tab-family', 'chat-room-tab-hermes', 'chat-room-dot-family', 'chat-room-dot-hermes',
    'chat-emoji-btn', 'chat-gif-btn', 'chat-media-btn', 'chat-input'].forEach((id) => store.set(id, makeEl()));
  store.get('chat-room-tab-family').classList.add('active');
  store.set('chat-dock', makeEl({ classes: ['chat-collapsed'] }));

  let loads = 0, seen = 0, scrolls = 0;
  const c = {
    chatActiveRoom: 'family',
    chatRoomDot: { family: false, hermes: true },
    hermesLoaded: false,
    document: { getElementById: (id) => store.get(id) || null },
    closeChatPickers: () => {},
    renderChatMessages: () => assert.fail('family should not re-render when opening Hermes'),
    renderHermesMessages: () => {},
    loadHermesMessages: () => loads++,
    scrollChatToBottom: () => scrolls++,
    markChatSeen: () => seen++,
  };
  vm.createContext(c);
  vm.runInContext(fn('renderChatRoomTabs') + fn('switchChatRoom') + fn('openHermesChat'), c);

  c.openHermesChat();

  assert.equal(c.chatActiveRoom, 'hermes');
  assert.equal(c.chatRoomDot.hermes, false); // cleared on entering the room
  assert.equal(store.get('chat-room-tab-hermes').classList.contains('active'), true);
  assert.equal(store.get('chat-room-tab-family').classList.contains('active'), false);
  assert.equal(store.get('chat-room-dot-hermes').hidden, true);
  assert.equal(store.get('chat-emoji-btn').hidden, true);
  assert.equal(store.get('chat-gif-btn').hidden, true);
  assert.equal(store.get('chat-media-btn').hidden, true);
  assert.equal(store.get('chat-input').placeholder, 'Message Hermes…');
  assert.equal(store.get('chat-dock').classList.contains('chat-force-open'), true); // desktop slim-rail case
  assert.equal(store.get('chat-dock').classList.contains('chat-open'), true); // mobile/kid slide-over case
  assert.equal(loads, 1); // not yet loaded -> fetched
  assert.equal(seen, 1);
  assert.equal(scrolls, 1);
});

test('nudge button ids are escaped data attributes and dispatch through one handler', () => {
  const c = { esc, calls: [] };
  vm.createContext(c);
  vm.runInContext(fn('renderHermesNudgeButton') + fn('handleHermesNudgeButton'), c);
  c.handleHermesNudgeOpen = (target) => c.calls.push(['open', target]);
  c.handleHermesNudgeAction = (messageId, actionId) => c.calls.push(['action', messageId, actionId]);
  const html = c.renderHermesNudgeButton('m1"x', { id: "cook:a'b", label: 'Cook <b>' });
  assert.ok(!html.includes('m1"x') && html.includes('m1&quot;x'), html);
  assert.ok(html.includes('Cook &lt;b&gt;'));
  c.handleHermesNudgeButton({ dataset: { messageId: 'm1', actionId: 'later', open: '' } });
  c.handleHermesNudgeButton({ dataset: { messageId: 'm1', actionId: 'open-homework', open: 'homework' } });
  assert.deepEqual(JSON.parse(JSON.stringify(c.calls)), [['action', 'm1', 'later'], ['open', 'homework']]);
});
