'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMoodCheckIn, answeredToday, markAnswered, clearAnswered } = require('../public/js/mood-check-in');
function fixture(send = async () => ({ message: { id: 'message' } })) {
  let user = 'kid1'; const writes = [];
  const model = createMoodCheckIn({ identity: () => user, verifyIdentity: async () => user,
    newId: () => 'mood-retry-00000001', send: async (...args) => { writes.push(args); return send(...args); } });
  return { model, writes, switchAccount: value => { user = value; } };
}
test('select, preview, edit and cancel never write; help also needs a confirmed send', async () => {
  const { model, writes } = fixture();
  for (const energy of ['Low', 'Okay', 'Full']) model.select(energy);
  model.preview(true); model.edit('Please help with maths.');
  assert.deepEqual(writes, []); model.clear();
  await model.confirm(); assert.deepEqual(writes, []);
  assert.equal(model.state.draft, ''); assert.equal(model.state.energy, '');
});
test('confirmed edited draft sends once, double taps are guarded', async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const { model, writes } = fixture(() => pending);
  model.select('Low'); model.preview(); model.edit('Could we talk after dinner?');
  const first = model.confirm(); const second = model.confirm();
  await Promise.resolve();
  assert.equal(writes.length, 1); assert.equal(writes[0][0], 'Could we talk after dinner?');
  release({ message: { id: 'sent' } }); await Promise.all([first, second]);
  assert.equal(model.state.draft, ''); assert.match(model.state.status, /Sent/);
});
test('lost response retains and locks draft; retry reuses exact body and id', async () => {
  let attempts = 0;
  const { model, writes } = fixture(async () => { if (++attempts === 1) throw Error('offline'); return { message: { id: 'sent' } }; });
  model.select('Okay'); model.preview(true);
  const draft = model.state.draft; assert.equal(await model.confirm(), false);
  assert.equal(model.state.draft, draft); assert.match(model.state.status, /not confirmed/);
  model.edit('different'); model.preview(); model.select('Full');
  assert.equal(model.state.draft, draft);
  assert.equal(await model.confirm(), true); assert.deepEqual(writes[0], writes[1]);
});
test('account switch prevents old draft send and clears it', async () => {
  const { model, writes, switchAccount } = fixture();
  model.select('Low'); model.preview(); switchAccount('kid2');
  assert.equal(await model.confirm(), false); assert.equal(writes.length, 0);
  assert.equal(model.state.draft, ''); assert.equal(model.state.energy, '');
});
test('cancel during identity verification prevents send; stale completion cannot show success', async () => {
  let verify; let writes = 0;
  const model = createMoodCheckIn({ identity: () => 'kid', verifyIdentity: () => new Promise(r => { verify = r; }), send: async () => { writes++; } });
  model.select('Full'); model.preview(); const pending = model.confirm(); model.clear(); verify('kid');
  await pending; assert.equal(writes, 0); assert.equal(model.state.status, '');
});
test('server identity mismatch clears without posting', async () => {
  let writes = 0;
  const model = createMoodCheckIn({ identity: () => 'kid', verifyIdentity: async () => 'other', send: async () => { writes++; } });
  model.select('Full'); model.preview(); await model.confirm();
  assert.equal(writes, 0); assert.equal(model.state.draft, '');
});
test('changing energy replaces the previous preview and empty edited drafts cannot send', async () => {
  const { model, writes } = fixture();
  model.select('Low'); model.preview(); model.select('Full');
  assert.equal(model.state.preview, false); assert.equal(model.state.draft, '');
  model.preview(); model.edit('   '); await model.confirm(); assert.equal(writes.length, 0);
});
test('an answer hides the check-in for that person until tomorrow; only the day is stored', () => {
  const data = new Map();
  const storage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
  assert.equal(answeredToday(storage, 'kid1:fam:kid', '2026-09-26'), false);
  markAnswered(storage, 'kid1:fam:kid', '2026-09-26');
  assert.equal(answeredToday(storage, 'kid1:fam:kid', '2026-09-26'), true);
  assert.equal(answeredToday(storage, 'kid1:fam:kid', '2026-09-27'), false, 'back the next day');
  assert.equal(answeredToday(storage, 'parent1:fam:parent', '2026-09-26'), false, 'per person');
  assert.deepEqual([...data.values()], ['2026-09-26'], 'no energy level is stored');
  clearAnswered(storage, 'kid1:fam:kid');
  assert.equal(answeredToday(storage, 'kid1:fam:kid', '2026-09-26'), false, 'Cancel undoes the answer');
  assert.equal(answeredToday(null, 'kid1:fam:kid'), false, 'without storage the prompt simply shows');
  assert.doesNotThrow(() => markAnswered({ setItem() { throw new Error('quota'); } }, 'kid1:fam:kid'));
});
