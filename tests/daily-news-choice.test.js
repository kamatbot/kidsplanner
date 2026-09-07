"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const NOW = Date.parse('2026-09-07T12:00:00Z');
const source = {url:'https://fixture.test/feed', source:'Fixture', hosts:['fixture.test'],defaultCategory:'Science'};
function fresh() { delete require.cache[require.resolve('../lib/news')]; return require('../lib/news'); }
function options(rows) {
  return { now:NOW, feeds:[source], fetch:async()=>({status:200,ok:true,text:async()=>`<rss><channel>${rows.map(([id,title,cat,date])=>`<item><title>${title}</title><link>https://fixture.test/${id}</link><category>${cat}</category><description>Read and discuss the evidence.</description><pubDate>${date || 'Sun, 06 Sep 2026 08:00:00 GMT'}</pubDate></item>`).join('')}</channel></rss>`}) };
}
test('three distinct topical choices with exact labels and stable daily picks', async()=>{
  const news=fresh();
  const rows=[['r','Bangkok students test solar panels','Tech'],['s','Astronomers discover a new planet','Space'],['c','Athletes prepare for a sports festival','Sports']];
  const first=await news.getDailyNews('2026-09-07',options(rows));
  assert.deepEqual(first.choices.map(x=>x.category),['regional','science','culture']);
  assert.deepEqual(first.choices.map(x=>x.article.id),rows.map(x=>'https://fixture.test/'+x[0]));
  assert.equal(first.editionDate,'2026-09-07');
  assert.deepEqual(await news.getDailyNews('2026-09-07',options(rows.reverse())),first);
  assert.equal(new Set(first.items.map(x=>x.id)).size,3);
});
test('empty categories are not filled with mislabeled science or old stories', async()=>{
  const news=fresh();
  const result=await news.getDailyNews('2026-09-07',options([['s','Research on a new planet','Space'],['old','Bangkok story','World','Mon, 01 Jun 2026 00:00:00 GMT']]));
  assert.equal(result.choices[0].article,null);
  assert.ok(result.choices[1].article);
  assert.equal(result.choices[2].article,null);
  assert.equal(result.items.length,1);
});
test('invalid date rejected before fetching and geography is about the story',async()=>{
  const news=fresh();
  assert.ok((await news.getDailyNews('2026-02-30',options([]))).error);
  assert.equal(news.dailyCategory({headline:'A new telescope',summary:'Researchers study distant planets',cat:'Space',source:'Bangkok Post Learning'}),'science');
});
