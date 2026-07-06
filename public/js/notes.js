/* ---------- Notes tab ---------- */
function noteSourceChip(source) {
  const map = {
    quote:  { icon: '📌', label: 'Quote' },
    sat:    { icon: '🔤', label: 'SAT word' },
    chat:   { icon: '💬', label: 'Chat' },
    social: { icon: '💗', label: 'Feelings' },
    news:   { icon: '📰', label: 'News' },
    manual: { icon: '📝', label: 'Note' },
  };
  return map[source] || map.manual;
}

function friendlyNoteDate(dateStr) {
  const d = parseIso(dateStr);
  const today = isoDate(new Date());
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateStr === today) return 'Today';
  if (dateStr === isoDate(yesterday)) return 'Yesterday';
  return formatLong(d);
}

async function loadNotes() {
  try {
    notesItems = await window.auth.getNotes(isKidSession() ? {} : {});
  } catch (e) {
    notesItems = [];
  }
  renderNotesTimeline();
  return notesItems;
}

function renderNotesTimeline() {
  const el = document.getElementById('notes-timeline');
  if (!el) return;
  if (!notesItems.length) {
    el.innerHTML = '<p class="text-muted">No notes yet — reflections you save from Quote, SAT, News, feelings check-ins, and pinned chat messages will show up here.</p>';
    return;
  }
  // Group by date, preserving the already-desc-by-date-then-createdAt server order.
  const groups = [];
  let lastDate = null;
  notesItems.forEach((n) => {
    if (n.date !== lastDate) {
      groups.push({ date: n.date, notes: [] });
      lastDate = n.date;
    }
    groups[groups.length - 1].notes.push(n);
  });

  el.innerHTML = groups.map((g) => {
    const rows = g.notes.map((n) => {
      const chip = noteSourceChip(n.source);
      const context = (n.ref && n.ref.context) ? n.ref.context : '';       // the original content
      const reflection = (n.body && n.body !== context) ? n.body : '';     // the person's own words
      const canEdit = sessionUser && (n.authorId === sessionUser.id || n.authorId === sessionUser.kidId);
      const del = canEdit ? `<button class="btn-link-danger note-delete-btn" onclick="handleDeleteNote('${n.id}')" title="Delete note">🗑️</button>` : '';
      const header = `<div class="note-item-header">
          <span class="note-source-chip note-source-${esc(n.source || 'manual')}">${chip.icon} ${chip.label}</span>
          ${del}
        </div>`;
      // When there's both a reflection AND a saved original, the card flips: the
      // front shows the person's note, the back reveals the original content.
      if (context && reflection) {
        return `<div class="note-item note-flippable" onclick="toggleNoteFlip(this, event)">
          ${header}
          <div class="note-face note-front">
            <div class="note-body">💭 ${esc(reflection)}</div>
            <div class="note-flip-hint">↻ Tap to see the original</div>
          </div>
          <div class="note-face note-back" style="display:none">
            <div class="note-content">${esc(context)}</div>
            <div class="note-flip-hint">↩︎ Tap to flip back</div>
          </div>
        </div>`;
      }
      // Otherwise show whatever's present: the original as the prominent block
      // (pins) or a plain manual/feelings note.
      const contentBlock = context ? `<div class="note-content">${esc(context)}</div>` : '';
      const bodyBlock = reflection ? `<div class="note-body">${context ? '💭 ' : ''}${esc(reflection)}</div>` : '';
      return `<div class="note-item">${header}${contentBlock}${bodyBlock}</div>`;
    }).join('');
    return `<div class="notes-day-group">
      <div class="notes-day-header">${esc(friendlyNoteDate(g.date))}</div>
      ${rows}
    </div>`;
  }).join('');
}

function openAddNoteComposer() {
  const composer = document.getElementById('notes-composer');
  if (composer) { composer.hidden = false; document.getElementById('notes-composer-text').focus(); }
}

function closeAddNoteComposer() {
  const composer = document.getElementById('notes-composer');
  if (composer) { composer.hidden = true; document.getElementById('notes-composer-text').value = ''; }
}

async function handleSaveManualNote() {
  const textEl = document.getElementById('notes-composer-text');
  const body = textEl ? textEl.value.trim() : '';
  if (!body) return;
  try {
    const res = await window.auth.addNote({ body, source: 'manual' });
    if (res && res.note) notesItems.unshift(res.note);
    closeAddNoteComposer();
    renderNotesTimeline();
    toast('📝 Note saved');
  } catch (err) { toast(`❌ ${err.message}`); }
}

async function handleDeleteNote(id) {
  try {
    await window.auth.deleteNote(id);
    notesItems = notesItems.filter((n) => n.id !== id);
    renderNotesTimeline();
    toast('Note deleted.');
  } catch (err) { toast(`❌ ${err.message}`); }
}

// Flip a note card between the reflection (front) and the original content (back).
function toggleNoteFlip(card, event) {
  if (event && event.target.closest('.note-delete-btn')) return; // don't flip on delete
  const front = card.querySelector('.note-front');
  const back = card.querySelector('.note-back');
  if (!front || !back) return;
  const showingBack = back.style.display !== 'none';
  front.style.display = showingBack ? '' : 'none';
  back.style.display = showingBack ? 'none' : '';
  card.classList.toggle('flipped', !showingBack);
}
window.toggleNoteFlip = toggleNoteFlip;

async function saveNoteFromWidget(body, source, ref) {
  try {
    const res = await window.auth.addNote({ body, source, ref });
    if (res && res.note) {
      notesItems.unshift(res.note);
      renderNotesTimeline();
    }
    toast('📝 Saved to Notes');
    return res && res.note;
  } catch (err) {
    toast(`❌ ${err.message}`);
    return null;
  }
}
