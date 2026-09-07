'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const register=require('../lib/routes/watch');
const day=new Date().toISOString().slice(0,10);
function context(role='kid', overrides={}, extraEvents=[]) {
 const handlers={};const pass=(q,r,n)=>n();
 const fam={id:'family',parentIds:['parent'],inviteCode:'SECRET',kids:[{id:'kid',name:'Maya',color:'#a72a72',photo:'thumbnail'},{id:'sibling',name:'Leo'}]};
 const req={user:{id:role==='kid'?'kid-user':'parent',data:{profile:{name:'Alex'}}},family:fam,watchAuth:{familyId:'family',targetUserId:role==='kid'?'kid-user':'parent',targetType:role,targetKidId:'kid'},...overrides};
 register({get:(p,...h)=>handlers[p]=h,post:()=>{}},{requireAuth:pass,requireParent:pass,requireFamily:pass,authLimiter:pass,
 schoolFeeds:{famStore:()=>({}),collectFromCache:()=>[{uid:'school',title:'Assembly',start:day+'T09:00:00+07:00',customUrl:'SECRET_URL'}]},
 schoolApi:{listTimetableEvents:()=>['kid','sibling'].map(kidId=>({uid:kidId,feedId:'sta-child-timetable',kidId,title:'Math',start:day+'T10:00:00+07:00'}))},
 events:{listEvents:()=>[{id:'shared',title:'Dinner',date:day,time:'18:00'}, {id:'private',title:'Sibling only',date:day,kidId:'sibling'}, ...extraEvents]}});
 const res={code:200,headers:{},set(k,v){this.headers[k]=v;return this},status(c){this.code=c;return this},json(b){this.body=b;return this}};
 let i=0;const next=()=>{const fn=handlers['/api/watch/context'][i++];if(fn)fn(req,res,next)};next();return res;
}
test('kid watch context projects own timetable and shared events without family secrets',()=>{
 const r=context();assert.equal(r.code,200);assert.equal(r.body.profile.role,'kid');assert.equal(r.body.profile.color,'#a72a72');
 assert.deepEqual(r.body.events.map(e=>e.id).sort(),['kid','school','shared']);
 assert.doesNotMatch(JSON.stringify(r.body),/SECRET|sibling/);assert.equal(r.headers['Cache-Control'],'no-store');
});
test('parent watch keeps family events without classroom timetable',()=>{
 const r=context('parent');assert.deepEqual(r.body.events.map(e=>e.id).sort(),['private','school','shared']);assert.equal(r.body.profile.role,'parent');
});
test('watch context rejects mismatched owner/family, missing profile, and interactive sessions',()=>{
 assert.equal(context('kid',{watchAuth:{familyId:'other',targetUserId:'kid-user'}}).code,403);
 assert.equal(context('kid',{watchAuth:{familyId:'family',targetUserId:'other'}}).code,403);
 assert.equal(context('kid',{watchAuth:{familyId:'family',targetUserId:'kid-user',targetType:'kid',targetKidId:'removed'}}).code,401);
 assert.equal(context('kid',{watchAuth:null}).code,403);
 assert.equal(context('parent',{family:{id:'family',parentIds:[],kids:[]}}).code,401);
});

test('recurring calendar occurrences have distinct watch identities',()=>{
 const next=new Date(Date.now()+86400000).toISOString().slice(0,10);
 const r=context('kid',{},[{id:'series',title:'Reading',date:day,occurrenceDate:day},{id:'series',title:'Reading',date:next,occurrenceDate:next}]);
 const ids=r.body.events.filter(e=>e.title==='Reading').map(e=>e.id);
 assert.equal(new Set(ids).size,2);
});
