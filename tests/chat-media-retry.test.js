'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
process.env.FAM_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'fametc-media-retry-'));
process.env.DATA_ENCRYPTION_KEY=crypto.randomBytes(32).toString('hex');
const store=require('../lib/store'),family=require('../lib/family'),chat=require('../lib/chat'),attachments=require('../lib/chat-attachments'),sqlite=require('../lib/chat-store');
const parent=store.createUser('media@test.local','Parent');const fam=family.createFamily(parent.id,'Media test');
function command(overrides={}){return {senderType:'parent',senderId:parent.id,postedByUserId:parent.id,text:'A photo',clientMessageId:crypto.randomBytes(16).toString('hex'),...overrides};}
function photo(){return attachments.save({scopeKey:fam.id,uploaderUserId:parent.id,originalName:'photo.jpg',mimeType:'image/jpeg',buffer:Buffer.from('ffd8ffffe1','hex')});}
test('retry of a sent photo returns the original message, without losing its attachment or inserting twice',()=>{
 const meta=photo();const cmd=command({media:attachments.mediaFor(meta)});const first=chat.sendMessage(fam.id,cmd);
 assert.ok(first.message);const retry=chat.sendMessage(fam.id,cmd);
 assert.equal(retry.existing,true);assert.equal(retry.message.id,first.message.id);assert.equal(retry.message.media.attachmentId,meta.id);
 assert.equal(chat.listMessages(fam.id).filter(x=>x.id===first.message.id).length,1);
 assert.ok(!JSON.stringify(retry.message).includes('fingerprint'));
 assert.equal(chat.sendMessage(fam.id,{...cmd,text:'different command'}).status,409);
 chat.deleteMessage(fam.id,parent.id,first.message.id);
 assert.equal(chat.sendMessage(fam.id,cmd).message.deleted,true);assert.equal(attachments.readMeta(meta.id),null);
});
test('retry keys are actor and room scoped; invalid keys and invalid attachments fail explicitly',()=>{
 const cmd=command();const first=chat.sendMessage(fam.id,cmd);const other=store.createUser('other@test.local','Other');
 family.joinFamilyAsParent(fam.inviteCode,other.id);
 const second=chat.sendMessage(fam.id,{...cmd,senderId:other.id,postedByUserId:other.id});assert.notEqual(first.message.id,second.message.id);
 const otherFam=family.createFamily(parent.id,'Other family');const third=chat.sendMessage(otherFam.id,cmd);assert.notEqual(first.message.id,third.message.id);
 assert.equal(chat.sendMessage(fam.id,{...cmd,clientMessageId:'bad'}).status,400);
 assert.equal(chat.sendMessage(fam.id,command({media:{type:'attachment',attachmentId:'a_'+ '1'.repeat(36)}})).status,409);
});
test('failed message insert releases its claim, while a crash-era deterministic claim can be recovered',()=>{
 const meta=photo();const cmd=command({media:attachments.mediaFor(meta)});const original=sqlite.insert;
 try{sqlite.insert=()=>{throw new Error('injected database write failure');};assert.throws(()=>chat.sendMessage(fam.id,cmd),/injected/);}
 finally{sqlite.insert=original;}
 assert.equal(attachments.readMeta(meta.id).claimedMessageId,null);
 const id='m_'+crypto.createHash('sha256').update(JSON.stringify([fam.id,parent.id,'parent',parent.id,cmd.clientMessageId])).digest('hex').slice(0,18);
 attachments.claimForMessage(meta.id,fam.id,parent.id,id); // simulate crash just before message insert
 const recovered=chat.sendMessage(fam.id,cmd);assert.equal(recovered.message.id,id);assert.equal(recovered.message.media.attachmentId,meta.id);
 assert.equal(chat.sendMessage(fam.id,command({media:attachments.mediaFor(meta)})).status,409);
});
test('WebM is typed as video only with its EBML header and WebM DocType',()=>{
 const valid=Buffer.from('1a45dfa39f4282847765626d','hex');
 assert.equal(attachments.kindForMime('video/webm'),'video');assert.equal(attachments.magicMatches('video/webm',valid),true);
 assert.equal(attachments.magicMatches('video/webm',Buffer.from('1a45dfa300000000','hex')),false);
 assert.equal(attachments.magicMatches('video/webm',Buffer.from('not a video')),false);
});
test('request receipts are encrypted at rest with the chat body key',()=>{
 const cmd=command({text:'private retry receipt test'});chat.sendMessage(fam.id,cmd);sqlite._checkpointForTest();
 const raw=fs.readFileSync(sqlite.DB_FILE);
 const hash=crypto.createHash('sha256').update(JSON.stringify([cmd.text,null,null,false])).digest('hex');
 assert.ok(!raw.includes(Buffer.from(hash)));assert.ok(!raw.includes(Buffer.from(cmd.text)));
});
