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

/* Shared chat media renderer. Attachment bytes stay behind the authenticated
   same-origin route; this helper only renders server-issued canonical
   descriptors and never trusts a model/client-provided destination. */
function chatMediaEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function chatMediaFilename(media, fallback) {
  const name = String(media && media.filename != null ? media.filename : '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 180);
  return name || fallback;
}

function chatMediaAttachmentUrl(media) {
  const id = String(media && media.attachmentId || '');
  const url = String(media && media.url || '');
  if (!/^a_[0-9a-f]{36}$/.test(id)) return '';
  const expected = `/api/chat/attachments/${id}`;
  return url === expected ? url : '';
}

function chatMediaSize(size) {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes < 0) return 'Size unavailable';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function chatMediaOpenLink(url, filename, label) {
  return `<a href="${chatMediaEscape(url)}" target="_blank" rel="noopener noreferrer" class="chat-msg-attachment-open">${chatMediaEscape(label || `Open ${filename}`)}</a>`;
}

function chatMediaMaybeScroll(mediaElement) {
  const closestMessages = mediaElement && typeof mediaElement.closest === 'function'
    ? mediaElement.closest('.chat-messages')
    : null;
  const el = closestMessages || document.getElementById('chat-messages') || document.getElementById('trip-chat-messages');
  if (!el) return;
  const mediaHeight = (mediaElement && mediaElement.offsetHeight) || 0;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < mediaHeight + 120) el.scrollTop = el.scrollHeight;
}

/* Voice messages (docs/VOICE-MESSAGES.md). The markup is deterministic for a
   given descriptor so a chat re-render never swaps a playing row; who sent it,
   the unplayed dot and play state are layered on by chat-voice.js. */
const CHAT_VOICE_MIME_TYPES = ['audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/wav'];
const CHAT_VOICE_PREVIEW = '🎤 Voice message';

function chatVoiceClock(ms) {
  const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function chatVoiceSpoken(ms) {
  const total = Math.max(1, Math.round((Number(ms) || 0) / 1000));
  const minutes = Math.floor(total / 60), seconds = total % 60;
  const parts = [];
  if (minutes) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  if (seconds || !minutes) parts.push(`${seconds} second${seconds === 1 ? '' : 's'}`);
  return parts.join(' ');
}

// Decorative bar heights (percent), stable per attachment id.
function chatVoiceBars(seed, count = 28) {
  let h = 2166136261;
  for (const ch of String(seed || 'voice')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const bars = [];
  for (let i = 0; i < count; i++) {
    h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0;
    const envelope = Math.sin(Math.PI * (i + 0.5) / count) * 0.45 + 0.55;
    bars.push(Math.round(22 + (h % 1000) / 1000 * 78 * envelope));
  }
  return bars;
}

function renderChatVoice(media, url) {
  const id = chatMediaEscape(media.attachmentId);
  const durationMs = Math.min(60000, Math.max(0, Math.round(Number(media.durationMs) || 0)));
  const label = `Play voice message, ${chatVoiceSpoken(durationMs)}`;
  const bars = chatVoiceBars(media.attachmentId).map(h => `<i style="--h:${h}%"></i>`).join('');
  return `<div class="chat-voice" data-voice-id="${id}" data-voice-src="${chatMediaEscape(url)}" data-voice-duration="${durationMs}" title="${CHAT_VOICE_PREVIEW}">
      <button type="button" class="chat-voice-play" data-voice-play aria-label="${chatMediaEscape(label)}"><svg class="chat-voice-icon-play" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M7 4.8v14.4a1 1 0 0 0 1.5.86l11.6-7.2a1 1 0 0 0 0-1.72L8.5 3.94A1 1 0 0 0 7 4.8z"/></svg><svg class="chat-voice-icon-pause" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="6" y="4.5" width="4.2" height="15" rx="1.2"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.2"/></svg></button>
      <span class="chat-voice-wave" aria-hidden="true">${bars}</span>
      <span class="chat-voice-time"><span class="chat-voice-elapsed"></span><span class="chat-voice-total">${chatVoiceClock(durationMs)}</span></span>
      <span class="chat-voice-dot" aria-hidden="true" hidden></span>
    </div>`;
}

function renderChatMedia(media) {
  if (!media) return '';

  // GIFs predate authenticated attachments and retain their existing behavior.
  if (media.type === 'gif' && media.previewUrl) {
    const preview = chatMediaEscape(media.previewUrl);
    const full = chatMediaEscape(media.url || media.previewUrl);
    return `<a href="${full}" target="_blank" rel="noopener noreferrer" class="chat-msg-gif-link">
      <img src="${preview}" alt="GIF" class="chat-msg-gif" loading="lazy" onload="chatMediaMaybeScroll(this)">
    </a>`;
  }

  if (media.type !== 'attachment') return '';
  const url = chatMediaAttachmentUrl(media);
  if (!url) return '';
  if (media.kind === 'audio' && CHAT_VOICE_MIME_TYPES.includes(String(media.mimeType || '').toLowerCase())) {
    return renderChatVoice(media, url);
  }
  const filename = chatMediaFilename(media, media.kind === 'photo' ? 'Photo' : media.kind === 'video' ? 'Video' : media.kind === 'audio' ? 'Voice message' : 'File');
  const safeUrl = chatMediaEscape(url);
  const safeName = chatMediaEscape(filename);

  if (media.kind === 'photo') {
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="chat-msg-attachment chat-msg-attachment-photo chat-msg-attachment-media-link">
      <img src="${safeUrl}" alt="Photo: ${safeName}" class="chat-msg-attachment-media" loading="lazy" decoding="async" onload="chatMediaMaybeScroll(this)">
    </a>`;
  }

  const size = chatMediaEscape(chatMediaSize(media.size));
  const open = chatMediaOpenLink(url, filename, `Open ${filename}`);

  if (media.kind === 'video') {
    const mimeType = String(media.mimeType || '').toLowerCase();
    const allowedMime = ['video/mp4', 'video/quicktime', 'video/mpeg', 'video/webm'].includes(mimeType);
    const source = allowedMime ? `<source src="${safeUrl}" type="${chatMediaEscape(mimeType)}">` : '';
    return `<figure class="chat-msg-attachment chat-msg-attachment-video">
      ${allowedMime ? `<video class="chat-msg-attachment-media" controls playsinline preload="metadata" onloadedmetadata="chatMediaMaybeScroll(this)">${source}</video>` : ''}
      <figcaption><span class="chat-msg-attachment-name">${safeName}</span><span class="chat-msg-attachment-size">${size}</span>${open}</figcaption>
    </figure>`;
  }

  return `<div class="chat-msg-attachment chat-msg-attachment-file">
    <div class="chat-msg-attachment-file-meta"><span class="chat-msg-attachment-name">${safeName}</span><span class="chat-msg-attachment-size">${size}</span></div>
    ${open}
  </div>`;
}

/* Storage helpers (fam_ prefix only) */
function load(key)        { try { return JSON.parse(localStorage.getItem(key)) || null; } catch { return null; } }
function save(key, val)   { localStorage.setItem(key, JSON.stringify(val)); }

/* The event mirror and pending queue belong to this account and family.
   Leave the old unscoped fam_events value recoverable, but never display or
   upload data whose owner cannot be established on a shared browser. */
let famEventsCache = null;
let famEventsCacheKey = null;
let famEventsGeneration = 0;
function familyEventStorageKey() {
  if (typeof sessionUser === 'undefined' || typeof currentFamily === 'undefined'
      || !sessionUser?.id || !currentFamily?.id) return '';
  return 'fam_events_' + encodeURIComponent(JSON.stringify([sessionUser.id, currentFamily.id, sessionUser.role || 'parent', sessionUser.kidId || '']));
}
function familyEventScope() {
  const key = familyEventStorageKey();
  return key ? `${famEventsGeneration}:${key}` : '';
}
function resetFamilyEventCache() {
  famEventsGeneration++;
  famEventsCache = null;
  famEventsCacheKey = null;
}
function getEvents() {
  const key = familyEventStorageKey();
  if (!key) return [];
  if (famEventsCacheKey !== key) {
    famEventsCacheKey = key;
    const stored = load(key);
    famEventsCache = Array.isArray(stored) ? stored : [];
  }
  return famEventsCache;
}
function saveEvents(events) {
  const key = familyEventStorageKey();
  if (!key) return;
  famEventsCacheKey = key;
  famEventsCache = events;
  save(key, events);
}
function getSchedules(){ return load('fam_schedules')|| []; }
function saveSched(s)  { save('fam_schedules', s); }
