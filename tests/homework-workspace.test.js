"use strict";
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('fs'), vm=require('vm');
const sandbox={}; vm.runInNewContext(fs.readFileSync(require('path').join(__dirname,'../public/js/homework-workspace.js'),'utf8'),sandbox);
const view=sandbox.famHomeworkWorkspace;
const rows=[{id:'a',kidId:'one',subject:'Maths',status:'todo',dueDate:'2026-09-07'},{id:'b',kidId:'two',subject:'English',status:'todo',dueDate:'2026-09-08'},{id:'c',kidId:'one',subject:'Maths',status:'done',dueDate:'2026-09-01'},{id:'d',kidId:'one',subject:'DT',status:'todo',dueDate:'2026-09-04'},{id:'e',kidId:'two',subject:'Maths',status:'todo',dueDate:'2026-09-20'}];
test('homework workspace groups by local due date and counts actual statuses',()=>{
 const p=view.project(rows,{now:'2026-09-05T12:00:00'});
 assert.deepEqual(JSON.parse(JSON.stringify(p.counts)),{open:4,done:1,soon:2,overdue:1});
 assert.deepEqual(Array.from(p.visible,x=>x.id),['d','a','b','e']);assert.equal(p.groups[0].overdue,true);assert.equal(rows.length,5);
});
test('child/subject filters drive both summary and details; completed is independent',()=>{
 const p=view.project(rows,{kidId:'one',subject:'Maths',status:'done',now:'2026-09-05T12:00:00'});
 assert.deepEqual(Array.from(p.visible,x=>x.id),['c']);assert.equal(p.counts.open,1);assert.equal(p.counts.done,1);
 assert.equal(view.project(rows,{kidId:'unknown'}).visible.length,0);
});
test('effort retains minutes rather than rounding 75 minutes to one hour',()=>{
 assert.equal(view.effort(75),'1h 15m');assert.equal(view.effort(30),'30 min');assert.equal(view.effort(null),'Not estimated');assert.equal(view.effort('bad'),'Not estimated');
});
