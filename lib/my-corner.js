"use strict";
const db = require('./db');
const crypto = require('./datacrypto');
const STICKERS = Object.freeze(['tuk-tuk', 'mango-sticky-rice', 'boba', 'monsoon-cloud', 'leaf-umbrella', 'small-star', 'sleepy-cat', 'happy-capybara', 'space-rocket', 'tiny-planet', 'rainbow', 'lucky-frog', 'bookworm', 'clever-fox', 'headphones', 'game-controller', 'roller-skate', 'sunshine', 'strawberry', 'ice-cream', 'pizza-slice', 'ocean-turtle', 'mountain', 'paper-plane', 'joyful-panda', 'brave-lion', 'calm-koala', 'worried-hedgehog', 'sad-penguin', 'angry-dragon', 'proud-peacock', 'curious-owl', 'shy-bunny', 'silly-monkey', 'tired-sloth', 'grateful-otter', 'focused-robot', 'study-pencil', 'reading-bear', 'painting-palette', 'dancing-dino', 'music-guitar', 'soccer-ball', 'basketball-hoop', 'swimming-dolphin', 'cycling-bunny', 'cooking-chef', 'gardening-sprout']);
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
}
function validate(value) {
  if (!exact(value, ['revision', 'note', 'stickers']) || !Number.isSafeInteger(value.revision) || value.revision < 0
      || typeof value.note !== 'string' || value.note.length > 240 || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value.note)
      || !Array.isArray(value.stickers) || value.stickers.length > 18) fail(400, 'Use a plain note up to 240 characters and at most 18 stickers.');
  const ids = new Set();
  for (const s of value.stickers) {
    if (!exact(s, ['id', 'stickerId', 'x', 'y', 'rotation']) || typeof s.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(s.id)
        || ids.has(s.id) || !STICKERS.includes(s.stickerId)
        || !Number.isFinite(s.x) || s.x < 0 || s.x > 1 || !Number.isFinite(s.y) || s.y < 0 || s.y > 1
        || !Number.isFinite(s.rotation) || s.rotation < -180 || s.rotation > 180) fail(400, 'Invalid sticker or placement.');
    ids.add(s.id);
  }
  return structuredClone(value);
}
function key() {
  const k = crypto.loadKey();
  if (!k) fail(503, 'My Corner is unavailable until encrypted storage is configured.');
  return k;
}
// Separate encrypted namespace: never part of users, families, notes or their exports.
function scope(familyId, kidId) { return JSON.stringify([familyId, kidId]); }
function read(familyId, kidId) {
  const k = key();
  const raw = db.load().fam_my_corners?.[scope(familyId, kidId)];
  return raw ? JSON.parse(crypto.decrypt(raw, k)) : { revision: 0, note: '', stickers: [] };
}
function save(familyId, kidId, input) {
  const value = validate(input);
  const previous = read(familyId, kidId);
  if (previous.revision !== value.revision) fail(409, 'Another client saved changes. Review the latest corner before saving again.');
  value.revision++;
  const root = db.load();
  const records = root.fam_my_corners ||= {};
  const id = scope(familyId, kidId);
  const old = records[id];
  records[id] = crypto.encrypt(JSON.stringify(value), key());
  db.persist();
  db.flushSync();
  if (db.persistenceStatus().lastWriteError) {
    if (old === undefined) delete records[id]; else records[id] = old;
    db.persist();
    fail(503, 'Could not save your corner. Your draft is still on this device; retry.');
  }
  return value;
}
module.exports = { read, save, validate, STICKERS };
