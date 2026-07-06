function satPlacementKey() {
  return `fam_sat_placement_done_${sessionUser ? sessionUser.id : 'anon'}`;
}

/* ---------- SAT word widget: daily activity + word bank + pop quiz ---------- */
function renderSatActivity() {
  const w = currentSatWord;
  const container = document.getElementById('sat-activity');
  if (!w || !container) return;

  // First-run placement step: "do you already know these?"
  const placementEl = document.getElementById('sat-placement');
  if (placementEl && !load(satPlacementKey())) {
    const sample = SAT_WORDS.slice(0, 6);
    placementEl.hidden = false;
    placementEl.innerHTML = `
      <div class="fam-sat-placement-title">Do you already know these words?</div>
      <div class="fam-sat-placement-list">
        ${sample.map((s, i) => `<label class="fam-sat-placement-item"><input type="checkbox" data-word="${esc(s.word)}"> ${esc(s.word)}</label>`).join('')}
      </div>
      <button type="button" class="btn-secondary" onclick="submitSatPlacement()">Continue</button>`;
  } else if (placementEl) {
    placementEl.hidden = true;
  }

  // Rotate today's activity by day-of-year % 3.
  const task = dayOfYear(new Date()) % 3;
  if (task === 0) {
    // (1) pick the sentence using the word correctly
    const wrongWord = SAT_WORDS[(SAT_WORDS.indexOf(w) + 5) % SAT_WORDS.length];
    const correctSentence = w.example;
    const wrongSentence = wrongWord.example.replace(new RegExp(wrongWord.word, 'i'), w.word);
    const options = Math.random() < 0.5 ? [correctSentence, wrongSentence] : [wrongSentence, correctSentence];
    container.innerHTML = `
      <div class="fam-sat-task-title">Which sentence uses "${esc(w.word)}" correctly?</div>
      <div class="fam-sat-options">
        ${options.map((s, i) => `<button type="button" class="fam-sat-opt" onclick="answerSatActivity(${s === correctSentence})">${esc(s)}</button>`).join('')}
      </div>
      <div class="fam-sat-feedback" id="sat-activity-feedback"></div>`;
  } else if (task === 1) {
    // (2) fill-in-the-blank — choose the word
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
    // (3) choose the correct definition
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
    fb.textContent = correct ? '✅ Nice work!' : '❌ Not quite — try tomorrow\'s activity!';
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
    panel.innerHTML = header + '<p class="text-muted">No words banked yet — answer today\'s activity to get started!</p>';
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
      panel.innerHTML = '<p class="text-muted">Answer a few more activities first to unlock the pop quiz!</p>';
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
    panel.innerHTML = '<p class="text-muted">No quiz questions yet — keep working on the daily activity!</p>';
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
