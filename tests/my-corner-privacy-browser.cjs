const { chromium } = require(process.env.FAM_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');

(async () => {
  const base = 'http://127.0.0.1:18369';
  const sessions = await fetch(base + '/qa/my-corner-session').then(r => r.json());
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const cookies = key => sessions[key].split('; ').map(part => ({
      name: part.slice(0, part.indexOf('=')), value: part.slice(part.indexOf('=') + 1), url: base,
    }));
    const page = await context.newPage();
    const secondTab = await context.newPage();
    const entry = page.getByRole('button', { name: 'My Corner · stickers & a note' });
    async function hide() {
      // Headless Chromium does not consistently hide background tabs. Exercise
      // its real DOM lifecycle handler explicitly while sharing real cookies.
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
    }
    async function show() {
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        document.dispatchEvent(new Event('visibilitychange'));
      });
    }
    for (const next of ['parent', 'sibling']) {
      await context.clearCookies(); await context.addCookies(cookies('child'));
      await page.goto(base);
      await entry.click();
      await page.getByLabel('Sticky note (240 characters maximum)').fill('Private unsaved child A');
      await hide();
      assert.equal(await page.locator('.fam-corner').count(), 0);
      await context.clearCookies(); await context.addCookies(cookies(next));
      await secondTab.goto(base);
      await show();
      await entry.click();
      await page.waitForFunction(() => document.getElementById('fam-my-corner-entry').hidden);
      assert.equal(await page.locator('.fam-corner').count(), 0);
      assert.ok(!(await page.locator('body').textContent()).includes('Private unsaved child A'));
    }
    await context.clearCookies(); await context.addCookies(cookies('child'));
    await page.goto(base);
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    let seen;
    const started = new Promise(resolve => { seen = resolve; });
    await page.route('**/api/my-corner', async route => {
      seen(); await pending;
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ revision: 0, note: 'Late private response', stickers: [] }) });
    });
    await entry.click(); await started;
    await hide();
    await context.clearCookies(); await context.addCookies(cookies('sibling'));
    await secondTab.goto(base); await show();
    const received = page.waitForResponse('**/api/my-corner'); release(); await received;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    assert.equal(await page.locator('.fam-corner').count(), 0);
    assert.ok(!(await page.locator('body').textContent()).includes('Late private response'));
    console.log('PASS: shared-cookie child→parent/child switches clear private DOM; reopening revalidates identity; delayed response cannot restore it.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
