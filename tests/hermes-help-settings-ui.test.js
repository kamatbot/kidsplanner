'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/js/settings.js', 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const defaults = { schoolDay: true, homework: true, dinner: false };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness() {
  const elements = {}, requests = [];
  const c = {
    sessionUser: { id: 'a', role: 'parent' }, currentFamily: { id: 'family-a' },
    isKidSession: () => c.sessionUser?.role === 'kid',
    esc: value => String(value).replaceAll('<', '&lt;'),
    fetch: async (path, options) => { requests.push({ path, ...options }); return { ok: true, json: async () => ({ helpsWith: defaults }) }; },
  };
  const parent = { appendChild(card) { elements[card.id] = card; } };
  c.document = {
    getElementById: id => id === 'connections-parent-only' ? parent : elements[id] || null,
    querySelector: selector => elements['hermes-help-settings']?.querySelector(selector),
    createElement() {
      return {
        inputs: [], html: '',
        set innerHTML(value) {
          this.html = value;
          this.inputs = [...value.matchAll(/<input[^>]*data-hermes-topic="([^"]+)"[^>]*>/g)].map(([tag, key]) => ({
            dataset: { hermesTopic: key }, checked: / checked/.test(tag), disabled: / disabled/.test(tag),
            addEventListener(type, action) { this[type] = action; }, focus() { this.focused = true; },
          }));
          this.retry = value.includes('data-hermes-help-retry') ? { addEventListener(type, action) { this[type] = action; } } : null;
        },
        get innerHTML() { return this.html; },
        querySelectorAll() { return this.inputs; },
        querySelector(selector) {
          if (selector === '[data-hermes-help-retry]') return this.retry;
          const key = selector.match(/data-hermes-topic="([^"]+)"/)?.[1];
          return this.inputs.find(input => input.dataset.hermesTopic === key);
        },
        remove() { delete elements[this.id]; },
      };
    },
  };
  vm.createContext(c);
  vm.runInContext(source, c);
  return { c, requests, card: () => elements['hermes-help-settings'] };
}
test('parent controls load server defaults and expose labelled native checkboxes with dinner off', async () => {
  const { c, requests, card } = harness();
  c.renderHermesHelpSettings();
  assert.ok(card().inputs.every(input => input.disabled));
  assert.match(card().html, /Loading preferences/);
  await tick();
  assert.deepEqual(requests.map(request => [request.path, request.method]), [['/api/hermes/settings', 'GET']]);
  assert.deepEqual(card().inputs.map(input => [input.dataset.hermesTopic, input.checked, input.disabled]), [
    ['schoolDay', true, false], ['homework', true, false], ['dinner', false, false],
  ]);
  assert.match(card().html, /aria-label="Dinner & meal planning"/);
  assert.match(card().html, /approval always stay on/);
});
test('save uses one topic patch, disables concurrent writes, and displays authoritative returned values', async () => {
  const { c, requests, card } = harness();
  c.renderHermesHelpSettings(); await tick();
  const pending = deferred();
  c.fetch = async (path, options) => { requests.push({ path, ...options }); return pending.promise; };
  const saving = c.saveHermesHelpSetting('dinner', true);
  await c.saveHermesHelpSetting('homework', false);
  assert.ok(card().inputs.every(input => input.disabled));
  assert.equal(card().inputs[2].checked, true);
  assert.equal(requests.length, 2);
  assert.deepEqual(JSON.parse(requests[1].body), { helpsWith: { dinner: true } });
  pending.resolve({ ok: true, json: async () => ({ helpsWith: { ...defaults, dinner: true } }) });
  await saving;
  assert.equal(card().inputs[2].checked, true);
  assert.equal(card().inputs[2].focused, true);
  assert.match(card().html, /Preferences saved/);
});
test('failed save restores the prior value and offers a retry without losing the control', async () => {
  const { c, card } = harness();
  c.renderHermesHelpSettings(); await tick();
  c.fetch = async () => ({ ok: false, json: async () => ({ error: 'Could not save. Try again.' }) });
  await c.saveHermesHelpSetting('homework', false);
  assert.equal(card().inputs[1].checked, true);
  assert.equal(card().inputs[1].disabled, false);
  assert.match(card().html, /Could not save\. Try again/);
  assert.ok(card().retry);
});
test('failed load leaves values unavailable and a successful retry restores the controls', async () => {
  const { c, card } = harness();
  c.fetch = async () => { throw new Error('Connection lost. Try again.'); };
  c.renderHermesHelpSettings(); await tick();
  assert.ok(card().inputs.every(input => input.disabled));
  assert.ok(card().retry);
  c.fetch = async () => ({ ok: true, json: async () => ({ helpsWith: defaults }) });
  await card().retry.click();
  assert.equal(card().inputs[0].disabled, false);
});
test('old-account preference responses cannot overwrite the next family and children never fetch controls', async () => {
  const { c, card, requests } = harness();
  const old = deferred();
  c.fetch = async (path, options) => { requests.push({ path, ...options }); return old.promise; };
  c.renderHermesHelpSettings();
  c.sessionUser = { id: 'b', role: 'parent' }; c.currentFamily = { id: 'family-b' };
  c.fetch = async () => ({ ok: true, json: async () => ({ helpsWith: { schoolDay: false, homework: false, dinner: true } }) });
  c.renderHermesHelpSettings(); await tick();
  old.resolve({ ok: true, json: async () => ({ helpsWith: defaults }) });
  await tick();
  assert.deepEqual(card().inputs.map(input => input.checked), [false, false, true]);
  c.sessionUser = { id: 'kid', role: 'kid' };
  c.renderHermesHelpSettings();
  assert.equal(card(), undefined);
  assert.equal(requests.length, 1);
});
