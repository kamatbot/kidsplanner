'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { STICKERS, validate } = require('../lib/my-corner');
const native = fs.readFileSync(path.join(__dirname, '../ios/FamETC/Features/MyCorner/MyCornerModel.swift'), 'utf8');
test('all 48 stickers have bundled native assets and are accepted by the server', () => {
  assert.equal(STICKERS.length, 48);
  assert.equal(new Set(STICKERS).size, 48);
  for (const id of STICKERS) {
    assert.ok(native.includes(`"${id}"`), `native missing ${id}`);
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
test('My Corner and stickers are iOS-only: the web ships neither', () => {
  const root = path.join(__dirname, '..');
  assert.equal(fs.existsSync(path.join(root, 'public/js/my-corner.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'public/img/my-corner')), false);
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  assert.ok(!/my-corner/.test(html), 'index.html must not load My Corner');
});
