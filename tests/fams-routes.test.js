"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
process.env.FAM_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),"fam-rewards-routes-"));
process.env.DATA_ENCRYPTION_KEY="15".repeat(32);
test("Fams routes isolate children and keep award amounts and approval parent-owned",async t=>{
  const express=require("express"),app=express();app.use(express.json());
  require("../lib/routes/fams")(app,{
    requireAuth(req,res,next){if(!req.headers["x-role"])return res.sendStatus(401);req.user={role:req.headers["x-role"]};next();},
    requireParent(req,res,next){if(req.user.role!=="parent")return res.sendStatus(403);next();},
    requireFamily(req,_res,next){req.family={id:"route-f",kids:req.headers["x-empty"]?[]:[{id:"own",name:"A"},{id:"sibling",name:"B"}]};next();},
    userRole:u=>u.role,kidIdForUser:()=>"own"
  });
  const server=app.listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));t.after(()=>server.close());
  const request=(url,role="kid",body)=>fetch(`http://127.0.0.1:${server.address().port}${url}`,{method:body?"POST":"GET",headers:{...(role?{"x-role":role}:{}),"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
  const empty=await fetch(`http://127.0.0.1:${server.address().port}/api/fams`,{headers:{"x-role":"parent","x-empty":"1"}});
  assert.equal(empty.status,200);assert.deepEqual(await empty.json(),{kidId:null,kids:[],isParent:true});
  assert.equal((await request("/api/fams",null)).status,401);
  assert.equal((await request("/api/fams?kidId=sibling")).status,403);
  assert.equal((await request("/api/fams?kidId=missing","parent")).status,404);
  assert.equal((await request("/api/fams?kidId[x]=own","parent")).status,400);
  const response=await request("/api/fams");assert.equal(response.headers.get("cache-control"),"no-store");
  const summary=await response.json();assert.deepEqual(summary.kids,[{id:"own",name:"A"}]);assert.equal(summary.balance,0);
  assert.equal((await request("/api/fams/chores","kid",{kidId:"own",title:"Dishes",amount:20})).status,403);
  const made=await request("/api/fams/chores","parent",{kidId:"own",title:"Dishes",amount:20});assert.equal(made.status,200);const {chore}=await made.json();
  assert.equal((await request(`/api/fams/chores/${chore.id}/approve`,"kid",{kidId:"own"})).status,403);
  assert.equal((await request(`/api/fams/chores/${chore.id}/submit`,"kid",{kidId:"sibling"})).status,403);
  assert.equal((await request(`/api/fams/chores/${chore.id}/submit`,"kid",{kidId:"own"})).status,200);
  assert.equal((await request(`/api/fams/chores/${chore.id}/approve`,"parent",{kidId:"own"})).status,200);
  await request(`/api/fams/chores/${chore.id}/approve`,"parent",{kidId:"own"});
  assert.equal((await(await request("/api/fams")).json()).balance,20);
  const lessons=await(await request("/api/fams/lessons")).json();assert.ok(lessons.lessons.every(l=>!Object.hasOwn(l,"answerId")));
  assert.equal((await request("/api/fams/lessons/needs/complete","parent",{kidId:"own",answerId:"0"})).status,403);
  const wrong=await(await request("/api/fams/lessons/needs/complete","kid",{answerId:"1"})).json();assert.equal(wrong.correct,false);
  assert.equal((await(await request("/api/fams")).json()).balance,20);
  const right=await(await request("/api/fams/lessons/needs/complete","kid",{answerId:"0",amount:99999})).json();assert.equal(right.correct,true);
  await request("/api/fams/lessons/needs/complete","kid",{answerId:"0"});
  assert.equal((await(await request("/api/fams")).json()).balance,22);
  assert.equal((await(await request("/api/fams/lessons")).json()).lessons.find(l=>l.id==="needs").completed,true);
  assert.equal((await request("/api/fams/school-reset","kid",{kidId:"own"})).status,403);
});
