'use strict';

// Local UI fixture: real app shell/navigation, synthetic API responses, no AI calls.
// FAM_PLAYWRIGHT_MODULE may point at the bundled Playwright installation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.FAM_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../public');
const evidence = path.resolve(__dirname, '../.dev-data/kid-companion/web');
const widths = (process.env.FAM_COMPANION_QA_WIDTHS || '390,1024,1440').split(',').map(Number);
fs.mkdirSync(evidence, { recursive: true });
const profile = { name: 'Pip', avatar: 'comet', color: 'violet', personality: 'playful', reminders: true, enabled: false, ageBand: '6-8' };
const kid = { id: 'kid-one', name: 'Ari', grade: '3', color: '#8660d3' };
const family = { id: 'fixture-family', name: 'Fixture Family', plan: 'full', parentIds: ['parent-one'], parents: [{ id: 'parent-one', name: 'Alex' }], kids: [kid, { id: 'kid-two', name: 'Robin', grade: '6', color: '#248b79' }] };
const user = role => role === 'kid' ? { id: 'user-kid-one', role, kidId: kid.id, name: kid.name } : { id: 'parent-one', role: 'parent', name: 'Alex' };
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const filename = path.resolve(root, '.' + (pathname === '/app' || pathname === '/' ? '/index.html' : pathname));
  if (!filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(filename, (error, data) => {
    if (error) { res.writeHead(404).end(); return; }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
    res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream' });
    res.end(data);
  });
});

async function fixture(browser, base, role, width) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const data = { user: user(role), profile: { ...profile }, other: { ...profile, avatar: 'owl', ageBand: '9-12' }, messages: [], writes: [], failLoad: false, failSave: false, loadGate: null, saveGate: null };
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const method = route.request().method();
    const json = value => route.fulfill({ json: value });
    const error = () => route.fulfill({ status: 503, json: { error: 'Temporary test outage' } });
    if (url.pathname === '/api/me') return json({ user: data.user });
    if (url.pathname === '/api/family') return json({ families: [{ ...family, kids: data.user.role === 'kid' ? [kid] : family.kids }] });
    if (url.pathname === '/api/hermes/companion' || url.pathname.startsWith('/api/hermes/companions')) {
      if (method === 'GET') {
        const snapshot = { ...data.profile };
        if (data.loadGate) await data.loadGate;
        if (data.failLoad) return error();
        return json(url.pathname.endsWith('/companion') ? { profile: snapshot } : { companions: data.emptyCompanions ? [] : [{ kidId: kid.id, kidName: kid.name, profile: snapshot }, { kidId: 'kid-two', kidName: 'Robin', profile: data.other }] });
      }
      const patch = route.request().postDataJSON();
      data.writes.push({ pathname: url.pathname, patch });
      if (data.saveGate) await data.saveGate;
      if (data.failSave) return error();
      const target = url.pathname.endsWith('kid-two') ? 'other' : 'profile';
      Object.assign(data[target], patch);
      return json({ profile: data[target] });
    }
    if (url.pathname === '/api/hermes/thread/messages') {
      if (method === 'POST') {
        const text = route.request().postDataJSON().text;
        const createdAt = new Date().toISOString();
        const message = { id: `human-${data.messages.length}`, senderType: data.user.role, senderId: kid.id, text, createdAt };
        const reply = { id: `helper-${data.messages.length}`, senderType: 'agent', senderId: 'hermes', text: 'Let’s work through a hint. What have you tried so far?', createdAt };
        data.messages.push(message, reply);
        return json({ message, messages: [reply] });
      }
      const after = url.searchParams.get('afterId');
      return json({ messages: after ? data.messages.slice(data.messages.findIndex(m => m.id === after) + 1) : data.messages });
    }
    if (url.pathname === '/api/chat/messages') return json({ messages: [] });
    if (url.pathname === '/api/news/recent') return json({ items: [], categories: [], unavailable: true });
    if (url.pathname === '/api/enrichment/brain-teaser/today') return json({ questions: [] });
    return json({});
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/app');
  await page.locator('#dashboard-screen').waitFor();
  return { context, page, data, errors };
}

async function openHermes(page, role, width) {
  if (width <= 900) {
    await page.locator('.fr-mobile-tabbar [aria-label="More"]').click();
    await page.locator('#mobile-more-dialog [data-tab="hermes"]').click();
  } else await page.locator('.app-sidebar [data-tab="hermes"]').click();
  await page.locator('#kid-companion-card .companion-hero, #kid-companion-card .companion-parent-list').waitFor();
}

async function noOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'page must fit viewport');
  assert.equal(await page.locator('#kid-companion-card').evaluate(el => el.scrollWidth > el.clientWidth + 1), false, 'companion card must fit');
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of widths) {
      const { context, page, data, errors } = await fixture(browser, base, 'kid', width);
      await openHermes(page, 'kid', width);
      const card = page.locator('#kid-companion-card');
      assert.equal(await page.locator('#hermes-page-input').isDisabled(), true);
      assert.match(await card.innerText(), /Chat is off/);
      await card.locator('summary').click();
      await card.getByLabel('Companion name').fill('Nova');
      await card.getByLabel('Fox', { exact: true }).check();
      await card.getByLabel('Mint', { exact: true }).check();
      await card.getByLabel('Personality').selectOption('curious');
      await card.getByLabel('Helpful reminders').uncheck();
      const save = card.getByRole('button', { name: 'Save my companion' });
      await save.click();
      await card.getByRole('status').filter({ hasText: /^Saved$/ }).waitFor();
      assert.deepEqual(Object.keys(data.writes.at(-1).patch).sort(), ['avatar', 'color', 'name', 'personality', 'reminders']);
      assert.equal(await page.locator('#tab-hermes .page-title').innerText(), 'Nova');
      assert.match(await page.locator('#chat-room-tab-hermes').innerText(), /Nova/);
      assert.equal(await card.locator('[name="enabled"]').count(), 0);
      await noOverflow(page);
      await page.screenshot({ path: path.join(evidence, `kid-customize-${width}.png`), fullPage: true });

      // A parent enabling chat is observed on the next navigation.
      data.profile.enabled = true;
      await page.locator(`${width <= 900 ? '.fr-mobile-tabbar' : '.app-sidebar'} [data-tab="today"]`).click();
      await openHermes(page, 'kid', width);
      assert.equal(await page.locator('#hermes-page-input').isDisabled(), false);
      await page.locator('#hermes-page-input').fill('Help with my homework');
      await page.locator('#hermes-page-form button[type="submit"]').click();
      await page.locator('#hermes-page-messages').getByText('Let’s work through a hint.', { exact: false }).waitFor();
      assert.match(await page.locator('#hermes-page-messages .chat-msg-sender').last().innerText(), /Nova.*AI HELPER/);
      assert.equal(await page.locator('#hermes-page-messages .companion-avatar').count(), 1);
      await page.screenshot({ path: path.join(evidence, `kid-chat-${width}.png`), fullPage: true });
      if (width === 390) {
        await page.locator('#chat-fab').click();
        await page.locator('#chat-room-tab-hermes').click();
        await page.waitForFunction(() => !document.getElementById('chat-input').disabled);
        assert.match(await page.locator('#chat-messages .chat-msg-sender').last().innerText(), /Nova.*AI HELPER/);
        await page.locator('#chat-input').fill('One more hint');
        await page.locator('#chat-send-form button[type="submit"]').click();
        await page.locator('#hermes-page-messages').getByText('One more hint', { exact: true }).waitFor({ state: 'attached' });
        await page.locator('#chat-room-tab-family').click();
        assert.equal(await page.locator('#chat-input').isDisabled(), false);
        assert.equal(await page.locator('#chat-input').getAttribute('placeholder'), 'Message the family…');
        await page.locator('#chat-fab').click();
        await card.locator('summary').click();
        const robot = card.getByLabel('Robot', { exact: true });
        await robot.focus();
        await page.keyboard.press('ArrowRight');
        assert.equal(await card.getByLabel('Fox', { exact: true }).isChecked(), true);
        data.failSave = true;
        await card.getByLabel('Companion name').fill('Comet');
        await card.getByRole('button', { name: 'Save my companion' }).click();
        await card.getByRole('status').filter({ hasText: /Could not save/ }).waitFor();
        assert.equal(await card.getByLabel('Companion name').inputValue(), 'Comet');
        assert.equal(await card.getByRole('button', { name: 'Save my companion' }).isDisabled(), false);
        data.failSave = false;
        let finishSave;
        data.saveGate = new Promise(resolve => { finishSave = resolve; });
        const keyboardSave = card.getByRole('button', { name: 'Save my companion' });
        await keyboardSave.focus();
        await page.keyboard.press('Enter');
        await card.getByRole('status').filter({ hasText: /^Saving…$/ }).waitFor();
        assert.equal(await keyboardSave.isDisabled(), true);
        assert.equal(await card.getByLabel('Companion name').isDisabled(), true);
        finishSave(); data.saveGate = null;
        await card.getByRole('status').filter({ hasText: /^Saved$/ }).waitFor();
        assert.equal(await keyboardSave.evaluate(el => el === document.activeElement), true, 'keyboard save preserves focus');
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.evaluate(() => setTheme('dark'));
        await noOverflow(page);
        await page.screenshot({ path: path.join(evidence, 'kid-dark-390.png'), fullPage: true });
        data.failLoad = true;
        await page.locator(`${width <= 900 ? '.fr-mobile-tabbar' : '.app-sidebar'} [data-tab="today"]`).click();
        await page.getByRole('button', { name: 'More', exact: true }).click();
        await page.locator('#mobile-more-dialog [data-tab="hermes"]').click();
        await card.getByRole('button', { name: 'Try again' }).waitFor();
        assert.equal(await page.locator('#hermes-page-input').isDisabled(), true);
        data.failLoad = false;
        await card.getByRole('button', { name: 'Try again' }).click();
        await card.locator('.companion-hero').waitFor();
        let releaseLoad;
        data.loadGate = new Promise(resolve => { releaseLoad = resolve; });
        await page.locator(`${width <= 900 ? '.fr-mobile-tabbar' : '.app-sidebar'} [data-tab="today"]`).click();
        await page.getByRole('button', { name: 'More', exact: true }).click();
        await page.locator('#mobile-more-dialog [data-tab="hermes"]').click();
        await card.getByRole('status').filter({ hasText: /Loading/ }).waitFor();
        assert.equal(await page.locator('#hermes-page-input').isDisabled(), true);
        releaseLoad(); data.loadGate = null;
        await card.locator('.companion-hero').waitFor();
        await card.locator('.companion-customizer > summary').click();
        await card.getByLabel('Companion name').fill('A Very Long Companion');
        await page.setViewportSize({ width: 320, height: 1000 });
        await card.evaluate(el => {
          const scale = [];
          for (const node of el.querySelectorAll('*')) {
            if (node.closest('svg')) continue;
            if (['INPUT', 'SELECT', 'BUTTON'].includes(node.tagName) || [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim())) {
              scale.push([node, parseFloat(getComputedStyle(node).fontSize) * 1.5]);
            }
          }
          scale.forEach(([node, size]) => { node.style.fontSize = `${size}px`; });
        });
        await noOverflow(page);
        await page.screenshot({ path: path.join(evidence, 'kid-larger-text-320.png'), fullPage: true });
        await page.setViewportSize({ width, height: 1000 });

        // Actual bootstrap/account replacement while an old child's GET is pending.
        data.loadGate = new Promise(resolve => { releaseLoad = resolve; });
        await page.locator('.fr-mobile-tabbar [data-tab="today"]').click();
        await page.locator('.fr-mobile-tabbar [aria-label="More"]').click();
        await page.locator('#mobile-more-dialog [data-tab="hermes"]').click();
        await card.getByRole('status').filter({ hasText: /Loading/ }).waitFor();
        const oldResponse = page.waitForResponse(response => response.url() === base + '/api/hermes/companion');
        data.user = user('parent');
        data.messages = []; // the new account has its own empty private thread
        data.loadGate = null;
        await page.evaluate(async () => {
          chatRoomDot.hermes = true; renderChatRoomTabs();
          if (await bootstrapSession()) { showDashboard(); switchNavTab('hermes'); }
        });
        await card.locator('.companion-parent-list').waitFor();
        releaseLoad();
        await oldResponse;
        await page.waitForFunction(() => document.querySelector('#kid-companion-card .companion-parent-list') && document.querySelector('#tab-hermes .page-title').textContent === 'Hermes');
        assert.equal(await card.locator('.companion-hero').count(), 0);
        assert.equal(await page.locator('#hermes-page-messages .chat-msg').count(), 0, 'previous private history is cleared');
        assert.equal(await page.locator('#chat-room-dot-hermes').isHidden(), true, 'previous unread state is cleared');
      }
      assert.deepEqual(errors, []);
      console.log(`PASS child ${width}px: navigation, disabled chat, all cosmetic controls, save, identity and immediate reply`);
      await context.close();
    }

    for (const width of widths) {
      const { context, page, data, errors } = await fixture(browser, base, 'parent', width);
      await openHermes(page, 'parent', width);
      const card = page.locator('#kid-companion-card');
      await card.locator('.companion-privacy summary').click();
      assert.match(await card.innerText(), /Anthropic/);
      assert.match(await card.innerText(), /No cheating alerts are sent to parents/);
      assert.equal(await card.locator('.companion-kid').count(), 2);
      const child = card.locator('[data-companion-kid="kid-one"]');
      await child.locator('summary').click();
      await child.getByLabel('Age band').selectOption('9-12');
      await child.getByLabel('Enable AI companion').check();
      await child.getByRole('button', { name: 'Save settings' }).click();
      await child.getByRole('status').filter({ hasText: /^Saved$/ }).waitFor();
      assert.equal(data.profile.enabled, true);
      assert.equal(data.profile.ageBand, '9-12');
      assert.equal(data.other.enabled, false);
      assert.equal(await page.locator('#tab-hermes .page-title').innerText(), 'Hermes');
      await noOverflow(page);
      await page.screenshot({ path: path.join(evidence, `parent-controls-${width}.png`), fullPage: true });
      if (width === 390) {
        data.emptyCompanions = true;
        await page.locator('.fr-mobile-tabbar [data-tab="today"]').click();
        await openHermes(page, 'parent', width);
        assert.match(await card.innerText(), /Add a child in Settings/);
        assert.equal(await card.locator('.companion-kid').count(), 0);
      }
      assert.deepEqual(errors, []);
      console.log(`PASS parent ${width}px: real navigation, per-child enablement/age, privacy and tutor disclosure`);
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; server.close(); });
