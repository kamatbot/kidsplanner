function satPlacementKey() {
  return `fam_sat_placement_done_${sessionUser ? sessionUser.id : 'anon'}`;
}

/* ---------- SAT word widget: vocabulary warm-up + word bank + pop quiz ---------- */
function renderSatActivity() {
  const w = currentSatWord;
  const container = document.getElementById('sat-activity');
  if (!w || !container) return;

  // PathOdds owns the real SAT Daily Quest. This local word activity is a
  // lightweight warm-up only and deliberately does not complete the SAT Daily 5
  // behavior slot; the PathOdds projection below is the source of truth.
  const wordLabel = document.querySelector('#widget-word .widget-label');
  if (wordLabel) wordLabel.textContent = 'Vocabulary warm-up';
  void loadPathOddsQuestWidget();

  // First-run placement step: "do you already know these?" — a native
  // <details> so it reads as a collapsed "Word bank →" line by default
  // instead of dominating the WORD section's height.
  const placementEl = document.getElementById('sat-placement');
  if (placementEl && !load(satPlacementKey())) {
    const sample = SAT_WORDS.slice(0, 6);
    placementEl.hidden = false;
    placementEl.innerHTML = `
      <summary class="fam-sat-placement-summary">Word bank →</summary>
      <div class="fam-sat-placement-title">Do you already know these words?</div>
      <div class="fam-sat-placement-list">
        ${sample.map((s) => `<label class="fam-sat-placement-item"><input type="checkbox" data-word="${esc(s.word)}"> ${esc(s.word)}</label>`).join('')}
      </div>
      <button type="button" class="btn-secondary" onclick="submitSatPlacement()">Continue</button>`;
  } else if (placementEl) {
    placementEl.hidden = true;
  }

  // Rotate today's activity by day-of-year % 3.
  const task = dayOfYear(new Date()) % 3;
  if (task === 0) {
    const wrongWord = SAT_WORDS[(SAT_WORDS.indexOf(w) + 5) % SAT_WORDS.length];
    const correctSentence = w.example;
    const wrongSentence = wrongWord.example.replace(new RegExp(wrongWord.word, 'i'), w.word);
    const options = Math.random() < 0.5 ? [correctSentence, wrongSentence] : [wrongSentence, correctSentence];
    container.innerHTML = `
      <div class="fam-sat-task-title">Which sentence uses "${esc(w.word)}" correctly?</div>
      <div class="fam-sat-options">
        ${options.map((s) => `<button type="button" class="fam-sat-opt" onclick="answerSatActivity(${s === correctSentence})">${esc(s)}</button>`).join('')}
      </div>
      <div class="fam-sat-feedback" id="sat-activity-feedback"></div>`;
  } else if (task === 1) {
    const others = SAT_WORDS.filter((s) => s.word !== w.word).sort(() => Math.random() - 0.5).slice(0, 3).map((s) => s.word);
    const options = [w.word, ...others].sort(() => Math.random() - 0.5);
    const blanked = w.example.replace(new RegExp(w.word, 'i'), '_____');
    container.innerHTML = `
      <div class="fam-sat-task-title">Fill in the blank: ${esc(blanked)}</div>
      <div class="fam-sat-options">
        ${options.map((opt) => `<button type="button" class="fam-sat-opt" onclick="answerSatActivity(${opt === w.word})">${esc(opt)}</button>`).join('')}
      </div>
      <div class="fam-sat-feedback" id="sat-activity-feedback"></div>`;
  } else {
    const others = SAT_WORDS.filter((s) => s.word !== w.word).sort(() => Math.random() - 0.5).slice(0, 3).map((s) => s.def);
    const options = [w.def, ...others].sort(() => Math.random() - 0.5);
    container.innerHTML = `
      <div class="fam-sat-task-title">Which is the definition of "${esc(w.word)}"?</div>
      <div class="fam-sat-options">
        ${options.map((opt) => `<button type="button" class="fam-sat-opt" onclick="answerSatActivity(${opt === w.def})">${esc(opt)}</button>`).join('')}
      </div>
      <div class="fam-sat-feedback" id="sat-activity-feedback"></div>`;
  }
}

function submitSatPlacement() {
  const checked = Array.from(document.querySelectorAll('#sat-placement input[type=checkbox]:checked')).map((el) => el.dataset.word);
  save(satPlacementKey(), true);
  const placementEl = document.getElementById('sat-placement');
  if (placementEl) placementEl.hidden = true;
  if (checked.length) {
    window.auth.wordBankPlacement(checked).then(() => loadWordBank()).catch(() => {});
  }
}

async function answerSatActivity(correct) {
  const btns = document.querySelectorAll('#sat-activity .fam-sat-opt');
  btns.forEach((b) => { b.disabled = true; });
  const fb = document.getElementById('sat-activity-feedback');
  if (fb) {
    fb.textContent = correct ? '✅ Warm-up complete!' : '❌ Not quite — keep it in your word bank.';
    fb.className = 'fam-sat-feedback ' + (correct ? 'correct' : 'wrong');
  }
  if (currentSatWord) {
    try {
      const res = await window.auth.wordBankInteract(currentSatWord.word, correct);
      if (res && res.entry) mergeWordBankEntry(res.entry);
    } catch (e) { /* best effort */ }
  }
}

function mergeWordBankEntry(entry) {
  const idx = wordBankState.words.findIndex((w) => w.word === entry.word);
  if (idx >= 0) wordBankState.words[idx] = entry;
  else wordBankState.words.push(entry);
  renderWordBankPanel();
  updateQuizButtonState();
}

async function loadWordBank() {
  try {
    const res = await window.auth.getWordBank();
    wordBankState = { words: (res && res.words) || [], stats: (res && res.stats) || { learning: 0, mastered: 0, known: 0 } };
  } catch (e) {
    wordBankState = { words: [], stats: { learning: 0, mastered: 0, known: 0 } };
  }
  renderWordBankPanel();
  updateQuizButtonState();
}

function toggleWordBank() {
  const panel = document.getElementById('sat-wordbank-panel');
  if (!panel) return;
  panel.hidden = !panel.hidden;
  if (!panel.hidden) renderWordBankPanel();
}

function renderWordBankPanel() {
  const panel = document.getElementById('sat-wordbank-panel');
  if (!panel) return;
  const s = wordBankState.stats || {};
  const header = `<div class="fam-wb-stats">Learning: ${s.learning || 0} · Mastered: ${s.mastered || 0} · Known: ${s.known || 0}</div>`;
  if (!wordBankState.words.length) {
    panel.innerHTML = header + '<p class="text-muted">No words banked yet — answer today\'s warm-up to get started!</p>';
    return;
  }
  const rows = wordBankState.words.map((w) => {
    const stateLabel = w.state === 'mastered' ? '⭐ Mastered' : w.state === 'known' ? '✅ Known' : `📖 Learning (${w.correctCount || 0}/3)`;
    return `<div class="fam-wb-row"><span class="fam-wb-word">${esc(w.word)}</span><span class="fam-wb-state">${stateLabel}</span></div>`;
  }).join('');
  panel.innerHTML = header + rows;
}

function updateQuizButtonState() {
  const btn = document.getElementById('sat-quiz-btn');
  if (!btn) return;
  const quizzable = wordBankState.words.filter((w) => w.state === 'mastered' || w.state === 'known' || w.seenCount).length;
  btn.disabled = quizzable < 2;
}

async function startWordQuiz() {
  const panel = document.getElementById('sat-quiz-panel');
  if (!panel) return;
  try {
    const res = await window.auth.wordBankQuiz(5);
    wordQuizState = { questions: (res && res.questions) || [], index: 0 };
    if (res && res.needMore) {
      panel.hidden = false;
      panel.innerHTML = '<p class="text-muted">Answer a few more warm-ups first to unlock the pop quiz!</p>';
      return;
    }
  } catch (e) {
    wordQuizState = { questions: [], index: 0 };
    panel.hidden = false;
    panel.innerHTML = '<p class="text-muted">Pop quiz isn\'t available right now — try again soon.</p>';
    return;
  }
  panel.hidden = false;
  renderWordQuizQuestion();
}

function renderWordQuizQuestion() {
  const panel = document.getElementById('sat-quiz-panel');
  if (!panel) return;
  const { questions, index } = wordQuizState;
  if (!questions.length) {
    panel.innerHTML = '<p class="text-muted">No quiz questions yet — keep working on the vocabulary warm-up!</p>';
    return;
  }
  if (index >= questions.length) {
    panel.innerHTML = '<p class="fam-wb-quiz-done">🎉 Pop quiz complete — great work!</p>';
    return;
  }
  const q = questions[index];
  panel.innerHTML = `
    <div class="fam-wb-quiz-progress">${index + 1}/${questions.length}</div>
    <div class="fam-wb-quiz-prompt">${esc(q.prompt)}</div>
    <div class="fam-sat-options">
      ${q.options.map((opt, i) => `<button type="button" class="fam-sat-opt" onclick="answerWordQuiz(${i})">${esc(opt)}</button>`).join('')}
    </div>
    <div class="fam-sat-feedback" id="word-quiz-feedback"></div>`;
}

async function answerWordQuiz(chosenIndex) {
  const { questions, index } = wordQuizState;
  const q = questions[index];
  const correct = chosenIndex === q.answerIndex;
  const btns = document.querySelectorAll('#sat-quiz-panel .fam-sat-opt');
  btns.forEach((b, i) => {
    b.disabled = true;
    if (i === q.answerIndex) b.classList.add('correct');
    else if (i === chosenIndex) b.classList.add('wrong');
  });
  const fb = document.getElementById('word-quiz-feedback');
  if (fb) { fb.textContent = correct ? '✅ Correct!' : '❌ Not quite.'; fb.className = 'fam-sat-feedback ' + (correct ? 'correct' : 'wrong'); }
  try {
    const res = await window.auth.wordBankInteract(q.word, correct);
    if (res && res.entry) mergeWordBankEntry(res.entry);
  } catch (e) { /* best effort */ }
  setTimeout(() => {
    wordQuizState.index++;
    renderWordQuizQuestion();
  }, 1000);
}

async function handlePinSatWord() {
  if (!currentSatWord) return;
  const w = currentSatWord;
  const full = `${w.word} (${w.pos}) — ${w.def}\n\nExample: ${w.example}`;
  await saveNoteFromWidget(full, 'sat', { kind: 'sat', id: w.word, context: full });
}

/* ============================================================
   PATHODDS DAILY QUEST — projection only, deep work stays in PathOdds
============================================================ */
let pathOddsLoading = false;
let pathOddsLastLoadedAt = 0;

function ensurePathOddsStyles() {
  if (document.getElementById('pathodds-integration-styles')) return;
  const style = document.createElement('style');
  style.id = 'pathodds-integration-styles';
  style.textContent = `
    .fam-pathodds-card{border:1px solid color-mix(in srgb,var(--border,#ddd) 76%,#6c63ff 24%);background:linear-gradient(135deg,color-mix(in srgb,var(--card,#fff) 96%,#6c63ff 4%),var(--card,#fff));padding:16px;border-radius:16px;margin-bottom:12px}
    .fam-pathodds-card .po-head{display:flex;align-items:center;gap:8px;margin-bottom:10px}.fam-pathodds-card .po-mark{display:grid;place-items:center;width:28px;height:28px;border-radius:9px;background:#17151f;color:#fff;font-size:13px;font-weight:800}.fam-pathodds-card .po-label{font-size:12px;font-weight:800;letter-spacing:.05em;text-transform:uppercase}.fam-pathodds-card .po-spacer{flex:1}.fam-pathodds-card .po-streak{font-size:12px;font-weight:700;color:var(--text-2,#666)}
    .fam-pathodds-card h4{font-size:17px;margin:0 0 5px}.fam-pathodds-card p{margin:0;color:var(--text-2,#666);font-size:13px;line-height:1.45}.fam-pathodds-card .po-progress{height:7px;background:var(--surface-2,#ecebe8);border-radius:99px;overflow:hidden;margin:12px 0 6px}.fam-pathodds-card .po-progress>span{display:block;height:100%;background:currentColor;border-radius:inherit}.fam-pathodds-card .po-meta{font-size:11px;color:var(--text-2,#777);margin:0 0 12px}.fam-pathodds-card .po-actions{display:flex;gap:8px;align-items:center;margin-top:12px}.fam-pathodds-card .po-actions button,.fam-pathodds-card .po-actions a{flex:0 0 auto}.fam-pathodds-card.is-complete{border-color:color-mix(in srgb,#2f9d68 45%,var(--border,#ddd))}
    .fam-pathodds-family{display:grid;gap:8px;margin-top:10px}.fam-pathodds-kid{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 10px;align-items:center;padding:10px;border-radius:12px;background:var(--surface-2,#f5f4f2)}.fam-pathodds-kid strong{font-size:13px}.fam-pathodds-kid span{font-size:12px;color:var(--text-2,#666)}.fam-pathodds-kid em{font-style:normal;font-size:12px;font-weight:750;grid-row:1/3;grid-column:2}.fam-pathodds-unavailable{opacity:.78}
  `;
  document.head.appendChild(style);
}

function ensurePathOddsCard() {
  const wordWidget = document.getElementById('widget-word');
  if (!wordWidget || !wordWidget.parentNode) return null;
  let card = document.getElementById('widget-pathodds');
  if (!card) {
    ensurePathOddsStyles();
    card = document.createElement('div');
    card.id = 'widget-pathodds';
    card.className = 'fam-pathodds-card';
    wordWidget.parentNode.insertBefore(card, wordWidget);
  }
  return card;
}

async function pathOddsFetch(url, options) {
  const response = await fetch(url, Object.assign({ credentials: 'same-origin', headers: { 'content-type': 'application/json' } }, options || {}));
  let payload = null;
  try { payload = await response.json(); } catch (e) { /* no json */ }
  if (!response.ok) {
    const error = new Error((payload && payload.error) || `Request failed (${response.status})`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function pathOddsStateCopy(state) {
  if (!state) return { title: 'PathOdds SAT', detail: 'Your adaptive SAT plan lives in PathOdds.', cta: 'Open PathOdds' };
  if (state.readiness === 'setup-required') return { title: 'Set up SAT prep', detail: 'Choose a target score and study schedule so PathOdds can build your plan.', cta: 'Finish setup' };
  if (state.readiness === 'diagnostic-required') return { title: 'Build your SAT baseline', detail: 'Complete the diagnostic before PathOdds starts adapting your daily quests.', cta: 'Start diagnostic' };
  if (state.readiness === 'completed') return { title: 'SAT Quest complete', detail: `You’re done for today${state.xpEarned ? ` · +${state.xpEarned} XP` : ''}.`, cta: 'View progress' };
  if (state.readiness === 'in-progress') return { title: 'Continue today’s SAT Quest', detail: `${state.answered || 0} of ${state.total || 11} complete${state.estimatedMinutes ? ` · ${state.estimatedMinutes} min plan` : ''}.`, cta: 'Continue quest' };
  return { title: 'Today’s SAT Quest', detail: `${state.estimatedMinutes || 15} focused minutes · ${state.total || 11} questions · Review → Focus → Mix → Sprint`, cta: 'Start quest' };
}

function renderPathOddsSelf(payload) {
  const card = ensurePathOddsCard();
  if (!card) return;
  if (!payload || payload.linked === false) {
    card.className = 'fam-pathodds-card';
    card.innerHTML = `
      <div class="po-head"><span class="po-mark">P</span><span class="po-label">PathOdds SAT</span></div>
      <h4>Connect your daily SAT plan</h4>
      <p>FamETC keeps the habit visible. PathOdds does the diagnostic, adaptive practice and deep work.</p>
      <div class="po-actions"><a class="btn-primary" href="${esc((payload && payload.linkUrl) || 'https://www.pathodds.com/api/auth/fametc/start')}">Connect PathOdds</a></div>`;
    return;
  }
  const snapshot = payload.snapshot;
  const state = snapshot && snapshot.state;
  const copy = pathOddsStateCopy(state);
  const total = Math.max(1, state && state.total || 11);
  const answered = Math.min(total, state && state.answered || 0);
  const percent = state && state.readiness === 'completed' ? 100 : Math.round((answered / total) * 100);
  const streak = state && state.currentStreak ? `${state.currentStreak}d SAT streak` : '';
  const route = snapshot && snapshot.action && snapshot.action.route || 'sat.home';
  card.className = `fam-pathodds-card${state && state.readiness === 'completed' ? ' is-complete' : ''}`;
  card.innerHTML = `
    <div class="po-head"><span class="po-mark">P</span><span class="po-label">PathOdds SAT</span><span class="po-spacer"></span><span class="po-streak">${esc(streak)}</span></div>
    <h4>${esc(copy.title)}</h4><p>${esc(copy.detail)}</p>
    ${(state && ['ready','in-progress','completed'].includes(state.readiness)) ? `<div class="po-progress"><span style="width:${percent}%"></span></div><div class="po-meta">${answered}/${total} questions${state.xpAvailable ? ` · ${state.xpAvailable} XP available` : ''}</div>` : ''}
    <div class="po-actions"><button type="button" class="btn-primary" onclick="launchPathOdds('${esc(route)}')">${esc(copy.cta)}</button></div>`;
  if (state && state.readiness === 'completed' && typeof markDaily5Done === 'function') {
    try { markDaily5Done('sat'); } catch (e) { /* Daily 5 is independent presentation state */ }
  }
}

function parentPathOddsStatus(result) {
  if (!result || result.status === 'rejected') return 'Status unavailable';
  const payload = result.value;
  if (!payload || payload.linked === false) return 'Not connected';
  const state = payload.snapshot && payload.snapshot.state;
  if (!state) return 'Connected';
  if (state.readiness === 'completed') return 'Complete';
  if (state.readiness === 'in-progress') return `${state.answered || 0}/${state.total || 11} complete`;
  if (state.readiness === 'setup-required') return 'Setup needed';
  if (state.readiness === 'diagnostic-required') return 'Diagnostic needed';
  return 'Ready today';
}

function parentPathOddsAction(result) {
  const payload = result && result.status === 'fulfilled' ? result.value : null;
  if (!payload || payload.linked === false) {
    return `<a class="btn-primary" href="${esc((payload && payload.linkUrl) || 'https://www.pathodds.com/api/auth/fametc/start?route=sat.home')}">Connect my PathOdds</a>`;
  }
  const route = payload.snapshot && payload.snapshot.action && payload.snapshot.action.route || 'sat.home';
  return `<button type="button" class="btn-primary" onclick="launchPathOdds('${esc(route)}')">Open my PathOdds</button>`;
}

async function renderPathOddsFamily() {
  const card = ensurePathOddsCard();
  if (!card) return;
  const kids = currentFamily && Array.isArray(currentFamily.kids) ? currentFamily.kids : [];
  card.className = 'fam-pathodds-card';
  card.innerHTML = `<div class="po-head"><span class="po-mark">P</span><span class="po-label">PathOdds SAT</span></div><h4>PathOdds for your family</h4><p>Connect your own plan, and keep each child’s SAT progress visible here.</p><div class="po-actions"><span class="text-muted">Loading…</span></div><div class="fam-pathodds-family"><span class="text-muted">Loading…</span></div>`;
  const [ownResult, ...kidResults] = await Promise.allSettled([
    pathOddsFetch('/api/pathodds/today'),
    ...kids.map((kid) => pathOddsFetch(`/api/pathodds/today?kidId=${encodeURIComponent(kid.id)}`))
  ]);
  card.querySelector('.po-actions').innerHTML = parentPathOddsAction(ownResult);
  card.querySelector('.fam-pathodds-family').innerHTML = kids.length ? kids.map((kid, index) => {
    const status = parentPathOddsStatus(kidResults[index]);
    return `<div class="fam-pathodds-kid"><strong>${esc(kid.name || 'Kid')}</strong><span>PathOdds SAT</span><em>${esc(status)}</em></div>`;
  }).join('') : '<span class="text-muted">Add a kid profile to track their daily PathOdds habit here.</span>';
}

async function loadPathOddsQuestWidget(force) {
  const card = ensurePathOddsCard();
  if (!card || !sessionUser) return;
  if (pathOddsLoading) return;
  if (!force && Date.now() - pathOddsLastLoadedAt < 30_000) return;
  pathOddsLoading = true;
  try {
    if (sessionUser.role === 'kid') {
      const payload = await pathOddsFetch('/api/pathodds/today');
      renderPathOddsSelf(payload);
    } else {
      await renderPathOddsFamily();
    }
    pathOddsLastLoadedAt = Date.now();
  } catch (error) {
    card.className = 'fam-pathodds-card fam-pathodds-unavailable';
    card.innerHTML = `<div class="po-head"><span class="po-mark">P</span><span class="po-label">PathOdds SAT</span></div><h4>Status temporarily unavailable</h4><p>Your family dashboard still works. Retry the PathOdds status when you’re ready.</p><div class="po-actions"><button type="button" class="btn-secondary" onclick="loadPathOddsQuestWidget(true)">Retry</button></div>`;
  } finally {
    pathOddsLoading = false;
  }
}

async function launchPathOdds(route) {
  try {
    const payload = await pathOddsFetch('/api/pathodds/launch', { method: 'POST', body: JSON.stringify({ route: route || 'sat.home' }) });
    if (!payload || !payload.launchUrl) throw new Error('PathOdds did not return a launch URL.');
    location.href = payload.launchUrl;
  } catch (error) {
    if (error && error.payload && error.payload.linkUrl) {
      location.href = error.payload.linkUrl;
      return;
    }
    const card = ensurePathOddsCard();
    if (card) {
      const message = card.querySelector('.po-meta') || document.createElement('div');
      message.className = 'po-meta';
      message.textContent = 'Could not open PathOdds right now. Please try again.';
      if (!message.parentNode) card.appendChild(message);
    }
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void loadPathOddsQuestWidget(true);
});
