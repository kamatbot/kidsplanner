function dayOfYear(d) {
  const jan1 = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - jan1) / 86400000);
}

function dailyPick(arr, date) {
  return arr[dayOfYear(date || new Date()) % arr.length];
}

function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseIso(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatLong(d) {
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function formatShort(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmt12(time) {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 || 12;
  return `${hr}:${String(m).padStart(2, '0')} ${ampm}`;
}

function mondayOf(d) {
  const copy = new Date(d);
  const dow = copy.getDay();
  copy.setDate(copy.getDate() - (dow === 0 ? 6 : dow - 1));
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* Storage helpers (fam_ prefix only) */
function load(key)        { try { return JSON.parse(localStorage.getItem(key)) || null; } catch { return null; } }
function save(key, val)   { localStorage.setItem(key, JSON.stringify(val)); }

/* Manual family events live on the server (/api/calendar/events — shared with
   iOS; see loadFamilyEvents() in app.js). getEvents() reads the in-memory copy
   synchronously; localStorage 'fam_events' is the offline mirror and, for
   events without the server's 'ev_' id prefix, the pending-upload queue. */
let famEventsCache = null; // null until loadFamilyEvents() resolves
function getEvents()   { return famEventsCache || load('fam_events') || []; }
function saveEvents(e) { famEventsCache = e; save('fam_events', e); }
function getSchedules(){ return load('fam_schedules')|| []; }
function saveSched(s)  { save('fam_schedules', s); }
