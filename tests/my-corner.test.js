'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fam-corner-'));
process.env.DATA_ENCRYPTION_KEY = require('node:crypto').randomBytes(32).toString('hex');
const db = require('../lib/db');
const corner = require('../lib/my-corner');
const store = require('../lib/store');
const family = require('../lib/family');
const express = require('express');
const parent = store.createUser('corner@example.test', 'Parent');
const fam = family.createFamily(parent.id, 'Test');
const a = family.addKid(fam.id, parent.id, { name: 'A' }).kid;
const b = family.addKid(fam.id, parent.id, { name: 'B' }).kid;
const child = store.findOrCreateKidUser(fam.id, a.id, 'A');
const sibling = store.findOrCreateKidUser(fam.id, b.id, 'B');
const p2 = store.createUser('other@example.test', 'Other');
const f2 = family.createFamily(p2.id, 'Other');
const k2 = family.addKid(f2.id, p2.id, { name: 'Other' }).kid;
const other = store.findOrCreateKidUser(f2.id, k2.id, 'Other');
const app = express(); app.use(express.json());
require('../lib/routes/my-corner')(app, {
  requireAuth(req, res, next) { req.user = store.getUser(req.get('test-user')); if (!req.user) return res.sendStatus(401); next(); },
  requireFamily(req, res, next) { req.family = req.user.data?.kid ? family.familyForKidUser(req.user) : family.familiesForUser(req.user.id)[0]; if (!req.family) return res.sendStatus(403); next(); },
  userRole: user => user.data?.profile?.role || 'parent', kidIdForUser: req => req.user.data?.kid?.kidId, family,
});
const server = app.listen(0, '127.0.0.1');
after(() => { server.close(); db.flushSync(); });
async function call(user, method = 'GET', body, query = '', expectedAccount) {
  if (!server.listening) await new Promise(r => server.once('listening', r));
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/my-corner${query}`, {
    method, headers: { 'test-user': user?.id || '', 'content-type': 'application/json', ...(expectedAccount ? { 'X-Fam-Corner-Account': expectedAccount } : {}) }, body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null), cache: res.headers.get('cache-control') };
}
const draft = { revision: 0, note: 'Ask about art club — private', stickers: [{ id: 'one', stickerId: 'tuk-tuk', x: 0.5, y: 0.5, rotation: 15 }] };
test('real HTTP: private read/write, second client, bounded edits and explicit conflicts', async () => {
  assert.equal((await call(null)).status, 401);
  assert.equal((await call(parent)).status, 403);
  assert.equal((await call(sibling, 'GET', null, '', child.id)).status, 403);
  assert.equal((await call(sibling, 'PUT', draft, '', child.id)).status, 403);
  assert.deepEqual((await call(sibling)).body, { revision: 0, note: '', stickers: [] });
  assert.equal((await call(parent, 'PUT', draft)).status, 403);
  const saved = await call(child, 'PUT', draft);
  assert.equal(saved.status, 200); assert.equal(saved.body.revision, 1);
  const second = await call(child); assert.deepEqual(second.body, saved.body); assert.equal(second.cache, 'no-store');
  for (const user of [sibling, other]) {
    assert.deepEqual((await call(user)).body, { revision: 0, note: '', stickers: [] });
    assert.equal((await call(user, 'GET', null, `?kidId=${a.id}`)).status, 400);
    assert.equal((await call(user, 'PUT', { ...draft, kidId: a.id })).status, 400);
  }
  assert.equal((await call(child, 'PUT', draft)).status, 409);
  const changed = { ...second.body, note: 'Second note', stickers: [{ ...draft.stickers[0], x: 0, y: 1, rotation: -180 }] };
  assert.equal((await call(child, 'PUT', changed)).status, 200);
  assert.equal((await call(child)).body.stickers[0].rotation, -180);
  const remove = { ...(await call(child)).body, stickers: [] };
  assert.equal((await call(child, 'PUT', remove)).status, 200);
  assert.deepEqual((await call(child)).body.stickers, []);
  assert.ok(!JSON.stringify(family.publicFamily(fam)).includes('Second note'));
  assert.ok(!JSON.stringify(child).includes('Second note'));
  assert.ok(!JSON.stringify(db.load().fam_my_corners).includes('Second note'));
  assert.ok(!fs.readFileSync(db.DB_FILE, 'utf8').includes('Second note'));
  const restored = JSON.parse(require('../lib/datacrypto').decrypt(fs.readFileSync(db.DB_FILE, 'utf8'), require('../lib/datacrypto').loadKey()));
  assert.ok(restored.fam_my_corners);
});
test('reject malformed, spoofed, malicious and excessive payloads', () => {
  const bad = [ { ...draft, familyId: fam.id }, { ...draft, note: '<svg onload=alert(1)>' }, { ...draft, note: 'a'.repeat(241) },
    { ...draft, stickers: Array(19).fill(draft.stickers[0]) }, { ...draft, revision: -1 },
    ...[{ stickerId: 'https://bad.test/a.svg' }, { x: -0.01 }, { y: 1.01 }, { x: NaN }, { rotation: 181 }, { url: 'bad' }].map(p => ({ ...draft, stickers: [{ ...draft.stickers[0], ...p }] })) ];
  for (const value of bad) assert.throws(() => corner.validate(value), { status: 400 });
});
test('write failure does not claim success or mutate the readable revision', () => {
  const before = corner.read(fam.id, a.id);
  const write = fs.writeFileSync;
  fs.writeFileSync = () => { throw new Error('simulated disk failure'); };
  try { assert.throws(() => corner.save(fam.id, a.id, { ...before, note: 'not saved' }), { status: 503 }); }
  finally { fs.writeFileSync = write; }
  assert.deepEqual(corner.read(fam.id, a.id), before);
  assert.equal(corner.save(fam.id, a.id, { ...before, note: 'retry saved' }).revision, before.revision + 1);
});
test('fresh process reloads the encrypted corner; encryption cannot be disabled', () => {
  const result = require('node:child_process').execFileSync(process.execPath, ['-e',
    `process.stdout.write(JSON.stringify(require('./lib/my-corner').read(${JSON.stringify(fam.id)},${JSON.stringify(a.id)})))`], { cwd: path.resolve(__dirname, '..'), env: process.env, encoding: 'utf8' });
  assert.equal(JSON.parse(result).note, 'retry saved');
  const crypto = require('../lib/datacrypto'); const key = process.env.DATA_ENCRYPTION_KEY;
  delete process.env.DATA_ENCRYPTION_KEY; crypto._resetKeyCache();
  try { assert.throws(() => corner.read(fam.id, a.id), { status: 503 }); }
  finally { process.env.DATA_ENCRYPTION_KEY = key; crypto._resetKeyCache(); }
});
test('sibling writes stay separate; removed child loses access', async () => {
  assert.equal((await call(sibling, 'PUT', { ...draft, note: 'Sibling own corner' })).status, 200);
  assert.equal((await call(child)).body.note, 'retry saved');
  fam.kids = fam.kids.filter(k => k.id !== b.id);
  assert.equal((await call(sibling)).status, 403);
  assert.equal((await call(sibling, 'PUT', draft)).status, 403);
});
