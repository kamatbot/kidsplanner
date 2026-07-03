"use strict";
/**
 * Lean hand-rolled ICS (iCalendar) parser — Phase 2 school calendar sync.
 *
 * Deliberately NOT using the node-ical package: the six built-in feeds (and
 * any custom URL a parent pastes) are simple VEVENT collections, and a small
 * dependency-free parser is easier to audit, keeps Hostinger's npm install
 * lean, and gives us exact control over windowing before events ever leave
 * the server (the sport feed alone is 3,500+ events).
 *
 * Scope / limitations (documented, not hidden):
 *  - Full RRULE expansion is NOT implemented. If an event carries an RRULE
 *    line we surface it as `recurring: true` and keep only the first
 *    (DTSTART-anchored) instance — acceptable for this phase per
 *    FEATURE_PLAN.md ("single instances are acceptable... note the
 *    limitation"). A future pass can expand RRULE into real instances.
 *  - Timezones: VALUE=DATE (all-day) events are parsed as calendar dates
 *    with no time-of-day component. Timed events carrying a TZID are
 *    trusted as wall-clock local time (the school's feeds are published in
 *    Asia/Bangkok); a bare "Z"-suffixed UTC timestamp is converted to an
 *    ISO string as-is. We do not do full IANA timezone-database conversion.
 */

// Unfold ICS "folded" lines: a line beginning with a single space or tab is
// a continuation of the previous line (RFC 5545 §3.1).
function unfoldLines(raw) {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else if (line.length) {
      out.push(line);
    }
  }
  return out;
}

// Parse a single content line "NAME;PARAM=X;PARAM2=Y:VALUE" (values may
// contain colons, e.g. URLs — only split on the FIRST unescaped colon).
function parseLine(line) {
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) return null;
  const head = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1);
  const [name, ...paramParts] = head.split(";");
  const params = {};
  for (const p of paramParts) {
    const eq = p.indexOf("=");
    if (eq === -1) continue;
    params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
  }
  return { name: name.toUpperCase(), params, value };
}

function unescapeText(s) {
  return String(s || "")
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

// DATE-TIME "20260703T090000" (floating/local) or "...Z" (UTC), or
// DATE "20260703" (all-day). Returns { iso, allDay }.
function parseDateValue(value, params) {
  const v = String(value || "").trim();
  const isDateOnly = params.VALUE === "DATE" || /^\d{8}$/.test(v);
  if (isDateOnly) {
    const y = v.slice(0, 4), mo = v.slice(4, 6), d = v.slice(6, 8);
    return { iso: `${y}-${mo}-${d}`, allDay: true };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!m) return { iso: null, allDay: false };
  const [, y, mo, d, h, mi, s, z] = m;
  // Floating/local time (school feed's stated timezone, Asia/Bangkok) is kept
  // as-is; a "Z" suffix marks true UTC and is passed through with the Z.
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${z ? "Z" : ""}`;
  return { iso, allDay: false };
}

// Parse raw ICS text into an array of VEVENT objects:
// { uid, summary, start, end, allDay, location, description, categories,
//   recurring }
function parseICS(raw) {
  return parseICSWithMeta(raw).events;
}

// Same parse, but also surfaces calendar-level metadata (X-WR-CALNAME) used
// by the custom-feed preview flow to show "Found N events in '<name>'"
// before the parent commits to subscribing.
function parseICSWithMeta(raw) {
  if (!raw || typeof raw !== "string") return { events: [], calendarName: null };
  const lines = unfoldLines(raw);
  const events = [];
  let cur = null;
  let calendarName = null;

  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    const { name, params, value } = parsed;

    if (!cur && (name === "X-WR-CALNAME" || name === "NAME")) {
      calendarName = unescapeText(value).trim() || null;
      continue;
    }

    if (name === "BEGIN" && value === "VEVENT") {
      cur = { uid: null, summary: "", start: null, end: null, allDay: false, location: "", description: "", categories: [], recurring: false };
      continue;
    }
    if (name === "END" && value === "VEVENT") {
      if (cur && cur.uid && cur.start) events.push(cur);
      cur = null;
      continue;
    }
    if (!cur) continue;

    switch (name) {
      case "UID":
        cur.uid = value.trim();
        break;
      case "SUMMARY":
        cur.summary = unescapeText(value);
        break;
      case "DTSTART": {
        const { iso, allDay } = parseDateValue(value, params);
        cur.start = iso;
        cur.allDay = allDay;
        break;
      }
      case "DTEND": {
        const { iso } = parseDateValue(value, params);
        cur.end = iso;
        break;
      }
      case "LOCATION":
        cur.location = unescapeText(value);
        break;
      case "DESCRIPTION":
        cur.description = unescapeText(value);
        break;
      case "CATEGORIES":
        cur.categories = unescapeText(value).split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "RRULE":
        cur.recurring = true;
        break;
      default:
        break;
    }
  }
  return { events, calendarName };
}

module.exports = { parseICS, parseICSWithMeta, unfoldLines, parseLine, parseDateValue };
