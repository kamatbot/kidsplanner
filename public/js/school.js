/* ============================================================
   SCHOOL CALENDAR SYNC (Phase 2)
   Server-sourced, read-only events merged into the calendar views.
   Auto-syncs (throttled ~1/hour server-side) on app open; "Sync now"
   in Settings forces a refetch. See lib/school-feeds.js for the
   windowing/dedup/deadline-flagging logic.
============================================================ */
let lastSchoolSyncAttempt = null; // client-side guard so app-open doesn't hammer the endpoint on every tab switch

async function loadSchoolFeedsInfo() {
  try {
    schoolFeedsInfo = await window.auth.getCalendarFeeds();
  } catch (e) {
    schoolFeedsInfo = null;
  }
  return schoolFeedsInfo;
}

async function syncSchoolCalendar(opts) {
  const { force = false, silent = false, showToast = false } = opts || {};
  const now = Date.now();
  if (!force && lastSchoolSyncAttempt && (now - lastSchoolSyncAttempt) < SCHOOL_AUTO_SYNC_MIN_MS) {
    return; // client-side throttle mirrors the server's ~1/hour guard
  }
  lastSchoolSyncAttempt = now;
  try {
    const result = await window.auth.syncCalendar(force);
    schoolEvents = result.events || [];
    schoolSyncErrors = result.errors || [];
    renderCalendar();
    renderMiniCal();
    renderSchoolSettings();
    scheduleReminders();
    if (typeof renderTodayScreen === 'function') renderTodayScreen();
    if (schoolSyncErrors.length && !silent) {
      const names = schoolSyncErrors.map(e => e.label).join(', ');
      toast(`⚠️ Couldn't sync: ${names}`);
    } else if (showToast) {
      const deadlineCount = schoolEvents.filter(e => e.isDeadline).length;
      toast(`Synced ${schoolEvents.length} school events, ${deadlineCount} deadlines 🎓`);
    }
  } catch (e) {
    if (!silent) toast(`❌ Could not sync school calendars: ${e.message || 'unknown error'}`);
  }
}

async function handleSyncNowClick() {
  const btn = document.getElementById('school-sync-now-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
  await loadSchoolFeedsInfo();
  await syncSchoolCalendar({ force: true, showToast: true });
  if (btn) { btn.disabled = false; btn.textContent = 'Sync now 🔄'; }
}

function timeAgo(iso) {
  if (!iso) return 'never';
  const ms = Date.now() - Date.parse(iso);
  if (ms < 60000) return 'just now';
  if (ms < 3600000) return `${Math.round(ms / 60000)} min ago`;
  if (ms < 86400000) return `${Math.round(ms / 3600000)} hr ago`;
  return `${Math.round(ms / 86400000)} day${Math.round(ms / 86400000) === 1 ? '' : 's'} ago`;
}

/* ---------- Settings > School calendars ---------- */
function renderSchoolSettings() {
  const el = document.getElementById('school-calendars-list');
  const lastSyncedEl = document.getElementById('school-last-synced');
  if (!el || isKidSession()) return;

  if (lastSyncedEl) {
    lastSyncedEl.textContent = schoolFeedsInfo && schoolFeedsInfo.lastSyncAt
      ? `Last synced ${timeAgo(schoolFeedsInfo.lastSyncAt)}`
      : 'Never synced yet';
  }

  if (!currentFamily) {
    el.innerHTML = '<p class="text-muted">Create or join a family first to subscribe kids to school calendars.</p>';
    return;
  }
  const kids = currentFamily.kids || [];
  if (!kids.length) {
    el.innerHTML = '<p class="text-muted">Add a kid profile above, then subscribe them to their school calendars here.</p>';
    return;
  }

  const builtin = (schoolFeedsInfo && schoolFeedsInfo.builtin) || [];
  const subs = (schoolFeedsInfo && schoolFeedsInfo.subscriptions) || [];
  const subKey = (kidId, feedId, customUrl) => subs.find(s => s.kidId === kidId && (feedId ? s.feedId === feedId : s.customUrl === customUrl));

  let html = '';

  // Built-in St Andrews feeds — per-kid checkbox grid. Pin the column count to
  // the number of kids (auto-fit resolves by width, which wrapped extra kids
  // onto their own rows).
  const feedCols = `grid-template-columns:minmax(0,1fr) repeat(${kids.length},minmax(56px,72px))`;
  html += '<div class="school-feed-table">';
  html += `<div class="school-feed-row school-feed-hdr" style="${feedCols}">
      <span></span>${kids.map(k => `<span class="school-feed-kid-hdr" style="color:${k.color}">${esc(k.name)}</span>`).join('')}
    </div>`;
  builtin.forEach(feed => {
    html += `<div class="school-feed-row" style="${feedCols}">
        <span class="school-feed-name">${esc(feed.name)}${feed.deadline ? ' <span class=\"school-feed-deadline-tag\">deadlines</span>' : ''}</span>
        ${kids.map(k => {
          const existing = subKey(k.id, feed.id);
          const checked = existing ? 'checked' : '';
          return `<label class="school-feed-checkbox"><input type="checkbox" ${checked} onchange="handleToggleBuiltinFeed('${k.id}','${feed.id}',this.checked)"></label>`;
        }).join('')}
      </div>`;
  });
  html += '</div>';

  // Custom / club feeds already subscribed.
  const customSubs = subs.filter(s => s.customUrl);
  if (customSubs.length) {
    html += '<h4 style="margin:18px 0 8px">Your custom calendars</h4>';
    html += customSubs.map(s => {
      const kid = kids.find(k => k.id === s.kidId);
      return `<div class="custom-feed-row">
          <span class="custom-feed-label">${esc(s.customName || 'Custom calendar')}${s.deadline ? ' <span class="school-feed-deadline-tag">deadlines</span>' : ''}</span>
          <span class="custom-feed-kid" style="color:${kid ? kid.color : '#6C63FF'}">${kid ? esc(kid.name) : ''}</span>
          <button type="button" class="kid-row-remove" title="Remove" onclick="handleRemoveCustomFeed('${s.id}')">×</button>
        </div>`;
    }).join('');
  }

  el.innerHTML = html;

  if (schoolSyncErrors.length) {
    const errEl = document.getElementById('school-sync-errors');
    if (errEl) {
      errEl.style.display = '';
      errEl.innerHTML = '⚠️ Couldn\'t sync: ' + schoolSyncErrors.map(e => `<strong>${esc(e.label)}</strong> (${esc(e.error)})`).join(', ');
    }
  } else {
    const errEl = document.getElementById('school-sync-errors');
    if (errEl) errEl.style.display = 'none';
  }
}

async function handleToggleBuiltinFeed(kidId, feedId, checked) {
  try {
    if (checked) {
      await window.auth.subscribeCalendarFeed({ kidId, feedId });
    } else {
      await window.auth.unsubscribeCalendarFeed({ kidId, feedId });
    }
    await loadSchoolFeedsInfo();
    renderSchoolSettings();
    await syncSchoolCalendar({ force: true, silent: true });
    toast(checked ? 'Subscribed! Syncing… 🎓' : 'Unsubscribed.');
  } catch (err) {
    toast(`❌ ${err.message}`);
    renderSchoolSettings(); // revert the checkbox to actual state
  }
}

async function handleRemoveCustomFeed(subscriptionId) {
  try {
    await window.auth.unsubscribeCalendarFeed({ subscriptionId });
    await loadSchoolFeedsInfo();
    renderSchoolSettings();
    await syncSchoolCalendar({ force: true, silent: true });
    toast('Calendar removed.');
  } catch (err) {
    toast(`❌ ${err.message}`);
  }
}

/* ---------- Add your school's calendar (custom URL, guided flow) ---------- */
let customFeedPreview = null; // { normalizedUrl, calendarName, count, sampleTitles } from the last successful preview

function openAddSchoolCalendarModal() {
  customFeedPreview = null;
  document.getElementById('custom-feed-url').value = '';
  document.getElementById('custom-feed-name').value = '';
  document.getElementById('custom-feed-preview-result').style.display = 'none';
  document.getElementById('custom-feed-preview-result').innerHTML = '';
  document.getElementById('custom-feed-confirm-section').style.display = 'none';
  document.getElementById('custom-feed-error').textContent = '';
  const kids = (currentFamily && currentFamily.kids) || [];
  const kidSelect = document.getElementById('custom-feed-kid');
  kidSelect.innerHTML = kids.map(k => `<option value="${k.id}">${esc(k.name)}</option>`).join('') || '<option value="">No kids yet</option>';
  openModal('add-school-calendar-modal');
}

async function handlePreviewCustomFeed() {
  const url = document.getElementById('custom-feed-url').value.trim();
  const errEl = document.getElementById('custom-feed-error');
  const resultEl = document.getElementById('custom-feed-preview-result');
  const confirmEl = document.getElementById('custom-feed-confirm-section');
  errEl.textContent = '';
  resultEl.style.display = 'none';
  confirmEl.style.display = 'none';
  customFeedPreview = null;
  if (!url) { errEl.textContent = 'Paste a calendar link first.'; return; }

  const btn = document.getElementById('custom-feed-preview-btn');
  btn.disabled = true; btn.textContent = 'Checking…';
  try {
    const preview = await window.auth.previewCalendarFeed(url);
    customFeedPreview = preview;
    const nameLine = preview.calendarName ? `Found <strong>${esc(preview.calendarName)}</strong> — ` : 'Found ';
    resultEl.innerHTML = `✅ ${nameLine}${preview.count} event${preview.count === 1 ? '' : 's'}.` +
      (preview.sampleTitles && preview.sampleTitles.length
        ? `<div class="text-muted" style="margin-top:6px">e.g. ${preview.sampleTitles.map(t => `“${esc(t)}”`).join(', ')}</div>`
        : '');
    resultEl.style.display = '';
    document.getElementById('custom-feed-name').value = preview.calendarName || '';
    confirmEl.style.display = '';
  } catch (err) {
    errEl.textContent = err.message || 'Could not check that calendar.';
  } finally {
    btn.disabled = false; btn.textContent = 'Check this link';
  }
}

async function handleSaveCustomFeed(e) {
  e.preventDefault();
  const errEl = document.getElementById('custom-feed-error');
  if (!customFeedPreview || !customFeedPreview.ok) {
    errEl.textContent = 'Check the link first so we know it works.';
    return;
  }
  const kidId = document.getElementById('custom-feed-kid').value;
  const customName = document.getElementById('custom-feed-name').value.trim();
  if (!kidId) { errEl.textContent = 'Add a kid profile first, then pick who this calendar is for.'; return; }
  try {
    await window.auth.subscribeCalendarFeed({
      kidId,
      customUrl: customFeedPreview.normalizedUrl,
      customName: customName || customFeedPreview.calendarName || 'School calendar',
    });
    closeModal('add-school-calendar-modal');
    await loadSchoolFeedsInfo();
    renderSchoolSettings();
    await syncSchoolCalendar({ force: true, showToast: true });
  } catch (err) {
    errEl.textContent = err.message;
  }
}

function switchFeedGuideTab(tab) {
  document.querySelectorAll('.feed-guide-tab').forEach(t => t.classList.toggle('active', t.dataset.guide === tab));
  document.querySelectorAll('.feed-guide-panel').forEach(p => p.classList.toggle('active', p.id === `guide-${tab}`));
}

/* ============================================================
   SCHOOL STATS WIDGET (house points / attendance / canteen)
   Parent-only (mirrors the Moodle IDs Settings card gating). Reads
   famGetSchoolStats() — purely local, populated by the extension's
   famImportSchoolData bridge calls (see PART B above). Respects the kid
   switcher (activeKidId) when one is selected, else shows every kid with
   stored stats.
============================================================ */
function renderSchoolStatsWidget() {
  const widget = document.getElementById('widget-school-stats');
  const rowsEl = document.getElementById('school-stats-rows');
  if (!widget || !rowsEl) return;

  if (isKidSession() || !currentFamily) {
    widget.style.display = 'none';
    return;
  }

  const stats = famGetSchoolStats();
  const kids = (currentFamily.kids || []).filter((k) => stats[k.id]);
  const visible = activeKidId ? kids.filter((k) => k.id === activeKidId) : kids;

  if (!visible.length) {
    widget.style.display = 'none';
    return;
  }

  widget.style.display = '';
  rowsEl.innerHTML = visible.map((k) => {
    const s = stats[k.id] || {};
    const points = (s.housePoints === null || s.housePoints === undefined) ? '—' : s.housePoints;
    const attend = (s.attendance === null || s.attendance === undefined) ? '—' : `${s.attendance}%`;
    const punctual = (s.punctual === null || s.punctual === undefined) ? '' : ` (${s.punctual}% on time)`;
    const hasBalance = s.canteenBalance !== null && s.canteenBalance !== undefined;
    const lowBalance = hasBalance && s.canteenBalance < LOW_BALANCE_THRESHOLD;
    const balance = hasBalance ? `฿${s.canteenBalance}` : '—';
    return `<div class="school-stats-row">
      <span class="school-stats-swatch" style="background:${k.color || '#ccc'}"></span>
      <span class="school-stats-name">${esc(k.name)}</span>
      <span class="school-stats-metric" title="House points">🏆 ${points}</span>
      <span class="school-stats-metric" title="Attendance (punctuality)">✅ ${attend}${esc(punctual)}</span>
      <span class="school-stats-metric school-stats-balance${lowBalance ? ' low' : ''}" title="Canteen balance">🍽️ ${balance}</span>
    </div>`;
  }).join('');
}

/* ============================================================
   SCHOOL ACCOUNT (Moodle) IMPORT — parent-only.
   Modal flow: connect credentials -> map kid to Moodle user id -> Import
   (server returns a PREVIEW, nothing saved yet) -> "Add to Fam ETC" confirms.
   Homework confirms into the server-side homework hub (see loadHomework()).
   Timetable rows come back from the preview/confirm response and are added
   here as normal calendar events (localStorage `fam_events`, same shape as
   saveEvent() above: {id,userId,kidId,title,date,time,endTime,category,notes})
   tagged category:'school' and kidId — see confirmTimetableAsEvents().
============================================================ */
let schoolStatusCache = null;      // last GET /api/school/status result
let schoolImportPreview = null;    // { homework:[...], timetable:[...] } from POST /api/school/import

function showSchoolStep(step) {
  const steps = { connect: 'school-step-connect', connected: 'school-step-connected', preview: 'school-step-preview' };
  Object.values(steps).forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById(steps[step]);
  if (target) target.style.display = '';
}

async function openSchoolAccountModal() {
  document.getElementById('school-connect-error').textContent = '';
  document.getElementById('school-import-error').textContent = '';
  document.getElementById('school-preview-error').textContent = '';
  document.getElementById('school-username').value = '';
  document.getElementById('school-password').value = '';
  openModal('school-account-modal');
  try {
    schoolStatusCache = await window.auth.getSchoolStatus();
  } catch (e) {
    schoolStatusCache = null;
  }
  if (!schoolStatusCache || !schoolStatusCache.encryptionAvailable) {
    showSchoolStep('connect');
    document.getElementById('school-connect-error').textContent = schoolStatusCache
      ? 'School account connection is not available on this server yet.'
      : 'Could not check school account status. Please try again.';
    document.getElementById('school-connect-submit-btn').disabled = true;
    return;
  }
  document.getElementById('school-connect-submit-btn').disabled = false;
  if (schoolStatusCache.connected) {
    showSchoolStep('connected');
    populateSchoolImportKidSelect();
  } else {
    showSchoolStep('connect');
  }
}

async function handleConnectSchoolAccount(e) {
  e.preventDefault();
  const errEl = document.getElementById('school-connect-error');
  errEl.textContent = '';
  const username = document.getElementById('school-username').value.trim();
  const password = document.getElementById('school-password').value;
  const btn = document.getElementById('school-connect-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Connecting…';
  try {
    await window.auth.connectSchoolAccount(username, password);
    document.getElementById('school-password').value = ''; // never keep it in the DOM longer than needed
    toast('School account connected! 🔗');
    schoolStatusCache = await window.auth.getSchoolStatus();
    showSchoolStep('connected');
    populateSchoolImportKidSelect();
  } catch (err) {
    errEl.textContent = err.message || 'Could not connect. Please check your username and password.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Connect 🔗';
  }
}

function populateSchoolImportKidSelect() {
  const sel = document.getElementById('school-import-kid');
  const kids = (currentFamily && currentFamily.kids) || [];
  sel.innerHTML = kids.map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join('') || '<option value="">No kids yet</option>';
  renderSchoolKidMapping();
}

function renderSchoolKidMapping() {
  const kidId = document.getElementById('school-import-kid').value;
  const mapping = (schoolStatusCache && schoolStatusCache.kidMappings || []).find((m) => m.kidId === kidId);
  document.getElementById('school-moodle-userid').value = mapping ? mapping.moodleUserId : '';
}

async function handleImportSchoolData() {
  const errEl = document.getElementById('school-import-error');
  errEl.textContent = '';
  const kidId = document.getElementById('school-import-kid').value;
  const moodleUserId = document.getElementById('school-moodle-userid').value.trim();
  if (!kidId) { errEl.textContent = 'Add a kid profile first.'; return; }
  if (!/^\d+$/.test(moodleUserId)) { errEl.textContent = 'Enter a numeric Moodle user id.'; return; }

  const btn = document.getElementById('school-import-btn-2');
  btn.disabled = true;
  btn.textContent = 'Importing…';
  try {
    await window.auth.mapSchoolKid(kidId, moodleUserId);
    schoolImportPreview = await window.auth.importSchoolData(kidId);
    schoolImportPreview.kidId = kidId;
    renderSchoolPreview();
    showSchoolStep('preview');
  } catch (err) {
    errEl.textContent = err.message || 'Could not import from the school portal.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Import 📥';
  }
}

function renderSchoolPreview() {
  const hwEl = document.getElementById('school-preview-homework');
  const ttEl = document.getElementById('school-preview-timetable');
  const hw = (schoolImportPreview && schoolImportPreview.homework) || [];
  const tt = (schoolImportPreview && schoolImportPreview.timetable) || [];

  const pending = hw.filter((h) => !h.completed);
  hwEl.innerHTML = pending.length
    ? pending.map((h) => `
        <div class="homework-row">
          <div class="hw-row-main">
            <div class="hw-row-title-line"><span class="hw-row-title">${esc(h.title)}</span></div>
            <div class="hw-row-meta">
              ${h.subject ? `<span class="hw-chip hw-subject-chip">${esc(h.subject)}</span>` : ''}
              <span class="hw-due-label">${esc(h.dueDate || 'No date')}</span>
            </div>
          </div>
        </div>`).join('')
    : '<p class="text-muted">No pending homework found.</p>';
  const skipped = hw.length - pending.length;
  if (skipped > 0) {
    hwEl.innerHTML += `<p class="text-muted">${skipped} completed item${skipped === 1 ? '' : 's'} not imported.</p>`;
  }

  ttEl.innerHTML = tt.length
    ? tt.map((t) => `<div class="homework-row"><div class="hw-row-main"><div class="hw-row-title-line"><span class="hw-row-title">${esc(t.day)} ${esc(t.time || '')} — ${esc(t.subject)}</span></div></div></div>`).join('')
    : '<p class="text-muted">No timetable found.</p>';
}

async function handleConfirmSchoolImport() {
  const errEl = document.getElementById('school-preview-error');
  errEl.textContent = '';
  if (!schoolImportPreview) return;
  try {
    const result = await window.auth.confirmSchoolImport(schoolImportPreview.kidId, schoolImportPreview.homework, schoolImportPreview.timetable);
    confirmTimetableAsEvents(result.timetable || [], schoolImportPreview.kidId);
    await loadHomework();
    renderHomeworkHub();
    renderCalendar();
    renderMiniCal();
    closeModal('school-account-modal');
    toast(`Imported ${result.homeworkCreated} homework item${result.homeworkCreated === 1 ? '' : 's'} 🎓`);
  } catch (err) {
    errEl.textContent = err.message || 'Could not save the import.';
  }
}

// Adds imported timetable rows as normal calendar events, same shape as
// saveEvent() — tagged category:'school' and the imported kidId. Dedups
// against existing events by title+date+time+kidId so re-importing the same
// week doesn't create duplicates.
function confirmTimetableAsEvents(timetableRows, kidId) {
  if (!timetableRows.length) return;
  const events = getEvents();
  const todayIso = isoDate(new Date());
  const dowIndex = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  const base = new Date();
  let added = 0;
  timetableRows.forEach((row) => {
    const dow = dowIndex[String(row.day || '').toLowerCase()];
    let dateStr = todayIso;
    if (dow !== undefined) {
      const d = new Date(base);
      const diff = (dow - d.getDay() + 7) % 7;
      d.setDate(d.getDate() + diff);
      dateStr = isoDate(d);
    }
    const title = row.subject || row.period || 'Class';
    const exists = events.some((e) => e.kidId === kidId && e.title === title && e.date === dateStr && e.time === (row.time || ''));
    if (exists) return;
    events.push({
      id: uid(),
      userId: sessionUser.id,
      kidId,
      title,
      date: dateStr,
      time: row.time || '',
      endTime: '',
      category: 'school',
      notes: [row.teacher, row.room].filter(Boolean).join(' · '),
    });
    added++;
  });
  if (added) saveEvents(events);
}

async function handleDisconnectSchoolAccount() {
  try {
    await window.auth.disconnectSchoolAccount();
    schoolStatusCache = null;
    schoolImportPreview = null;
    toast('School account disconnected.');
    showSchoolStep('connect');
    document.getElementById('school-username').value = '';
    document.getElementById('school-password').value = '';
  } catch (err) {
    toast(`❌ ${err.message}`);
  }
}

/* ---------- Snap homework (AI parse from a photo) ----------
   Reuses the SAME photo-upload + Claude parse pipeline as
   parseScheduleWithAI()/processUpload() (see the AI PARSE section above),
   adapted to extract homework items (subject, title, due date) instead of
   class periods. Parent reviews+edits before saving as source:"ai".
   TODO(security): same client-exposed Anthropic key as parseScheduleWithAI()
   — tracked Phase 1 item, not fixed here (see that function's TODO). */
let hwUploadedFile = null;
let parsedHomeworkItems = [];

function openSnapHomeworkModal() {
  clearHomeworkUpload();
  openModal('snap-homework-modal');
}

function handleHomeworkDrop(e) {
  e.preventDefault();
  document.getElementById('hw-upload-zone').classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) processHomeworkUpload(file);
}

function handleHomeworkFileSelect(e) {
  const file = e.target.files[0];
  if (file) processHomeworkUpload(file);
}

function processHomeworkUpload(file) {
  hwUploadedFile = file;
  document.getElementById('hw-preview-filename').textContent = `${file.name} (${(file.size / 1024).toFixed(0)} KB)`;

  const reader = new FileReader();
  reader.onload = (ev) => {
    const content = document.getElementById('hw-preview-content');
    if (file.type.startsWith('image/')) {
      content.innerHTML = `<img src="${ev.target.result}" alt="Homework diary preview">`;
    } else if (file.type === 'application/pdf') {
      content.innerHTML = `<iframe src="${ev.target.result}" title="Homework diary PDF"></iframe>`;
    } else {
      content.innerHTML = `<div style="padding:16px;color:var(--text-2)">Preview not available for this file type.</div>`;
    }
    document.getElementById('hw-upload-preview').style.display = '';
    hwUploadedFile._dataUrl = ev.target.result;

    if (typeof ANTHROPIC_API_KEY !== 'undefined' && ANTHROPIC_API_KEY) {
      document.getElementById('hw-ai-parse-section').style.display = '';
      setHomeworkParseStatus('⏳', 'Parsing homework diary with AI…');
      parseHomeworkWithAI();
    } else {
      setHomeworkParseStatus('⚠️', 'No API key configured in config.js');
      document.getElementById('hw-ai-parse-section').style.display = '';
    }
  };
  reader.readAsDataURL(file);
}

function clearHomeworkUpload() {
  hwUploadedFile = null;
  document.getElementById('hw-upload-preview').style.display = 'none';
  document.getElementById('hw-preview-content').innerHTML = '';
  document.getElementById('hw-file-input').value = '';
  document.getElementById('hw-ai-parse-section').style.display = 'none';
}

function setHomeworkParseStatus(icon, text) {
  const spinner = document.getElementById('hw-ai-spinner');
  const label = document.getElementById('hw-ai-status-text');
  if (spinner) spinner.textContent = icon;
  if (label) label.textContent = text;
}

async function parseHomeworkWithAI() {
  const apiKey = (typeof ANTHROPIC_API_KEY !== 'undefined' && ANTHROPIC_API_KEY) ? ANTHROPIC_API_KEY : '';
  if (!apiKey) { setHomeworkParseStatus('⚠️', 'No API key configured in config.js'); return; }

  try {
    let base64, mediaType;
    if (hwUploadedFile.type === 'application/pdf') {
      const result = await renderPdfToBase64(hwUploadedFile);
      base64 = result.base64;
      mediaType = result.mediaType;
    } else {
      const dataUrl = hwUploadedFile._dataUrl;
      base64 = dataUrl.split(',')[1];
      mediaType = dataUrl.split(',')[0].match(/:(.*?);/)[1];
      if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mediaType)) {
        throw new Error('Unsupported image type. Please use JPG or PNG.');
      }
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: `Parse this photo of a homework diary/planner page into a JSON array of homework items.
Each element must have exactly these fields:
{
  "subject": "subject or class name",
  "title": "short description of the homework/assignment",
  "dueDate": "YYYY-MM-DD — infer the year from context if not shown; use today's date ${isoDate(new Date())} as a reference point for 'this Friday' etc. style phrasing"
}
Rules:
- One entry per homework/assignment item, even if several are for the same subject.
- If no due date is visible for an item, make your best guess based on context (e.g. tomorrow) rather than omitting it.
- Return ONLY a valid JSON array with no markdown, no code blocks, no extra text.` },
          ],
        }],
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `API error ${res.status}`);
    }

    const data = await res.json();
    let rawText = data.content?.[0]?.text?.trim() || '';
    const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) rawText = fenceMatch[1].trim();

    const items = JSON.parse(rawText);
    if (!Array.isArray(items) || items.length === 0) throw new Error('No homework items found in the photo.');

    setHomeworkParseStatus('✅', `Found ${items.length} item(s) — review below`);
    openHomeworkParseReview(items);
  } catch (err) {
    setHomeworkParseStatus('❌', `Parse failed: ${err.message}`);
    toast(`❌ ${err.message}`);
    console.error(err);
  }
}

function openHomeworkParseReview(items) {
  parsedHomeworkItems = items;
  closeModal('snap-homework-modal');

  const kidGroup = document.getElementById('hw-parse-kid-group');
  const kidSelect = document.getElementById('hw-parse-kid');
  if (isKidSession()) {
    kidGroup.style.display = 'none';
  } else {
    kidGroup.style.display = '';
    const kids = (currentFamily && currentFamily.kids) || [];
    kidSelect.innerHTML = kids.map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join('') || '<option value="">Add a kid first</option>';
    if (activeKidId) kidSelect.value = activeKidId;
  }

  renderHomeworkParseTable(items);
  updateHomeworkParseSummary();
  openModal('snap-homework-review-modal');
}

function renderHomeworkParseTable(items) {
  const tbody = document.getElementById('hw-parse-tbody');
  tbody.innerHTML = items.map((it, i) => `
    <tr>
      <td><input type="checkbox" class="hw-parse-check" data-i="${i}" checked onchange="updateHomeworkParseSummary()"></td>
      <td><input type="text" value="${esc(it.subject || '')}" oninput="parsedHomeworkItems[${i}].subject=this.value"></td>
      <td><input type="text" value="${esc(it.title || '')}" oninput="parsedHomeworkItems[${i}].title=this.value"></td>
      <td><input type="date" value="${esc(it.dueDate || '')}" oninput="parsedHomeworkItems[${i}].dueDate=this.value"></td>
    </tr>`).join('');
}

function toggleAllHomeworkParsed(checked) {
  document.querySelectorAll('.hw-parse-check').forEach((cb) => { cb.checked = checked; });
  updateHomeworkParseSummary();
}

function updateHomeworkParseSummary() {
  const checked = document.querySelectorAll('.hw-parse-check:checked').length;
  const total = parsedHomeworkItems.length;
  const summary = document.getElementById('hw-parse-summary');
  if (summary) summary.textContent = `${checked} of ${total} item(s) selected`;
}

async function applyParsedHomework() {
  const kidId = isKidSession() ? sessionUser.kidId : document.getElementById('hw-parse-kid').value;
  if (!kidId) { toast('Add a kid profile first.'); return; }

  const rows = document.querySelectorAll('#hw-parse-tbody tr');
  const selected = [];
  rows.forEach((row, i) => {
    if (!row.querySelector('.hw-parse-check')?.checked) return;
    selected.push(parsedHomeworkItems[i]);
  });
  if (!selected.length) { toast('No items selected.'); return; }

  let added = 0;
  for (const it of selected) {
    if (!it.title || !it.dueDate) continue;
    try {
      const res = await window.auth.addHomework({
        kidId, title: it.title, subject: it.subject || '', dueDate: it.dueDate, source: 'ai',
      });
      homeworkItems.push(res.homework);
      added++;
    } catch (err) { /* skip individual failures, keep going */ }
  }

  closeModal('snap-homework-review-modal');
  renderHomeworkHub();
  renderCalendar();
  toast(`✅ Added ${added} homework item${added === 1 ? '' : 's'}!`);
}
