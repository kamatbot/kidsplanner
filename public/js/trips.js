/* ============================================================
   TRIPS.JS — Fam ETC Trips (Phase C web UI)
   Drives public/trips.html: BOTH the trips LIST (/trips) and the trip HUB
   (/trips/<id>) live in this one script — location.pathname decides which
   to render, history.pushState navigates between them without a reload.
   Ports the "Waypoint" UX reference mock (Overview / Itinerary / Flights /
   Lodging / Packing / Chat / People) using this app's Horizon design tokens
   via public/css/trips.css. Packing, the Ideas bucket atop Itinerary, and
   paste-to-import on Flights/Lodging are v1.1 additions — see the
   "v1.1 — Wanderlog-gap features" section of docs/TRIPS-PLAN.md.

   Fetches go through window.auth.trips* wrappers (see auth.js), EXCEPT the
   trip chat long-poll, which needs raw fetch + AbortController — that part
   mirrors chatLongPollFetch/chatLongPollLoop in app.js (~line 2108) almost
   verbatim, just scoped to a trip id and a "trip" prefix on every name so
   nothing here can ever clash with app.js's globals (they're never loaded
   on the same page, but keeping the names distinct is cheap and honest).

   House style: template-literal innerHTML rendering with esc() on all user
   data, inline onclick handlers, top-level functions, no bundler. This file
   is loaded alongside util.js (date helpers: isoDate/parseIso/formatShort/
   fmt12/mondayOf/uid/... — see tests/trips-bundle.test.js for the global-
   scope clash guard) and auth.js — do not redeclare any of util.js's names.
============================================================ */

/* ============================================================
   STATE
============================================================ */
let currentView = null;       // 'list' | 'hub'
let currentTripId = null;
let currentTrip = null;       // full publicTrip from GET /api/trips/:id (hub only)
let currentUser = null;
let currentUserId = null;
let currentTab = 'overview';  // overview | itinerary | flights | lodging | chat | people

let tripsListCache = [];
let tripsNewFormOpen = false;
// Create-trip hero state: the name auto-writes itself from the destination
// until the user edits it by hand; the destination placeholder cycles through
// real cities until the user starts typing.
let tripCreateNameTouched = false;
let tripCreateRotorTimer = null;
let tripCreateRotorIdx = 0;
const TRIP_CREATE_CITIES = ['Lisbon', 'Tokyo', 'Rome', 'Barcelona', 'Kyoto', 'Phuket', 'New York', 'Queenstown'];

let tripFormState = null;     // itinerary add/edit/schedule form: {dayDate, itemId|null, scheduling}
let tripOpenThreads = new Set();
let tripFlightFormOpen = false;
let tripLodgingFormOpen = false;
let tripEditFormOpen = false;
let tripInviteCopied = false;

let dragItemId = null;
let dragFromDate = null;

// Packing tab (v1.1) state.
let tripChecklistFormOpen = false;
let tripChecklistRenameId = null;
const PACKING_PRESETS = ['Passport', 'Chargers', 'Meds', 'Swimwear', 'Snacks', 'Headphones'];

// Paste-to-import (v1.1) state — one shared panel for Flights + Lodging tabs
// since a single parse can surface both kinds of bookings at once.
let tripPasteOpen = false;
let tripPasteText = '';
let tripPasteParsing = false;
let tripPasteAdding = false;
let tripPasteResult = null;   // { flights: [...], lodging: [...] } — each item gets a local _selected flag

// Trip chat long-poll state (mirrors app.js's chat* globals, trip-scoped).
let tripChatMessages = [];
let tripChatLastId = null;
let tripChatPollTimer = false;
let tripChatPollAbort = null;
let tripChatNudgeReady = false;
const TRIP_CHAT_BACKOFF_MS = [2000, 5000, 10000];

// lib/trips.js publicTrip()/memberFaces() hand back a PALETTE NAME (see
// lib/trips.js PALETTE — "accent"|"teal"|"blue"|"amber"|"green"|"violet"|
// "orange"), not a CSS value, so the server never bakes a hex/light-vs-dark
// decision into stored data. Map it to this app's Horizon token here, at the
// single point every avatar renders through (avatarHtml below) — "amber"/
// "violet" aren't valid CSS color keywords, so this isn't just cosmetic.
const PALETTE_COLORS = {
  accent: 'var(--accent)',
  teal: 'var(--c-teal)',
  blue: 'var(--c-blue)',
  amber: 'var(--c-amber)',
  green: 'var(--c-green)',
  violet: 'var(--c-violet)',
  orange: 'var(--c-orange)',
};
function paletteColor(name) {
  if (!name) return 'var(--accent)';
  return PALETTE_COLORS[name] || name; // already a CSS value (e.g. memberFor's 'var(--muted)' fallback)
}

const CATS = {
  food:     { label: 'Food',     color: 'var(--c-amber)' },
  sight:    { label: 'Sight',    color: 'var(--c-blue)' },
  activity: { label: 'Activity', color: 'var(--c-teal)' },
  transit:  { label: 'Transit',  color: 'var(--c-orange)' },
  stay:     { label: 'Stay',     color: 'var(--c-violet)' },
};

const ICON_PLANE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"></path></svg>';
const ICON_BED = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"></path><path d="M5 21V7l7-4 7 4v14"></path><path d="M9 21v-6h6v6"></path><path d="M9 10h.01M15 10h.01M9 13h.01M15 13h.01"></path></svg>';
const ICON_HEART = '<svg width="13" height="13" viewBox="0 0 24 24" fill="{{FILL}}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>';
const ICON_THREAD = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
const ICON_EDIT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>';
const ICON_TRASH = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
const ICON_TRASH_LG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
const ICON_SEND = '<svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true"><path d="M2.3 20.5 22 12 2.3 3.5v6.6L16 12 2.3 13.9z"/></svg>';
const ICON_DRAG = '<svg class="trip-item-drag" width="10" height="16" viewBox="0 0 10 16"><circle cx="2.5" cy="3" r="1.5" fill="currentColor"></circle><circle cx="7.5" cy="3" r="1.5" fill="currentColor"></circle><circle cx="2.5" cy="8" r="1.5" fill="currentColor"></circle><circle cx="7.5" cy="8" r="1.5" fill="currentColor"></circle><circle cx="2.5" cy="13" r="1.5" fill="currentColor"></circle><circle cx="7.5" cy="13" r="1.5" fill="currentColor"></circle></svg>';

/* ============================================================
   HELPERS (esc/toast copied from app.js's local convention — trips.html
   doesn't load app.js, so this page owns its own copies)
============================================================ */
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 2800);
}

function isKidRole() {
  return !!(currentTrip && (currentTrip.myRole === 'kid' || currentTrip.myRole === 'kid-read'));
}
function isOwnerRole() {
  return !!(currentTrip && currentTrip.myRole === 'owner');
}

function daysBetweenInclusive(startISO, endISO) {
  if (!startISO || !endISO) return 0;
  const s = parseIso(startISO), e = parseIso(endISO);
  return Math.round((e - s) / 86400000) + 1;
}

// "Jun 4 – 9, 2027" / "Jun 30 – Jul 2, 2027" / "Dec 30, 2026 – Jan 2, 2027"
function formatTripDateRange(startISO, endISO) {
  if (!startISO || !endISO) return '';
  const s = parseIso(startISO), e = parseIso(endISO);
  const sMonth = s.toLocaleDateString('en-US', { month: 'short' });
  const eMonth = e.toLocaleDateString('en-US', { month: 'short' });
  if (s.getFullYear() === e.getFullYear() && sMonth === eMonth) {
    return `${sMonth} ${s.getDate()} – ${e.getDate()}, ${e.getFullYear()}`;
  }
  if (s.getFullYear() === e.getFullYear()) {
    return `${sMonth} ${s.getDate()} – ${eMonth} ${e.getDate()}, ${e.getFullYear()}`;
  }
  return `${sMonth} ${s.getDate()}, ${s.getFullYear()} – ${eMonth} ${e.getDate()}, ${e.getFullYear()}`;
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'now';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return mins + 'm';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h';
  return Math.floor(hrs / 24) + 'd';
}

function memberFor(userId) {
  const members = (currentTrip && currentTrip.members) || [];
  const m = members.find((x) => x.userId === userId);
  if (!m) return { userId, name: 'Someone', initial: '?', color: 'var(--muted)' };
  return { userId, name: m.name || 'Member', initial: m.initial || (m.name || '?')[0].toUpperCase(), color: m.color || 'var(--accent)' };
}

function avatarHtml(initial, color, size, overlap) {
  const s = size || 28;
  const ml = overlap ? Math.round(s * -0.22) : 0;
  return `<div class="trip-avatar" style="width:${s}px;height:${s}px;font-size:${Math.round(s * 0.42)}px;background:${esc(paletteColor(color))};margin-left:${ml}px" title="${esc(initial || '?')}">${esc(initial || '?')}</div>`;
}

function renderAvatarStack(faces, size) {
  return (faces || []).slice(0, 6).map((f, i) => avatarHtml(f.initial, f.color, size, i > 0)).join('');
}

/* ============================================================
   ROUTING — /trips (list) vs /trips/<id> (hub), history.pushState between
   them so switching trips never triggers a full reload.
============================================================ */
function tripsParseRoute() {
  const m = location.pathname.match(/^\/trips\/([A-Za-z0-9_-]+)\/?$/);
  if (m && m[1] && m[1] !== 'join') return { view: 'hub', id: m[1] };
  return { view: 'list' };
}

function tripsRoute() {
  tripStopChatPolling();
  const r = tripsParseRoute();
  if (r.view === 'hub') {
    currentView = 'hub';
    currentTripId = r.id;
    tripsLoadHub(r.id);
  } else {
    currentView = 'list';
    currentTripId = null;
    currentTrip = null;
    tripsLoadList();
  }
}

function tripsGoHub(id) {
  history.pushState({}, '', '/trips/' + encodeURIComponent(id));
  tripsRoute();
}

function tripsGoList() {
  history.pushState({}, '', '/trips');
  tripsRoute();
}

function tripsGoTab(tab) {
  currentTab = tab;
  renderHub();
}

async function tripsBoot() {
  let me = null;
  try { me = await window.auth.getMe(); } catch (e) { me = null; }
  if (!me || !me.user) {
    window.location.href = '/login?next=' + encodeURIComponent(location.pathname);
    return;
  }
  currentUser = me.user;
  currentUserId = me.user.id;
  window.addEventListener('popstate', tripsRoute);
  tripsRoute();
}

/* ============================================================
   TRIPS LIST (/trips)
============================================================ */
async function tripsLoadList() {
  const root = document.getElementById('trips-root');
  if (!root) return;
  root.innerHTML = '<div class="trip-main"><p class="text-muted">Loading trips…</p></div>';
  try {
    tripsListCache = await window.auth.getTrips();
    renderTripsList();
  } catch (err) {
    root.innerHTML = `<div class="trip-main"><p class="error-msg">${esc(err.message)}</p></div>`;
  }
}

function renderTripsList() {
  const root = document.getElementById('trips-root');
  if (!root) return;
  const trips = tripsListCache || [];
  // First visit with zero trips: land straight in the creation hero — the
  // create card IS the empty state, not a dead-end box with a button in it.
  const firstRun = !trips.length;
  const formOpen = tripsNewFormOpen || firstRun;
  root.innerHTML = `
    <div class="trip-hub-header">
      <div class="trip-hub-inner">
        ${tripBrandHtml()}
        <div class="trip-hub-title">
          <div class="trip-hub-name-row"><div class="trip-hub-name">Trips</div></div>
        </div>
        <div class="trip-hub-header-right">
          ${formOpen ? '' : '<button type="button" class="btn-primary" onclick="tripsToggleNewForm()">+ New trip</button>'}
        </div>
      </div>
    </div>
    <div class="trip-main">
      ${formOpen ? renderNewTripForm(firstRun) : ''}
      ${trips.length ? `<div class="trip-list-grid">${trips.map(renderTripCard).join('')}</div>` : ''}
    </div>
  `;
  if (formOpen) tripCreateAfterRender();
  else tripCreateStopRotor();
}

function tripsToggleNewForm() {
  tripsNewFormOpen = !tripsNewFormOpen;
  tripCreateNameTouched = false;
  renderTripsList();
}

function renderNewTripForm(firstRun) {
  return `
    <form class="trip-create-card" onsubmit="tripsSubmitNew(event)">
      <div class="trip-create-hero">
        <div class="trip-create-blob trip-create-blob-1"></div>
        <div class="trip-create-blob trip-create-blob-2"></div>
        <div class="trip-create-hero-inner">
          <div class="trip-create-kicker">${firstRun ? 'Your first trip' : 'New trip'}</div>
          <input class="trip-create-dest" name="destination" placeholder="${esc(TRIP_CREATE_CITIES[0])}…"
                 autocomplete="off" maxlength="120" spellcheck="false" autofocus
                 oninput="tripCreateOnDestination(this)">
          <div class="trip-create-hero-sub">Where to next? Type a destination — we'll handle the rest.</div>
        </div>
      </div>
      <div class="trip-create-body">
        <div class="trip-create-field">
          <label class="micro-label" for="trip-create-name">Trip name</label>
          <input class="trip-input" id="trip-create-name" name="name" placeholder="Lisbon with the crew"
                 required autocomplete="off" maxlength="80" oninput="tripCreateNameTouched = true">
        </div>
        <div class="trip-create-field">
          <label class="micro-label">Dates</label>
          <div class="trip-form-row">
            <input class="trip-input" type="date" name="startDate" required onchange="tripCreateOnDates(this.form)">
            <span class="trip-create-dates-arrow">→</span>
            <input class="trip-input" type="date" name="endDate" required onchange="tripCreateOnDates(this.form)">
          </div>
          <div class="trip-create-presets">
            <button type="button" class="trip-create-preset" onclick="tripCreatePreset(this.form, 3)">Long weekend</button>
            <button type="button" class="trip-create-preset" onclick="tripCreatePreset(this.form, 6)">One week</button>
            <button type="button" class="trip-create-preset" onclick="tripCreatePreset(this.form, 13)">Two weeks</button>
            <span class="trip-create-meta" id="trip-create-meta"></span>
          </div>
        </div>
        <div class="trip-form-actions">
          <button type="submit" class="btn-primary">Start planning →</button>
          ${firstRun ? '' : '<button type="button" class="btn-secondary" onclick="tripsToggleNewForm()">Cancel</button>'}
        </div>
        ${firstRun ? `
        <div class="trip-create-perks">
          <span>🔗 Invite anyone with a link</span>
          <span>🗳️ Vote on the plan together</span>
          <span>💬 One chat for the whole crew</span>
        </div>` : ''}
      </div>
    </form>
  `;
}

/* ---- create-trip hero behaviors (all direct-DOM: never re-render the list
   mid-typing, that would eat the user's input state) ---- */

// Cycle the destination placeholder through real cities until typing starts.
function tripCreateAfterRender() {
  // autofocus doesn't fire on innerHTML-injected nodes — focus by hand, but
  // only when the user explicitly opened the form (never on the auto-opened
  // first-run state, where it would pop the keyboard on mobile uninvited).
  if (tripsNewFormOpen) {
    const dest = document.querySelector('.trip-create-dest');
    if (dest) dest.focus();
  }
  tripCreateStopRotor();
  tripCreateRotorTimer = setInterval(() => {
    const el = document.querySelector('.trip-create-dest');
    if (!el) { tripCreateStopRotor(); return; }
    if (el.value) return; // typing — hold still
    tripCreateRotorIdx = (tripCreateRotorIdx + 1) % TRIP_CREATE_CITIES.length;
    el.placeholder = TRIP_CREATE_CITIES[tripCreateRotorIdx] + '…';
  }, 2200);
}
function tripCreateStopRotor() {
  if (tripCreateRotorTimer) { clearInterval(tripCreateRotorTimer); tripCreateRotorTimer = null; }
}

// The trip name writes itself ("<City> with the crew") until hand-edited.
function tripCreateOnDestination(destEl) {
  const nameEl = destEl.form && destEl.form.name;
  if (!nameEl) return;
  const city = destEl.value.split(',')[0].trim();
  if (!tripCreateNameTouched) nameEl.value = city ? `${city} with the crew` : '';
}

// Presets: no start date yet → upcoming Friday; end = start + nights.
function tripCreatePreset(form, nights) {
  let start = form.startDate.value;
  if (!start) {
    const d = new Date();
    d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7)); // next Friday
    start = isoDate(d);
    form.startDate.value = start;
  }
  const end = parseIso(start);
  end.setDate(end.getDate() + nights);
  form.endDate.value = isoDate(end);
  tripCreateOnDates(form);
}

// Live "6 DAYS · IN 312 DAYS" chip — updated in place, JetBrains-mono style.
function tripCreateOnDates(form) {
  const meta = document.getElementById('trip-create-meta');
  if (!meta) return;
  const s = form.startDate.value, e = form.endDate.value;
  if (s) form.endDate.min = s;
  if (!s || !e || e < s) { meta.textContent = ''; meta.classList.remove('show'); return; }
  const days = daysBetweenInclusive(s, e);
  const today = isoDate(new Date());
  let when;
  if (today >= s && today <= e) when = 'happening now ✈';
  else if (today > e) when = 'a memory now';
  else {
    const lead = Math.round((parseIso(s) - parseIso(today)) / 86400000);
    when = lead === 1 ? 'tomorrow ✈' : `in ${lead} days`;
  }
  meta.textContent = `${days} day${days === 1 ? '' : 's'} · ${when}`;
  meta.classList.remove('show');
  void meta.offsetWidth; // restart the pop-in animation on every change
  meta.classList.add('show');
}

function renderTripCard(t) {
  const startDate = t.startDate || (t.dates && t.dates.startDate) || '';
  const endDate = t.endDate || (t.dates && t.dates.endDate) || '';
  const dates = formatTripDateRange(startDate, endDate);
  const role = t.role || 'editor';
  const roleLabel = role === 'owner' ? 'Owner' : (role === 'kid' || role === 'kid-read') ? 'View only' : 'Editor';
  const faces = t.memberFaces || [];
  const counts = t.counts || {};
  const places = counts.itinerary != null ? counts.itinerary : (counts.places || 0);
  const flights = counts.flights || 0;
  return `
    <div class="trip-card" onclick="tripsGoHub('${esc(t.id)}')">
      <div class="trip-card-top">
        <div class="trip-card-name">${esc(t.name || 'Untitled trip')}</div>
        <div class="role-chip role-${esc(role)}">${roleLabel}</div>
      </div>
      <div class="trip-card-meta micro-label">${esc(dates)}${t.destination ? ' · ' + esc(t.destination) : ''}</div>
      <div class="trip-card-bottom">
        <div class="avatar-stack">${renderAvatarStack(faces, 26)}</div>
        <div class="trip-card-counts">${places} place${places === 1 ? '' : 's'} · ${flights} flight${flights === 1 ? '' : 's'}</div>
      </div>
    </div>
  `;
}

async function tripsSubmitNew(e) {
  e.preventDefault();
  const f = e.target;
  const payload = {
    name: f.name.value.trim(),
    destination: f.destination.value.trim(),
    startDate: f.startDate.value,
    endDate: f.endDate.value,
  };
  if (!payload.name || !payload.startDate || !payload.endDate) {
    toast('Fill in the trip name and dates first.');
    return;
  }
  try {
    const res = await window.auth.createTrip(payload);
    tripsNewFormOpen = false;
    const id = res && res.trip && res.trip.id;
    if (id) tripsGoHub(id);
    else await tripsLoadList();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

/* ============================================================
   TRIP HUB (/trips/<id>)
============================================================ */
async function tripsLoadHub(id) {
  const root = document.getElementById('trips-root');
  if (!root) return;
  root.innerHTML = '<div class="trip-main"><p class="text-muted">Loading trip…</p></div>';
  currentTab = 'overview';
  tripOpenThreads = new Set();
  tripFormState = null;
  tripFlightFormOpen = false;
  tripLodgingFormOpen = false;
  tripEditFormOpen = false;
  tripInviteCopied = false;
  tripChecklistFormOpen = false;
  tripChecklistRenameId = null;
  tripPasteOpen = false;
  tripPasteText = '';
  tripPasteParsing = false;
  tripPasteAdding = false;
  tripPasteResult = null;
  try {
    const res = await window.auth.getTrip(id);
    currentTrip = res && res.trip;
    if (!currentTrip) throw new Error('Trip not found.');
    renderHub();
  } catch (err) {
    root.innerHTML = `
      <div class="trip-main">
        <p class="error-msg">${esc(err.message)}</p>
        <p><a href="/trips" onclick="event.preventDefault();tripsGoList()">← Back to trips</a></p>
      </div>`;
  }
}

function renderHub() {
  if (!currentTrip) return;
  const kid = isKidRole();
  if (kid && currentTab === 'chat') currentTab = 'overview';
  const tabsDef = [['overview', 'Overview'], ['itinerary', 'Itinerary'], ['flights', 'Flights'], ['lodging', 'Lodging'], ['packing', 'Packing']];
  if (!kid) tabsDef.push(['chat', 'Chat']);
  tabsDef.push(['people', 'People']);

  const root = document.getElementById('trips-root');
  if (!root) return;
  root.innerHTML = `
    ${tripHubHeaderHtml()}
    <nav class="trip-tabs">
      <div class="trip-tabs-inner">
        ${tabsDef.map(([id, label]) => `<button type="button" class="trip-tab-btn${currentTab === id ? ' active' : ''}" onclick="tripsGoTab('${id}')">${esc(label)}</button>`).join('')}
      </div>
    </nav>
    <div class="trip-main" id="trip-tab-content"></div>
  `;
  rerenderTab();

  if (currentTab === 'chat') {
    tripLoadChat();
    tripStartChatPolling();
  } else {
    tripStopChatPolling();
    if (currentTab === 'packing') tripEnsurePacking();
  }
}

function rerenderTab() {
  const el = document.getElementById('trip-tab-content');
  if (!el || !currentTrip) return;
  if (currentTab === 'overview') el.innerHTML = renderOverviewTab();
  else if (currentTab === 'itinerary') el.innerHTML = renderItineraryTabHtml();
  else if (currentTab === 'flights') el.innerHTML = renderFlightsTabHtml();
  else if (currentTab === 'lodging') el.innerHTML = renderLodgingTabHtml();
  else if (currentTab === 'packing') el.innerHTML = renderPackingTabHtml();
  else if (currentTab === 'chat') el.innerHTML = renderChatTabHtml();
  else if (currentTab === 'people') el.innerHTML = renderPeopleTabHtml();
}

// The brand tile doubles as the back-to-app link (Waypoint mock: logo tile +
// wordmark + divider + trip title, all in ONE sticky row — no separate chrome
// bar). Used by both the hub header and the trips-list top bar.
function tripBrandHtml() {
  return `
    <a class="trip-brand" href="/" title="Back to Fam ETC" aria-label="Back to Fam ETC">
      <span class="trip-brand-tile">${ICON_PLANE}</span>
      <span class="trip-brand-name">Fam ETC</span>
    </a>
    <div class="trip-brand-divider"></div>`;
}

function tripHubHeaderHtml() {
  const t = currentTrip;
  const kid = isKidRole();
  const dates = formatTripDateRange(t.startDate, t.endDate);
  const members = t.members || [];
  return `
    <div class="trip-hub-header">
      <div class="trip-hub-inner">
        ${tripBrandHtml()}
        <div class="trip-hub-title">
          <div class="trip-hub-name-row">
            <div class="trip-hub-name">${esc(t.name)}</div>
            ${!kid ? `<button type="button" class="trip-icon-btn" title="Edit trip" onclick="tripToggleEditForm()">${ICON_EDIT}</button>` : ''}
          </div>
          <div class="micro-label trip-hub-meta">${esc(dates)}${t.destination ? ' · ' + esc(t.destination) : ''}</div>
        </div>
        <div class="trip-hub-header-right">
          <div class="avatar-stack">${renderAvatarStack(members, 30)}</div>
          ${!kid ? `<button type="button" class="btn-primary" onclick="tripsGoTab('people')">Invite friends</button>` : ''}
        </div>
      </div>
    </div>
    ${!kid && tripEditFormOpen ? `<div class="trip-main" style="padding-bottom:0">${tripEditFormHtml()}</div>` : ''}
  `;
}

function tripToggleEditForm() {
  tripEditFormOpen = !tripEditFormOpen;
  renderHub();
}

function tripEditFormHtml() {
  const t = currentTrip;
  return `
    <form class="trip-inline-form" onsubmit="tripSubmitEdit(event)" style="margin-bottom:16px">
      <div class="trip-form-row">
        <input class="trip-input" name="name" value="${esc(t.name)}" placeholder="Trip name" required maxlength="80">
        <input class="trip-input" name="destination" value="${esc(t.destination || '')}" placeholder="Destination" maxlength="120">
      </div>
      <div class="trip-form-row">
        <input class="trip-input" type="date" name="startDate" value="${esc(t.startDate)}" required>
        <input class="trip-input" type="date" name="endDate" value="${esc(t.endDate)}" required>
      </div>
      <div class="trip-form-actions">
        <button type="submit" class="btn-primary">Save changes</button>
        <button type="button" class="btn-secondary" onclick="tripToggleEditForm()">Cancel</button>
        ${isOwnerRole() ? `<button type="button" class="btn-danger" style="margin-left:auto" onclick="tripDeleteTrip()">Delete trip</button>` : ''}
      </div>
    </form>
  `;
}

async function tripSubmitEdit(e) {
  e.preventDefault();
  const f = e.target;
  const payload = {
    name: f.name.value.trim(),
    destination: f.destination.value.trim(),
    startDate: f.startDate.value,
    endDate: f.endDate.value,
  };
  try {
    const res = await window.auth.updateTrip(currentTripId, payload);
    if (res && res.trip) currentTrip = res.trip;
    tripEditFormOpen = false;
    renderHub();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

async function tripDeleteTrip() {
  if (!confirm("Delete this trip for everyone? This can't be undone.")) return;
  try {
    await window.auth.deleteTrip(currentTripId);
    tripsGoList();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

/* ============================================================
   OVERVIEW TAB
============================================================ */
function renderOverviewTab() {
  const t = currentTrip;
  const itin = t.itinerary || [];
  const flights = t.flights || [];
  const lodging = t.lodging || [];
  const members = t.members || [];
  const stats = [
    { k: 'Days', v: String(daysBetweenInclusive(t.startDate, t.endDate)) },
    { k: 'Travelers', v: String(members.length) },
    { k: 'Places planned', v: String(itin.length) },
    { k: 'Flights', v: String(flights.length) },
  ];
  const nextFlight = flights[0];
  const homeBase = lodging[0];
  const topVoted = itin
    .filter((i) => (i.votes || []).length > 0)
    .slice()
    .sort((a, b) => (b.votes || []).length - (a.votes || []).length)
    .slice(0, 4);
  const feed = (t.activity || []).slice(-6).reverse();

  return `
    <div class="trip-stat-grid">
      ${stats.map((s) => `<div class="card trip-stat-card"><div class="micro-label">${esc(s.k)}</div><div class="trip-stat-val">${esc(s.v)}</div></div>`).join('')}
    </div>
    <div class="trip-overview-row">
      <div class="card">
        <div class="micro-label trip-panel-title">Next flight</div>
        ${nextFlight ? `
          <div class="trip-next-flight-top">
            <div class="trip-next-flight-route">${esc((nextFlight.from || '—') + ' → ' + (nextFlight.to || '—'))}</div>
            <div class="trip-next-flight-sub">${esc(nextFlight.airline || '')}${nextFlight.flightNo ? ' · ' + esc(nextFlight.flightNo) : ''}</div>
          </div>
          <div class="trip-next-flight-times">${esc(nextFlight.departs || '')}${nextFlight.arrives ? ' — ' + esc(nextFlight.arrives) : ''}</div>
        ` : `<p class="text-muted">No flights added yet.</p>`}
        <a href="#" class="trip-link-more" onclick="event.preventDefault();tripsGoTab('flights')">All flights →</a>
      </div>
      <div class="card">
        <div class="micro-label trip-panel-title">Home base</div>
        ${homeBase ? `
          <div class="trip-homebase-name">${esc(homeBase.name)}</div>
          <div class="trip-homebase-addr">${esc(homeBase.address || '')}</div>
          <div class="trip-homebase-times">${esc(homeBase.checkIn || '')}${homeBase.checkOut ? ' → ' + esc(homeBase.checkOut) : ''}</div>
        ` : `<p class="text-muted">No lodging added yet.</p>`}
        <a href="#" class="trip-link-more" onclick="event.preventDefault();tripsGoTab('lodging')">Lodging →</a>
      </div>
    </div>
    <div class="trip-overview-row">
      <div class="card">
        <div class="micro-label trip-panel-title">Crowd favorites</div>
        ${topVoted.length ? `<div class="trip-favorites-list">
          ${topVoted.map((it, i) => `
            <div class="trip-favorite-row">
              <div class="trip-favorite-rank">0${i + 1}</div>
              <div class="trip-favorite-title">${esc(it.title)}</div>
              <div class="avatar-stack">${renderAvatarStack((it.votes || []).slice(0, 4).map(memberFor), 22)}</div>
              <div class="trip-favorite-count">+${(it.votes || []).length}</div>
            </div>
          `).join('')}
        </div>` : `<p class="text-muted">No votes yet — head to the itinerary and tap ♥ on your favorites.</p>`}
        <a href="#" class="trip-link-more" onclick="event.preventDefault();tripsGoTab('itinerary')">Open itinerary →</a>
      </div>
      <div class="card">
        <div class="micro-label trip-panel-title">Latest from the crew</div>
        ${feed.length ? `<div class="trip-feed-list">
          ${feed.map((fe) => {
            const face = memberFor(fe.userId);
            return `<div class="trip-feed-row">
              ${avatarHtml(face.initial, face.color, 26, false)}
              <div class="trip-feed-text"><strong>${esc(face.name)}</strong> ${esc(fe.text || '')}</div>
              <div class="trip-feed-when">${esc(timeAgo(fe.at))}</div>
            </div>`;
          }).join('')}
        </div>` : `<p class="text-muted">No activity yet.</p>`}
      </div>
    </div>
  `;
}

/* ============================================================
   ITINERARY TAB
============================================================ */
function buildDays(trip) {
  const dates = new Set();
  if (trip.startDate && trip.endDate) {
    const start = parseIso(trip.startDate);
    const end = parseIso(trip.endDate);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) dates.add(isoDate(d));
  }
  (trip.itinerary || []).forEach((it) => { if (it.date) dates.add(it.date); });
  return Array.from(dates).sort().map((dateStr) => ({
    date: dateStr,
    items: (trip.itinerary || [])
      .filter((it) => it.date === dateStr)
      .sort((a, b) => (a.order || 0) - (b.order || 0)),
  }));
}

// Unscheduled itinerary items (date === null) — sorted votes desc, then order.
function buildIdeas(trip) {
  return (trip.itinerary || [])
    .filter((it) => !it.date)
    .slice()
    .sort((a, b) => ((b.votes || []).length - (a.votes || []).length) || ((a.order || 0) - (b.order || 0)));
}

function findItineraryItem(id) {
  return (currentTrip.itinerary || []).find((i) => i.id === id);
}

// Inline JS argument for a possibly-null date inside an onclick/ondrag attribute
// (esc(null) would render the literal string "null", not the value null).
function tripDateArg(d) {
  return d === null || d === undefined ? 'null' : `'${esc(d)}'`;
}

function tripReplaceItem(item) {
  currentTrip.itinerary = currentTrip.itinerary || [];
  const idx = currentTrip.itinerary.findIndex((i) => i.id === item.id);
  if (idx !== -1) currentTrip.itinerary[idx] = item;
  else currentTrip.itinerary.push(item);
}

function renderItineraryTabHtml() {
  const kid = isKidRole();
  const days = buildDays(currentTrip);
  return `
    ${renderIdeasPanel(kid)}
    <div class="trip-itin-toolbar">
      <div class="trip-section-title">Itinerary</div>
      <div class="trip-itin-hint">${kid ? 'View only' : 'Drag places to reorder or move between days · tap ♥ to vote'}</div>
    </div>
    <div class="trip-days">
      ${days.length ? days.map((day) => renderDaySection(day, kid)).join('') : '<p class="text-muted">This trip has no dates yet.</p>'}
    </div>
  `;
}

function renderIdeasPanel(kid) {
  const ideas = buildIdeas(currentTrip);
  const addFormHere = !kid && tripFormState && tripFormState.dayDate === null && !tripFormState.itemId && !tripFormState.scheduling;
  return `
    <section class="trip-ideas-panel">
      <div class="trip-ideas-head">
        <div class="trip-ideas-title">💡 Ideas</div>
        <div class="trip-ideas-sub micro-label">Unscheduled — vote first, pick a day later</div>
      </div>
      <div class="trip-ideas-items">
        ${ideas.length ? ideas.map((it) => renderItineraryItem(it, null, kid, true)).join('') : (addFormHere ? '' : '<p class="text-muted" style="margin:0">No ideas yet — drag a place here, or add one below.</p>')}
        ${addFormHere ? renderIdeaFormHtml(null) : ''}
        ${!kid ? `
          <div class="trip-ideas-enddrop" ondragover="tripIdeasEndDragOver(event)" ondrop="tripIdeasEndDrop(event)">
            <div class="trip-drop-indicator" id="drop-end-ideas"></div>
            <button type="button" class="trip-add-place-btn" onclick="tripOpenAddIdeaForm()">+ Add an idea</button>
          </div>
        ` : ''}
      </div>
    </section>
  `;
}

function renderDaySection(day, kid) {
  const d = parseIso(day.date);
  const dateBadge = formatShort(d).toUpperCase();
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
  const formHere = !kid && tripFormState && tripFormState.dayDate === day.date && !tripFormState.itemId && !tripFormState.scheduling;
  return `
    <section>
      <div class="trip-day-head">
        <div class="micro-label trip-day-badge">${esc(dateBadge)}</div>
        <div class="trip-day-label">${esc(weekday)}</div>
        <div class="trip-day-count micro-label">${day.items.length} ${day.items.length === 1 ? 'place' : 'places'}</div>
      </div>
      <div class="trip-day-items">
        ${day.items.map((it) => renderItineraryItem(it, day.date, kid)).join('')}
        ${formHere ? renderItineraryForm(day.date, null) : ''}
        ${!kid ? `
          <div class="trip-day-enddrop" ondragover="tripDayEndDragOver(event,'${esc(day.date)}')" ondrop="tripDayEndDrop(event,'${esc(day.date)}')">
            <div class="trip-drop-indicator" id="drop-end-${esc(day.date)}"></div>
            <button type="button" class="trip-add-place-btn" onclick="tripOpenAddForm('${esc(day.date)}')">+ Add a place</button>
          </div>
        ` : ''}
      </div>
    </section>
  `;
}

function renderItineraryItem(it, dayDate, kid, isIdea) {
  const cat = CATS[it.category] || CATS.activity;
  const voted = !kid && (it.votes || []).includes(currentUserId);
  const editingHere = !kid && tripFormState && tripFormState.itemId === it.id && !tripFormState.scheduling;
  const schedulingHere = !kid && tripFormState && tripFormState.itemId === it.id && tripFormState.scheduling;
  const threadOpen = tripOpenThreads.has(it.id);
  const comments = it.comments || [];
  const dragAttrs = !kid
    ? ` draggable="true" ondragstart="tripItemDragStart(event,'${esc(it.id)}',${tripDateArg(dayDate)})" ondragover="tripItemDragOver(event,'${esc(it.id)}')" ondrop="tripItemDrop(event,${tripDateArg(dayDate)},'${esc(it.id)}')" ondragend="tripDragEnd()"`
    : '';
  let formHtml = '';
  if (schedulingHere) formHtml = renderScheduleFormHtml(it);
  else if (editingHere) formHtml = isIdea ? renderIdeaFormHtml(it) : renderItineraryForm(dayDate, it);
  return `
    <div>
      <div class="trip-drop-indicator" id="drop-${esc(it.id)}"></div>
      ${(editingHere || schedulingHere) ? formHtml : `
      <div class="trip-item"${dragAttrs}>
        ${!kid ? ICON_DRAG : ''}
        ${!isIdea ? `<div class="trip-item-time">${esc(it.time || '')}</div>` : ''}
        <div class="trip-item-body">
          <div class="trip-item-title-row">
            <div class="trip-item-title">${esc(it.title)}</div>
            <div class="cat-pill"><span class="cat-dot" style="background:${cat.color}"></span>${cat.label}</div>
          </div>
          ${it.note ? `<div class="trip-item-note">${esc(it.note)}</div>` : ''}
        </div>
        <div class="trip-item-actions">
          ${!kid ? `<button type="button" class="trip-vote-btn${voted ? ' voted' : ''}" onclick="tripToggleVote('${esc(it.id)}')" title="Vote for this">${ICON_HEART.replace('{{FILL}}', voted ? 'currentColor' : 'none')}${(it.votes || []).length}</button>` : ''}
          <button type="button" class="trip-thread-btn" onclick="tripToggleThread('${esc(it.id)}')" title="Comments">${ICON_THREAD}${comments.length}</button>
          ${!kid && isIdea ? `<button type="button" class="trip-schedule-btn" onclick="tripOpenScheduleForm('${esc(it.id)}')">Schedule →</button>` : ''}
          ${!kid ? `
            <button type="button" class="trip-icon-btn" title="Edit" onclick="tripOpenEditForm('${esc(it.id)}')">${ICON_EDIT}</button>
            <button type="button" class="trip-icon-btn danger" title="Remove" onclick="tripDeleteItem('${esc(it.id)}')">${ICON_TRASH}</button>
          ` : ''}
        </div>
      </div>
      `}
      ${threadOpen ? renderThread(it, kid, comments) : ''}
    </div>
  `;
}

function renderThread(it, kid, comments) {
  return `
    <div class="trip-thread-panel">
      ${comments.length ? comments.map((cm) => {
        const face = memberFor(cm.userId);
        const canDelete = !kid && (isOwnerRole() || cm.userId === currentUserId);
        return `<div class="trip-comment-row">
          ${avatarHtml(face.initial, face.color, 24, false)}
          <div class="trip-comment-body"><strong>${esc(face.name)}</strong>&nbsp; <span>${esc(cm.text)}</span></div>
          ${!kid ? `<div class="trip-comment-actions">
            ${canDelete ? `<button type="button" class="trip-icon-btn small" title="Delete" onclick="tripDeleteComment('${esc(it.id)}','${esc(cm.id)}')">${ICON_TRASH}</button>` : ''}
            <button type="button" class="trip-icon-btn small" title="Report" onclick="tripFlagComment('${esc(it.id)}','${esc(cm.id)}')">🚩</button>
          </div>` : ''}
        </div>`;
      }).join('') : `<p class="text-muted" style="margin:0">No comments yet.</p>`}
      ${!kid ? `<form class="trip-comment-form" onsubmit="tripSubmitComment(event,'${esc(it.id)}')">
        <input class="trip-input" name="c" placeholder="Add a comment…" autocomplete="off" maxlength="1000">
        <button type="submit" class="btn-secondary">Send</button>
      </form>` : ''}
    </div>
  `;
}

function renderItineraryForm(dayDate, item) {
  const v = item || {};
  const cats = Object.keys(CATS);
  return `
    <form class="trip-inline-form" onsubmit="tripSubmitItineraryForm(event,'${esc(dayDate)}')">
      <div class="trip-form-row">
        <input class="trip-input trip-input-mono trip-input-time" name="time" value="${esc(v.time || '')}" placeholder="10:30" autocomplete="off">
        <input class="trip-input trip-input-grow" name="title" value="${esc(v.title || '')}" placeholder="What's the plan? e.g. Lunch at Time Out Market" autocomplete="off" maxlength="200">
        <select class="trip-select" name="cat">
          ${cats.map((c) => `<option value="${c}"${(v.category ? v.category === c : c === 'activity') ? ' selected' : ''}>${CATS[c].label}</option>`).join('')}
        </select>
      </div>
      <input class="trip-input" name="note" value="${esc(v.note || '')}" placeholder="Notes for the crew (optional)" autocomplete="off" maxlength="1000">
      <div class="trip-form-actions">
        <button type="submit" class="btn-primary">${item ? 'Save changes' : 'Add to day'}</button>
        <button type="button" class="btn-secondary" onclick="tripCancelForm()">Cancel</button>
      </div>
    </form>
  `;
}

// Idea add/edit form: title, category, note only — no date/time (v1.1 §1).
function renderIdeaFormHtml(item) {
  const v = item || {};
  const cats = Object.keys(CATS);
  return `
    <form class="trip-inline-form" onsubmit="tripSubmitIdeaForm(event${item ? `,'${esc(item.id)}'` : ''})">
      <div class="trip-form-row">
        <input class="trip-input trip-input-grow" name="title" value="${esc(v.title || '')}" placeholder="Add an idea… e.g. Try the pastel de nata place" autocomplete="off" maxlength="200">
        <select class="trip-select" name="cat">
          ${cats.map((c) => `<option value="${c}"${(v.category ? v.category === c : c === 'activity') ? ' selected' : ''}>${CATS[c].label}</option>`).join('')}
        </select>
      </div>
      <input class="trip-input" name="note" value="${esc(v.note || '')}" placeholder="Notes for the crew (optional)" autocomplete="off" maxlength="1000">
      <div class="trip-form-actions">
        <button type="submit" class="btn-primary">${item ? 'Save changes' : 'Add idea'}</button>
        <button type="button" class="btn-secondary" onclick="tripCancelForm()">Cancel</button>
      </div>
    </form>
  `;
}

// "Schedule →" form: picks a real date (+ optional time) for an idea.
function renderScheduleFormHtml(item) {
  const v = item || {};
  const min = (currentTrip && currentTrip.startDate) || '';
  const max = (currentTrip && currentTrip.endDate) || '';
  return `
    <form class="trip-inline-form" onsubmit="tripSubmitScheduleForm(event,'${esc(item.id)}')">
      <div class="trip-form-row">
        <input class="trip-input" type="date" name="date" value="${esc(v.date || min)}" min="${esc(min)}" max="${esc(max)}" required>
        <input class="trip-input trip-input-mono trip-input-time" name="time" value="${esc(v.time || '')}" placeholder="10:30" autocomplete="off">
      </div>
      <div class="trip-form-actions">
        <button type="submit" class="btn-primary">Schedule</button>
        <button type="button" class="btn-secondary" onclick="tripCancelForm()">Cancel</button>
      </div>
    </form>
  `;
}

function tripOpenAddForm(dayDate) {
  tripFormState = { dayDate, itemId: null, scheduling: false };
  rerenderTab();
}

function tripOpenEditForm(itemId) {
  const item = findItineraryItem(itemId);
  if (!item) return;
  tripFormState = { dayDate: item.date, itemId: item.id, scheduling: false };
  rerenderTab();
}

function tripOpenAddIdeaForm() {
  tripFormState = { dayDate: null, itemId: null, scheduling: false };
  rerenderTab();
}

function tripOpenScheduleForm(itemId) {
  const item = findItineraryItem(itemId);
  if (!item) return;
  tripFormState = { dayDate: null, itemId: item.id, scheduling: true };
  rerenderTab();
}

function tripCancelForm() {
  tripFormState = null;
  rerenderTab();
}

async function tripSubmitItineraryForm(e, dayDate) {
  e.preventDefault();
  const f = e.target;
  const title = f.title.value.trim();
  if (!title) { toast('Give it a title first.'); return; }
  const payload = {
    date: dayDate,
    time: f.time.value.trim(),
    title,
    category: f.cat.value,
    note: f.note.value.trim(),
  };
  try {
    let res;
    if (tripFormState && tripFormState.itemId) {
      res = await window.auth.updateTripItineraryItem(currentTripId, tripFormState.itemId, payload);
    } else {
      res = await window.auth.addTripItineraryItem(currentTripId, payload);
    }
    if (res && res.item) tripReplaceItem(res.item);
    tripFormState = null;
    rerenderTab();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

async function tripSubmitIdeaForm(e, itemId) {
  e.preventDefault();
  const f = e.target;
  const title = f.title.value.trim();
  if (!title) { toast('Give it a title first.'); return; }
  const payload = { title, category: f.cat.value, note: f.note.value.trim() };
  try {
    let res;
    if (itemId) {
      res = await window.auth.updateTripItineraryItem(currentTripId, itemId, payload);
    } else {
      payload.date = null;
      payload.time = '';
      res = await window.auth.addTripItineraryItem(currentTripId, payload);
    }
    if (res && res.item) tripReplaceItem(res.item);
    tripFormState = null;
    rerenderTab();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

async function tripSubmitScheduleForm(e, itemId) {
  e.preventDefault();
  const f = e.target;
  const date = f.date.value;
  if (!date) { toast('Pick a date first.'); return; }
  try {
    const res = await window.auth.updateTripItineraryItem(currentTripId, itemId, { date, time: f.time.value.trim() });
    if (res && res.item) tripReplaceItem(res.item);
    tripFormState = null;
    rerenderTab();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

async function tripDeleteItem(itemId) {
  if (!confirm('Remove this place from the itinerary?')) return;
  try {
    await window.auth.deleteTripItineraryItem(currentTripId, itemId);
    currentTrip.itinerary = (currentTrip.itinerary || []).filter((i) => i.id !== itemId);
    rerenderTab();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

async function tripToggleVote(itemId) {
  try {
    const res = await window.auth.voteTripItineraryItem(currentTripId, itemId);
    if (res && res.item) tripReplaceItem(res.item);
    rerenderTab();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

function tripToggleThread(itemId) {
  if (tripOpenThreads.has(itemId)) tripOpenThreads.delete(itemId);
  else tripOpenThreads.add(itemId);
  rerenderTab();
}

async function tripSubmitComment(e, itemId) {
  e.preventDefault();
  const input = e.target.elements.c;
  const text = input.value.trim();
  if (!text) return;
  try {
    const res = await window.auth.addTripComment(currentTripId, itemId, text);
    const item = findItineraryItem(itemId);
    if (item && res && res.comment) {
      item.comments = item.comments || [];
      item.comments.push(res.comment);
    }
    input.value = '';
    rerenderTab();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

async function tripDeleteComment(itemId, commentId) {
  if (!confirm('Delete this comment?')) return;
  try {
    await window.auth.deleteTripComment(currentTripId, itemId, commentId);
    const item = findItineraryItem(itemId);
    if (item) item.comments = (item.comments || []).filter((c) => c.id !== commentId);
    rerenderTab();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

async function tripFlagComment(itemId, commentId) {
  const reason = prompt("What's wrong with this comment? (optional)") || '';
  try {
    await window.auth.flagTripComment(currentTripId, itemId, commentId, reason);
    toast('Comment reported. The trip owner will review it. 🚩');
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

/* ---------- drag-and-drop reorder / move across days ---------- */
function tripClearDropIndicators() {
  document.querySelectorAll('.trip-drop-indicator.show').forEach((el) => el.classList.remove('show'));
}

function tripItemDragStart(e, itemId, fromDate) {
  dragItemId = itemId;
  dragFromDate = fromDate;
  try {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', itemId);
  } catch (err) { /* some browsers restrict dataTransfer access — safe to ignore */ }
}

function tripItemDragOver(e, beforeItemId) {
  if (!dragItemId || dragItemId === beforeItemId) return;
  e.preventDefault();
  tripClearDropIndicators();
  const ind = document.getElementById('drop-' + beforeItemId);
  if (ind) ind.classList.add('show');
}

function tripDayEndDragOver(e, date) {
  if (!dragItemId) return;
  e.preventDefault();
  tripClearDropIndicators();
  const ind = document.getElementById('drop-end-' + date);
  if (ind) ind.classList.add('show');
}

async function tripItemDrop(e, date, beforeItemId) {
  e.preventDefault();
  await tripMoveItem(date, beforeItemId);
}

async function tripDayEndDrop(e, date) {
  e.preventDefault();
  await tripMoveItem(date, null);
}

function tripIdeasEndDragOver(e) {
  if (!dragItemId) return;
  e.preventDefault();
  tripClearDropIndicators();
  const ind = document.getElementById('drop-end-ideas');
  if (ind) ind.classList.add('show');
}

async function tripIdeasEndDrop(e) {
  e.preventDefault();
  await tripMoveItem(null, null);
}

async function tripMoveItem(date, beforeId) {
  if (!dragItemId) return;
  const itemId = dragItemId;
  tripDragEnd();
  try {
    const res = await window.auth.moveTripItineraryItem(currentTripId, itemId, { date, beforeId: beforeId || null });
    if (res && res.trip) currentTrip = res.trip;
    rerenderTab();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

function tripDragEnd() {
  dragItemId = null;
  dragFromDate = null;
  tripClearDropIndicators();
}

/* ============================================================
   FLIGHTS TAB
============================================================ */
function renderFlightsTabHtml() {
  const kid = isKidRole();
  const flights = currentTrip.flights || [];
  return `
    <div class="trip-section-header">
      <div>
        <div class="trip-section-title">Flights</div>
        <div class="trip-section-sub">Paste details from your confirmation email — everyone can see them.</div>
      </div>
      ${!kid ? `
        <div class="trip-section-header-actions">
          <button type="button" class="btn-secondary" onclick="tripTogglePastePanel()">✨ Paste confirmation</button>
          <button type="button" class="btn-primary" onclick="tripToggleFlightForm()">+ Add flight</button>
        </div>
      ` : ''}
    </div>
    ${!kid ? renderPasteImportPanel() : ''}
    ${!kid && tripFlightFormOpen ? renderFlightForm() : ''}
    <div class="trip-card-list">
      ${flights.length ? flights.map((fl) => renderFlightCard(fl, kid)).join('') : `<p class="text-muted">No flights yet.</p>`}
    </div>
  `;
}

function renderFlightForm() {
  return `
    <form class="trip-inline-form" onsubmit="tripSubmitFlightForm(event)" style="margin-bottom:16px">
      <div class="trip-form-grid">
        <input class="trip-input" name="airline" placeholder="Airline · TAP Air Portugal" autocomplete="off">
        <input class="trip-input trip-input-mono" name="flightNo" placeholder="Flight # · TP 1026" autocomplete="off">
        <input class="trip-input trip-input-mono" name="confirmation" placeholder="Confirmation · TZ8K4Q" autocomplete="off">
      </div>
      <div class="trip-form-grid">
        <input class="trip-input trip-input-mono" name="from" placeholder="From · BOS" autocomplete="off" maxlength="8">
        <input class="trip-input trip-input-mono" name="to" placeholder="To · LIS" autocomplete="off" maxlength="8">
        <input class="trip-input" name="departs" placeholder="Departs · Jun 3, 21:50" autocomplete="off">
        <input class="trip-input" name="arrives" placeholder="Arrives · Jun 4, 09:25" autocomplete="off">
      </div>
      <div class="trip-form-actions">
        <button type="submit" class="btn-primary">Save flight</button>
        <button type="button" class="btn-secondary" onclick="tripToggleFlightForm()">Cancel</button>
      </div>
    </form>
  `;
}

function tripToggleFlightForm() {
  tripFlightFormOpen = !tripFlightFormOpen;
  rerenderTab();
}

function renderFlightCard(fl, kid) {
  const faces = (fl.travelerUserIds || []).map(memberFor);
  return `
    <div class="card trip-flight-card">
      <div class="trip-flight-icon">${ICON_PLANE}</div>
      <div class="trip-flight-main">
        <div class="trip-flight-route">${esc((fl.from || '—') + ' → ' + (fl.to || '—'))}</div>
        <div class="trip-flight-sub">${esc(fl.airline || '')}${fl.flightNo ? ' · ' : ''}<span class="trip-mono">${esc(fl.flightNo || '')}</span></div>
      </div>
      <div class="trip-flight-details">
        <div class="trip-flight-times">${esc(fl.departs || '')}${fl.arrives ? ' → ' + esc(fl.arrives) : ''}</div>
        <div class="micro-label" style="margin-top:4px">Conf <span class="trip-conf-chip">${esc(fl.confirmation || '—')}</span></div>
      </div>
      <div class="avatar-stack">${renderAvatarStack(faces, 26)}</div>
      ${!kid ? `<button type="button" class="trip-icon-btn danger" title="Remove" onclick="tripDeleteFlight('${esc(fl.id)}')">${ICON_TRASH_LG}</button>` : ''}
    </div>
  `;
}

async function tripSubmitFlightForm(e) {
  e.preventDefault();
  const f = e.target;
  const from = f.from.value.trim().toUpperCase();
  const to = f.to.value.trim().toUpperCase();
  const payload = {
    airline: f.airline.value.trim(),
    flightNo: f.flightNo.value.trim().toUpperCase(),
    confirmation: f.confirmation.value.trim().toUpperCase(),
    from,
    to,
    departs: f.departs.value.trim(),
    arrives: f.arrives.value.trim(),
  };
  try {
    const res = await window.auth.addTripFlight(currentTripId, payload);
    if (res && res.flight) { currentTrip.flights = currentTrip.flights || []; currentTrip.flights.push(res.flight); }
    tripFlightFormOpen = false;
    rerenderTab();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

async function tripDeleteFlight(id) {
  if (!confirm('Remove this flight?')) return;
  try {
    await window.auth.deleteTripFlight(currentTripId, id);
    currentTrip.flights = (currentTrip.flights || []).filter((f) => f.id !== id);
    rerenderTab();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

/* ============================================================
   LODGING TAB
============================================================ */
function renderLodgingTabHtml() {
  const kid = isKidRole();
  const lodging = currentTrip.lodging || [];
  return `
    <div class="trip-section-header">
      <div>
        <div class="trip-section-title">Lodging</div>
        <div class="trip-section-sub">Hotels, rentals, that friend's aunt's place — keep it all here.</div>
      </div>
      ${!kid ? `
        <div class="trip-section-header-actions">
          <button type="button" class="btn-secondary" onclick="tripTogglePastePanel()">✨ Paste confirmation</button>
          <button type="button" class="btn-primary" onclick="tripToggleLodgingForm()">+ Add lodging</button>
        </div>
      ` : ''}
    </div>
    ${!kid ? renderPasteImportPanel() : ''}
    ${!kid && tripLodgingFormOpen ? renderLodgingForm() : ''}
    <div class="trip-card-list">
      ${lodging.length ? lodging.map((ho) => renderLodgingCard(ho, kid)).join('') : `<p class="text-muted">No lodging yet.</p>`}
    </div>
  `;
}

function renderLodgingForm() {
  return `
    <form class="trip-inline-form" onsubmit="tripSubmitLodgingForm(event)" style="margin-bottom:16px">
      <div class="trip-form-grid">
        <input class="trip-input" name="name" placeholder="Name · Casa da Baixa" autocomplete="off">
        <input class="trip-input" name="address" placeholder="Address" autocomplete="off">
        <input class="trip-input trip-input-mono" name="confirmation" placeholder="Confirmation · HB-29174" autocomplete="off">
      </div>
      <div class="trip-form-grid">
        <input class="trip-input" name="checkIn" placeholder="Check-in · Jun 4, 15:00" autocomplete="off">
        <input class="trip-input" name="checkOut" placeholder="Check-out · Jun 9, 11:00" autocomplete="off">
        <input class="trip-input" name="note" placeholder="Notes · 3 rooms, rooftop terrace" autocomplete="off">
      </div>
      <div class="trip-form-actions">
        <button type="submit" class="btn-primary">Save lodging</button>
        <button type="button" class="btn-secondary" onclick="tripToggleLodgingForm()">Cancel</button>
      </div>
    </form>
  `;
}

function tripToggleLodgingForm() {
  tripLodgingFormOpen = !tripLodgingFormOpen;
  rerenderTab();
}

function renderLodgingCard(ho, kid) {
  return `
    <div class="card trip-lodging-card">
      <div class="trip-lodging-icon">${ICON_BED}</div>
      <div class="trip-lodging-main">
        <div class="trip-lodging-name">${esc(ho.name)}</div>
        <div class="trip-lodging-addr">${esc(ho.address || '')}</div>
        <div class="trip-lodging-cols">
          <div><div class="micro-label">Check-in</div><div class="trip-mono-val">${esc(ho.checkIn || '—')}</div></div>
          <div><div class="micro-label">Check-out</div><div class="trip-mono-val">${esc(ho.checkOut || '—')}</div></div>
          <div><div class="micro-label">Confirmation</div><div class="trip-mono-val">${esc(ho.confirmation || '—')}</div></div>
        </div>
        ${ho.note ? `<div class="trip-note-chip">${esc(ho.note)}</div>` : ''}
      </div>
      ${!kid ? `<button type="button" class="trip-icon-btn danger" title="Remove" onclick="tripDeleteLodging('${esc(ho.id)}')">${ICON_TRASH_LG}</button>` : ''}
    </div>
  `;
}

async function tripSubmitLodgingForm(e) {
  e.preventDefault();
  const f = e.target;
  const name = f.name.value.trim();
  if (!name) { toast('Give it a name first.'); return; }
  const payload = {
    name,
    address: f.address.value.trim(),
    confirmation: f.confirmation.value.trim(),
    checkIn: f.checkIn.value.trim(),
    checkOut: f.checkOut.value.trim(),
    note: f.note.value.trim(),
  };
  try {
    const res = await window.auth.addTripLodging(currentTripId, payload);
    if (res && res.lodging) { currentTrip.lodging = currentTrip.lodging || []; currentTrip.lodging.push(res.lodging); }
    tripLodgingFormOpen = false;
    rerenderTab();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

async function tripDeleteLodging(id) {
  if (!confirm('Remove this lodging?')) return;
  try {
    await window.auth.deleteTripLodging(currentTripId, id);
    currentTrip.lodging = (currentTrip.lodging || []).filter((h) => h.id !== id);
    rerenderTab();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

/* ============================================================
   PASTE-TO-IMPORT (v1.1 §3) — shared panel for Flights + Lodging tabs.
   Paste an email → window.auth.parseBooking → preview cards (flights AND
   lodging together, since one parse can find both) → "Add N selected" adds
   each via the normal addTripFlight/addTripLodging wrappers.
============================================================ */
function renderSpinner() {
  return '<span class="trip-spinner" aria-hidden="true"></span>';
}

function renderPasteImportPanel() {
  if (!tripPasteOpen) return '';
  if (!tripPasteResult) {
    return `
      <div class="card trip-paste-panel">
        <div class="trip-panel-title micro-label">✨ Paste confirmation</div>
        <div class="trip-section-sub" style="margin-bottom:10px">Paste the confirmation email here — flights, hotels, anything.</div>
        <form onsubmit="tripSubmitPasteParse(event)">
          <textarea class="trip-input trip-paste-textarea" name="text" placeholder="Paste the confirmation email here — flights, hotels, anything" ${tripPasteParsing ? 'disabled' : ''}>${esc(tripPasteText)}</textarea>
          <div class="trip-form-actions" style="margin-top:10px">
            <button type="submit" class="btn-primary" ${tripPasteParsing ? 'disabled' : ''}>${tripPasteParsing ? renderSpinner() + 'Parsing…' : 'Parse'}</button>
            <button type="button" class="btn-secondary" onclick="tripClosePastePanel()">Cancel</button>
          </div>
        </form>
      </div>
    `;
  }
  const flights = tripPasteResult.flights || [];
  const lodging = tripPasteResult.lodging || [];
  const total = flights.length + lodging.length;
  const selectedCount = flights.filter((f) => f._selected).length + lodging.filter((l) => l._selected).length;
  return `
    <div class="card trip-paste-panel">
      <div class="trip-panel-title micro-label">✨ Found ${total} booking${total === 1 ? '' : 's'}</div>
      <div class="trip-paste-preview-list">
        ${flights.map((f, i) => renderPasteFlightPreview(f, i)).join('')}
        ${lodging.map((l, i) => renderPasteLodgingPreview(l, i)).join('')}
      </div>
      <div class="trip-form-actions" style="margin-top:12px">
        <button type="button" class="btn-primary" ${(tripPasteAdding || !selectedCount) ? 'disabled' : ''} onclick="tripAddSelectedPasteItems()">${tripPasteAdding ? renderSpinner() + 'Adding…' : `Add ${selectedCount} selected`}</button>
        <button type="button" class="btn-secondary" onclick="tripClosePastePanel()">Cancel</button>
      </div>
    </div>
  `;
}

function renderPasteFlightPreview(f, i) {
  return `
    <label class="trip-paste-card">
      <input type="checkbox" ${f._selected ? 'checked' : ''} onchange="tripTogglePasteSelect('flights',${i},this.checked)">
      <div class="trip-paste-card-body">
        <div class="trip-paste-card-kind micro-label">✈ Flight</div>
        <div class="trip-paste-card-title">${esc((f.from || '—') + ' → ' + (f.to || '—'))}</div>
        <div class="trip-paste-card-sub">${esc(f.airline || '')}${f.flightNo ? ' · ' + esc(f.flightNo) : ''}${f.confirmation ? ' · Conf ' + esc(f.confirmation) : ''}</div>
        <div class="trip-paste-card-sub">${esc(f.departs || '')}${f.arrives ? ' → ' + esc(f.arrives) : ''}</div>
      </div>
    </label>
  `;
}

function renderPasteLodgingPreview(l, i) {
  return `
    <label class="trip-paste-card">
      <input type="checkbox" ${l._selected ? 'checked' : ''} onchange="tripTogglePasteSelect('lodging',${i},this.checked)">
      <div class="trip-paste-card-body">
        <div class="trip-paste-card-kind micro-label">🛏 Lodging</div>
        <div class="trip-paste-card-title">${esc(l.name || 'Untitled')}</div>
        <div class="trip-paste-card-sub">${esc(l.address || '')}</div>
        <div class="trip-paste-card-sub">${esc(l.checkIn || '')}${l.checkOut ? ' → ' + esc(l.checkOut) : ''}${l.confirmation ? ' · Conf ' + esc(l.confirmation) : ''}</div>
      </div>
    </label>
  `;
}

function tripTogglePastePanel() {
  tripPasteOpen = !tripPasteOpen;
  if (!tripPasteOpen) { tripPasteResult = null; tripPasteText = ''; }
  rerenderTab();
}

function tripClosePastePanel() {
  tripPasteOpen = false;
  tripPasteResult = null;
  tripPasteText = '';
  tripPasteParsing = false;
  rerenderTab();
}

function tripTogglePasteSelect(kind, idx, checked) {
  if (!tripPasteResult || !tripPasteResult[kind] || !tripPasteResult[kind][idx]) return;
  tripPasteResult[kind][idx]._selected = !!checked;
  rerenderTab();
}

async function tripSubmitPasteParse(e) {
  e.preventDefault();
  const text = e.target.text.value.trim();
  if (!text) { toast('Paste some text first.'); return; }
  tripPasteText = text;
  tripPasteParsing = true;
  rerenderTab();
  try {
    const res = await window.auth.parseBooking({ text });
    const flights = (res && res.flights) || [];
    const lodging = (res && res.lodging) || [];
    if (!flights.length && !lodging.length) throw new Error("Couldn't find any bookings in that text.");
    flights.forEach((f) => { f._selected = true; });
    lodging.forEach((l) => { l._selected = true; });
    tripPasteResult = { flights, lodging };
  } catch (err) {
    let msg;
    if (err.status === 503) msg = "AI parsing isn't set up on this server yet.";
    else if (err.status === 422) msg = "Couldn't find any bookings in that text.";
    else msg = err.message; // 429 (or anything else) — pass the server's own message through
    toast('❌ ' + msg);
  } finally {
    tripPasteParsing = false;
    rerenderTab();
  }
}

async function tripAddSelectedPasteItems() {
  if (!tripPasteResult) return;
  const flights = (tripPasteResult.flights || []).filter((f) => f._selected);
  const lodging = (tripPasteResult.lodging || []).filter((l) => l._selected);
  if (!flights.length && !lodging.length) { toast('Select at least one to add.'); return; }
  tripPasteAdding = true;
  rerenderTab();
  let added = 0;
  for (const f of flights) {
    try {
      await window.auth.addTripFlight(currentTripId, {
        airline: f.airline || '',
        flightNo: (f.flightNo || '').toUpperCase(),
        confirmation: (f.confirmation || '').toUpperCase(),
        from: (f.from || '').toUpperCase(),
        to: (f.to || '').toUpperCase(),
        departs: f.departs || '',
        arrives: f.arrives || '',
      });
      added++;
      toast(`✅ Added flight ${(f.from || '?')} → ${(f.to || '?')}`);
    } catch (err) {
      toast('❌ ' + err.message);
    }
  }
  for (const l of lodging) {
    try {
      await window.auth.addTripLodging(currentTripId, {
        name: l.name || '',
        address: l.address || '',
        confirmation: l.confirmation || '',
        checkIn: l.checkIn || '',
        checkOut: l.checkOut || '',
        note: l.note || '',
      });
      added++;
      toast(`✅ Added ${l.name || 'lodging'}`);
    } catch (err) {
      toast('❌ ' + err.message);
    }
  }
  tripPasteAdding = false;
  tripPasteOpen = false;
  tripPasteResult = null;
  tripPasteText = '';
  try {
    const res = await window.auth.getTrip(currentTripId);
    if (res && res.trip) currentTrip = res.trip;
  } catch (err) { /* keep local state if the refresh fails — mutations already landed */ }
  rerenderTab();
}

/* ============================================================
   PACKING TAB (v1.1 §2) — "My packing" (lazy get-or-create, the one
   kid-write surface in trips) + shared checklists with assignee chips.
============================================================ */
function tripMyChecklist() {
  return (currentTrip.checklists || []).find((c) => c.kind === 'personal' && c.ownerUserId === currentUserId);
}

function tripFindChecklist(listId) {
  return (currentTrip.checklists || []).find((c) => c.id === listId);
}

function tripReplaceChecklistItem(listId, item) {
  if (!item) return;
  const list = tripFindChecklist(listId);
  if (!list) return;
  list.items = list.items || [];
  const idx = list.items.findIndex((i) => i.id === item.id);
  if (idx !== -1) list.items[idx] = item;
  else list.items.push(item);
}

async function tripEnsurePacking() {
  if (tripMyChecklist()) return;
  try {
    const res = await window.auth.getOrCreateMyPacking(currentTripId);
    if (res && res.checklist) {
      currentTrip.checklists = currentTrip.checklists || [];
      currentTrip.checklists.push(res.checklist);
      if (currentTab === 'packing') rerenderTab();
    }
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

function renderPackingTabHtml() {
  const kid = isKidRole();
  const mine = tripMyChecklist();
  const shared = (currentTrip.checklists || []).filter((c) => c.kind === 'shared');
  return `
    <div class="trip-section-title" style="margin-bottom:4px">Packing</div>
    <div class="trip-section-sub" style="margin-bottom:16px">Quick-add the essentials, then split up shared lists with the crew.</div>
    ${mine ? renderPersonalChecklistCard(mine) : `<div class="card trip-packing-card"><p class="text-muted" style="margin:0">Loading your packing list…</p></div>`}
    <div class="trip-section-header" style="margin-top:22px">
      <div class="trip-panel-title micro-label" style="margin:0">Shared lists</div>
      ${!kid ? `<button type="button" class="btn-secondary" onclick="tripToggleChecklistForm()">+ New list</button>` : ''}
    </div>
    ${!kid && tripChecklistFormOpen ? renderNewChecklistForm() : ''}
    <div class="trip-checklist-grid">
      ${shared.length ? shared.map((c) => renderSharedChecklistCard(c, kid)).join('') : `<p class="text-muted">No shared lists yet.</p>`}
    </div>
  `;
}

function renderChecklistItemRow(list, item, isShared) {
  const kid = isKidRole();
  const mineOwn = list.kind === 'personal'; // the one kid-write surface: owner always may touch their own personal items
  const canToggle = mineOwn || !kid;
  const canDelete = mineOwn || !kid;
  const doneByFace = item.doneBy ? memberFor(item.doneBy) : null;
  return `
    <div class="trip-checklist-row${item.done ? ' done' : ''}">
      <label class="trip-checklist-check">
        <input type="checkbox" ${item.done ? 'checked' : ''} ${canToggle ? '' : 'disabled'} onchange="tripToggleChecklistItem('${esc(list.id)}','${esc(item.id)}',this.checked)">
        <span class="trip-checklist-text">${esc(item.text)}</span>
      </label>
      <div class="trip-checklist-row-meta">
        ${isShared ? renderAssigneeChip(list, item, kid) : ''}
        ${isShared && item.done && doneByFace ? avatarHtml(doneByFace.initial, doneByFace.color, 20, false) : ''}
        ${canDelete ? `<button type="button" class="trip-icon-btn small" title="Remove" onclick="tripDeleteChecklistItem('${esc(list.id)}','${esc(item.id)}')">${ICON_TRASH}</button>` : ''}
      </div>
    </div>
  `;
}

function renderAssigneeChip(list, item, kid) {
  const members = currentTrip.members || [];
  if (kid) {
    if (!item.assigneeUserId) return '';
    const f = memberFor(item.assigneeUserId);
    return avatarHtml(f.initial, f.color, 20, false);
  }
  return `<div class="trip-assignee-picker">
    ${members.map((m) => {
      const active = item.assigneeUserId === m.userId;
      return `<button type="button" class="trip-assignee-btn${active ? ' active' : ''}" title="${active ? 'Unassign' : 'Assign to '}${esc(m.name)}" onclick="tripSetAssignee('${esc(list.id)}','${esc(item.id)}','${esc(m.userId)}')">${avatarHtml(m.initial, m.color, 18, false)}</button>`;
    }).join('')}
  </div>`;
}

function renderPersonalChecklistCard(list) {
  const items = list.items || [];
  const done = items.filter((i) => i.done).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;
  return `
    <div class="card trip-packing-card trip-packing-mine">
      <div class="trip-packing-head">
        <div class="trip-panel-title micro-label" style="margin:0">${esc(list.title || 'My packing')}</div>
        <div class="trip-packing-count micro-label">${done}/${items.length} packed</div>
      </div>
      <div class="trip-progress-track"><div class="trip-progress-fill" style="width:${pct}%"></div></div>
      <div class="trip-packing-presets">
        ${PACKING_PRESETS.map((p) => `<button type="button" class="trip-preset-chip" onclick="tripAddPresetItem('${esc(list.id)}','${esc(p)}')">+ ${esc(p)}</button>`).join('')}
      </div>
      <div class="trip-checklist-items">
        ${items.length ? items.map((it) => renderChecklistItemRow(list, it, false)).join('') : `<p class="text-muted" style="margin:4px 0">Nothing packed yet — tap a chip above or add your own.</p>`}
      </div>
      <form class="trip-checklist-add-form" onsubmit="tripSubmitChecklistItem(event,'${esc(list.id)}')">
        <input class="trip-input" id="packing-add-${esc(list.id)}" name="text" placeholder="Add an item…" autocomplete="off" maxlength="200">
        <button type="submit" class="btn-secondary">Add</button>
      </form>
    </div>
  `;
}

function renderSharedChecklistCard(list, kid) {
  const items = list.items || [];
  const done = items.filter((i) => i.done).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;
  const canManageList = !kid && (isOwnerRole() || list.createdBy === currentUserId);
  const renamingHere = tripChecklistRenameId === list.id;
  return `
    <div class="card trip-checklist-card">
      <div class="trip-packing-head">
        ${renamingHere ? `
          <form class="trip-checklist-rename-form" onsubmit="tripSubmitRenameChecklist(event,'${esc(list.id)}')">
            <input class="trip-input" name="title" value="${esc(list.title)}" maxlength="80" autocomplete="off" autofocus>
            <button type="submit" class="btn-secondary">Save</button>
            <button type="button" class="btn-secondary" onclick="tripCancelRenameChecklist()">Cancel</button>
          </form>
        ` : `<div class="trip-panel-title micro-label" style="margin:0">${esc(list.title)}</div>`}
        <div class="trip-packing-count micro-label">${done}/${items.length} packed</div>
      </div>
      <div class="trip-progress-track"><div class="trip-progress-fill" style="width:${pct}%"></div></div>
      <div class="trip-checklist-items">
        ${items.length ? items.map((it) => renderChecklistItemRow(list, it, true)).join('') : `<p class="text-muted" style="margin:4px 0">No items yet.</p>`}
      </div>
      ${!kid ? `
        <form class="trip-checklist-add-form" onsubmit="tripSubmitChecklistItem(event,'${esc(list.id)}')">
          <input class="trip-input" id="packing-add-${esc(list.id)}" name="text" placeholder="Add an item…" autocomplete="off" maxlength="200">
          <button type="submit" class="btn-secondary">Add</button>
        </form>
      ` : ''}
      ${canManageList ? `
        <div class="trip-checklist-admin">
          <button type="button" class="trip-icon-btn small" title="Rename list" onclick="tripStartRenameChecklist('${esc(list.id)}')">${ICON_EDIT}</button>
          <button type="button" class="trip-icon-btn danger small" title="Delete list" onclick="tripDeleteChecklist('${esc(list.id)}')">${ICON_TRASH}</button>
        </div>
      ` : ''}
    </div>
  `;
}

function tripToggleChecklistForm() {
  tripChecklistFormOpen = !tripChecklistFormOpen;
  rerenderTab();
}

function renderNewChecklistForm() {
  return `
    <form class="trip-inline-form" onsubmit="tripSubmitNewChecklist(event)" style="margin-bottom:16px">
      <input class="trip-input" name="title" placeholder="List name · Beach day, Ski gear…" autocomplete="off" maxlength="80" autofocus>
      <div class="trip-form-actions">
        <button type="submit" class="btn-primary">Create list</button>
        <button type="button" class="btn-secondary" onclick="tripToggleChecklistForm()">Cancel</button>
      </div>
    </form>
  `;
}

async function tripSubmitNewChecklist(e) {
  e.preventDefault();
  const title = e.target.title.value.trim();
  if (!title) { toast('Give the list a name first.'); return; }
  try {
    const res = await window.auth.createTripChecklist(currentTripId, { title });
    if (res && res.checklist) { currentTrip.checklists = currentTrip.checklists || []; currentTrip.checklists.push(res.checklist); }
    tripChecklistFormOpen = false;
    rerenderTab();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

function tripStartRenameChecklist(listId) {
  tripChecklistRenameId = listId;
  rerenderTab();
}

function tripCancelRenameChecklist() {
  tripChecklistRenameId = null;
  rerenderTab();
}

async function tripSubmitRenameChecklist(e, listId) {
  e.preventDefault();
  const title = e.target.title.value.trim();
  if (!title) return;
  try {
    const res = await window.auth.renameTripChecklist(currentTripId, listId, { title });
    const list = tripFindChecklist(listId);
    if (list && res && res.checklist) Object.assign(list, res.checklist);
    tripChecklistRenameId = null;
    rerenderTab();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

async function tripDeleteChecklist(listId) {
  if (!confirm('Delete this packing list for everyone?')) return;
  try {
    await window.auth.deleteTripChecklist(currentTripId, listId);
    currentTrip.checklists = (currentTrip.checklists || []).filter((c) => c.id !== listId);
    rerenderTab();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

async function tripSubmitChecklistItem(e, listId) {
  e.preventDefault();
  const text = e.target.text.value.trim();
  if (!text) return;
  try {
    const res = await window.auth.addTripChecklistItem(currentTripId, listId, { text });
    if (res && res.item) {
      const list = tripFindChecklist(listId);
      if (list) { list.items = list.items || []; list.items.push(res.item); }
    }
    rerenderTab();
    const input = document.getElementById('packing-add-' + listId);
    if (input) input.focus();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

async function tripAddPresetItem(listId, text) {
  try {
    const res = await window.auth.addTripChecklistItem(currentTripId, listId, { text });
    if (res && res.item) {
      const list = tripFindChecklist(listId);
      if (list) { list.items = list.items || []; list.items.push(res.item); }
    }
    rerenderTab();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

async function tripToggleChecklistItem(listId, itemId, checked) {
  try {
    const res = await window.auth.updateTripChecklistItem(currentTripId, listId, itemId, { done: !!checked });
    tripReplaceChecklistItem(listId, res && res.item);
    rerenderTab();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

async function tripSetAssignee(listId, itemId, userId) {
  const list = tripFindChecklist(listId);
  const item = list && (list.items || []).find((i) => i.id === itemId);
  const next = item && item.assigneeUserId === userId ? null : userId;
  try {
    const res = await window.auth.updateTripChecklistItem(currentTripId, listId, itemId, { assigneeUserId: next });
    tripReplaceChecklistItem(listId, res && res.item);
    rerenderTab();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

async function tripDeleteChecklistItem(listId, itemId) {
  try {
    await window.auth.deleteTripChecklistItem(currentTripId, listId, itemId);
    const list = tripFindChecklist(listId);
    if (list) list.items = (list.items || []).filter((i) => i.id !== itemId);
    rerenderTab();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

/* ============================================================
   PEOPLE TAB
============================================================ */
function renderPeopleTabHtml() {
  const t = currentTrip;
  const kid = isKidRole();
  const members = t.members || [];
  const inviteUrl = t.inviteCode ? (location.origin + '/trips/join/' + t.inviteCode) : '';
  return `
    <div class="trip-section-title" style="margin-bottom:16px">The crew</div>
    ${!kid ? `
      <div class="card trip-invite-card">
        <div class="micro-label trip-panel-title">Invite link</div>
        ${t.inviteCode ? `
          <div class="trip-invite-row">
            <div class="trip-invite-link">${esc(inviteUrl)}</div>
            <button type="button" class="btn-primary" onclick="tripCopyInviteLink()">${tripInviteCopied ? 'Copied!' : 'Copy link'}</button>
          </div>
          <div class="trip-invite-hint">Anyone with the link joins as an editor. It's free — no account limits, no paywall.</div>
        ` : `<p class="text-muted" style="margin:0">The invite link is disabled.</p>`}
        ${isOwnerRole() ? `
          <div class="trip-invite-admin">
            <button type="button" class="btn-secondary" onclick="tripRegenerateInvite()">Regenerate link</button>
            ${t.inviteCode ? `<button type="button" class="btn-secondary" onclick="tripDisableInvite()">Disable link</button>` : ''}
          </div>
        ` : ''}
      </div>
    ` : ''}
    <div class="trip-member-list">
      ${members.map((m) => renderMemberRow(m, kid)).join('')}
    </div>
  `;
}

function renderMemberRow(m, kid) {
  const isSelf = m.userId === currentUserId;
  const roleLabel = m.role === 'owner' ? 'Owner' : 'Editor';
  const canRemove = !kid && (isSelf || isOwnerRole());
  return `
    <div class="trip-member-row">
      ${avatarHtml(m.initial, m.color, 36, false)}
      <div class="trip-member-info">
        <div class="trip-member-name">${esc(m.name)}${isSelf ? ' <span class="trip-you-tag">(you)</span>' : ''}</div>
      </div>
      <div class="role-chip role-${esc(m.role)}">${roleLabel}</div>
      ${canRemove ? `<button type="button" class="trip-icon-btn" title="${isSelf ? 'Leave trip' : 'Remove'}" onclick="tripRemoveMember('${esc(m.userId)}')">${ICON_TRASH}</button>` : ''}
    </div>
  `;
}

async function tripCopyInviteLink() {
  const url = location.origin + '/trips/join/' + (currentTrip.inviteCode || '');
  try { await navigator.clipboard.writeText(url); } catch (e) { /* clipboard unavailable — still flip the label */ }
  tripInviteCopied = true;
  rerenderTab();
  setTimeout(() => { tripInviteCopied = false; if (currentTab === 'people') rerenderTab(); }, 1800);
}

async function tripRegenerateInvite() {
  if (!confirm('Regenerate the invite link? The old link will stop working.')) return;
  try {
    const res = await window.auth.regenerateTripInvite(currentTripId);
    if (res && res.inviteCode) currentTrip.inviteCode = res.inviteCode;
    rerenderTab();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

async function tripDisableInvite() {
  if (!confirm("Disable the invite link? No one will be able to join with it until you regenerate.")) return;
  try {
    await window.auth.disableTripInvite(currentTripId);
    currentTrip.inviteCode = null;
    rerenderTab();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

async function tripRemoveMember(userId) {
  const isSelf = userId === currentUserId;
  if (!confirm(isSelf ? 'Leave this trip?' : 'Remove this person from the trip?')) return;
  try {
    await window.auth.removeTripMember(currentTripId, userId);
    if (isSelf) { tripsGoList(); return; }
    currentTrip.members = (currentTrip.members || []).filter((m) => m.userId !== userId);
    rerenderTab();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

/* ============================================================
   CHAT TAB — trip room, long-poll mirrors app.js's chatLongPollFetch/Loop
   (~line 2108) but hits /api/trips/:id/chat/messages and is fully trip-
   scoped so it can be started/stopped per tab switch (renderHub above).
============================================================ */
function renderChatTabHtml() {
  return `
    <div class="card trip-chat-card">
      <div class="chat-messages" id="trip-chat-messages"></div>
      <form class="chat-send-row" onsubmit="tripSendChatMessage(event)">
        <input type="text" id="trip-chat-input" class="chat-input" placeholder="Message the crew…" autocomplete="off" maxlength="4000">
        <button type="submit" class="btn-primary chat-send-btn" title="Send" aria-label="Send">${ICON_SEND}</button>
      </form>
    </div>
  `;
}

function tripChatAvatarFor(userId) {
  return memberFor(userId);
}

function tripChatUpdateMeta(type) {
  if (type === 'trip-flight') return { kind: 'flight', label: 'Flight', icon: '✈️' };
  if (type === 'trip-lodging') return { kind: 'lodging', label: 'Stay', icon: '🛏️' };
  if (type === 'trip-itinerary') return { kind: 'itinerary', label: 'Itinerary', icon: '🗺️' };
  if (type === 'trip-packing') return { kind: 'packing', label: 'Packing', icon: '🧳' };
  if (type === 'trip-member') return { kind: 'member', label: 'Crew', icon: '👋' };
  return null;
}

function renderTripChatUpdate(message, senderName, time, controls) {
  const card = message.card;
  const meta = card && tripChatUpdateMeta(card.type);
  if (!meta) return '';
  const title = card.title || message.text || 'Trip update';
  const detail = card.title && message.text ? `<div class="trip-chat-update-detail">${esc(message.text)}</div>` : '';
  const actor = card.type === 'trip-member' ? '' : `<span>${esc(senderName || 'Trip member')}</span><span aria-hidden="true">•</span>`;
  return `<div class="trip-chat-update trip-chat-update-${meta.kind}">
    <div class="trip-chat-update-icon" aria-hidden="true">${meta.icon}</div>
    <div class="trip-chat-update-body">
      <div class="trip-chat-update-kind">${meta.label}</div>
      <div class="trip-chat-update-title">${esc(title)}</div>
      ${detail}
      <div class="trip-chat-update-meta">
        ${actor}<time>${esc(time)}</time>${controls}
      </div>
    </div>
  </div>`;
}

function renderTripChatMessages() {
  const el = document.getElementById('trip-chat-messages');
  if (!el) return;
  const wasAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  el.innerHTML = tripChatMessages.map((m) => {
    if (m.deleted) return `<div class="chat-msg chat-msg-deleted"><span class="chat-msg-deleted-text">Message deleted</span></div>`;
    const own = m.senderId === currentUserId;
    const face = tripChatAvatarFor(m.senderId);
    const senderName = m.senderName || face.name;
    const time = m.createdAt ? new Date(m.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
    const canDelete = own || isOwnerRole();
    const controls = `<div class="chat-msg-controls">
        ${canDelete ? `<button type="button" class="chat-msg-ctrl" onclick="tripDeleteChatMsg('${esc(m.id)}')" title="Delete">🗑️</button>` : ''}
        <button type="button" class="chat-msg-ctrl" onclick="tripFlagChatMsg('${esc(m.id)}')" title="Report / flag message">🚩</button>
      </div>`;
    const updateCard = renderTripChatUpdate(m, senderName, time, controls);
    if (updateCard) return updateCard;
    return `<div class="chat-msg ${own ? 'chat-msg-own' : 'chat-msg-other'}">
      ${!own ? `<div class="chat-msg-avatar-row">${avatarHtml(face.initial, face.color, 16, false)}<span class="chat-msg-sender">${esc(senderName)}</span></div>` : ''}
      <div class="chat-msg-bubble">
        ${m.text ? `<div class="chat-msg-text">${esc(m.text)}</div>` : ''}
      </div>
      <div class="chat-msg-meta">
        <span class="chat-msg-time">${time}</span>
        ${controls}
      </div>
    </div>`;
  }).join('') || '<p class="text-muted chat-empty">No messages yet. Say hi! 👋</p>';
  if (wasAtBottom) el.scrollTop = el.scrollHeight;
}

function tripScrollChatToBottom() {
  const el = document.getElementById('trip-chat-messages');
  if (el) el.scrollTop = el.scrollHeight;
}

async function tripLoadChat() {
  try {
    const msgs = await window.auth.getTripChatMessages(currentTripId, {});
    tripChatMessages = msgs;
    tripChatLastId = msgs.length ? msgs[msgs.length - 1].id : null;
    renderTripChatMessages();
    tripScrollChatToBottom();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

function tripMergeChatMessages(msgs) {
  if (!msgs.length) return;
  const byId = new Map(tripChatMessages.map((m) => [m.id, m]));
  for (const m of msgs) byId.set(m.id, m);
  tripChatMessages = Array.from(byId.values()).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  tripChatLastId = tripChatMessages[tripChatMessages.length - 1].id;
  renderTripChatMessages();
}

async function tripChatLongPollFetch() {
  const qs = `?afterId=${encodeURIComponent(tripChatLastId || '')}&wait=1`;
  tripChatPollAbort = new AbortController();
  const res = await fetch('/api/trips/' + encodeURIComponent(currentTripId) + '/chat/messages' + qs, {
    credentials: 'same-origin',
    signal: tripChatPollAbort.signal,
  });
  if (!res.ok) throw new Error(`poll failed (${res.status})`);
  const data = await res.json().catch(() => null);
  return (data && data.messages) || [];
}

function tripChatWaitForVisible() {
  return new Promise((resolve) => {
    const onVis = () => {
      if (document.hidden) return;
      document.removeEventListener('visibilitychange', onVis);
      resolve();
    };
    document.addEventListener('visibilitychange', onVis);
  });
}

async function tripChatLongPollLoop() {
  let backoffIdx = 0;
  while (tripChatPollTimer) {
    if (document.hidden) { await tripChatWaitForVisible(); continue; }
    try {
      const msgs = await tripChatLongPollFetch();
      if (!tripChatPollTimer) break;
      tripMergeChatMessages(msgs);
      backoffIdx = 0;
    } catch (err) {
      if (!tripChatPollTimer || err.name === 'AbortError') continue; // stopped, or nudged early — retry now, no backoff
      await new Promise((r) => setTimeout(r, TRIP_CHAT_BACKOFF_MS[Math.min(backoffIdx, TRIP_CHAT_BACKOFF_MS.length - 1)]));
      backoffIdx++;
    }
  }
}

function tripStartChatPolling() {
  tripStopChatPolling();
  tripChatPollTimer = true;
  tripChatLongPollLoop();
  tripSetupChatRealtimeNudge();
}

function tripStopChatPolling() {
  tripChatPollTimer = false;
  if (tripChatPollAbort) { tripChatPollAbort.abort(); tripChatPollAbort = null; }
}

function tripSetupChatRealtimeNudge() {
  if (tripChatNudgeReady) return;
  tripChatNudgeReady = true;
  const nudge = () => { if (tripChatPollTimer && tripChatPollAbort) tripChatPollAbort.abort(); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) nudge(); });
  window.addEventListener('focus', nudge);
}

async function tripSendChatMessage(e) {
  e.preventDefault();
  const input = document.getElementById('trip-chat-input');
  const text = input ? input.value.trim() : '';
  if (!text) return;
  try {
    const res = await window.auth.sendTripChatMessage(currentTripId, text);
    if (input) input.value = '';
    // MUST go through the id-deduping merge, never a raw push: the server
    // emits to long-poll waiters BEFORE the POST response returns, so the
    // in-flight poll usually delivers this same message first — a raw push
    // here rendered every sent message twice.
    if (res && res.message) tripMergeChatMessages([res.message]);
    tripScrollChatToBottom();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

async function tripDeleteChatMsg(id) {
  if (!confirm('Delete this message for the trip?')) return;
  try {
    const res = await window.auth.deleteTripChatMessage(currentTripId, id);
    const idx = tripChatMessages.findIndex((m) => m.id === id);
    if (idx !== -1 && res && res.message) tripChatMessages[idx] = res.message;
    renderTripChatMessages();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

async function tripFlagChatMsg(id) {
  const reason = prompt("What's wrong with this message? (optional)") || '';
  try {
    await window.auth.flagTripChatMessage(currentTripId, id, reason);
    toast('Message reported. The trip owner will review it. 🚩');
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

/* ============================================================
   BOOT
============================================================ */
tripsBoot();
