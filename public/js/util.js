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

function chatInlineMarkdown(value) {
  const text = String(value == null ? '' : value).replace(/\u0000/g, '');
  const escape = (part) => String(part)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const format = (part) => {
    let formatted = escape(part);
    const code = [];
    formatted = formatted.replace(/`([^`\n]+)`/g, (_, content) => {
      const token = `\u0000CODE${code.length}\u0000`;
      code.push(`<code>${content}</code>`);
      return token;
    });
    formatted = formatted
      .replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');
    return formatted.replace(/\u0000CODE(\d+)\u0000/g, (_, index) => code[Number(index)] || '');
  };
  const urlPattern = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
  let html = '';
  let cursor = 0;

  for (const match of text.matchAll(urlPattern)) {
    let label = match[0];
    let trailing = '';
    while (/[.,!?;:)\]}]$/.test(label)) {
      trailing = label.slice(-1) + trailing;
      label = label.slice(0, -1);
    }

    const href = label.toLowerCase().startsWith('www.') ? `https://${label}` : label;
    let safe = false;
    try {
      safe = ['http:', 'https:'].includes(new URL(href).protocol);
    } catch (_) {}

    html += format(text.slice(cursor, match.index));
    html += safe
      ? `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${escape(label)}</a>${format(trailing)}`
      : format(match[0]);
    cursor = match.index + match[0].length;
  }
  return html + format(text.slice(cursor));
}

function linkifyChatText(value) {
  const text = String(value == null ? '' : value)
    .replace(/^\s*\(Response formatting failed,\s*plain text:\)\s*/i, '')
    .replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const hasBlocks = lines.length > 1 || lines.some((line) => /^\s*(?:#{1,3}\s+|[-*•]\s+|\d+[.)]\s+)/.test(line));
  if (!hasBlocks) return chatInlineMarkdown(text);

  let html = '';
  let list = null;
  const closeList = () => {
    if (!list) return;
    html += `</${list}>`;
    list = null;
  };
  for (const line of lines) {
    if (!line.trim()) { closeList(); continue; }
    const heading = /^\s*#{1,3}\s+(.+)$/.exec(line);
    if (heading) {
      closeList();
      html += `<div class="chat-msg-heading">${chatInlineMarkdown(heading[1])}</div>`;
      continue;
    }
    const bullet = /^\s*[-*•]\s+(.+)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    const wantedList = bullet ? 'ul' : numbered ? 'ol' : null;
    if (wantedList) {
      if (list !== wantedList) { closeList(); list = wantedList; html += `<${list}>`; }
      html += `<li>${chatInlineMarkdown((bullet || numbered)[1])}</li>`;
      continue;
    }
    closeList();
    html += `<p>${chatInlineMarkdown(line)}</p>`;
  }
  closeList();
  return html;
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
