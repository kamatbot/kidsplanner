"use strict";
const fams = require("../fams");
const learning = require("../finance-learning");
module.exports = (app, deps) => {
  const {requireAuth,requireFamily,requireParent,userRole,kidIdForUser}=deps;
  const noStore=(_req,res,next)=>{res.set("Cache-Control","no-store");next();};
  const select=(req,res,next)=>{
    const parent=userRole(req.user)==="parent";
    if(!parent && userRole(req.user)!=="kid") return res.status(403).json({error:"Family member required."});
    const requested=req.method==="GET"?req.query.kidId:req.body?.kidId;
    const own=kidIdForUser(req);
    if(requested!==undefined && typeof requested!=="string") return res.status(400).json({error:"Invalid child."});
    if(!parent && requested && requested!==own) return res.status(403).json({error:"Your own rewards only."});
    if(parent && !requested && !req.family.kids.length && req.method==="GET" && req.path==="/api/fams") {
      return res.json({kidId:null,kids:[],isParent:true});
    }
    const id=parent?(requested||req.family.kids[0]?.id):own;
    if(!id || !req.family.kids.some(k=>k.id===id)) return res.status(404).json({error:"Child not found."});
    req.famsKid=id;req.famsParent=parent;next();
  };
  const guards=[noStore,requireAuth,requireFamily,select];
  const result=(res,value)=>res.status(value.error?400:200).json(value);
  const childOnly=(req,res,next)=>req.famsParent?res.status(403).json({error:"Child session required."}):next();
  app.get("/api/fams",...guards,(req,res)=>res.json({kidId:req.famsKid,isParent:req.famsParent,kids:req.family.kids.filter(k=>req.famsParent||k.id===req.famsKid).map(k=>({id:k.id,name:k.name})),...fams.summary(req.family.id,req.famsKid)}));
  app.post("/api/fams/goals",...guards,(req,res)=>result(res,fams.setGoal(req.family.id,req.famsKid,{name:req.body.name,target:req.body.target})));
  app.post("/api/fams/chores",...guards,requireParent,(req,res)=>result(res,fams.createChore(req.family.id,req.famsKid,{title:req.body.title,amount:req.body.amount})));
  app.post("/api/fams/chores/:id/submit",...guards,childOnly,(req,res)=>result(res,fams.submitChore(req.family.id,req.famsKid,req.params.id)));
  app.post("/api/fams/chores/:id/approve",...guards,requireParent,(req,res)=>result(res,fams.approveChore(req.family.id,req.famsKid,req.params.id)));
  app.post("/api/fams/school-reset",...guards,requireParent,(req,res)=>result(res,fams.confirmSchoolReset(req.family.id,req.famsKid)));
  app.get("/api/fams/lessons",...guards,(req,res)=>{
    const summary=fams.summary(req.family.id,req.famsKid);
    res.json({lessons:learning.lessons.map(({answerId,explanation,...lesson})=>({...lesson,completed:(summary.completedLessons||[]).includes(lesson.id)}))});
  });
  app.post("/api/fams/lessons/:id/complete",...guards,childOnly,(req,res)=>{
    const lesson=learning.lessons.find(l=>l.id===req.params.id);
    if(!lesson) return res.status(404).json({error:"Lesson not found."});
    if(typeof req.body.answerId!=="string" || !lesson.options.some(o=>o.id===req.body.answerId)) return res.status(400).json({error:"Choose an answer."});
    const correct=lesson.answerId===req.body.answerId;
    res.json({correct,explanation:lesson.explanation,...(correct?fams.awardLesson(req.family.id,req.famsKid,lesson.id):{})});
  });
  app.post("/api/fams/projection",noStore,requireAuth,requireFamily,(req,res)=>result(res,learning.projection(req.body)));
};
