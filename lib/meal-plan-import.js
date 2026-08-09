"use strict";

// The Hermes meal-plan boundary is deliberately a small, deterministic parser.
// It accepts a supported Markdown pipe table or a tightly-scoped single-day
// heading with meal sections; everything else stays ordinary chat text.

const SLOTS = ["breakfast", "lunch", "dinner"];
const SLOT_INDEX = new Map(SLOTS.map((slot, index) => [slot, index]));
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DAY_INDEX = new Map();
[
  ["monday", ["monday", "mon"]],
  ["tuesday", ["tuesday", "tue", "tues"]],
  ["wednesday", ["wednesday", "wed", "weds"]],
  ["thursday", ["thursday", "thu", "thur", "thurs"]],
  ["friday", ["friday", "fri"]],
  ["saturday", ["saturday", "sat"]],
  ["sunday", ["sunday", "sun"]],
].forEach(([day, aliases], index) => {
  for (const alias of aliases) DAY_INDEX.set(alias, index);
});

const MAX_DAYS = 7;
const MAX_ENTRIES = 21;
const MAX_TITLE_LENGTH = 120;
const DAY_HEADER = "day";

class MealPlanParseError extends Error {
  constructor(message) {
    super(message);
    this.name = "MealPlanParseError";
    this.code = "MEAL_PLAN_PARSE_ERROR";
  }
}

function fail(message) {
  throw new MealPlanParseError(message);
}

function cleanMarkdown(value) {
  return String(value == null ? "" : value)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/`{1,3}/g, "")
    .replace(/~~([^~]*)~~/g, "$1")
    .replace(/\*\*|__|\*|_/g, "")
    .replace(/^[\s>*-]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function headerName(value) {
  return cleanMarkdown(value).toLowerCase().replace(/[.:]/g, "");
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

function markdownLines(markdown) {
  return String(markdown == null ? "" : markdown).replace(/\r\n?/g, "\n").split("\n");
}

function tableShapeAt(lines, headerLine) {
  const headers = splitPipeRow(lines[headerLine]);
  if (!headers || headers.length < 2) return null;
  const positions = { day: -1, breakfast: -1, lunch: -1, dinner: -1 };
  for (let i = 0; i < headers.length; i++) {
    const name = headerName(headers[i]);
    if (name === DAY_HEADER || SLOT_INDEX.has(name)) {
      if (positions[name] !== -1) return null;
      positions[name] = i;
    }
  }
  const slots = SLOTS.filter((slot) => positions[slot] >= 0);
  if (positions.day < 0 || !slots.length) return null;
  const separator = splitPipeRow(lines[headerLine + 1]);
  if (!separator || separator.length !== headers.length || !isSeparatorRow(separator)) return null;
  return { headers, positions, slots };
}

function findTableShape(lines) {
  for (let i = 0; i < lines.length; i++) {
    const shape = tableShapeAt(lines, i);
    if (shape) {
      return { ...shape, headerLine: i };
    }
  }
  return null;
}

function parseTableRows(lines, found) {
  const rows = [];
  const seenDays = new Set();
  for (let i = found.headerLine + 2; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!String(rawLine).trim()) break;
    const cells = splitPipeRow(rawLine);
    if (!cells) break;
    if (cells.length !== found.headers.length || isSeparatorRow(cells)) {
      fail("The meal-plan table is malformed.");
    }
    const dayText = cleanMarkdown(cells[found.positions.day]).toLowerCase().replace(/[.]$/, "");
    const dayIndex = DAY_INDEX.get(dayText);
    if (dayIndex == null) fail("The meal-plan table contains an unsupported weekday.");
    if (seenDays.has(dayIndex)) fail("The meal-plan table contains a duplicate weekday.");
    seenDays.add(dayIndex);
    const titles = {};
    for (const slot of found.slots) {
      const title = cleanMarkdown(cells[found.positions[slot]]).slice(0, MAX_TITLE_LENGTH);
      if (!title) fail("The meal-plan table contains an empty meal.");
      titles[slot] = title;
    }
    rows.push({ dayIndex, titles });
    if (rows.length > MAX_DAYS || rows.length * found.slots.length > MAX_ENTRIES) {
      fail("The meal-plan table is too large.");
    }
  }
  if (!rows.length) fail("The meal-plan table has no meal rows.");
  return rows;
}

function validDate(startDate) {
  const value = String(startDate == null ? "" : startDate).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date;
}

function validMonday(startDate) {
  const date = validDate(startDate);
  return date && date.getUTCDay() === 1 ? date : null;
}

function dateForOffset(start, offset) {
  const date = new Date(start.getTime());
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function stableKey(date, slot) {
  return `${date}|${slot}`;
}

function markdownHeading(line) {
  const match = String(line || "").match(/^\s{0,3}(#{1,6})[ \t]+(.+?)[ \t]*$/);
  if (!match) return null;
  return {
    text: cleanMarkdown(match[2].replace(/[ \t]+#+[ \t]*$/, "")),
  };
}

function isSingleDayHeading(heading) {
  if (!heading || !heading.text) return false;
  const text = heading.text.toLowerCase();
  return /\bmeal\s+plan\b/.test(text)
    && /\b(?:today|tomorrow)(?:['’]s)?\b/.test(text);
}

function isMarkdownListItem(line) {
  return /^\s*(?:[-+*]|\d+[.)])[ \t]+/.test(String(line || ""));
}

function singleDayMealLabel(line) {
  if (isMarkdownListItem(line)) return null;
  const text = cleanMarkdown(line);
  const match = text.match(/^(breakfast|lunch|dinner)(?:\s*(?::|[-–—|])\s*(.*))?$/i);
  if (!match) return null;
  return {
    slot: match[1].toLowerCase(),
    inlineTitle: cleanMarkdown(match[2] || ""),
  };
}

function isIgnoredSingleDaySection(line) {
  if (isMarkdownListItem(line)) return false;
  const text = cleanMarkdown(line)
    .toLowerCase()
    .replace(/[.:]+$/, "")
    .replace(/\s+/g, " ");
  return /^(?:after[ -]?school\s+)?snacks?$/.test(text)
    || /^(?:(?:quick|meal)\s+)?prep(?:aration)?(?:\s+(?:notes?|plan))?$/.test(text)
    || /^quick\s+prep\s+tonight(?:\s*:.*)?$/.test(text)
    || /^(?:grocery|groceries|shopping)(?:\s+(?:list|notes?))?$/.test(text)
    || /^(?:alternative|alternatives|substitutions?|options?)$/.test(text)
    || /^(?:ingredients?|notes?|other\s+notes?)$/.test(text);
}

function parseSingleDaySections(lines) {
  let headingIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isSingleDayHeading(markdownHeading(lines[i]))) {
      headingIndex = i;
      break;
    }
  }
  if (headingIndex < 0) fail("No supported single-day meal-plan heading was found.");

  let end = lines.length;
  for (let i = headingIndex + 1; i < lines.length; i++) {
    if (markdownHeading(lines[i])) {
      end = i;
      break;
    }
  }

  const meals = new Map();
  for (let i = headingIndex + 1; i < end; i++) {
    const label = singleDayMealLabel(lines[i]);
    if (!label) continue;
    if (meals.has(label.slot)) fail("The single-day meal plan contains a duplicate meal label.");

    let title = label.inlineTitle;
    if (!title) {
      let titleIndex = i + 1;
      while (titleIndex < end) {
        const candidate = lines[titleIndex];
        if (!String(candidate).trim() || !cleanMarkdown(candidate)) {
          titleIndex += 1;
          continue;
        }
        if (markdownHeading(candidate) || singleDayMealLabel(candidate) || isIgnoredSingleDaySection(candidate)) break;
        title = cleanMarkdown(candidate);
        break;
      }
      if (!title) fail("The single-day meal plan contains a meal label without a title.");
      i = titleIndex;
    }
    meals.set(label.slot, title.slice(0, MAX_TITLE_LENGTH));
  }

  if (!meals.size) fail("The single-day meal plan has no recognized meals.");
  return meals;
}

function parseMealPlan(markdown, startDate) {
  if (markdown && typeof markdown === "object" && !Array.isArray(markdown)) {
    startDate = markdown.startDate;
    markdown = markdown.text != null ? markdown.text : markdown.markdown;
  }
  const lines = markdownLines(markdown);
  const table = findTableShape(lines);
  if (table) {
    const start = validMonday(startDate);
    if (!start) fail("startDate must be a valid Monday in YYYY-MM-DD format.");
    const rows = parseTableRows(lines, table);
    const items = [];
    for (const row of rows.sort((a, b) => a.dayIndex - b.dayIndex)) {
      const date = dateForOffset(start, row.dayIndex);
      for (const slot of SLOTS) {
        if (!row.titles[slot]) continue;
        items.push({ key: stableKey(date, slot), date, slot, title: row.titles[slot] });
      }
    }
    if (items.length > MAX_ENTRIES) fail("The meal-plan table is too large.");
    return items;
  }

  const date = validDate(startDate);
  if (!date) fail("startDate must be a valid date in YYYY-MM-DD format.");
  const dateText = date.toISOString().slice(0, 10);
  const meals = parseSingleDaySections(lines);
  const items = [];
  for (const slot of SLOTS) {
    if (!meals.has(slot)) continue;
    items.push({ key: stableKey(dateText, slot), date: dateText, slot, title: meals.get(slot) });
  }
  return items;
}

function isParseableMealPlan(markdown) {
  try {
    const lines = markdownLines(markdown);
    const table = findTableShape(lines);
    if (table) parseTableRows(lines, table);
    else parseSingleDaySections(lines);
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = {
  SLOTS,
  WEEKDAYS,
  MAX_DAYS,
  MAX_ENTRIES,
  MAX_TITLE_LENGTH,
  MealPlanParseError,
  parseMealPlan,
  parse: parseMealPlan,
  isParseableMealPlan,
  isParseable: isParseableMealPlan,
  stableKey,
};
