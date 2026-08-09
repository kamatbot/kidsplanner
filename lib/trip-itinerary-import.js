"use strict";

// Hermes trip imports deliberately accept one small, deterministic grammar.
// This module has no datastore or model dependency so the same parser can be
// used by marker inference, preview, and confirm without changing state.

const MAX_TABLE_ROWS = 14;
const MAX_ITEMS = 50;
const MAX_TITLE_LENGTH = 200;
const MAX_NOTE_LENGTH = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CATEGORY_SET = new Set(["food", "sight", "activity", "transit", "stay"]);

const WEEKDAY_ALIASES = new Map([
  ["monday", 1], ["mon", 1],
  ["tuesday", 2], ["tue", 2], ["tues", 2],
  ["wednesday", 3], ["wed", 3], ["weds", 3],
  ["thursday", 4], ["thu", 4], ["thur", 4], ["thurs", 4],
  ["friday", 5], ["fri", 5],
  ["saturday", 6], ["sat", 6],
  ["sunday", 0], ["sun", 0],
]);

const DAYPART_ORDER = ["morning", "afternoon", "evening"];

class TripItineraryParseError extends Error {
  constructor(message) {
    super(message);
    this.name = "TripItineraryParseError";
    this.code = "TRIP_ITINERARY_PARSE_ERROR";
  }
}

function fail(message) {
  throw new TripItineraryParseError(message);
}

function cleanMarkdown(value) {
  return String(value == null ? "" : value)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/`{1,3}/g, "")
    .replace(/~~([^~]*)~~/g, "$1")
    .replace(/\*\*|__|\*|_/g, "")
    .replace(/^[\s>*-]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedHeader(value) {
  return cleanMarkdown(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function headerKind(value) {
  const key = normalizedHeader(value);
  if (key === "date" || key === "dateyyyymmdd" || key === "dateiso") return "date";
  if (key === "day") return "day";
  if (["activity", "plan", "place", "title", "stop"].includes(key)) return "title";
  if (key === "time") return "time";
  if (["category", "type"].includes(key)) return "category";
  if (["note", "notes", "details"].includes(key)) return "note";
  if (DAYPART_ORDER.includes(key)) return key;
  return null;
}

function splitPipeRow(line) {
  const source = String(line || "").trim();
  if (!source.includes("|")) return null;
  let value = source;
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|") && !value.endsWith("\\|")) value = value.slice(0, -1);

  const cells = [];
  let cell = "";
  let escaped = false;
  for (const char of value) {
    if (escaped) {
      cell += char;
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }
  if (escaped) cell += "\\";
  cells.push(cell.trim());
  return cells;
}

function isSeparatorRow(cells) {
  return Array.isArray(cells) && cells.length > 0
    && cells.every((cell) => /^:?-{3,}:?$/.test(String(cell).trim()));
}

function tableShapeAt(lines, headerLine) {
  const headers = splitPipeRow(lines[headerLine]);
  if (!headers || headers.length < 2) return null;

  const positions = {
    date: -1,
    day: -1,
    title: -1,
    time: -1,
    category: -1,
    note: -1,
    morning: -1,
    afternoon: -1,
    evening: -1,
  };
  let recognized = false;
  for (let i = 0; i < headers.length; i++) {
    const kind = headerKind(headers[i]);
    if (!kind) continue;
    recognized = true;
    if (positions[kind] !== -1) return { error: "The itinerary table has duplicate columns." };
    positions[kind] = i;
  }

  const dateKindCount = (positions.date >= 0 ? 1 : 0) + (positions.day >= 0 ? 1 : 0);
  const daypartCount = DAYPART_ORDER.filter((part) => positions[part] >= 0).length;
  const eligible = dateKindCount === 1 && (positions.title >= 0 || daypartCount > 0);
  if (!recognized || !eligible) return null;

  const separator = splitPipeRow(lines[headerLine + 1]);
  if (!separator || separator.length !== headers.length || !isSeparatorRow(separator)) {
    return { error: "The itinerary table is malformed." };
  }

  return {
    headers,
    positions,
    form: positions.title >= 0 ? "row" : "matrix",
    dayparts: DAYPART_ORDER.filter((part) => positions[part] >= 0),
    headerLine,
  };
}

function parseTable(markdown, required = true) {
  const lines = String(markdown == null ? "" : markdown).replace(/\r\n?/g, "\n").split("\n");
  let found = null;
  for (let i = 0; i < lines.length; i++) {
    const shape = tableShapeAt(lines, i);
    if (!shape) continue;
    if (shape.error) fail(shape.error);
    found = shape;
    break;
  }
  if (!found) {
    if (required) fail("No supported itinerary table was found.");
    return null;
  }

  const rows = [];
  for (let i = found.headerLine + 2; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!String(rawLine).trim()) break;
    const cells = splitPipeRow(rawLine);
    if (!cells) break;
    if (cells.length !== found.headers.length || isSeparatorRow(cells)) {
      fail("The itinerary table is malformed.");
    }
    rows.push(cells);
    if (rows.length > MAX_TABLE_ROWS) fail("The itinerary table is too large.");
  }
  if (!rows.length) fail("The itinerary table has no itinerary rows.");
  return { ...found, rows };
}

function validDate(value) {
  const text = String(value == null ? "" : value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) return null;
  return date;
}

function dateForOffset(start, offset) {
  const date = new Date(start.getTime());
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function dateContext(value, endDateArg) {
  const source = value && typeof value === "object" ? value : {};
  const startDate = source.startDate != null ? source.startDate : value;
  const endDate = source.endDate != null ? source.endDate : endDateArg;
  const start = validDate(startDate);
  const end = validDate(endDate);
  if (!start || !end || end < start) {
    fail("The Trip must have valid startDate and endDate values.");
  }
  const normalizedStart = start.toISOString().slice(0, 10);
  const normalizedEnd = end.toISOString().slice(0, 10);
  return {
    start,
    end,
    startDate: normalizedStart,
    endDate: normalizedEnd,
    dayCount: Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1,
  };
}

function resolveDate(value, context) {
  const text = cleanMarkdown(value);
  if (!text) fail("Every itinerary row needs a date or Day value.");

  const exact = validDate(text);
  if (exact) {
    const date = exact.toISOString().slice(0, 10);
    if (date < context.startDate || date > context.endDate) {
      fail("Every itinerary date must fall within the Trip date range.");
    }
    return date;
  }

  const day = /^day\s+([1-9]\d*)$/i.exec(text);
  if (day) {
    const dayNumber = Number(day[1]);
    if (!Number.isSafeInteger(dayNumber) || dayNumber > context.dayCount) {
      fail("Every Day N value must fall within the Trip date range.");
    }
    const offset = dayNumber - 1;
    const date = dateForOffset(context.start, offset);
    if (date < context.startDate || date > context.endDate) {
      fail("Every Day N value must fall within the Trip date range.");
    }
    return date;
  }

  const weekday = WEEKDAY_ALIASES.get(text.toLowerCase().replace(/[.,]$/, ""));
  if (weekday == null) fail("Use exact dates, Day N, or an unambiguous weekday in itinerary rows.");

  if (context.dayCount > 7) fail("Weekday dates are ambiguous; use exact dates or Day N.");
  const matches = [];
  for (let offset = 0; offset < context.dayCount; offset++) {
    const date = new Date(context.start.getTime());
    date.setUTCDate(date.getUTCDate() + offset);
    if (date.getUTCDay() === weekday) matches.push(dateForOffset(context.start, offset));
  }
  if (matches.length !== 1) fail("Weekday dates are ambiguous; use exact dates or Day N.");
  return matches[0];
}

function normalizeTime(value) {
  const text = cleanMarkdown(value);
  if (!text) return "";

  const twentyFourHour = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(text);
  if (twentyFourHour) return text;

  const twelveHour = /^(\d{1,2})(?::([0-5]\d))?\s*([ap])\.?m\.?$/i.exec(text);
  if (twelveHour) {
    const hour = Number(twelveHour[1]);
    if (hour < 1 || hour > 12) fail("The itinerary table contains an unsupported time.");
    const minute = twelveHour[2] || "00";
    let converted = hour % 12;
    if (twelveHour[3].toLowerCase() === "p") converted += 12;
    return `${String(converted).padStart(2, "0")}:${minute}`;
  }
  fail("The itinerary table contains an unsupported time.");
}

function escapedKeyword(keyword) {
  return String(keyword).split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
}

function hasKeyword(text, keyword) {
  return new RegExp(`(?:^|[^a-z0-9])${escapedKeyword(keyword)}(?=$|[^a-z0-9])`, "i").test(text);
}

const CATEGORY_RULES = [
  ["food", ["breakfast", "lunch", "dinner", "brunch", "restaurant", "cafe", "café", "coffee", "bakery", "meal", "snack", "food", "dine", "tasting"]],
  ["stay", ["hotel", "hostel", "resort", "lodging", "accommodation", "airbnb", "villa", "guesthouse", "check-in", "check in", "check-out", "check out"]],
  ["transit", ["flight", "airport", "train", "railway", "metro", "subway", "bus", "taxi", "transfer", "ferry", "station", "transit", "transport", "car rental", "rental car", "departure", "arrival"]],
  ["sight", ["museum", "gallery", "temple", "church", "cathedral", "landmark", "monument", "beach", "park", "garden", "sightseeing", "sight", "tour", "explore", "old town", "palace", "castle", "viewpoint", "attraction"]],
  ["activity", ["hike", "hiking", "swim", "swimming", "walk", "workshop", "class", "kayak", "bike", "biking", "cycling", "spa", "show", "concert", "event", "shopping", "free time", "adventure", "activity"]],
];

function normalizedCategory(value) {
  return cleanMarkdown(value).toLowerCase().replace(/[^a-z]+/g, "");
}

function inferCategory(rawCategory, title, note) {
  const explicit = normalizedCategory(rawCategory);
  if (CATEGORY_SET.has(explicit)) return explicit;
  const text = [rawCategory, title, note].map(cleanMarkdown).filter(Boolean).join(" ").toLowerCase();
  for (const [category, keywords] of CATEGORY_RULES) {
    if (keywords.some((keyword) => hasKeyword(text, keyword))) return category;
  }
  return "activity";
}

function normalizeTitle(value) {
  return cleanMarkdown(value).slice(0, MAX_TITLE_LENGTH);
}

function normalizeNote(value) {
  return cleanMarkdown(value).slice(0, MAX_NOTE_LENGTH);
}

function stableKey(date, time, title) {
  const normalizedDate = String(date || "").trim();
  const normalizedTime = String(time || "").trim();
  const normalizedTitle = normalizeTitle(title).normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
  return `${normalizedDate}|${normalizedTime}|${normalizedTitle}`;
}

function itemFor(date, time, title, rawCategory, note) {
  const cleanTitle = normalizeTitle(title);
  if (!cleanTitle) fail("The itinerary table contains an empty activity.");
  const cleanNote = normalizeNote(note);
  const category = inferCategory(rawCategory, cleanTitle, cleanNote);
  return {
    key: stableKey(date, time, cleanTitle),
    date,
    time,
    title: cleanTitle,
    category,
    note: cleanNote,
  };
}

const PROSE_SECTION_LABELS = new Set([
  "morning",
  "afternoon",
  "evening",
  "typical day",
  "lunch and rest",
]);

function markdownHeading(line) {
  const match = /^\s{0,3}(?:#{1,6})(?:[ \t]+(.*)|[ \t]*)$/.exec(String(line || ""));
  if (!match) return null;
  return {
    text: String(match[1] || "").replace(/[ \t]+#+[ \t]*$/, "").trim(),
  };
}

function dayHeadingNumber(value) {
  const text = cleanMarkdown(value);
  const match = /^day\s+([1-9]\d*)(?:\s*[-–—:.)]\s*.*)?$/i.exec(text);
  return match ? Number(match[1]) : null;
}

function boldLabel(line) {
  const match = /^\s{0,3}(\*\*|__)\s*(.+?)\s*\1\s*:?\s*$/.exec(String(line || ""));
  if (!match) return null;
  return cleanMarkdown(match[2]).replace(/:\s*$/, "").trim();
}

function proseSection(line) {
  const label = boldLabel(line);
  if (!label) return false;
  const normalized = label.toLowerCase().replace(/\s+/g, " ");
  return PROSE_SECTION_LABELS.has(normalized);
}

function boldLabelWithCopy(line) {
  const match = /^\s{0,3}(\*\*|__)\s*([^*_]+?)\s*\1\s*:\s*.*$/.exec(String(line || ""));
  return match ? cleanMarkdown(match[2]).replace(/:\s*$/, "").trim() : null;
}

function proseBullet(line) {
  const match = /^(?:[-+*])[ \t]+(.+?)\s*$/.exec(String(line || ""));
  return match ? match[1] : null;
}

function isAdvisoryLine(line) {
  const text = cleanMarkdown(line).toLowerCase();
  return /^(?:for your group\s*,?\s*look for|important|choose one(?:\b|\.\.\.)|pace)(?:\b|\s*[:—-])/i.test(text);
}

function parseProse(markdown, context, add) {
  const lines = String(markdown == null ? "" : markdown).replace(/\r\n?/g, "\n").split("\n");
  let itineraryHeadingSeen = false;
  let currentDate = null;
  let collecting = false;
  let foundDay = false;
  let foundSection = false;
  let codeFence = null;

  for (const line of lines) {
    const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const marker = fence[1][0];
      if (!codeFence) codeFence = { marker, length: fence[1].length };
      else if (codeFence.marker === marker && fence[1].length >= codeFence.length) codeFence = null;
      continue;
    }
    if (codeFence) continue;

    const heading = markdownHeading(line);
    if (heading) {
      const dayNumber = dayHeadingNumber(heading.text);
      if (!itineraryHeadingSeen && hasKeyword(heading.text, "itinerary")) {
        itineraryHeadingSeen = true;
      }
      if (!itineraryHeadingSeen) {
        continue;
      }
      if (dayNumber != null) {
        if (!Number.isSafeInteger(dayNumber) || dayNumber > context.dayCount) {
          fail("Every Day N value must fall within the Trip date range.");
        }
        currentDate = resolveDate(`Day ${dayNumber}`, context);
        foundDay = true;
        collecting = false;
      } else {
        collecting = false;
      }
      continue;
    }

    if (!itineraryHeadingSeen || !currentDate) continue;

    if (proseSection(line)) {
      collecting = true;
      foundSection = true;
      continue;
    }
    const label = boldLabel(line);
    if (label !== null || boldLabelWithCopy(line) !== null || isAdvisoryLine(line)) {
      collecting = false;
      continue;
    }
    if (!collecting) continue;

    const title = proseBullet(line);
    if (title == null) continue;
    if (!cleanMarkdown(title)) continue;
    add(itemFor(currentDate, "", title, "", ""));
  }

  if (!itineraryHeadingSeen) {
    fail("The itinerary prose needs an H1-H6 heading containing itinerary.");
  }
  if (!foundDay) fail("The itinerary prose needs a valid Day N heading.");
  if (!foundSection) fail("The itinerary prose needs a recognized activity section.");
}

function parseTripItinerary(markdown, tripOrStartDate, maybeEndDate) {
  let text = markdown;
  let dateSource = tripOrStartDate;
  let endDate = maybeEndDate;
  if (markdown && typeof markdown === "object" && !Array.isArray(markdown)) {
    text = markdown.text != null ? markdown.text : markdown.markdown;
    dateSource = markdown.trip || markdown;
    endDate = markdown.endDate;
  }
  const context = dateContext(dateSource, endDate);
  const table = parseTable(text, false);
  const items = [];
  const keys = new Set();
  const add = (item) => {
    if (keys.has(item.key)) fail("The itinerary table contains duplicate activities.");
    keys.add(item.key);
    items.push(item);
    if (items.length > MAX_ITEMS) fail("The itinerary table contains too many activities.");
  };

  if (table) {
    for (const cells of table.rows) {
      const date = resolveDate(cells[table.positions.date >= 0 ? table.positions.date : table.positions.day], context);
      if (table.form === "row") {
        const title = cells[table.positions.title];
        if (!normalizeTitle(title)) fail("The itinerary table contains an empty activity.");
        const time = table.positions.time >= 0 ? normalizeTime(cells[table.positions.time]) : "";
        const category = table.positions.category >= 0 ? cells[table.positions.category] : "";
        const note = table.positions.note >= 0 ? cells[table.positions.note] : "";
        add(itemFor(date, time, title, category, note));
        continue;
      }

      let rowItems = 0;
      const category = table.positions.category >= 0 ? cells[table.positions.category] : "";
      for (const daypart of table.dayparts) {
        const title = normalizeTitle(cells[table.positions[daypart]]);
        if (!title) continue;
        // Matrix notes are intentionally not copied to every daypart item. A
        // single row note has no unambiguous per-cell ownership.
        add(itemFor(date, "", title, category, ""));
        rowItems++;
      }
      if (!rowItems) fail("The itinerary table contains a row with no activity.");
    }
  } else {
    parseProse(text, context, add);
  }
  if (!items.length) fail("The itinerary table has no itinerary activities.");
  return items;
}

function isParseableItinerary(markdown, tripOrStartDate, maybeEndDate) {
  try {
    parseTripItinerary(markdown, tripOrStartDate, maybeEndDate);
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = {
  MAX_TABLE_ROWS,
  MAX_ITEMS,
  MAX_TITLE_LENGTH,
  MAX_NOTE_LENGTH,
  CATEGORY_SET,
  TripItineraryParseError,
  parseTripItinerary,
  parseItinerary: parseTripItinerary,
  parse: parseTripItinerary,
  isParseableItinerary,
  isParseableTripItinerary: isParseableItinerary,
  isParseable: isParseableItinerary,
  cleanMarkdown,
  normalizeTime,
  inferCategory,
  stableKey,
};
