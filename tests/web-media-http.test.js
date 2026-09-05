'use strict';
// Real Express + SQLite + encrypted attachment integration, synthetic accounts only.
// SESSION_SECRET is SET, not deleted: lib/loadenv backfills any undefined var
// from a local .env/.env.hostinger, so deleting it made this test pass only on
// a machine without those files (i.e. CI). Setting it wins in both places.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto'),Keygrip=require('keygrip');
process.env.FAM_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'fametc-media-http-'));process.env.PORT='0';process.env.NODE_ENV='test';
process.env.SESSION_SECRET='web-media-http-test-secret';process.env.DATA_ENCRYPTION_KEY=crypto.randomBytes(32).toString('hex');
const store=require('../lib/store'),family=require('../lib/family'),trips=require('../lib/trips'),chat=require('../lib/chat');
const app=require('../server');
function cookie(user){const val=Buffer.from(JSON.stringify({uid:user.id,authGen:store.sessionGeneration(user)})).toString('base64');return `fam_sess=${val}; fam_sess.sig=${new Keygrip([process.env.SESSION_SECRET]).sign('fam_sess='+val)}`;}
test('web media HTTP: upload is private; retry is idempotent; Trip scope and ranges stay enforced',async(t)=>{
 const server=app.server;t.after(()=>server.close());if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const parent=store.createUser('parent@example.test','Parent'),other=store.createUser('other@example.test','Other');const fam=family.createFamily(parent.id,'Family');family.createFamily(other.id,'Unrelated');
 const parentCookie=cookie(parent),otherCookie=cookie(other);
 async function request(url,method='GET',body,token=parentCookie,headers={}){return fetch(base+url,{method,headers:{Cookie:token,...headers,...(body && !(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});}
 function uploadForm(roomId,type='image/jpeg',bytes=Buffer.from('ffd8ffe112345678','hex')){const form=new FormData();form.append('roomId',roomId);form.append('file',new Blob([bytes],{type}),type==='image/jpeg'?'photo.jpg':'clip.webm');return form;}
 assert.equal((await request('/api/chat/attachments','POST',uploadForm('family'),'')).status,401);
 const response=await request('/api/chat/attachments','POST',uploadForm('family'));assert.equal(response.status,200);const media=(await response.json()).attachment;
 assert.equal(media.kind,'photo');assert.equal((await request(media.url,'GET',null,otherCookie)).status,404);
 const key=crypto.randomBytes(16).toString('hex'),body={text:'See this',media,clientMessageId:key};
 const sent=await request('/api/chat/messages','POST',body);assert.equal(sent.status,200);const first=(await sent.json()).message;
 const replay=await request('/api/chat/messages','POST',body);assert.equal(replay.status,200);assert.equal((await replay.json()).message.id,first.id);
 assert.equal(chat.listMessages(fam.id).length,1);
 assert.equal((await request('/api/chat/messages','POST',{...body,text:'Changed'})).status,409);
 const trip=trips.createTrip(parent.id,fam.id,{name:'Trip',destination:'Paris',startDate:'2026-09-10',endDate:'2026-09-12'}).trip;
 const bytes=Buffer.concat([Buffer.from('1a45dfa39f4282847765626d','hex'),Buffer.alloc(32,1)]);
 const videoUpload=await request('/api/chat/attachments','POST',uploadForm('trip:'+trip.id,'video/webm',bytes));assert.equal(videoUpload.status,200);const video=(await videoUpload.json()).attachment;assert.equal(video.kind,'video');
 assert.equal((await request('/api/chat/messages','POST',{text:'Wrong room',media:video})).status,409);
 const tripBody={text:'Trip clip',media:video,clientMessageId:crypto.randomBytes(16).toString('hex')};const tripUrl='/api/trips/'+trip.id+'/chat/messages';
 const tripSent=await request(tripUrl,'POST',tripBody);assert.equal(tripSent.status,200);const tripMessage=(await tripSent.json()).message;
 assert.equal((await (await request(tripUrl,'POST',tripBody)).json()).message.id,tripMessage.id);
 const range=await request(video.url,'GET',null,parentCookie,{Range:'bytes=4-9'});assert.equal(range.status,206);assert.equal(range.headers.get('content-type'),'video/webm');assert.match(range.headers.get('cache-control'),/no-store/);assert.deepEqual(Buffer.from(await range.arrayBuffer()),bytes.subarray(4,10));
 assert.equal((await request(video.url,'GET',null,otherCookie,{Range:'bytes=4-9'})).status,404);
 assert.equal((await request('/api/chat/messages/'+first.id,'DELETE')).status,200);assert.equal((await request(media.url)).status,404);
});
