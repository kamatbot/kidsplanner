(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FamChatWidth = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DEFAULT_WIDTH = 360;
  const MIN_WIDTH = 296;
  const MAX_WIDTH = 520;
  const STEP = 16;
  const STORAGE_PREFIX = 'fam_chat_dock_width_';

  function finiteNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || value.trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function clamp(value) {
    const numeric = finiteNumber(value);
    if (numeric === null) return DEFAULT_WIDTH;
    return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(numeric)));
  }

  function storageKey(userId) {
    const scope = userId === null || userId === undefined || userId === ''
      ? 'anon'
      : encodeURIComponent(String(userId));
    return `${STORAGE_PREFIX}${scope}`;
  }

  function read(storage, userId) {
    if (!storage || typeof storage.getItem !== 'function') return DEFAULT_WIDTH;
    let raw;
    try {
      raw = storage.getItem(storageKey(userId));
    } catch (e) {
      return DEFAULT_WIDTH;
    }
    if (raw === null || raw === undefined) return DEFAULT_WIDTH;

    let value = raw;
    try { value = JSON.parse(raw); } catch (e) { /* old/plain values are normalized below */ }
    return clamp(value);
  }

  function write(storage, userId, value) {
    const width = clamp(value);
    if (storage && typeof storage.setItem === 'function') {
      try { storage.setItem(storageKey(userId), JSON.stringify(width)); } catch (e) { /* best effort */ }
    }
    return width;
  }

  return Object.freeze({
    DEFAULT_WIDTH,
    MIN_WIDTH,
    MAX_WIDTH,
    STEP,
    STORAGE_PREFIX,
    clamp,
    read,
    storageKey,
    write,
  });
});
