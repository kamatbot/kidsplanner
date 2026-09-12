"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {lessons,projection}=require("../lib/finance-learning");
test("projection conserves contributions at zero and compounds monthly end deposits",()=>{
  assert.deepEqual(projection({principal:100,monthlyContribution:10,annualRate:0,years:2}),{total:340,contributions:340,growth:0,series:[{year:0,total:100,contributions:100},{year:1,total:220,contributions:220},{year:2,total:340,contributions:340}]});
  const result=projection({principal:1000,monthlyContribution:100,annualRate:12,years:1});
  const expected=1000*1.01**12+100*(1.01**12-1)/.01;
  assert.equal(result.total,Math.round(expected*100)/100);
  assert.equal(result.contributions,2200);
  assert.ok(Math.abs(result.total-result.contributions-result.growth)<.011);
  const loss=projection({principal:1000,monthlyContribution:0,annualRate:-10,years:1});
  assert.ok(loss.total<1000);assert.ok(loss.growth<0);
});
test("projection rejects coercion, unsafe limits and unknown input",()=>{
  const base={principal:0,monthlyContribution:0,annualRate:0,years:1};
  for(const delta of [{principal:"100"},{principal:NaN},{principal:Infinity},{principal:-1},{monthlyContribution:1e7},{annualRate:31},{annualRate:-51},{years:0},{years:51},{years:1.2},{kidId:"x"}]) assert.ok(projection({...base,...delta}).error);
  assert.ok(projection(null).error);
});
test("lessons cover two weeks with unique identifiers and one valid answer",()=>{
  assert.equal(new Set(lessons.map(l=>l.id)).size,lessons.length);
  assert.ok(lessons.length>=14);
  for(const lesson of lessons) {assert.equal(lesson.options.filter(o=>o.id===lesson.answerId).length,1);assert.ok(lesson.body&&lesson.explanation);}
});
