/* ============================================================
   TRIPS.JS — Fam ETC Trips (Phase C web UI)
   Drives public/trips.html: BOTH the trips LIST (/trips) and the trip HUB
   (/trips/<id>) live in this one script — location.pathname decides which
   to render, history.pushState navigates between them without a reload.
   Ports the "Waypoint" UX reference mock (Overview / Itinerary / Flights /
   Lodging / Chat / People) using this app's Horizon design tokens via
   public/css/trips.css.

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

let tripFormState = null;     // itinerary add/edit form: {dayDate, itemId|null}
let tripOpenThreads = new Set();
let tripFlightFormOpen = false;
let tripLodgingFormOpen = false;
let tripEditFormOpen = false;
let tripInviteCopied = false;

let dragItemId = null;
let dragFromDate = null;

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
  root.innerHTML = `
    <div class="trip-main">
      <div class="trip-list-header">
        <h1 class="page-title">Trips</h1>
        <div class="page-header-spacer"></div>
        <button type="button" class="btn-primary" onclick="tripsToggleNewForm()">+ New trip</button>
      </div>
      ${tripsNewFormOpen ? renderNewTripForm() : ''}
      ${trips.length
        ? `<div class="trip-list-grid">${trips.map(renderTripCard).join('')}</div>`
        : (tripsNewFormOpen ? '' : renderTripsEmptyState())}
    </div>
  `;
}

function tripsToggleNewForm() {
  tripsNewFormOpen = !tripsNewFormOpen;
  renderTripsList();
}

function renderNewTripForm() {
  return `
    <form class="trip-inline-form" onsubmit="tripsSubmitNew(event)" style="margin-bottom:20px;max-width:520px">
      <div class="trip-form-row">
        <input class="trip-input" name="name" placeholder="Trip name · Lisbon with the crew" required autocomplete="off" maxlength="80">
      </div>
      <div class="trip-form-row">
        <input class="trip-input" name="destination" placeholder="Destination · Lisbon, PT" autocomplete="off" maxlength="120">
      </div>
      <div class="trip-form-row">
        <input class="trip-input" type="date" name="startDate" required>
        <input class="trip-input" type="date" name="endDate" required>
      </div>
      <div class="trip-form-actions">
        <button type="submit" class="btn-primary">Create trip</button>
        <button type="button" class="btn-secondary" onclick="tripsToggleNewForm()">Cancel</button>
      </div>
    </form>
  `;
}

function renderTripsEmptyState() {
  return `
    <div class="trip-empty">
      <div class="trip-empty-icon">✈️</div>
      <h3>Plan your first trip</h3>
      <p>Bring in friends and family from outside your household — a shared itinerary, flights, lodging, and a group chat, all in one place.</p>
      <button type="button" class="btn-primary" onclick="tripsToggleNewForm()">+ Plan a trip</button>
    </div>
  `;
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
  const tabsDef = [['overview', 'Overview'], ['itinerary', 'Itinerary'], ['flights', 'Flights'], ['lodging', 'Lodging']];
  if (!kid) tabsDef.push(['chat', 'Chat']);
  tabsDef.push(['people', 'People']);

  const root = document.getElementById('trips-root');
  if (!root) return;
  root.innerHTML = `
    ${tripHubHeaderHtml()}
    <nav class="trip-tabs">
      ${tabsDef.map(([id, label]) => `<button type="button" class="trip-tab-btn${currentTab === id ? ' active' : ''}" onclick="tripsGoTab('${id}')">${esc(label)}</button>`).join('')}
    </nav>
    <div class="trip-main" id="trip-tab-content"></div>
  `;
  rerenderTab();

  if (currentTab === 'chat') {
    tripLoadChat();
    tripStartChatPolling();
  } else {
    tripStopChatPolling();
  }
}

function rerenderTab() {
  const el = document.getElementById('trip-tab-content');
  if (!el || !currentTrip) return;
  if (currentTab === 'overview') el.innerHTML = renderOverviewTab();
  else if (currentTab === 'itinerary') el.innerHTML = renderItineraryTabHtml();
  else if (currentTab === 'flights') el.innerHTML = renderFlightsTabHtml();
  else if (currentTab === 'lodging') el.innerHTML = renderLodgingTabHtml();
  else if (currentTab === 'chat') el.innerHTML = renderChatTabHtml();
  else if (currentTab === 'people') el.innerHTML = renderPeopleTabHtml();
}

function tripHubHeaderHtml() {
  const t = currentTrip;
  const kid = isKidRole();
  const dates = formatTripDateRange(t.startDate, t.endDate);
  const members = t.members || [];
  return `
    <div class="trip-hub-header">
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

function findItineraryItem(id) {
  return (currentTrip.itinerary || []).find((i) => i.id === id);
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
    <div class="trip-itin-toolbar">
      <div class="trip-section-title">Itinerary</div>
      <div class="trip-itin-hint">${kid ? 'View only' : 'Drag places to reorder or move between days · tap ♥ to vote'}</div>
    </div>
    <div class="trip-days">
      ${days.length ? days.map((day) => renderDaySection(day, kid)).join('') : '<p class="text-muted">This trip has no dates yet.</p>'}
    </div>
  `;
}

function renderDaySection(day, kid) {
  const d = parseIso(day.date);
  const dateBadge = formatShort(d).toUpperCase();
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
  const formHere = !kid && tripFormState && tripFormState.dayDate === day.date && !tripFormState.itemId;
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

function renderItineraryItem(it, dayDate, kid) {
  const cat = CATS[it.category] || CATS.activity;
  const voted = !kid && (it.votes || []).includes(currentUserId);
  const editingHere = !kid && tripFormState && tripFormState.itemId === it.id;
  const threadOpen = tripOpenThreads.has(it.id);
  const comments = it.comments || [];
  const dragAttrs = !kid
    ? ` draggable="true" ondragstart="tripItemDragStart(event,'${esc(it.id)}','${esc(dayDate)}')" ondragover="tripItemDragOver(event,'${esc(it.id)}')" ondrop="tripItemDrop(event,'${esc(dayDate)}','${esc(it.id)}')" ondragend="tripDragEnd()"`
    : '';
  return `
    <div>
      <div class="trip-drop-indicator" id="drop-${esc(it.id)}"></div>
      ${editingHere ? renderItineraryForm(dayDate, it) : `
      <div class="trip-item"${dragAttrs}>
        ${!kid ? ICON_DRAG : ''}
        <div class="trip-item-time">${esc(it.time || '')}</div>
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

function tripOpenAddForm(dayDate) {
  tripFormState = { dayDate, itemId: null };
  rerenderTab();
}

function tripOpenEditForm(itemId) {
  const item = findItineraryItem(itemId);
  if (!item) return;
  tripFormState = { dayDate: item.date, itemId: item.id };
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
      ${!kid ? `<button type="button" class="btn-primary" onclick="tripToggleFlightForm()">+ Add flight</button>` : ''}
    </div>
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
      ${!kid ? `<button type="button" class="btn-primary" onclick="tripToggleLodgingForm()">+ Add lodging</button>` : ''}
    </div>
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
    if (res && res.message) {
      tripChatMessages.push(res.message);
      tripChatLastId = res.message.id;
      renderTripChatMessages();
    }
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
