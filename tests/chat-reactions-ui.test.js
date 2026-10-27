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
function context(extra = {}) {
  const c = vm.createContext({ sessionUser: { id: 'mom' }, ...extra });
  const constant = source.slice(source.indexOf('const CHAT_REACTIONS'), source.indexOf(';', source.indexOf('const CHAT_REACTIONS')) + 1);
  vm.runInContext(constant + fn('esc') + fn('todayActionIdArg') + fn('renderChatReactions'), c);
  return c;
}

test('reaction chips show the emoji, a count above one, and mark my own', () => {
  const c = context();
  const html = c.renderChatReactions({ id: 'm1', senderType: 'parent', reactions: [
    { key: 'thumbsup', userIds: ['mom', 'dad'], names: ['Mom', 'Dad'] },
    { key: 'fire', userIds: ['kid'], names: ['Arya'] },
  ] });
  assert.match(html, /chat-reaction chat-reaction-mine" data-reaction="thumbsup"/);
  assert.match(html, /👍<\/span><span class="chat-reaction-count">2<\/span>/);
  assert.match(html, /data-reaction="fire"[^>]*title="Arya"/);
  assert.doesNotMatch(html, /🔥<\/span><span class="chat-reaction-count">/);
  assert.equal((html.match(/chat-react-pick/g) || []).length, 5, 'the tray offers exactly five reactions');
});

test('deleted and Hermes messages get no reactions', () => {
  const c = context();
  assert.equal(c.renderChatReactions({ id: 'm', deleted: true }), '');
  assert.equal(c.renderChatReactions({ id: 'm', senderType: 'agent' }), '');
});
