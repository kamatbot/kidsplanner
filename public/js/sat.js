function satPlacementKey() {
  return `fam_sat_placement_done_${sessionUser ? sessionUser.id : 'anon'}`;
}

/* ---------- SAT word widget: vocabulary warm-up + word bank + pop quiz ---------- */
let dailyVocabulary = null;
let vocabularyRequestToken = 0;
let vocabularyScope = '';
let vocabularyAnswered = false;

async function renderSatActivity() {
  const container = document.getElementById('sat-activity');
  if (!container) return;
  const token = ++vocabularyRequestToken;
  const scope = daily5DoneKey();
  dailyVocabulary = null;
  currentSatWord = null;
  vocabularyAnswered = false;
  vocabularyScope = scope;
  ['sat-word', 'sat-pos', 'sat-def', 'sat-example'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = id === 'sat-word' ? 'Loading today’s word…' : '';
  });
  container.innerHTML = '<p role="status">Loading today’s vocabulary challenge…</p>';

  const wordLabel = document.querySelector('#widget-word .widget-label');
  if (wordLabel) wordLabel.textContent = 'Word of the Day';

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

  try {
    const requestedDate = isoDate(new Date());
    const data = await window.auth.getDailyVocabulary(requestedDate);
    if (token !== vocabularyRequestToken || scope !== daily5DoneKey()) return;
    if (!data || data.date !== requestedDate) throw new Error('Vocabulary edition unavailable');
    const challenge = data && data.challenge;
    if (!data.word || !Array.isArray(data.weekWords) || data.weekWords.length !== 7 || !challenge || !Array.isArray(challenge.options) || challenge.options.length !== 3 || !Number.isInteger(challenge.answerIndex) || challenge.answerIndex < 0 || challenge.answerIndex > 2 || challenge.options.some((option) => !option.text || !option.explanation)) throw new Error('Invalid vocabulary challenge');
    dailyVocabulary = data;
    currentSatWord = data.word;
    const w = data.word;
    [['sat-word', w.word], ['sat-pos', w.pos], ['sat-def', w.def], ['sat-example', w.example]].forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    });
    container.innerHTML = `
      <div class="fam-sat-task-title">Two truths and a lie</div>
      <p>${esc(challenge.prompt)}</p>
      <div class="fam-sat-options">
        ${challenge.options.map((option, index) => `<button type="button" class="fam-sat-opt" onclick="answerSatActivity(${index})">${esc(option.text)}</button>`).join('')}
      </div>
      <div class="fam-sat-feedback" id="sat-activity-feedback" aria-live="polite"></div>
      <details><summary class="fam-sat-placement-summary">This week’s shared vocabulary</summary><dl>${data.weekWords.map((word) => `<dt>${esc(word.word)} (${esc(word.pos)})</dt><dd>${esc(word.def)}</dd>`).join('')}</dl></details>`;
  } catch (error) {
    if (token !== vocabularyRequestToken || scope !== daily5DoneKey()) return;
    const word = document.getElementById('sat-word');
    if (word) word.textContent = 'Vocabulary unavailable';
    container.innerHTML = '<p role="status">Could not load today’s shared word. Please try again.</p><button type="button" class="btn-secondary" onclick="renderSatActivity()">Retry</button>';
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

async function answerSatActivity(chosenIndex) {
  if (!dailyVocabulary || vocabularyAnswered || vocabularyScope !== daily5DoneKey() || !Number.isInteger(chosenIndex) || chosenIndex < 0 || chosenIndex > 2) return;
  vocabularyAnswered = true;
  const { challenge, word } = dailyVocabulary;
  const scope = vocabularyScope;
  const correct = chosenIndex === challenge.answerIndex;
  window.famChildProgress?.report('word', 'started');
  const btns = document.querySelectorAll('#sat-activity .fam-sat-opt');
  btns.forEach((b) => { b.disabled = true; });
  const fb = document.getElementById('sat-activity-feedback');
  if (fb) {
    fb.innerHTML = `<p>${correct ? 'You found the misuse.' : 'Not quite. Here is how each sentence uses the word.'}</p>${challenge.options.map((option, index) => `<p><strong>${index + 1}. ${index === challenge.answerIndex ? 'Misuse' : 'Correct use'}:</strong> ${esc(option.explanation)}</p>`).join('')}`;
    fb.className = 'fam-sat-feedback ' + (correct ? 'correct' : 'wrong');
  }
  if (currentSatWord) {
    try {
      const res = await window.auth.wordBankInteract(word.word, correct);
      if (scope === daily5DoneKey() && res && res.entry) {
        mergeWordBankEntry(res.entry);
        window.famChildProgress?.report('word', 'completed');
      }
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
