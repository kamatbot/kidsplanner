const { chromium } = require(process.env.FAM_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const base = 'http://127.0.0.1:18369';
  const sessions = await fetch(base + '/qa/my-corner-session').then(r => r.json());
  const browser = await chromium.launch({channel:'chrome', headless:true});
  try {
    for (const width of [390, 1024]) {
      const context = await browser.newContext({viewport:{width,height:900}, serviceWorkers:'block'});
      await context.addCookies(sessions.parent.split('; ').map(s=>({name:s.slice(0,s.indexOf('=')),value:s.slice(s.indexOf('=')+1),url:base})));
      const page = await context.newPage(); await page.goto(base);
      const pal = page.locator('#today-study-pal');
      await pal.getByRole('button', {name:/Koko/}).waitFor();
      const toggle = pal.getByRole('button', {name:/Koko/});
      if (await toggle.textContent() === 'Show Koko') await toggle.click();
      await toggle.click(); assert.equal(await toggle.textContent(),'Show Koko'); await toggle.click();
      const mood = page.locator('#mood-check-in');
      const count = async () => (await (await context.request.get(base+'/api/chat/messages')).json()).messages.length;
      const before = await count();
      await mood.getByRole('button',{name:'Full',exact:true}).click();
      await mood.getByRole('button',{name:'Preview sharing'}).click();
      await mood.getByRole('button',{name:'Cancel',exact:true}).click(); assert.equal(await count(),before);
      await mood.getByRole('button',{name:'Okay',exact:true}).click();
      await mood.getByRole('button',{name:'Preview sharing'}).click();
      await mood.getByRole('button',{name:'Send to family',exact:true}).click();
      await mood.getByRole('status').filter({hasText:'Sent to family chat.'}).waitFor();
      assert.equal(await count(),before+1);
      const messages = (await (await context.request.get(base+'/api/chat/messages')).json()).messages;
      assert.equal(messages.at(-1).senderType,'parent');
      // My Corner and stickers are iOS-only; the web offers neither.
      assert.equal(await page.getByRole('button',{name:/My Corner/}).count(),0);
      await page.screenshot({path:'.dev-data/daily-four/parent-koko-'+width+'.png'});
      await context.close();
    }
    console.log('PASS parent Koko, explicit emotion preview/cancel/send, no web My Corner at 390/1024px');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
