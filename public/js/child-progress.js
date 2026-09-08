(function () {
  'use strict';
  const parts = new Set(['news', 'word', 'puzzle', 'bt', 'quote']);
  let active = null;

  function scope() {
    if (typeof sessionUser === 'undefined' || typeof currentFamily === 'undefined' ||
        typeof isKidSession !== 'function' || !isKidSession() || !sessionUser.id ||
        !sessionUser.kidId || !currentFamily?.id) return null;
    return JSON.stringify([sessionUser.id, currentFamily.id, sessionUser.kidId, isoDate(new Date())]);
  }

  function current(state) {
    return active === state && scope() === state.key;
  }

  async function drain(state) {
    if (state.running || !current(state)) return;
    state.running = true;
    try {
      while (state.queue.length && current(state)) {
        const event = state.queue.shift();
        try {
          // Refresh before an ordinary start so opening a finished activity on
          // another device cannot retract its saved completion.
          if (event.status === 'started' && !event.reset) {
            if (!current(state)) return;
            const saved = await window.auth.getDaily5Progress(state.date);
            if (!current(state)) return;
            if (saved?.parts?.[event.part]?.status === 'completed') continue;
          }
          if (!current(state)) return;
          await window.auth.reportDaily5Progress({ date: state.date, part: event.part, status: event.status });
          if (!current(state)) return;
        } catch (_) {
          if (current(state)) state.queue.unshift(event);
          // Retry only on another report or online event, never in a loop.
          return;
        }
      }
    } finally {
      state.running = false;
    }
  }

  function report(part, status, { reset = false } = {}) {
    const key = scope();
    if (!key) { active = null; return Promise.resolve(); }
    if (!parts.has(part) || !['started', 'completed'].includes(status) ||
        (reset && (part !== 'puzzle' || status !== 'started'))) return Promise.resolve();
    if (!active || active.key !== key) active = { key, date: JSON.parse(key)[3], queue: [], running: false };
    // At most one pending intent per part (plus one failed/in-flight event).
    // Ordinary starts preserve a queued completion; explicit resets replace it.
    const pending = active.queue.findLast(event => event.part === part);
    if (!pending) active.queue.push({ part, status, reset });
    else if (status === 'completed' || reset) Object.assign(pending, { status, reset });
    return drain(active);
  }

  window.famChildProgress = { report, clear() { active = null; } };
  window.addEventListener('online', () => { if (active) void drain(active); });
})();
