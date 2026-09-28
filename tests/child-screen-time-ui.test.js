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

test('extra time granted and in use shows a neutral "extra time given" chip, not the red one', async () => {
  const { nodes, view } = setup({ routes: {
    '/api/screen-time': async () => ({ kids: [kidState('mia')] }),
    '/api/screen-time/kids/mia/usage': async () => usage('mia', { [TODAY]: { minutes: 100, limitMinutes: 135, extraMinutes: 15, devices: [{ deviceId: 'd1', label: 'iPhone', minutes: 100, limitReachedAt: '2026-09-08T17:42:00' }] } }),
  } });
  await view.render('mia');
  const html = section(nodes['tab-child'].innerHTML);
  assert.match(html, /<span class="cv-st-chip is-info">Limit reached at 5:42\sPM · extra time given<\/span>/);
  assert.doesNotMatch(html, /Daily limit reached/);
});

test('no extra time: the red "Daily limit reached" chip is unchanged', async () => {
  const { nodes, view } = setup({ routes: {
    '/api/screen-time': async () => ({ kids: [kidState('mia')] }),
    '/api/screen-time/kids/mia/usage': async () => usage('mia', { [TODAY]: { minutes: 130, limitMinutes: 120, extraMinutes: 0, devices: [{ deviceId: 'd1', label: 'iPhone', minutes: 130, limitReachedAt: '2026-09-08T17:42:00' }] } }),
  } });
  await view.render('mia');
  const html = section(nodes['tab-child'].innerHTML);
  assert.match(html, /<span class="cv-st-chip">Daily limit reached at 5:42\sPM<\/span>/);
  assert.doesNotMatch(html, /is-info|extra time given/);
});

test('extra time granted but usage still at/over the extended allowance keeps the red chip', async () => {
  const { nodes, view } = setup({ routes: {
    '/api/screen-time': async () => ({ kids: [kidState('mia')] }),
    '/api/screen-time/kids/mia/usage': async () => usage('mia', { [TODAY]: { minutes: 150, limitMinutes: 135, extraMinutes: 15, devices: [{ deviceId: 'd1', label: 'iPhone', minutes: 150, limitReachedAt: '2026-09-08T17:42:00' }] } }),
  } });
  await view.render('mia');
  const html = section(nodes['tab-child'].innerHTML);
  assert.match(html, /<span class="cv-st-chip">Daily limit reached at 5:42\sPM<\/span>/);
  assert.doesNotMatch(html, /is-info|extra time given/);
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
    '/api/screen-time': async () => ({ kids: [kidState('mia', { policy: { enabled: false, limits: [] }, alerts: [{ message: evil, at: evil }, { type: evil, message: evil, at: evil, ackedAt: evil }] })] }),
    '/api/screen-time/kids/mia/usage': async () => usage('mia', { requests: [{ minutes: 15, fams: 5, status: evil, date: TODAY, createdAt: '1' }] }),
  } });
  context.currentFamily.kids[0].name = `Mia${evil}`;
  await view.render('mia');
  const html = section(nodes['tab-child'].innerHTML);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /class="cv-st-off">Screen Time is off for Mia&lt;img src=x onerror=alert\(1\)&gt; right now\./); // Off line path
  assert.match(html, /class="cv-st-chip is-info">Needs a look/); // unknown type never reaches the class attribute
  assert.doesNotMatch(html, /<img/);
});

test('Off: a parent-disabled policy with an enrolled device shows the quiet line above the chart and keeps history', async () => {
  const { nodes, view } = setup({ routes: {
    '/api/screen-time': async () => ({ kids: [kidState('mia', { policy: { enabled: false, limits: [{ id: 'total' }] }, alerts: [{ id: 'a1', type: 'revoked', message: 'Mia turned off Screen Time on iPhone', at: '2026-09-07T16:12:00Z', ackedAt: '2026-09-08T09:00:00Z' }] })] }),
    '/api/screen-time/kids/mia/usage': async () => usage('mia', { [TODAY]: { minutes: 45, limitMinutes: null } }),
  } });
  await view.render('mia');
  const html = section(nodes['tab-child'].innerHTML);
  assert.match(html, /<p class="cv-st-off">Screen Time is off for Mia right now\. Turn it back on in the Fam ETC app\.<\/p>/);
  assert.ok(html.indexOf('cv-st-off') < html.indexOf('cv-st-chart'), 'Off line sits above the chart');
  assert.equal((html.match(/class="cv-st-day/g) || []).length, 7); // chart still renders
  assert.match(html, /About 45 min today/);
  assert.match(html, /Mia turned off Screen Time on iPhone[\s\S]*No action needed/);
  assert.doesNotMatch(html, /isn’t set up|Needs a look/);
});

test('On: no Off line; not set up still wins over Off when no device is enrolled', async () => {
  let kids = [kidState('mia')];
  const { nodes, view } = setup({ routes: {
    '/api/screen-time': async () => ({ kids }),
    '/api/screen-time/kids/mia/usage': async () => usage('mia'),
  } });
  await view.render('mia');
  assert.doesNotMatch(section(nodes['tab-child'].innerHTML), /cv-st-off|is off for Mia/);
  kids = [kidState('mia', { policy: { enabled: false, limits: [] }, devices: [] })];
  await view.render('mia');
  const html = section(nodes['tab-child'].innerHTML);
  assert.match(html, /Screen Time isn’t set up for Mia yet/);
  assert.doesNotMatch(html, /cv-st-off|cv-st-chart/);
});

test('alert history: unacked keep the chip (toned by type), acked are labelled plainly, newest three only', async () => {
  const alerts = [
    { id: 'a1', type: 'revoked', message: 'Mia turned off Screen Time on iPhone', at: '2026-09-08T10:00:00Z', ackedAt: null },
    { id: 'a2', type: 'stale', message: 'Mia’s iPhone hasn’t checked in since Sat 9:12 PM. It may be off or offline.', at: '2026-09-07T10:00:00Z', ackedAt: null },
    { id: 'a3', type: 'restored', message: 'Screen Time is back on for Mia’s iPhone', at: '2026-09-06T10:00:00Z', ackedAt: '2026-09-06T10:00:00Z' },
    { id: 'a4', type: 'selection_changed', message: 'Oldest alert', at: '2026-09-01T10:00:00Z', ackedAt: null },
  ];
  const { nodes, view } = setup({ routes: {
    '/api/screen-time': async () => ({ kids: [kidState('mia', { alerts })] }),
    '/api/screen-time/kids/mia/usage': async () => usage('mia'),
  } });
  await view.render('mia');
  const html = section(nodes['tab-child'].innerHTML);
  const items = (html.match(/<h3>Alerts<\/h3><ul class="cv-st-list">([\s\S]*?)<\/ul>/) || [])[1].match(/<li[\s\S]*?<\/li>/g);
  assert.equal(items.length, 3);
  assert.doesNotMatch(html, /Oldest alert/);
  assert.match(items[0], /^<li class="is-open"><strong>Mia turned off Screen Time on iPhone<\/strong><span><span class="cv-st-chip">Needs a look<\/span>/); // danger tone
  assert.match(items[1], /^<li class="is-open">[\s\S]*<span class="cv-st-chip is-warning">Needs a look<\/span>/);
  assert.match(items[2], /^<li class="is-acked"><strong>Screen Time is back on for Mia’s iPhone<\/strong><span>[^<]* · No action needed<\/span><\/li>$/);
  assert.doesNotMatch(items[2], /cv-st-chip/);
});

test('stale alerts use the new wording, including legacy history that said Screen Time was turned off', async () => {
  const legacy = 'Mia\'s iPhone hasn\'t checked in since Sat 9:12 PM — it may be off, offline, or Screen Time was turned off';
  const { nodes, view } = setup({ routes: {
    '/api/screen-time': async () => ({ kids: [kidState('mia', { alerts: [{ id: 'a1', type: 'stale', message: legacy, at: '2026-09-07T10:00:00Z', ackedAt: null }] })] }),
    '/api/screen-time/kids/mia/usage': async () => usage('mia'),
  } });
  await view.render('mia');
  const html = section(nodes['tab-child'].innerHTML);
  assert.match(html, /Mia's iPhone hasn't checked in since Sat 9:12 PM\. It may be off or offline\./);
  assert.doesNotMatch(html, /was turned off/);
});

test('child-view.css styles the Off line with ink-2 and distinct acked/unacked alert rows', () => {
  const css = fs.readFileSync(require('node:path').join(__dirname, '../public/css/child-view.css'), 'utf8');
  assert.match(css, /\.cv-st-off \{[^}]*color: var\(--fr-ink-2/);
  assert.match(css, /\.cv-st-chip\.is-warning \{[^}]*--fr-fams-ink/);
  assert.match(css, /\.cv-st-chip\.is-info \{[^}]*--fr-you-ink/);
  assert.match(css, /\.cv-st-list li\.is-acked strong \{[^}]*--fr-ink-2/);
});
