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
  const next = source.slice(start + 1).search(/\n(?:async )?function \w+\(/);
  return source.slice(start, next < 0 ? undefined : start + 1 + next) + '\n';
}

const profile = { name: 'Pip', avatar: 'comet', color: 'violet', personality: 'playful', reminders: true, enabled: true, ageBand: '6-8' };
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function context(overrides = {}, names = []) {
  const c = {
    sessionUser: { id: 'user-one', role: 'kid', kidId: 'kid-one' },
    currentFamily: { id: 'family-one', kids: [{ id: 'kid-one', name: 'Ari' }] },
    companionState: null, chatActiveRoom: 'family', hermesSending: false,
    updateCompanionIdentity() {}, renderCompanionSettings() {}, renderHermesPage() {}, renderHermesMessages() {},
    document: { getElementById: () => null }, esc,
    ...overrides,
  };
  vm.createContext(c);
  vm.runInContext(['isKidSession', 'companionSessionKey', 'companionStateIsCurrent', 'ownCompanionProfile', 'validateCompanionProfile', ...names].map(fn).join('\n'), c);
  c.companionState ||= { scope: c.companionSessionKey(), status: 'ready', profile: { ...profile }, companions: [], pending: 0 };
  c.ensureCompanionState = () => c.companionState;
  return c;
}

function formFor(values = {}, kidId) {
  const fields = Object.fromEntries(Object.entries({ ...profile, ...values }).map(([key, value]) => [key, {
    value, checked: value === true, validity: '', setCustomValidity(value) { this.validity = value; }, reportValidity() {},
  }]));
  const status = { textContent: '' };
  const fieldset = { disabled: false };
  const nameLabel = { textContent: '' }, enabledLabel = { textContent: '' };
  const container = { dataset: { companionKid: kidId }, querySelector: selector => selector === '[data-companion-name]' ? nameLabel : enabledLabel };
  return {
    dataset: {}, elements: { namedItem: name => fields[name] },
    closest: () => kidId ? container : null,
    querySelector: selector => selector === '.companion-fields' ? fieldset : status,
    fields, status, fieldset, container, nameLabel, enabledLabel,
  };
}

test('profile and artwork reject unknown enum values, and names render as literal text', () => {
  const c = context({}, ['companionAvatar', 'companionEditor']);
  assert.equal(c.validateCompanionProfile(profile).name, 'Pip');
  for (const patch of [{ avatar: '<img>' }, { color: 'red' }, { personality: 'system prompt' }, { ageBand: 'adult' }, { enabled: 'true' }, { name: '' }]) {
    assert.throws(() => c.validateCompanionProfile({ ...profile, ...patch }), /settings could not be read/);
  }
  const svg = c.companionAvatar('<script>', 'red" onload="attack');
  assert.doesNotMatch(svg, /script|onload|attack/);
  const html = c.companionEditor({ ...profile, name: '<img src=x>' }, 'self', false);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.doesNotMatch(html, /name="enabled"|name="ageBand"/);
  assert.equal((html.match(/name="avatar"/g) || []).length, 5);
});

test('a late profile load cannot render after an account or family switch', async () => {
  for (const change of [c => { c.sessionUser.id = 'user-two'; }, c => { c.currentFamily.id = 'family-two'; }]) {
    const gate = deferred();
    let renders = 0;
    const c = context({ hermesApi: () => gate.promise, renderCompanionSettings() { renders++; } }, ['loadCompanionSettings']);
    const old = c.companionState;
    const pending = c.loadCompanionSettings(true);
    assert.equal(renders, 1);
    change(c);
    gate.resolve({ profile: { ...profile, name: 'Stale name' } });
    await pending;
    assert.equal(renders, 1, 'no completion writes to a new account');
    assert.equal(old.profile.name, 'Pip');
    assert.equal(c.ownCompanionProfile(), null);
  }
});

test('malformed and unavailable profile responses leave chat disabled and permit a retry', async () => {
  const c = context({ hermesApi: async () => ({ profile: { ...profile, enabled: null } }) }, ['loadCompanionSettings']);
  await c.loadCompanionSettings(true);
  assert.equal(c.companionState.status, 'error');
  assert.equal(c.ownCompanionProfile(), null);
  c.hermesApi = async () => ({ profile });
  await c.loadCompanionSettings(true);
  assert.equal(c.companionState.status, 'ready');
  assert.equal(c.ownCompanionProfile().enabled, true);
});

test('child saves contain cosmetic fields only; a parent policy save targets exactly the chosen child', async () => {
  for (const parent of [false, true]) {
    const calls = [];
    const form = formFor({ name: '  Nova  ', avatar: 'owl', enabled: false, ageBand: '9-12' }, parent ? 'kid-one' : undefined);
    const c = context({
      sessionUser: { id: 'user-one', role: parent ? 'parent' : 'kid', kidId: parent ? undefined : 'kid-one' },
      document: { getElementById: () => form.container },
      hermesApi: async (url, options) => { calls.push({ url, patch: JSON.parse(options.body) }); return { profile: { ...profile, name: 'Nova', avatar: 'owl', enabled: false, ageBand: '9-12' } }; },
    }, ['handleSaveCompanion']);
    if (parent) c.companionState.companions = [{ kidId: 'kid-one', profile: { ...profile } }];
    await c.handleSaveCompanion({ preventDefault() {}, currentTarget: form });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, parent ? '/api/hermes/companions/kid-one' : '/api/hermes/companion');
    assert.deepEqual(Object.keys(calls[0].patch).sort(), (parent ? ['name', 'avatar', 'color', 'personality', 'reminders', 'enabled', 'ageBand'] : ['name', 'avatar', 'color', 'personality', 'reminders']).sort());
    assert.equal(calls[0].patch.name, 'Nova');
    assert.equal(form.status.textContent, 'Saved');
    assert.equal(form.fieldset.disabled, false);
    assert.equal(c.companionState.pending, 0);
  }
});

test('failed saves retain edits and unlock; stale saves never replace the next account’s profile', async () => {
  const form = formFor({ name: 'Nova' });
  const c = context({ hermesApi: async () => { throw new Error('Offline'); } }, ['handleSaveCompanion']);
  await c.handleSaveCompanion({ preventDefault() {}, currentTarget: form });
  assert.match(form.status.textContent, /Could not save.*Offline/);
  assert.equal(form.fields.name.value, 'Nova');
  assert.equal(form.fieldset.disabled, false);
  assert.equal(c.companionState.profile.name, 'Pip');
  const gate = deferred();
  c.hermesApi = () => gate.promise;
  const pending = c.handleSaveCompanion({ preventDefault() {}, currentTarget: form });
  const next = { scope: 'next-account', profile: { ...profile, name: 'Other' }, pending: 0 };
  c.companionState = next;
  gate.resolve({ profile: { ...profile, name: 'Nova' } });
  await pending;
  assert.equal(next.profile.name, 'Other');
  assert.notEqual(form.status.textContent, 'Saved');
});

test('name saves match server Unicode normalization, apostrophes and character bounds', async () => {
  for (const name of ['No\u0301va’s', 'น้องปิป', '𐐀'.repeat(24)]) {
    const form = formFor({ name });
    let savedName;
    const c = context({ document: { getElementById: () => form.container }, hermesApi: async (url, options) => {
      savedName = JSON.parse(options.body).name;
      return { profile: { ...profile, name: savedName } };
    } }, ['handleSaveCompanion']);
    await c.handleSaveCompanion({ preventDefault() {}, currentTarget: form });
    assert.equal(savedName, name.normalize('NFC'));
    assert.equal(form.status.textContent, 'Saved');
    assert.equal(c.ownCompanionProfile().name, savedName);
  }
  for (const name of ['𐐀'.repeat(25), '---', '⭐']) {
    const form = formFor({ name });
    const c = context({ hermesApi: () => assert.fail('invalid names stay in the form') }, ['handleSaveCompanion']);
    await c.handleSaveCompanion({ preventDefault() {}, currentTarget: form });
    assert.match(form.fields.name.validity, /1–24 letters/);
  }
});

test('private sends consume approved immediate replies and ignore late replies across family changes', async () => {
  const merged = [];
  const message = { id: 'sent' }, reply = { id: 'reply' };
  const input = { id: 'hermes-page-input', value: 'A hint please' };
  const c = context({ hermesApi: async () => ({ message, messages: [reply] }), mergeHermesMessages: messages => merged.push(...messages), toast: () => assert.fail('no error') }, ['handleSendHermesMessage']);
  await c.handleSendHermesMessage({ preventDefault() {} }, input);
  assert.deepEqual(merged, [message, reply]);
  assert.equal(input.value, '');
  assert.equal(c.hermesSending, false);
  c.companionState.profile.enabled = false;
  input.value = 'No send while disabled';
  await c.handleSendHermesMessage({ preventDefault() {} }, input);
  assert.equal(merged.length, 2);
  c.companionState.profile.enabled = true;
  const gate = deferred();
  c.hermesApi = () => gate.promise;
  const pending = c.handleSendHermesMessage({ preventDefault() {} }, input);
  c.currentFamily.id = 'family-two';
  input.value = 'New family draft';
  gate.resolve({ message: { id: 'stale' }, messages: [reply] });
  await pending;
  assert.equal(merged.length, 2);
  assert.equal(input.value, 'New family draft');
});

test('initial private history is not merged after a scope change', async () => {
  const gate = deferred();
  const c = context({ hermesAvailable: true, hermesLoaded: false, hermesApi: () => gate.promise,
    mergeHermesMessages: () => assert.fail('stale history must be ignored'), updateHermesBadge() {} }, ['loadHermesMessages']);
  const pending = c.loadHermesMessages();
  c.currentFamily.id = 'family-two';
  gate.resolve({ messages: [{ id: 'old' }] });
  await pending;
  assert.equal(c.hermesLoaded, false);
});
