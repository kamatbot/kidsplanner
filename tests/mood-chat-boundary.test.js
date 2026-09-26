'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fam-mood-boundary-'));
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
process.env.PORT = '0'; process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'isolated-mood-test-secret-not-production';
const Keygrip = require('keygrip');
const store = require('../lib/store'), family = require('../lib/family');
const app = require('../server');
function cookie(user) {
  const value = Buffer.from(JSON.stringify({ uid: user.id, authGen: store.sessionGeneration(user) })).toString('base64');
  return `fam_sess=${value}; fam_sess.sig=${new Keygrip([process.env.SESSION_SECRET]).sign(`fam_sess=${value}`)}`;
}
test('real authenticated family route rejects stale context and ignores sender/family spoofing; retries insert once', async t => {
  t.after(() => app.server.close());
  const parent = store.createUser('mood-parent@example.invalid', 'Parent');
  const fam = family.createFamily(parent.id, 'Synthetic mood family');
  const { kid } = family.addKid(fam.id, parent.id, { name: 'Child', grade: '6' });
  const { kid: sibling } = family.addKid(fam.id, parent.id, { name: 'Sibling', grade: '7' });
  const child = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
  const siblingUser = store.findOrCreateKidUser(fam.id, sibling.id, sibling.name);
  const outsider = store.createUser('outside@example.invalid', 'Outside');
  const otherFamily = family.createFamily(outsider.id, 'Other');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const headers = user => ({ Cookie: cookie(user), 'Content-Type': 'application/json' });
  const payload = { text: 'My energy is low today. Could someone help me with my next step?',
    clientMessageId: crypto.randomUUID(), expectedContext: { userId: child.id, familyId: fam.id },
    senderType: 'parent', senderId: parent.id, familyId: otherFamily.id };
  const post = (user, body) => fetch(base + '/api/chat/messages', { method: 'POST', headers: headers(user), body: JSON.stringify(body) });
  for (const user of [parent, siblingUser, outsider]) assert.equal((await post(user, payload)).status, 409);
  assert.equal((await post(child, { ...payload, expectedContext: { userId: child.id, familyId: otherFamily.id } })).status, 409);
  assert.equal((await post(child, { ...payload, expectedContext: { userId: child.id, familyId: fam.id, role: 'parent' } })).status, 409);
  const first = await post(child, payload); assert.equal(first.status, 200);
  const sent = (await first.json()).message;
  assert.equal(sent.text, payload.text); assert.equal(sent.senderType, 'kid'); assert.equal(sent.senderId, kid.id); assert.equal(sent.familyId, fam.id);
  const retry = await post(child, payload); assert.equal((await retry.json()).message.id, sent.id);
  const messages = await (await fetch(base + '/api/chat/messages', { headers: headers(child) })).json();
  assert.equal(messages.messages.length, 1);
  const parentPayload = { text: 'My energy is full today.', clientMessageId: crypto.randomUUID(), expectedContext: {userId: parent.id, familyId: fam.id, role: 'parent'} };
  const parentSent = await (await post(parent, parentPayload)).json();
  assert.equal(parentSent.message.senderType, 'parent'); assert.equal(parentSent.message.senderId, parent.id);
  assert.equal((await (await post(parent, parentPayload)).json()).message.id, parentSent.message.id);
  assert.equal((await post(parent, {...parentPayload, expectedContext: {...parentPayload.expectedContext, role:'kid'}})).status, 409);
  const other = await (await fetch(base + '/api/chat/messages', { headers: headers(outsider) })).json();
  assert.equal(other.messages.length, 0);
  const notes = await (await fetch(base + '/api/notes', { headers: headers(child) })).json();
  assert.equal(notes.notes.length, 0);
  assert.equal((await fetch(base + '/api/chat/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })).status, 401);
});
