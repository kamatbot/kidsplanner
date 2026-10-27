'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
function fn(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2) + '\n';
}
const msg = (id, senderId, createdAt) => ({ id, senderType: 'parent', senderId, text: id, createdAt });
function context(extra = {}) {
  const c = vm.createContext({
    sessionUser: { id: 'mom' }, chatReads: [], chatMessages: [], chatReadPosted: null, chatActiveRoom: 'family',
    isKidSession: () => false, renderChatMessages() {}, JSON, ...extra,
  });
  vm.runInContext(fn('isOwnMessage') + fn('chatSeenByLine') + fn('applyChatReads') + fn('maybeMarkChatRead'), c);
  return c;
}

test('"Seen by" sits on the newest own message and lists only readers who reached it', () => {
  const c = context({
    chatMessages: [msg('a', 'mom', '2026-10-27T10:00:00Z'), msg('b', 'dad', '2026-10-27T10:01:00Z'), msg('c', 'mom', '2026-10-27T10:02:00Z')],
    chatReads: [
      { userId: 'dad', name: 'Dad Kamat', messageId: 'c', messageCreatedAt: '2026-10-27T10:02:00Z' },
      { userId: 'kid', name: 'Arya', messageId: 'b', messageCreatedAt: '2026-10-27T10:01:00Z' },
      { userId: 'mom', name: 'Mom', messageId: 'c', messageCreatedAt: '2026-10-27T10:02:00Z' },
    ],
  });
  assert.deepEqual({ ...c.chatSeenByLine() }, { messageId: 'c', text: 'Seen by Dad' });
  c.chatReads[1].messageCreatedAt = '2026-10-27T10:03:00Z';
  assert.equal(c.chatSeenByLine().text, 'Seen by Dad, Arya');
  c.chatReads = [];
  assert.equal(c.chatSeenByLine(), null, 'nothing shows until someone has read it');
});

test('applyChatReads re-renders only when the marks change', () => {
  let renders = 0;
  const c = context({ renderChatMessages: () => renders++ });
  const reads = [{ userId: 'dad', messageId: 'x' }];
  c.applyChatReads(reads);
  c.applyChatReads(JSON.parse(JSON.stringify(reads)));
  assert.equal(renders, 1);
});

test('messages are marked read once, and only while the family room is on screen', () => {
  const posted = [];
  const dock = { hidden: false, classList: { contains: (name) => name === 'chat-collapsed' ? collapsed : false } };
  let collapsed = true;
  const c = context({
    chatMessages: [msg('a', 'dad', '2026-10-27T10:00:00Z')],
    document: { hidden: false, getElementById: () => dock },
    window: { auth: { markChatRead: async (id) => { posted.push(id); } } },
  });
  c.maybeMarkChatRead();
  assert.deepEqual(posted, [], 'a collapsed dock is not reading');
  collapsed = false;
  c.maybeMarkChatRead();
  c.maybeMarkChatRead();
  assert.deepEqual(posted, ['a']);
  c.chatActiveRoom = 'hermes';
  c.chatMessages.push(msg('b', 'dad', '2026-10-27T10:01:00Z'));
  c.maybeMarkChatRead();
  assert.deepEqual(posted, ['a'], 'the Hermes room hides family messages');
});
