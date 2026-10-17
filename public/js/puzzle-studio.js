/* Pure circuit rules are shared by the UI and focused Node tests. Practice is
   deliberately transient: no completion, streak, reward or storage writes. */
(function (root) {
  'use strict';
  const SIZE = 4;
  const directions = [[-1, 0], [0, 1], [1, 0], [0, -1]];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function ports(tile, turn = tile.turn) {
    return (tile.kind === 'straight' ? [0, 2] : [0, 1]).map(p => (p + turn) % 4);
  }
  function neighbor(index, direction) {
    const row = Math.floor(index / SIZE) + directions[direction][0];
    const col = index % SIZE + directions[direction][1];
    return row < 0 || row >= SIZE || col < 0 || col >= SIZE ? -1 : row * SIZE + col;
  }
  function trace(tiles) {
    const powered = new Set();
    if (tiles.length !== SIZE * SIZE || !ports(tiles[0]).includes(3)) return { powered, solved: false };
    const queue = [0];
    while (queue.length) {
      const index = queue.shift();
      if (powered.has(index)) continue;
      powered.add(index);
      for (const direction of ports(tiles[index])) {
        const next = neighbor(index, direction);
        if (next >= 0 && ports(tiles[next]).includes((direction + 2) % 4) && !powered.has(next)) queue.push(next);
      }
    }
    return { powered, solved: powered.has(15) && ports(tiles[15]).includes(1) };
  }
  function makeCircuit(seed = 1) {
    let state = (Number(seed) >>> 0) || 1;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    const path = [0], visited = new Set(path);
    function walk(index) {
      if (index === 15) return true;
      const choices = directions.map((_, d) => neighbor(index, d)).filter(n => n >= 0 && !visited.has(n));
      for (let i = choices.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [choices[i], choices[j]] = [choices[j], choices[i]]; }
      for (const next of choices) {
        visited.add(next); path.push(next);
        if (walk(next)) return true;
        visited.delete(next); path.pop();
      }
      return false;
    }
    walk(0);
    const tiles = Array.from({ length: 16 }, () => ({ kind: random() < .5 ? 'curve' : 'straight', turn: Math.floor(random() * 4), solution: 0 }));
    path.forEach((index, position) => {
      const from = position ? directions.findIndex((_, d) => neighbor(index, d) === path[position - 1]) : 3;
      const to = position < path.length - 1 ? directions.findIndex((_, d) => neighbor(index, d) === path[position + 1]) : 1;
      const tile = tiles[index];
      tile.kind = (from + 2) % 4 === to ? 'straight' : 'curve';
      tile.solution = [0, 1, 2, 3].find(turn => { const ps = ports(tile, turn); return ps.includes(from) && ps.includes(to); });
    });
    while (trace(tiles).solved) tiles[0].turn = (tiles[0].turn + 1) % 4;
    return { tiles, path };
  }
  const arrow = { north: 0, east: 90, south: 180, west: 270, up: 0, right: 90, down: 180, left: 270 };
  function itemMarkup(item) {
    const key = String(item).toLowerCase();
    const shapes = { circle: '<circle cx="24" cy="24" r="14"/>', square: '<rect x="11" y="11" width="26" height="26" rx="3"/>', triangle: '<path d="M24 8 41 38H7Z"/>', diamond: '<path d="M24 6 42 24 24 42 6 24Z"/>', star: '<path d="m24 5 6 12 13 2-10 10 2 14-11-7-12 7 3-14L5 19l13-2Z"/>' };
    if (Object.hasOwn(shapes, key)) return `<svg viewBox="0 0 48 48" aria-hidden="true">${shapes[key]}</svg>`;
    if (Object.hasOwn(arrow, key)) return `<svg viewBox="0 0 48 48" aria-hidden="true" style="transform:rotate(${arrow[key]}deg)"><path d="M24 39V9M12 21 24 9l12 12" fill="none"/></svg>`;
    return `<span>${escape(String(item).slice(0, 64))}</span>`;
  }
  function visualMarkup(visual) {
    if (!visual || !['sequence', 'balance', 'path', 'rotation'].includes(visual.kind) || !Array.isArray(visual.items)) return '';
    const items = visual.items.slice(0, 25);
    const columns = Number.isInteger(visual.columns) && visual.columns >= 2 && visual.columns <= 5 ? visual.columns : 0;
    return `<figure class="reasoning-visual reasoning-${visual.kind}" role="img" aria-label="${escape(visual.alt)}"><div class="reasoning-items${columns ? ' reasoning-matrix' : ''}"${columns ? ` style="--visual-columns:${columns}"` : ''} aria-hidden="true">${items.map((item) => `<span class="reasoning-piece${['wall', 'blocked'].includes(String(item).toLowerCase()) ? ' reasoning-wall' : ''}">${itemMarkup(item)}</span>`).join('')}</div></figure>`;
  }
  const api = { makeCircuit, trace, ports, visualMarkup };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root.document) return;
  let host, scope = '', getScope = () => '', generation = 0, abort, board, initial, seed = 1, moves = 0;
  let questions = [], questionIndex = 0, answered = false;
  function cancel() { generation++; abort?.abort(); abort = null; }
  function setScope(next) {
    if (scope === next) return;
    scope = next; cancel(); questions = []; questionIndex = 0; board = null;
    if (host) { host.open = false; const content = host.querySelector('.puzzle-studio-content'); if (content) content.replaceChildren(); }
  }
  function renderShell() {
    host.querySelector('.puzzle-studio-content').innerHTML = `<div class="practice-mode" role="group" aria-label="Practice game"><button type="button" data-game="circuit" aria-pressed="true">Circuit trail</button><button type="button" data-game="reasoning" aria-pressed="false">Visual reasoning</button></div><div class="practice-stage"></div>`;
  }
  function circuit(focusBoard = false) {
    cancel();
    const generated = makeCircuit(seed);
    board = generated; initial = board.tiles.map(t => t.turn); moves = 0;
    host.querySelector('.practice-stage').innerHTML = `<div class="circuit-layout"><div class="circuit-board" role="group" aria-label="Circuit trail, four rows and four columns">${board.tiles.map((tile, i) => `<button type="button" class="circuit-tile" data-tile="${i}" style="--turn:${tile.turn * 90}deg"><svg viewBox="0 0 64 64" aria-hidden="true"><path class="circuit-track" d="${tile.kind === 'straight' ? 'M32 0V64' : 'M32 0V22Q32 32 42 32H64'}"/></svg>${i === 0 ? '<span class="circuit-terminal">IN</span>' : i === 15 ? '<span class="circuit-terminal">OUT</span>' : ''}</button>`).join('')}</div><div class="circuit-guide"><h3>Make a little connection.</h3><p>Turn the tiles to carry the light from <strong>IN</strong> to <strong>OUT</strong>. Every turn changes the path.</p><p class="practice-caption">No clock. No points. Just a good idea.</p><p class="practice-status" role="status" aria-live="polite"></p><div class="practice-actions"><button type="button" data-action="hint">Show a hint</button><button type="button" data-action="reset">Start over</button><button type="button" data-action="new">New circuit</button></div></div></div>`;
    paintCircuit();
    if (focusBoard) host.querySelector('[data-tile="0"]')?.focus();
  }
  function paintCircuit() {
    const state = trace(board.tiles);
    host.querySelectorAll('[data-tile]').forEach(button => {
      const i = Number(button.dataset.tile), tile = board.tiles[i];
      button.style.setProperty('--turn', `${tile.turn * 90}deg`);
      button.classList.toggle('is-powered', state.powered.has(i));
      button.setAttribute('aria-label', `Row ${Math.floor(i / 4) + 1}, column ${i % 4 + 1}. ${ports(tile).map(p => ['up', 'right', 'down', 'left'][p]).join(' and ')}. ${state.powered.has(i) ? 'Connected to IN. ' : ''}Rotate clockwise.`);
    });
    host.querySelector('.circuit-board').classList.toggle('is-complete', state.solved);
    host.querySelector('.practice-status').textContent = state.solved ? `Connected! You found a path in ${moves} turns. Try another circuit when you're ready.` : `${moves} turns · ${state.powered.size} tiles connected`;
  }
  async function reasoning(focusResult = false) {
    cancel();
    const current = generation, account = getScope();
    const stage = host.querySelector('.practice-stage');
    stage.innerHTML = '<p role="status">Finding a fresh set of ideas…</p>';
    abort = new AbortController();
    try {
      const response = await fetch('/api/brainteaser/practice?count=6', { credentials: 'same-origin', signal: abort.signal });
      if (!response.ok) throw new Error('Practice unavailable');
      const result = await response.json();
      if (current !== generation || account !== getScope() || !host.open) return;
      questions = (result.questions || []).filter(q => typeof q.q === 'string' && Array.isArray(q.options) && q.options.length === 4 && q.options.every(o => typeof o === 'string') && Number.isInteger(q.answerIndex) && q.answerIndex >= 0 && q.answerIndex < 4);
      questionIndex = 0;
      if (!questions.length) throw new Error('No questions');
      paintQuestion(focusResult);
    } catch (error) {
      if (current !== generation || account !== getScope() || error.name === 'AbortError') return;
      stage.innerHTML = '<p role="status">Practice couldn’t load. Your daily progress is untouched.</p><button type="button" data-action="retry">Try again</button>';
      if (focusResult) stage.querySelector('[data-action="retry"]').focus();
    }
  }
  function paintQuestion(focusQuestion = false) {
    answered = false;
    const q = questions[questionIndex];
    host.querySelector('.practice-stage').innerHTML = `<div class="practice-reasoning"><p class="practice-caption">Idea ${questionIndex + 1} of ${questions.length} · just for practice</p>${visualMarkup(q.visual)}<h3 class="practice-question" tabindex="-1">${escape(q.q)}</h3><div class="practice-options">${q.options.map((option, i) => `<button type="button" data-choice="${i}"><span>${String.fromCharCode(65 + i)}</span>${escape(option)}</button>`).join('')}</div><p class="practice-feedback" role="status" aria-live="polite"></p><button type="button" data-action="next" hidden>${questionIndex === questions.length - 1 ? 'Try a fresh set' : 'Next idea'}</button></div>`;
    if (focusQuestion) host.querySelector('.practice-question').focus();
  }
  function onClick(event) {
    if (!scope || getScope() !== scope) { setScope(getScope()); return; }
    const button = event.target.closest('button');
    if (!button || !host.contains(button)) return;
    if (button.dataset.game) {
      host.querySelectorAll('[data-game]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
      button.dataset.game === 'circuit' ? circuit() : reasoning(); return;
    }
    if (button.dataset.tile != null && board) {
      board.tiles[Number(button.dataset.tile)].turn++; moves++;
      host.querySelectorAll('.is-hint').forEach(b => b.classList.remove('is-hint'));
      paintCircuit(); return;
    }
    if (button.dataset.choice != null && !answered) {
      answered = true;
      const q = questions[questionIndex], choice = Number(button.dataset.choice);
      host.querySelectorAll('[data-choice]').forEach(b => { b.disabled = true; b.classList.toggle('is-correct', Number(b.dataset.choice) === q.answerIndex); b.classList.toggle('is-incorrect', b === button && choice !== q.answerIndex); });
      host.querySelector('.practice-feedback').textContent = `${choice === q.answerIndex ? 'You spotted it.' : 'A new way to see it.'} ${q.exp || ''}`;
      host.querySelector('[data-action="next"]').hidden = false; return;
    }
    switch (button.dataset.action) {
      case 'new': seed++; circuit(true); break;
      case 'reset': board.tiles.forEach((t, i) => { t.turn = initial[i]; }); moves = 0; paintCircuit(); break;
      case 'hint': {
        const index = board.path.find(i => ports(board.tiles[i]).slice().sort().join() !== ports(board.tiles[i], board.tiles[i].solution).slice().sort().join());
        if (index != null) { host.querySelector(`[data-tile="${index}"]`).classList.add('is-hint'); host.querySelector('.practice-status').textContent = `Try turning row ${Math.floor(index / 4) + 1}, column ${index % 4 + 1}.`; }
        break;
      }
      case 'retry': reasoning(true); break;
      case 'next': if (++questionIndex >= questions.length) reasoning(true); else paintQuestion(true); break;
    }
  }
  function mount(element, scopeGetter) {
    if (!element || host === element) return;
    host = element; getScope = scopeGetter;
    setScope(getScope());
    host.addEventListener('click', onClick);
    host.addEventListener('toggle', () => {
      if (!host.open) { cancel(); return; }
      if (!getScope() || getScope() !== scope) { setScope(getScope()); return; }
      renderShell(); circuit();
    });
  }
  root.famPuzzleStudio = { ...api, mount, setScope };
})(typeof window !== 'undefined' ? window : globalThis);
