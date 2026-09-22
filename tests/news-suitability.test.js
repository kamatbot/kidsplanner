'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const NOW = Date.parse('2026-09-22T08:00:00Z');
const feed = {source:'Bangkok Post Learning',url:'https://www.bangkokpost.com/rss/data/learning.xml',hosts:['bangkokpost.com'],production:true};
const fresh = () => { delete require.cache[require.resolve('../lib/news')]; return require('../lib/news'); };
function entry(title, summary = 'Students test a new invention.', extra = '') {
 return `<item><title>${title}</title><link>https://www.bangkokpost.com/learning/innovation/12345</link><pubDate>Mon, 21 Sep 2026 09:00:00 GMT</pubDate><description>${summary}</description>${extra}</item>`;
}
test('local news requires innovation, never just geography or a technology label', () => {
 const news=fresh();
 for(const title of ['Bangkok students invent water-saving robot','Thai school tests solar panels','Singapore researchers develop new materials']) assert.equal(news.parseFeed(entry(title),feed).length,1,title);
 for(const title of ['Bangkok traffic update','Thai football team wins','Thailand technology shares rise']) assert.equal(news.parseFeed(entry(title,'General local report.'),feed).length,0,title);
});
test('mature topics veto innovation even after display truncation or in secondary content', () => {
 const news=fresh();
 for(const subject of ['murder','sexual assault','sex trafficking','suicide','shooting','pornography','rape','drug trafficking']) {
   assert.equal(news.parseFeed(entry('Bangkok innovation report',`New robot linked to ${subject}.`),feed).length,0,subject);
 }
 assert.equal(news.parseFeed(entry('New robot in Bangkok','A useful classroom invention.',`<content:encoded><![CDATA[${'Classroom engineering. '.repeat(100)} A murder investigation.]]></content:encoded>`),feed).length,0);
 assert.equal(news.parseFeed(entry('Bangkok robot report','Classroom innovation.', '<summary>Se&#120;ual abuse.</summary>'),feed).length,0);
});
test('JSON feeds enforce the same policy using all supplied text fields', () => {
 const news=fresh();
 const story={title:'Bangkok students invent robot',url:'https://www.bangkokpost.com/story/1',date_published:'2026-09-21T09:00:00Z',summary:'New prototype'};
 assert.equal(news.parseFeed(JSON.stringify({items:[story]}),feed).length,1);
 assert.equal(news.parseFeed(JSON.stringify({items:[{...story,content_text:'A sexual assault investigation.'}]}),feed).length,0);
});
test('no eligible local innovation leaves the daily slot empty, including cached/outage reads', async () => {
 const news=fresh();
 const options={now:NOW,feeds:[feed],fetch:async()=>({status:200,text:async()=>`<rss>${entry('Bangkok murder report','Robot used by police.')}</rss>`})};
 const first=await news.getDailyNews('2026-09-22',options);
 assert.equal(first.choices[0].label,'Local Innovation');
 assert.equal(first.choices[0].article,null);
 assert.deepEqual(first.items,[]);
 const outage=await news.getDailyNews('2026-09-22',{...options,now:NOW+31*60*1000,fetch:async()=>{throw Error('offline');}});
 assert.equal(outage.choices[0].article,null);
 assert.deepEqual(outage.items,[]);
});


test('innovation evidence in full feed content survives display truncation and cached reads', async () => {
 const news = fresh();
 const xml = `<rss>${entry('Thai students unveil a community project', 'Children shared their work with neighbors.', '<content:encoded>Students designed a prototype water filter.</content:encoded>')}</rss>`;
 const options = {now: NOW, feeds: [feed], fetch: async () => ({status: 200, text: async () => xml})};
 const first = await news.getDailyNews('2026-09-22', options);
 assert.equal(first.choices[0].article.headline, 'Thai students unveil a community project');
 const cached = await news.getDailyNews('2026-09-22', {...options, now: NOW + 31 * 60 * 1000, fetch: async () => { throw Error('offline'); }});
 assert.equal(cached.choices[0].article.headline, first.choices[0].article.headline);
 assert.doesNotMatch(JSON.stringify(cached), /feed-screened|content:encoded/);
});
