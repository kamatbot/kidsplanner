"use strict";
const test=require('node:test');
const assert=require('node:assert/strict');
const mount=require('../lib/routes/learning');
const vocabulary=require('../lib/vocabulary-challenges');
function run(user,family,date) {
  let handlers;
  const app={get(path,...h){if(path==='/api/enrichment/vocabulary/today')handlers=h;},post(){},patch(){},delete(){}};
  mount(app,{requireAuth(req,res,next){return req.user?next():res.status(401).json({error:'Sign in'});},requireFamily(req,res,next){return req.family?next():res.status(403).json({error:'No family'});}});
  const req={user,family,query:{date}};
  const res={statusCode:200,headers:{},status(n){this.statusCode=n;return this;},set(k,v){this.headers[k]=v;return this;},json(body){this.body=body;return this;}};
  let i=0; const next=()=>handlers[i++]?.(req,res,next); next(); return res;
}
test('daily vocabulary requires an authenticated family and honors the requested local date',()=>{
  assert.equal(run(null,null,'2026-09-07').statusCode,401);
  assert.equal(run({id:'kid'},null,'2026-09-07').statusCode,403);
  const r=run({id:'kid'}, {id:'family'},'2026-09-07');
  assert.deepEqual(r.body,vocabulary.getDailyVocabulary('2026-09-07'));
  assert.equal(r.headers['Cache-Control'],'no-store');
  assert.equal(run({id:'kid'},{id:'family'},'2026-02-30').statusCode,400);
});


test('web and native requests receive the same new daily word on every date in the rotation', () => {
  const { DAILY_WORDS } = require('../lib/sat-words');
  for (let index = 0; index < DAILY_WORDS.length; index++) {
    const date = new Date(Date.UTC(2026, 8, 13 + index)).toISOString().slice(0, 10);
    const web = run({ id: 'parent' }, { id: 'family' }, date);
    const native = run({ id: 'kid', role: 'kid' }, { id: 'family' }, date);
    assert.equal(web.statusCode, 200);
    assert.deepEqual(web.body, native.body);
    assert.deepEqual(web.body.word, DAILY_WORDS[index]);
  }
});
