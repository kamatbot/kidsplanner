'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync('public/js/app.js', 'utf8');
const settings = fs.readFileSync('public/js/settings.js', 'utf8');
function fn(name) { const start = source.indexOf(`function ${name}(`); const next = source.indexOf('\nfunction ', start + 1); return source.slice(start, next); }
function harness() {
 const context = { currentFamily: { kids: [{ id:'one', name:'Maya', grade:'6th Grade', color:'#a72a72', photo:'' }, { id:'two', name:'Leo', color:'#128077' }] }, sessionUser:{id:'login',kidId:'one'}, isKidSession:()=>true, esc:s=>String(s).replaceAll('"','&quot;').replaceAll('<','&lt;') };
 vm.runInNewContext(settings+'\n'+fn('kidColorFor')+'\n'+fn('isOwnMessage')+'\n'+fn('chatSenderColor'),context);
 return context;
}
test('saved child color survives family reordering and own-message styling',()=>{
 const c=harness(); assert.equal(c.kidColorFor('one'),'#a72a72');
 c.currentFamily.kids.reverse(); assert.equal(c.kidColorFor('one'),'#a72a72');
 assert.equal(c.chatSenderColor({senderType:'kid',senderId:'one'}),'#a72a72');
 assert.equal(c.chatSenderColor({senderType:'kid',senderId:'two'}),'#128077');
 assert.equal(c.kidColorFor('missing'),null);
});
test('profile rendering rejects external or injected images and colors',()=>{
 const c=harness();const kid=c.currentFamily.kids[0];kid.photo='https://tracker.example/avatar.jpg';kid.color='red;display:none';
 assert.doesNotMatch(c.kidAvatarMarkup('one'),/<img|tracker|display:none/);
 kid.photo='data:image/jpeg;base64,AAAA'; assert.match(c.kidAvatarMarkup('one'),/<img/);
 kid.name='<bad>'; assert.doesNotMatch(c.renderKidProfileEditor(kid), /<bad>/);
});
test('settings sections keep only one panel visible and relocated connections remain parent-only',()=>{
 const panels=['family','school','preferences','connections','security'].map(section=>({dataset:{settingsSection:section},hidden:false}));
 const controls=panels.map(p=>({dataset:{settingsNav:p.dataset.settingsSection},setAttribute(){},removeAttribute(){}}));
 const parent={hidden:false},notice={hidden:true}; const c=harness();
 c.document={querySelectorAll:s=>s==='[data-settings-section]'?panels:controls,getElementById:id=>id==='connections-parent-only'?parent:notice};
 c.showSettingsSection('school');assert.deepEqual(panels.filter(p=>!p.hidden).map(p=>p.dataset.settingsSection),['school']);assert.equal(parent.hidden,true);assert.equal(notice.hidden,false);
 c.showSettingsSection('security');assert.deepEqual(panels.filter(p=>!p.hidden).map(p=>p.dataset.settingsSection),['security']);
 c.showSettingsSection('unknown');assert.equal(panels[0].hidden,false);
});
