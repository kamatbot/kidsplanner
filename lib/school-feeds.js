"use strict";
/**
 * Phase 2 — School calendar integration.
 *
 * Built-in feed registry (the six VERIFIED St Andrews public Google Calendar
 * feeds from FEATURE_PLAN.md) + per-family subscription storage + server-
 * side fetch/parse/window/dedup sync, keyed off lib/db.js (same pattern as
 * lib/family.js — subscriptions are family data, shared across parents).
 */
const crypto = require("crypto");
const dns = require("dns");
const db = require("./db");
const family = require("./family");
const { parseICS, parseICSWithMeta } = require("./ical");

// ---------- built-in feed registry ----------
// Feed URL pattern verified 2026-07-03 (FEATURE_PLAN.md Phase 2):
//   https://calendar.google.com/calendar/ical/<calendar-id>/public/basic.ics
const ICS_BASE = "https://calendar.google.com/calendar/ical";
function icsUrlFor(calendarId) {
  return `${ICS_BASE}/${encodeURIComponent(calendarId)}/public/basic.ics`;
}

// `deadline: true` marks feeds that are deadline calendars (CAHE + the two
// Senior Studies feeds) — Phase 3's homework hub will ingest these directly.
const BUILTIN_FEEDS = [
  {
    id: "sta-whole-school",
    name: "STA Whole School",
    calendarId: "standrews.ac.th_a25bgo8dl9bcggkqtvbdg73rpg@group.calendar.google.com",
    mapsTo: "school events",
    deadline: false,
  },
  {
    id: "sta-high-school",
    name: "STA High School",
    calendarId: "standrews.ac.th_o9pe6t3oi3lmn9u9hme5ujo95s@group.calendar.google.com",
    mapsTo: "school events",
    deadline: false,
  },
  {
    id: "sta-hs-sport",
    name: "STA HS Sport Competition",
    calendarId: "41753qg2fl7ii5mk5g2r5jj41c@group.calendar.google.com",
    mapsTo: "sports/extracurricular",
    deadline: false,
  },
  {
    id: "cahe",
    name: "CAHE (college & careers)",
    calendarId: "standrews.ac.th_83llb0e0nai91e7iui5pl8uadk@group.calendar.google.com",
    mapsTo: "deadlines",
    deadline: true,
  },
  {
    id: "senior-studies-2027",
    name: "Class of 2027 Senior Studies",
    calendarId: "standrews.ac.th_lk64660d4utn2agjlp99nnkb7o@group.calendar.google.com",
    mapsTo: "deadlines",
    deadline: true,
  },
  {
    id: "senior-studies-2026",
    name: "Class of 2026 Senior Studies",
    calendarId: "standrews.ac.th_urlaprs6nnhf1vkct73creehd4@group.calendar.google.com",
    mapsTo: "deadlines",
    deadline: true,
  },
];
const BUILTIN_BY_ID = new Map(BUILTIN_FEEDS.map((f) => [f.id, f]));

function publicBuiltinFeeds() {
  return BUILTIN_FEEDS.map((f) => ({ id: f.id, name: f.name, mapsTo: f.mapsTo, deadline: f.deadline }));
}

// ---------- storage ----------
// root.schoolCalendar[familyId] = {
//   subscriptions: [{ id, kidId, feedId|null, customUrl|null, customName?,
//                      filterKeyword?, createdAt }],
//   cache: { [subscriptionId]: { fetchedAt, events: [...], error: null|string } },
//   lastSyncAt: iso|null,
// }
function root() {
  const r = db.load();
  if (!r.schoolCalendar) r.schoolCalendar = {};
  return r;
}
function famStore(familyId) {
  const r = root();
  if (!r.schoolCalendar[familyId]) {
    r.schoolCalendar[familyId] = { subscriptions: [], cache: {}, lastSyncAt: null, hidden: [] };
  }
  return r.schoolCalendar[familyId];
}
function subId() {
  return "sub_" + crypto.randomBytes(8).toString("hex");
}

function feedUrlForSubscription(sub) {
  if (sub.customUrl) return sub.customUrl;
  const feed = BUILTIN_BY_ID.get(sub.feedId);
  return feed ? icsUrlFor(feed.calendarId) : null;
}
function feedLabelForSubscription(sub) {
  if (sub.customUrl) return sub.customName || "Custom calendar";
  const feed = BUILTIN_BY_ID.get(sub.feedId);
  return feed ? feed.name : "Unknown feed";
}
function isDeadlineFeed(sub) {
  if (sub.feedId) {
    const feed = BUILTIN_BY_ID.get(sub.feedId);
    return !!(feed && feed.deadline);
  }
  return false; // custom URLs are never auto-flagged as deadline calendars
}

// ---------- validation ----------
// webcal:// is the calendar-subscription scheme iCloud/Outlook and many
// "Add to Calendar" links use — it's semantically identical to https:// for
// fetching an .ics file, so normalize it rather than reject it (parents
// pasting an Apple/Outlook subscribe link is an expected path here).
function normalizeCalendarUrl(url) {
  const trimmed = String(url || "").trim();
  if (/^webcal:\/\//i.test(trimmed)) return "https://" + trimmed.slice("webcal://".length);
  return trimmed;
}

function validCustomUrl(url) {
  try {
    const u = new URL(normalizeCalendarUrl(url));
    if (u.protocol === "https:") return true;
    // http: is allowed only for loopback (local dev/test servers) — real
    // subscriptions in production must be https:// (webcal:// is normalized
    // to https:// above).
    return u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost");
  } catch (e) {
    return false;
  }
}

// ---------- subscribe / unsubscribe (requireParent gated at the route) ----------
function subscribe(familyId, { kidId, feedId, customUrl, customName, filterKeyword }) {
  const fam = family.getFamily(familyId);
  if (!fam) return { error: "Family not found." };
  if (!kidId || !fam.kids.some((k) => k.id === kidId)) return { error: "Kid not found in this family." };
  if (!feedId && !customUrl) return { error: "Provide a feedId or a customUrl." };
  if (feedId && !BUILTIN_BY_ID.has(feedId)) return { error: "Unknown feed." };
  const normalizedUrl = customUrl ? normalizeCalendarUrl(customUrl) : null;
  if (customUrl && !validCustomUrl(customUrl)) return { error: "That doesn't look like a valid calendar URL. Paste an https:// or webcal:// iCal link." };

  const store = famStore(familyId);
  const dup = store.subscriptions.find((s) =>
    s.kidId === kidId && (feedId ? s.feedId === feedId : s.customUrl === normalizedUrl)
  );
  if (dup) return { subscription: dup, family: fam };

  const sub = {
    id: subId(),
    kidId,
    feedId: feedId || null,
    customUrl: normalizedUrl,
    customName: customUrl ? (String(customName || "").trim().slice(0, 80) || null) : null,
    filterKeyword: String(filterKeyword || "").trim().slice(0, 60) || null,
    createdAt: new Date().toISOString(),
  };
  store.subscriptions.push(sub);
  db.persist();
  return { subscription: sub };
}

// Hide a single synced school event so it doesn't reappear on the next sync
// (school events aren't stored as rows — collectFromCache() re-derives the
// list from the raw feed cache every time, so "delete" is a persisted
// hide-list keyed by subscription+uid rather than a row removal).
function hideEvent(familyId, { subscriptionId, uid }) {
  if (typeof subscriptionId !== "string" || !subscriptionId || typeof uid !== "string" || !uid) {
    return { error: "Provide subscriptionId and uid." };
  }
  const store = famStore(familyId);
  if (!store.subscriptions.some((s) => s.id === subscriptionId)) {
    return { error: "Subscription not found." };
  }
  store.hidden = store.hidden || [];
  const key = `${subscriptionId}::${uid}`;
  if (!store.hidden.includes(key)) store.hidden.push(key);
  db.persist();
  return { ok: true };
}

function unsubscribe(familyId, { kidId, feedId, customUrl, subscriptionId }) {
  const store = famStore(familyId);
  const before = store.subscriptions.length;
  store.subscriptions = store.subscriptions.filter((s) => {
    if (subscriptionId) return s.id !== subscriptionId;
    const kidMatch = !kidId || s.kidId === kidId;
    const feedMatch = feedId ? s.feedId === feedId : (customUrl ? s.customUrl === customUrl : false);
    return !(kidMatch && feedMatch);
  });
  if (store.subscriptions.length === before) return { error: "Subscription not found." };
  db.persist();
  return { ok: true };
}

function listFeedsForFamily(familyId) {
  const store = famStore(familyId);
  return {
    builtin: publicBuiltinFeeds(),
    subscriptions: store.subscriptions.map((s) => ({
      id: s.id,
      kidId: s.kidId,
      feedId: s.feedId,
      customUrl: s.customUrl,
      customName: s.customName,
      label: feedLabelForSubscription(s),
      filterKeyword: s.filterKeyword,
      deadline: isDeadlineFeed(s),
      createdAt: s.createdAt,
    })),
    lastSyncAt: store.lastSyncAt,
  };
}

// ---------- fetch + parse + window + dedup ----------
const WINDOW_PAST_MS = 14 * 24 * 60 * 60 * 1000;   // 2 weeks back
const WINDOW_FUTURE_MS = 92 * 24 * 60 * 60 * 1000; // ~3 months forward
const SYNC_TTL_MS = 60 * 60 * 1000;                // 1 hour cache
const AUTO_SYNC_MIN_INTERVAL_MS = 60 * 60 * 1000;  // throttle auto-sync to ~1/hour

function withinWindow(iso, now) {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return t >= now - WINDOW_PAST_MS && t <= now + WINDOW_FUTURE_MS;
}

// Deadline detection: title-based keyword match on top of the feed-level
// flag, so a deadline-shaped item on a non-deadline feed still gets caught
// (belt & suspenders — FEATURE_PLAN.md "IA 1st Copy", "Extended Essay
// outline", university deadlines).
const DEADLINE_KEYWORDS = /\b(deadline|due|due date|ia\s*(1st|2nd|first|second)?\s*copy|extended essay|university application|ucas|common app|submission)\b/i;
function detectDeadline(summary, feedIsDeadline) {
  if (feedIsDeadline) return true;
  return DEADLINE_KEYWORDS.test(summary || "");
}

// ---------- SSRF guards ----------
// Any https:// URL a parent pastes gets fetched server-side, so a malicious
// "calendar link" could otherwise probe internal services (metadata
// endpoints, admin panels on 10/172.16/192.168, etc.) or redirect there.
// validCustomUrl() already restricts http:// to the 127.0.0.1/localhost dev
// loopback (used by tests' local HTTP fixtures) — that same case is the only
// one exempted from the DNS/IP check below, everything else must be https
// AND resolve to a public address, re-checked on every redirect hop.
const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB

function isLoopbackHttpDevUrl(u) {
  return u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost");
}

function isDisallowedAddress(address) {
  if (address.includes(":")) {
    // IPv6.
    const a = address.toLowerCase();
    if (a === "::1" || a === "::") return true; // loopback / unspecified
    if (/^fe[89ab]/.test(a)) return true; // link-local fe80::/10
    if (/^f[cd]/.test(a)) return true; // unique-local fc00::/7
    const v4 = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
    return v4 ? isDisallowedAddress(v4[1]) : false;
  }
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n))) return true; // malformed — fail closed
  const [a, b] = octets;
  if (a === 0) return true; // unspecified/"this network"
  if (a === 127) return true; // loopback
  if (a === 10) return true; // 10/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 169 && b === 254) return true; // link-local
  return false;
}

// Resolve the hostname and reject if ANY resolved address is loopback,
// private, link-local, or unspecified. Checking every address (not just the
// first) blocks a DNS answer that mixes a public IP with a private one.
async function assertSafeUrl(u) {
  if (isLoopbackHttpDevUrl(u)) return; // dev/test loopback allowance
  if (u.protocol !== "https:") {
    throw new Error("That calendar link must use https://.");
  }
  let addresses;
  try {
    addresses = await dns.promises.lookup(u.hostname, { all: true });
  } catch (e) {
    throw new Error("Could not resolve that calendar server's address.");
  }
  if (!addresses.length || addresses.some((a) => isDisallowedAddress(a.address))) {
    throw new Error("That calendar address points to a private network and can't be fetched.");
  }
}

// Read the body via the stream, aborting once it crosses MAX_BODY_BYTES
// instead of buffering an attacker-controlled response fully into memory.
async function readCappedBody(res) {
  const reader = res.body.getReader();
  let received = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error("That calendar file is too large.");
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch (e) { /* already released via cancel */ }
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function fetchIcsText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    let current = new URL(url);
    let res;
    for (let hop = 0; ; hop++) {
      await assertSafeUrl(current);
      res = await fetch(current, {
        signal: controller.signal,
        redirect: "manual",
        headers: { "User-Agent": "FamETC-School-Sync/1.0" },
      });
      const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!location) break;
      if (hop >= MAX_REDIRECTS) throw new Error("That calendar link redirected too many times.");
      current = new URL(location, current);
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error("That link needs sign-in — use the calendar's PUBLIC or SECRET iCal address, not the private web link.");
    }
    if (!res.ok) throw new Error(`The calendar server returned an error (HTTP ${res.status}).`);
    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    const text = await readCappedBody(res);
    // Google/Apple/Outlook feeds send text/calendar, but some school sites
    // mislabel it — so fall back to sniffing the body itself rather than
    // trusting Content-Type alone. Either signal being calendar-shaped is
    // enough; only reject when NEITHER looks right (e.g. an HTML login page).
    const looksLikeIcs = /^\s*BEGIN:VCALENDAR/i.test(text);
    if (!contentType.includes("calendar") && !looksLikeIcs) {
      throw new Error("That link didn't return a calendar. Double check you copied the iCal/.ics address, not a regular web page link.");
    }
    return text;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("The calendar server took too long to respond. Please try again.");
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

// Validate + preview a custom calendar URL WITHOUT saving a subscription.
// Used by the "Add your school's calendar" guided flow so a parent sees
// confirmation ("Found 42 events — e.g. ...") before committing.
async function previewFeed(url) {
  const normalized = normalizeCalendarUrl(url);
  if (!validCustomUrl(url)) {
    return { ok: false, error: "That doesn't look like a valid calendar URL. Paste an https:// or webcal:// iCal link." };
  }
  let text;
  try {
    text = await fetchIcsText(normalized);
  } catch (e) {
    return { ok: false, error: e.message || "Could not fetch that calendar." };
  }
  const { events, calendarName } = parseICSWithMeta(text);
  if (!events.length) {
    return { ok: false, error: "That calendar link works, but it doesn't have any events in it yet." };
  }
  const sampleTitles = events.slice(0, 5).map((e) => e.summary).filter(Boolean);
  return {
    ok: true,
    normalizedUrl: normalized,
    calendarName: calendarName || null,
    count: events.length,
    sampleTitles,
  };
}

// Sync every subscription for a family: fetch (or reuse cache within TTL),
// parse, window, filter, tag, dedup by UID, return events. `force` bypasses
// the TTL for a manual "Sync now".
async function syncFamily(familyId, { force = false } = {}) {
  const fam = family.getFamily(familyId);
  if (!fam) return { error: "Family not found." };
  const store = famStore(familyId);
  const now = Date.now();

  if (!force && store.lastSyncAt && (now - Date.parse(store.lastSyncAt)) < AUTO_SYNC_MIN_INTERVAL_MS) {
    // Throttled — serve the cached windowed result rather than refetching.
    return { events: collectFromCache(store, now), throttled: true, lastSyncAt: store.lastSyncAt, errors: collectErrors(store) };
  }

  const results = await Promise.all(store.subscriptions.map(async (sub) => {
    const url = feedUrlForSubscription(sub);
    if (!url) return { sub, error: "No URL for this subscription." };
    const cached = store.cache[sub.id];
    if (!force && cached && (now - Date.parse(cached.fetchedAt)) < SYNC_TTL_MS) {
      return { sub, cached: true };
    }
    try {
      const text = await fetchIcsText(url);
      const raw = parseICS(text);
      store.cache[sub.id] = { fetchedAt: new Date().toISOString(), events: raw, error: null };
      return { sub, ok: true };
    } catch (e) {
      // Keep any previously-cached events on a failed refetch; just record
      // the error so the client can surface which feed failed.
      if (!store.cache[sub.id]) store.cache[sub.id] = { fetchedAt: new Date().toISOString(), events: [], error: null };
      store.cache[sub.id].error = e.message || "Fetch failed";
      store.cache[sub.id].erroredAt = new Date().toISOString();
      return { sub, error: e.message || "Fetch failed" };
    }
  }));

  store.lastSyncAt = new Date().toISOString();
  db.persist();

  const events = collectFromCache(store, now);
  const errors = results.filter((r) => r.error).map((r) => ({
    subscriptionId: r.sub.id,
    label: feedLabelForSubscription(r.sub),
    error: r.error,
  }));
  return { events, throttled: false, lastSyncAt: store.lastSyncAt, errors };
}

function collectErrors(store) {
  const errors = [];
  for (const sub of store.subscriptions) {
    const cached = store.cache[sub.id];
    if (cached && cached.error) {
      errors.push({ subscriptionId: sub.id, label: feedLabelForSubscription(sub), error: cached.error });
    }
  }
  return errors;
}

// Windowed, filtered, tagged, deduped (by iCal UID) event list across ALL of
// a family's subscriptions.
function collectFromCache(store, now) {
  const byUid = new Map();
  const hidden = new Set(store.hidden || []);
  for (const sub of store.subscriptions) {
    const cached = store.cache[sub.id];
    if (!cached || !Array.isArray(cached.events)) continue;
    const feedDeadline = isDeadlineFeed(sub);
    for (const raw of cached.events) {
      if (!withinWindow(raw.start, now)) continue;
      if (sub.filterKeyword) {
        const kw = sub.filterKeyword.toLowerCase();
        const hay = `${raw.summary} ${raw.location} ${raw.description}`.toLowerCase();
        if (!hay.includes(kw)) continue;
      }
      const key = `${sub.id}::${raw.uid}`;
      if (hidden.has(key)) continue;
      // Dedup by UID: a re-sync updates rather than duplicates. If the same
      // UID appears via two different subscriptions for the SAME kid we
      // still want both (different kids' calendars) — so the dedup key is
      // scoped per-subscription (feed+kid), matching how re-syncs upsert.
      if (byUid.has(key)) continue;
      byUid.set(key, {
        uid: raw.uid,
        title: raw.summary,
        start: raw.start,
        end: raw.end,
        allDay: raw.allDay,
        location: raw.location,
        description: raw.description,
        recurring: raw.recurring,
        source: "school",
        readOnly: true,
        feedId: sub.feedId,
        subscriptionId: sub.id,
        feedLabel: feedLabelForSubscription(sub),
        kidId: sub.kidId,
        isDeadline: detectDeadline(raw.summary, feedDeadline),
        type: detectDeadline(raw.summary, feedDeadline) ? "deadline" : "event",
      });
    }
  }
  return Array.from(byUid.values()).sort((a, b) => (a.start || "").localeCompare(b.start || ""));
}

module.exports = {
  BUILTIN_FEEDS,
  publicBuiltinFeeds,
  icsUrlFor,
  subscribe,
  unsubscribe,
  hideEvent,
  listFeedsForFamily,
  syncFamily,
  previewFeed,
  normalizeCalendarUrl,
  // exported for tests
  withinWindow,
  detectDeadline,
  collectFromCache,
  famStore,
  WINDOW_PAST_MS,
  WINDOW_FUTURE_MS,
  SYNC_TTL_MS,
  AUTO_SYNC_MIN_INTERVAL_MS,
};
