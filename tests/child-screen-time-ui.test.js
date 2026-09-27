'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/js/child-view.js'), 'utf8');
const TODAY = '2026-09-08';
const dates = Array.from({ length: 7 }, (_, i) => `2026-09-0${8 - i}`); // newest first, as the API returns
function usage(kidId, overrides = {}) {
  return { kidId, days: dates.map((date, i) => ({ date, minutes: i === 6 ? null : 60 + i * 15, devices: [], limitMinutes: 120, extraMinutes: 0, ...(overrides[date] || {}) })), requests: overrides.requests || [] };
}
function kidState(kidId, extra = {}) {
  return { kidId, policy: { enabled: true, limits: [] }, devices: [{ id: 'd1', label: 'iPhone' }], alerts: [], requests: [], ...extra };
}
function setup({ routes = {} } = {}) {
  const nodes = Object.fromEntries(['child-nav', 'tab-child', 'cv-screen-time'].map(id => [id, { innerHTML: '', hidden: false, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }]));
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [`${TODAY}T12:00:00`])); } }
  const context = { Date: Clock, document: { getElementById: id => nodes[id] }, sessionUser: { id: 'parent' }, currentFamily: { id: 'family', kids: [{ id: 'mia', name: 'Mia' }, { id: 'leo', name: 'Leo' }] },
    isKidSession() { return context.sessionUser?.role === 'kid'; }, isoDate: date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    kidAvatarMarkup: () => '<span class="kid-profile-avatar">M</span>', esc: v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
    auth: { getChildInsights: async id => ({ kidId: id, date: TODAY }), getHomework: async () => [], getGoals: async () => [], getActivities: async () => [] },
  };
  context.fetch = async url => {
    const path = url.split('?')[0];
    const handler = routes[path];
    if (!handler) return { ok: false, json: async () => ({ error: 'not found' }) };
    const body = await handler(url);
    return { ok: true, json: async () => body };
  };
  context.window = context; vm.runInNewContext(source, context);
  return { context, nodes, view: context.famChildView };
}
const section = html => (html.match(/<section id="cv-screen-time"[\s\S]*?<\/section>/) || [''])[0];

test('duration formatting', () => {
  const { view } = setup();
  const d = view.screenTime.duration;
  assert.deepEqual([0, 45, 60, 105, 120, 15].map(d), ['0 min', '45 min', '1 h', '1 h 45 min', '2 h', '15 min']);
});

test('today line with limit, without limit, and unreported', () => {
  const { view } = setup();
  const t = view.screenTime.todayLine;
  assert.equal(t({ minutes: 105, limitMinutes: 120 }), 'About 1 h 45 min of 2 h today');
  assert.equal(t({ minutes: 105, limitMinutes: null }), 'About 1 h 45 min today');
  assert.equal(t({ minutes: null, limitMinutes: 120 }), 'No screen time reported today');
  assert.equal(t(null), 'No screen time reported today');
});

test('chart bars scale to max(limit, minutes) with a distinct extra segment', () => {
  const { view } = setup();
  const bars = view.screenTime.chartDays([
    { date: '2026-09-08', minutes: 150, limitMinutes: 150, extraMinutes: 30 },
    { date: '2026-09-07', minutes: 60, limitMinutes: 120, extraMinutes: 0 },
    { date: '2026-09-06', minutes: 300, limitMinutes: null, extraMinutes: 0 },
    { date: '2026-09-05', minutes: null, limitMinutes: 120, extraMinutes: 0 },
  ]);
  assert.deepEqual(bars.map(b => b.date), ['2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08']);
  const [unknown, noLimit, under, withExtra] = bars;
  assert.equal(noLimit.base, 100); assert.equal(noLimit.limitPct, null); // 300 is the week's max
  assert.equal(under.base, 20); assert.equal(under.extraPct, 0); assert.equal(under.limitPct, 40);
  assert.equal(withExtra.base, 40); assert.equal(withExtra.extraPct, 10); assert.equal(withExtra.over, 0); assert.equal(withExtra.limitPct, 50);
  assert.equal(unknown.minutes, null); assert.equal(unknown.base, 0);
  const over = view.screenTime.chartDays([{ date: '2026-09-08', minutes: 180, limitMinutes: 120, extraMinutes: 15 }])[0];
  assert.equal(over.base, 58.3); assert.equal(over.extraPct, 8.3); assert.equal(over.over, 33.3); assert.equal(over.limitPct, 66.7);
});

test('renders today, limit chip, chart, requests, alerts and honest footnote for Mia', async () => {
  const { nodes, view } = setup({ routes: {
    '/api/screen-time': async () => ({ kids: [kidState('mia', { alerts: [{ id: 'a1', message: 'Mia turned off Screen Time on iPhone', at: '2026-09-07T16:12:00Z' }] }), kidState('leo', { alerts: [{ id: 'a2', message: 'Leo sibling alert', at: '2026-09-08T10:00:00Z' }] })] }),
    '/api/screen-time/kids/mia/usage': async () => usage('mia', { [TODAY]: { minutes: 135, limitMinutes: 135, extraMinutes: 15, devices: [{ deviceId: 'd1', label: 'iPhone', minutes: 135, limitReachedAt: '2026-09-08T17:42:00' }] }, requests: [{ id: 'r1', minutes: 15, fams: 5, date: TODAY, status: 'approved', createdAt: '2026-09-08T16:00:00Z' }] }),
  } });
  await view.render('mia');
  const html = section(nodes['tab-child'].innerHTML);
  assert.match(html, /Mia’s screen time/);
  assert.match(html, /About 2 h 15 min of 2 h 15 min today/);
  assert.match(html, /Includes 15 min extra time with fams/);
  assert.match(html, /Daily limit reached at 5:42\sPM/);
  assert.equal((html.match(/class="cv-st-day/g) || []).length, 7);
  assert.match(html, /class="cv-st-extra" style="height:11.1%"/);
  assert.match(html, /role="img" aria-label="Last 7 days: screen time reported on 6 of 7 days/);
  assert.match(html, /<table class="cv-sr">[\s\S]*Not reported/);
  assert.match(html, /Asked for 15 min · 5 fams · Approved/);
  assert.match(html, /Mia turned off Screen Time on iPhone/);
  assert.doesNotMatch(html, /Leo sibling alert/);
  assert.match(html, /Counted in 15-minute steps\. App-by-app details stay on Mia’s device\./);
  assert.match(nodes['tab-child'].innerHTML, /id="cv-fams"/); // nothing else hidden
});

test('not set up, error with retry, and loading skeleton', async () => {
  let fail = true;
  const { nodes, view } = setup({ routes: {
    '/api/screen-time': async () => { if (fail) throw new Error('offline'); return { kids: [{ kidId: 'mia', policy: { enabled: false }, devices: [], alerts: [] }] }; },
  } });
  const pending = view.render('mia');
  assert.match(section(nodes['tab-child'].innerHTML), /cv-st-skeleton[\s\S]*Loading screen time/);
  await pending;
  assert.match(section(nodes['tab-child'].innerHTML), /Screen time couldn’t be loaded[\s\S]*data-cv-action="st-retry"/);
  fail = false;
  nodes['tab-child'].onclick({ target: { closest: () => ({ dataset: { cvAction: 'st-retry' } }) } });
  await new Promise(r => setTimeout(r, 5));
  assert.match(nodes['cv-screen-time'].innerHTML, /Screen Time isn’t set up for Mia yet — set it up in the Fam ETC app/);
  assert.equal(nodes['cv-screen-time'].attrs['aria-busy'], 'false');
});

test('a stale screen time response for Mia never paints after switching to Leo', async () => {
  let release;
  const { nodes, view } = setup({ routes: {
    '/api/screen-time': async () => ({ kids: [kidState('mia'), kidState('leo')] }),
    '/api/screen-time/kids/mia/usage': () => new Promise(r => { release = () => r(usage('mia', { [TODAY]: { minutes: 945 } })); }),
    '/api/screen-time/kids/leo/usage': async () => usage('leo', { [TODAY]: { minutes: 30, limitMinutes: 60 } }),
  } });
  const old = view.render('mia');
  await view.render('leo');
  release(); await old;
  const html = nodes['tab-child'].innerHTML;
  assert.match(html, /<h1>Leo<\/h1>/);
  assert.match(html, /About 30 min of 1 h today/);
  assert.doesNotMatch(html, /15 h 45 min|Mia/);
});

test('all dynamic screen time text is escaped', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const { context, nodes, view } = setup({ routes: {
    '/api/screen-time': async () => ({ kids: [kidState('mia', { alerts: [{ message: evil, at: evil }] })] }),
    '/api/screen-time/kids/mia/usage': async () => usage('mia', { requests: [{ minutes: 15, fams: 5, status: evil, date: TODAY, createdAt: '1' }] }),
  } });
  context.currentFamily.kids[0].name = `Mia${evil}`;
  await view.render('mia');
  const html = section(nodes['tab-child'].innerHTML);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img/);
});
