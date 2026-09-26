'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/js/app.js', 'utf8');
// Slice at the next top-level declaration: unlike brace counters this supports
// destructured parameters and template literals in the SVG renderer.
function fn(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const rest = source.slice(start);
  const end = rest.indexOf('\n}', rest.indexOf('{'));
  return rest.slice(0, end + 2);
}
const isoDate = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
function setup(names, extra = {}) {
  const ctx = { Date, Math, Map, isoDate, parseIso: value => new Date(`${value}T00:00:00`), esc: value => String(value).replace(/"/g, '&quot;'), ...extra };
  vm.runInNewContext(names.map(fn).join('\n'), ctx);
  return ctx;
}

test('homework rings use Monday–Sunday plus unfinished overdue and keep kids isolated', () => {
  const item = (dueDate, status, kidId = 'a') => ({dueDate, status, kidId});
  const ctx = setup(['todayKidProgress'], {
    homeworkItems: [item('2026-09-20','done'), item('2026-09-20','todo'), item('2026-09-21','done'), item('2026-09-26','in_progress'), item('2026-09-27','todo'), item('2026-09-28','todo'), item(null,'todo'), item('2026-09-26','todo','b')],
    goalsItems: [{kidId:'a',type:'habit',checks:['2026-09-26']},{kidId:'a',type:'habit',checks:[]},{kidId:'a',type:'milestone',checks:['2026-09-26']},{kidId:'b',type:'habit',checks:['2026-09-26']}],
  });
  const progress = ctx.todayKidProgress('a','2026-09-26');
  assert.deepEqual(JSON.parse(JSON.stringify(progress)), {homework:{done:1,total:4,left:3,overdue:1,dueToday:1},habits:{done:1,total:2}});
  assert.equal(ctx.todayKidProgress('a','2026-09-27').homework.total,4, 'Sunday stays in the same week');
  assert.equal(ctx.todayKidProgress('a','2026-09-28').homework.done,0, 'last week completed work no longer counts');
});

test('Daily 4 distinguishes unavailable data from known zero and counts either challenge once', () => {
  const ctx = setup(['todayDaily3Progress'], {load:()=>({news:true}),daily5DoneKey:()=> 'today',timeAgo:()=> 'just now'});
  for (const data of [null,'loading','error',{date:'2026-09-25',parts:{news:{status:'completed'}}}]) assert.equal(ctx.todayDaily3Progress(data,'2026-09-26'),null);
  const data = {date:'2026-09-26',parts:{puzzle:{status:'completed'},bt:{status:'completed'}}};
  assert.equal(ctx.todayDaily3Progress(data,data.date).done,1);
  assert.equal(ctx.todayDaily3Progress(data,data.date).total,4);
  assert.equal(ctx.todayDaily3Progress(data,data.date).status,'Challenge done');
  assert.equal(ctx.todayDaily3Progress(data,data.date,true).done,2,'own local completion may augment server state');
  data.parts.word={status:'started'};
  assert.equal(ctx.todayDaily3Progress(data,data.date).status,'Challenge done');
  data.parts.quote={status:'completed',updatedAt:'2026-09-26T10:00:00Z'};
  assert.equal(ctx.todayDaily3Progress(data,data.date).status,'Quote done just now');
  data.parts.news={status:'completed'}; data.parts.word={status:'completed'};
  assert.equal(ctx.todayDaily3Progress(data,data.date).done,4, 'two challenge records still earn one credit');
  assert.equal(ctx.todayDaily3Progress(data,data.date).status,'Done ✓');
});

test('SVG rings expose counts, empty tracks and change motion; reduced motion suppresses effects', () => {
  let reduced = false;
  const ctx = setup(['famRing'], {famRingHistory:new Map(),window:{matchMedia:()=>({matches:reduced})}});
  const render = (value,total) => ctx.famRing({key:'test',rings:[{value,total,color:'var(--fr-hw)',label:'Homework'}]});
  const empty = render(0,0);
  assert.match(empty,/role="img" aria-label="Homework: none yet"/);
  assert.match(empty,/stroke-dasharray="4 7"/);
  assert.doesNotMatch(empty,/class="fr-ring-fill"/);
  const filled = render(1,2);
  assert.match(filled,/Homework: 1 of 2/);
  assert.match(filled,/<animate /);
  assert.match(render(2,2),/fr-ring-completed/);
  reduced = true;
  assert.doesNotMatch(render(0,2),/<animate |fr-ring-spark|fr-ring-completed/);
  assert.doesNotMatch(render(2,2),/<animate |fr-ring-spark|fr-ring-completed/);
});

test('parent hero keeps total eligible count separate from due-today progress and caps preview at three', () => {
  const nodes = Object.fromEntries(['today-actions-list','today-actions-count','today-parent-ring','today-actions-footer'].map(id=>[id,{setAttribute(){}}]));
  const now = new Date(); const today = isoDate(now); const future = new Date(now); future.setDate(now.getDate()+10);
  const ctx = setup(['renderTodayActionQueue'], {
    document:{getElementById:id=>nodes[id]}, window:{}, isKidSession:()=>false,
    renderTodayActionRoleCopy(){},renderTodayActionAssigneeOptions(){},todayIcon:()=>'',
    todayActionQueueState:'ready',todayActionItems:[
      {id:'due',status:'open',dueDate:today},{id:'future',status:'open',dueDate:isoDate(future)},
      {id:'shared',status:'open'},{id:'fourth',status:'open'},
      {id:'snoozed',status:'snoozed',dueDate:today,snoozedUntil:future.toISOString()},
      {id:'done',status:'done',completedAt:now.toISOString(),updatedAt:now.toISOString()},
      {id:'edited',status:'done',completedAt:'2020-01-01T12:00:00Z',updatedAt:now.toISOString()},
      {id:'legacy',status:'done',updatedAt:now.toISOString()},
    ], renderTodayActionRow:a=>`<article>${a.id}</article>`,famRing:options=>{ctx.ring=options;return '';},
  });
  vm.runInNewContext(fs.readFileSync('public/js/action-queue.js','utf8'),ctx);
  ctx.renderTodayActionQueue();
  assert.match(nodes['today-actions-count'].innerHTML,/See all 4/);
  assert.equal(ctx.ring.rings[0].value,1);
  assert.equal(ctx.ring.rings[0].total,2);
  assert.equal((nodes['today-actions-list'].innerHTML.match(/<article>/g)||[]).length,3);
  assert.match(nodes['today-actions-footer'].innerHTML,/\+1 more/);
  assert.doesNotMatch(nodes['today-actions-list'].innerHTML,/snoozed|done/);
});

test('unavailable parent insights omit the Daily 4 ring instead of rendering false zero', () => {
  const ctx = setup(['todayKidProgress','todayKidFacts','todayDaily3Progress','todayKidRowHtml'], {
    homeworkItems:[],goalsItems:[],sessionUser:{name:'Parent'},todayActionIdArg:x=>x,kidAvatarMarkup:()=>'',todayIcon:()=>'',
    famRing:options=>{ctx.rings=options.rings;return '<svg></svg>';},
  });
  const kid={id:'a',name:'Alex'};
  const unavailable=ctx.todayKidRowHtml(kid,true,'error','2026-09-26','error');
  assert.equal(ctx.rings.length,2);
  assert.match(unavailable,/Unavailable/);
  assert.doesNotMatch(unavailable,/>0\/4</);
  assert.match(unavailable,/No habits yet/);
  const zero=ctx.todayKidRowHtml(kid,true,'error','2026-09-26',{date:'2026-09-26',parts:{}});
  assert.equal(ctx.rings.length,3);
  assert.match(zero,/>0\/4</);
});

test('kid hero counts only own actions and own homework, excluding shared and sibling work', () => {
  const nodes = Object.fromEntries(['today-actions-list','today-actions-count','today-parent-ring'].map(id=>[id,{setAttribute(){}}]));
  const ctx=setup(['todayActionCanManageForViewer','todayActionCanManage','renderTodayActionQueue'], {
    document:{getElementById:id=>nodes[id]},window:{},isKidSession:()=>true,sessionUser:{kidId:'a'},
    renderTodayActionRoleCopy(){},renderTodayActionAssigneeOptions(){},todayIcon:()=>'',todayActionQueueState:'ready',
    todayActionItems:[{id:'mine',status:'open',assigneeType:'kid',assigneeId:'a',sourceType:'homework'}, {id:'sibling',status:'open',assigneeType:'kid',assigneeId:'b'}, {id:'shared',status:'open',assigneeType:'family'}],
    renderTodayActionRow:a=>a.id,famRing:()=>'',
  });
  vm.runInNewContext(fs.readFileSync('public/js/action-queue.js','utf8'),ctx);
  ctx.renderTodayActionQueue();
  assert.match(nodes['today-actions-count'].innerHTML,/See all 1/);
  assert.equal(nodes['today-actions-list'].innerHTML,'mine');
});

test('failed and pending homework/habit loads never claim empty or complete', () => {
  const ctx = setup(['todayKidProgress','todayKidFacts','todayDaily3Progress','todayKidRowHtml'], {
    homeworkItems:[],goalsItems:[],sessionUser:{name:'Parent'},todayActionIdArg:x=>x,kidAvatarMarkup:()=>'',todayIcon:()=>'',
    homeworkLoadState:'error',goalsLoadState:'error',
    famRing:options=>{ctx.rings=options.rings;return '<svg></svg>';},
  });
  const failed = ctx.todayKidRowHtml({id:'a',name:'Alex'},true,'error','2026-09-26','error');
  assert.equal(ctx.rings.length,0);
  assert.match(failed,/Homework unavailable/);
  assert.match(failed,/Habits unavailable/);
  assert.doesNotMatch(failed,/Nothing due today|No habits yet|>0<\/b>/);
  ctx.homeworkLoadState='loading'; ctx.goalsLoadState='loading';
  assert.match(ctx.todayKidRowHtml({id:'a',name:'Alex'},true,'loading','2026-09-26','loading'),/Loading homework/);
});

test('learning tiles combine current child server progress with local completions', () => {
  const nodes = Object.fromEntries(['news','quote','word','challenge'].map(key => [`fr-learning-${key}`,{}]));
  nodes['fr-challenge-status'] = {};
  const values = {};
  const ctx = setup(['renderTodayLearningRings'], {
    document:{getElementById:id=>nodes[id]},isKidSession:()=>true,currentFamily:{id:'family'},sessionUser:{kidId:'a'},
    todayRingDataKey:()=> 'a-today',todayRingData:new Map([['a-today',{progress:{parts:{
      news:{status:'completed'},word:{status:'started'},puzzle:{status:'started'},bt:{status:'completed'}
    }}}]]),
    famRing:options=>{values[options.key]=options.rings[0].value;return options.label;},
  });
  ctx.renderTodayLearningRings({quote:true});
  assert.deepEqual(values,{'learning-news':1,'learning-quote':1,'learning-word':.35,'learning-challenge':1});
  assert.equal(nodes['fr-challenge-status'].textContent,'Done ✓');
  ctx.isKidSession=()=>false;
  ctx.renderTodayLearningRings({});
  assert.deepEqual(values,{'learning-news':0,'learning-quote':0,'learning-word':0,'learning-challenge':0},'parent tiles never inherit a child’s records');
});
