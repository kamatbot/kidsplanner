'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { STICKERS, validate } = require('../lib/my-corner');
const web = fs.readFileSync(path.join(__dirname, '../public/js/my-corner.js'), 'utf8');
const native = fs.readFileSync(path.join(__dirname, '../ios/FamETC/Features/MyCorner/MyCornerModel.swift'), 'utf8');
test('all 24 stickers have web and bundled native assets and are accepted by the server', () => {
  assert.equal(STICKERS.length, 24);
  assert.equal(new Set(STICKERS).size, 24);
  for (const [i, id] of STICKERS.entries()) {
    assert.ok(web.includes(`'${id}'`), `web missing ${id}`);
    assert.ok(native.includes(`"${id}"`), `native missing ${id}`);
    assert.ok(fs.existsSync(path.join(__dirname, `../public/img/my-corner/${id}.${i < 6 ? 'svg' : 'png'}`)), `web asset missing ${id}`);
    const assets = path.join(__dirname, `../ios/FamETC/Assets.xcassets/Corner-${id}.imageset`);
    assert.ok(fs.existsSync(path.join(assets, 'sticker.png')), `native asset missing ${id}`);
    const contents = JSON.parse(fs.readFileSync(path.join(assets, 'Contents.json'), 'utf8'));
    assert.ok(contents.images.some(image => image.filename === 'sticker.png'));
    const doc = {revision:0,note:'',stickers:[{id:'one',stickerId:id,x:0.5,y:0.5,rotation:0}]};
    assert.deepEqual(validate(doc),doc);
  }
});
test('larger collection preserves the 18-placement limit and rejects arbitrary assets', () => {
  const doc={revision:0,note:'',stickers:Array.from({length:18},(_,i)=>({id:`s-${i}`,stickerId:STICKERS[i],x:0.5,y:0.5,rotation:0}))};
  assert.equal(validate(doc).stickers.length,18);
  assert.throws(()=>validate({...doc,stickers:[...doc.stickers,{...doc.stickers[0],id:'extra'}]}),{status:400});
  assert.throws(()=>validate({...doc,stickers:[{...doc.stickers[0],stickerId:'../private'}]}),{status:400});
});
