"use strict";
/* ============================================================
   Fam ETC School Import — parse.js
   Shared Moodle HTML parsing, used by BOTH popup.js (manual trigger) and
   content.js (auto-sync). Kept dependency-free (DOMParser is a browser
   global available in both the popup document and a content-script page
   context) so it can be included via a plain <script> tag / content_scripts
   entry without a build step.

   VERIFIED structures (bangkok.learn.nae.school) — see README.md for URLs.
============================================================ */

/* ---------- shared login-page detection ---------- */
function looksLikeMoodleLoginPage(html) {
  if (!html) return true;
  // The Moodle login page has a password field and no homework/timetable
  // markup. A logged-in homework/timetable page will contain one of our
  // known selectors' class names in the raw HTML.
  const hasPasswordField = /name=["']password["']/i.test(html);
  const hasKnownContent = /applyhwclass|sta_timetable/i.test(html);
  return hasPasswordField && !hasKnownContent;
}

const PARSER_MAX_TEXT = 600;
const PARSER_MAX_WARNING = 300;
const PARSER_MAX_WARNINGS = 40;

function boundedParserText(value, max = PARSER_MAX_TEXT) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function addParserWarning(warnings, message) {
  const warning = boundedParserText(message, PARSER_MAX_WARNING);
  if (warning && warnings.length < PARSER_MAX_WARNINGS && !warnings.includes(warning)) {
    warnings.push(warning);
  }
  return warning;
}

function attachParserWarnings(value, warnings) {
  value.parserWarnings = warnings.slice(0, PARSER_MAX_WARNINGS);
  return value;
}

/* ---------- homework parsing ----------
   GET /mod/homework/view.php?h=2&userid=<id>&showcompleted=0&limit=0
   Task = <div class="accordion-item applyhwclass ...">, completed tasks
   also carry class "tickon". Inside: <span class="subject">,
   <span class="title">, <div class="date" title="This task was completed
   on <D>\nIt was set <D>">visible date</div>.
*/
function parseHomeworkHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const nodes = doc.querySelectorAll(".accordion-item.applyhwclass");
  const items = [];
  const parserWarnings = [];

  nodes.forEach((node, index) => {
    const subjectEl = node.querySelector(".subject");
    const titleEl = node.querySelector(".title");
    const dateEl = node.querySelector(".date");
    const rowWarnings = [];

    const taskIdAttr = node.getAttribute("data-id");
    const moodleTaskId = typeof taskIdAttr === "string" && /^\d+$/.test(taskIdAttr) ? taskIdAttr : null;
    const completed = node.classList.contains("tickon");
    const subject = boundedParserText(subjectEl && subjectEl.textContent);
    const title = boundedParserText(titleEl && titleEl.textContent);
    const visibleDate = boundedParserText(dateEl && dateEl.textContent);
    const titleAttr = (dateEl && dateEl.getAttribute("title")) || "";

    if (!subjectEl || !subject) rowWarnings.push(`Homework row ${index + 1} is missing a subject.`);
    if (!titleEl || !title) rowWarnings.push(`Homework row ${index + 1} is missing a title.`);
    if (!dateEl || !visibleDate) rowWarnings.push(`Homework row ${index + 1} is missing a due date.`);
    if (!moodleTaskId) rowWarnings.push(`Homework row ${index + 1} is missing a valid numeric Moodle task id (data-id); completion sync is unavailable.`);

    // titleAttr looks like: "This task was completed on <D>\nIt was set <D>"
    // or just "It was set <D>" for incomplete tasks.
    let setDate = null;
    const setMatch = titleAttr.match(/It was set\s+([^\n]+)/i);
    if (setMatch) setDate = boundedParserText(setMatch[1]);
    else if (titleAttr) rowWarnings.push(`Homework row ${index + 1} has an unrecognized set-date format.`);

    rowWarnings.forEach((warning) => addParserWarning(parserWarnings, warning));

    const item = {
      subject,
      title,
      dueDate: visibleDate, // e.g. "Thu 18 June" — normalized app-side
      setDate,
      completed,
      moodleTaskId,
    };
    if (rowWarnings.length) {
      item.rawText = boundedParserText(node.textContent);
      item.warnings = rowWarnings.slice(0, PARSER_MAX_WARNINGS);
    }
    items.push(item);
  });

  return attachParserWarnings(items, parserWarnings);
}

/* ---------- timetable parsing ----------
   GET /local/sta/pages/timetable.php?id=<id>
   <table class="sta_timetable generaltable table">: header cells like
   "Reg07:45","P108:00",... (period code + HH:MM). Each following <tr> is a
   day; each td.cell holds concatenated "SubjectTeacher Room Group" text.
   May be a 2-week (Wk1/Wk2) timetable — populated rows from both weeks are
   preserved, with unusual rows reported for review.
*/
function splitPeriodHeader(text) {
  // e.g. "P108:00" -> { period: "P1", time: "08:00" }; "Reg07:45" -> { period: "Reg", time: "07:45" }
  const m = String(text || "").trim().match(/^(.*?)(\d{1,2}:\d{2})$/);
  if (!m) return { period: String(text || "").trim(), time: "" };
  return { period: m[1].trim(), time: m[2].trim() };
}

function timetableDayValue(label) {
  const raw = boundedParserText(label);
  const match = raw.match(/^(?:wk\s*[12]\s*)?(mon|tue|wed|thu|fri)(?:day)?\b/i);
  if (match && !/wk\s*2/i.test(raw)) {
    return { value: { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4 }[match[1].toLowerCase()], raw };
  }
  return { value: raw, raw };
}

function parseTimetableHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = doc.querySelector("table.sta_timetable");
  if (!table) return attachParserWarnings(
    { lessons: [], twoWeek: false },
    ["Timetable table was not found; no lessons could be imported."]
  );

  const rows = Array.from(table.querySelectorAll("tr"));
  if (!rows.length) return attachParserWarnings(
    { lessons: [], twoWeek: false },
    ["Timetable table has no rows; no lessons could be imported."]
  );

  const firstRowCells = Array.from(rows[0].querySelectorAll("th, td"));
  const hasHeader = rows[0].querySelectorAll("th").length > 0 ||
    !firstRowCells.length ||
    firstRowCells.some((cell) => /\d{1,2}:\d{2}/.test(cell.textContent || ""));
  const headerCells = hasHeader ? firstRowCells.slice(1) : []; // first cell is usually blank/day label col
  const periods = headerCells.map((c) => splitPeriodHeader(c.textContent));

  const dayRows = hasHeader ? rows.slice(1) : rows;
  const lessons = [];
  const parserWarnings = [];
  let twoWeek = false;

  dayRows.forEach((row, dayIdx) => {
    const cells = Array.from(row.querySelectorAll("td"));
    if (!cells.length) return;
    // First cell is typically the day name (may include "Wk1"/"Wk2" — treat
    // as a 2-week timetable if we see that pattern anywhere).
    const dayLabel = boundedParserText(cells[0].textContent);
    if (/wk\s*[12]/i.test(dayLabel)) twoWeek = true;

    const lessonCells = cells.slice(1);
    lessonCells.forEach((cell, i) => {
      const text = boundedParserText(cell.textContent);
      if (!text) return;
      const period = periods[i] || { period: "", time: "" };
      const day = timetableDayValue(dayLabel);
      const rowWarnings = [];
      if (!hasHeader) rowWarnings.push("Timetable has no recognizable header row.");
      if (!dayLabel || typeof day.value !== "number") rowWarnings.push(`Timetable lesson ${dayIdx + 1} has an unrecognized day label.`);
      if (!period.period && !period.time) rowWarnings.push(`Timetable lesson ${dayIdx + 1} has no period header.`);
      else if (!period.time) rowWarnings.push(`Timetable lesson ${dayIdx + 1} has an unrecognized period/time format.`);
      rowWarnings.forEach((warning) => addParserWarning(parserWarnings, warning));
      const lesson = {
        day: day.value, // 0=Mon .. 4=Fri, or the raw value when malformed
        period: period.period || "",
        time: period.time,
        subject: text, // best-effort: whole cell text (Subject/Teacher/Room/Group concatenated)
      };
      if (rowWarnings.length) {
        lesson.dayLabel = dayLabel;
        lesson.periodRaw = boundedParserText(headerCells[i] && headerCells[i].textContent);
        lesson.timeRaw = boundedParserText(period.time);
        lesson.rawText = text;
        lesson.warnings = rowWarnings.slice(0, PARSER_MAX_WARNINGS);
      }
      lessons.push(lesson);
    });
  });

  if (!lessons.length) addParserWarning(parserWarnings, "No populated timetable lesson cells were found.");
  return attachParserWarnings({ lessons, twoWeek }, parserWarnings);
}

/* ---------- signed-up ECA/activity parsing ----------
   GET /mod/eca/view_student.php?e=<event id>&userid=<kid id>&prefmode=0
   Timeslot headers and activity rows share one table in document order:
     <th><input class="timeslot-radio" data-index="1787215500">Thursday ...</th>
     <tr data-clubid="64894"><td class="wait">Signed up</td>
       <td class="name"><a>High School Flames Chess Tryouts</a></td></tr>
   Only rows whose visible status is "Signed up" (case-insensitive) are imported;
   availability and waitlist rows are deliberately ignored.
*/
function parseEcaTimeslot(text) {
  const months = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  const m = String(text || "").replace(/\s+/g, " ").trim().match(
    /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4}),\s+(\d{1,2}):(\d{2})\s*(am|pm)$/i
  );
  if (!m) return null;
  const month = months[m[2].slice(0, 3).toLowerCase()];
  if (!month) return null;
  let hour = Number(m[4]);
  if (hour < 1 || hour > 12) return null;
  if (m[6].toLowerCase() === "am") hour %= 12;
  else hour = (hour % 12) + 12;
  const pad = (n) => String(n).padStart(2, "0");
  return {
    date: `${m[3]}-${pad(month)}-${pad(Number(m[1]))}`,
    time: `${pad(hour)}:${m[5]}`,
  };
}

function parseSignedUpActivitiesHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = doc.querySelector("table#ecastudentview");
  if (!table) return attachParserWarnings([], ["ECA signup table was not found; no activities could be imported."]);

  const activities = [];
  const parserWarnings = [];
  let timeslot = null;
  Array.from(table.querySelectorAll("tr")).forEach((row, index) => {
    const header = row.querySelector("th");
    if (header && header.querySelector(".timeslot-radio")) {
      const raw = boundedParserText(header.textContent);
      timeslot = { raw, parsed: parseEcaTimeslot(raw) };
      if (!timeslot.parsed) addParserWarning(parserWarnings, `ECA timeslot "${raw || "(empty)"}" could not be parsed.`);
      return;
    }

    const cells = typeof row.querySelectorAll === "function" ? Array.from(row.querySelectorAll("td")) : [];
    const status = row.querySelector("td.wait") || cells.find((cell) => boundedParserText(cell.textContent).toLowerCase() === "signed up");
    if (!status || boundedParserText(status.textContent).toLowerCase() !== "signed up") return;
    const nameEl = row.querySelector("td.name a") || row.querySelector("td.name");
    const title = boundedParserText(nameEl && nameEl.textContent);
    const clubId = boundedParserText(row.getAttribute("data-clubid"));
    const rowWarnings = [];
    if (!timeslot) rowWarnings.push(`Signed-up ECA row ${index + 1} has no timeslot.`);
    else if (!timeslot.parsed) rowWarnings.push(`Signed-up ECA row ${index + 1} has an unrecognized timeslot.`);
    if (!title) rowWarnings.push(`Signed-up ECA row ${index + 1} is missing a title.`);
    if (!clubId) rowWarnings.push(`Signed-up ECA row ${index + 1} is missing a club id.`);
    rowWarnings.forEach((warning) => addParserWarning(parserWarnings, warning));

    const activity = {
      title,
      date: (timeslot && timeslot.parsed && timeslot.parsed.date) || "",
      time: (timeslot && timeslot.parsed && timeslot.parsed.time) || "",
      clubId,
    };
    if (rowWarnings.length) {
      activity.timeslot = (timeslot && timeslot.raw) || "";
      activity.rawText = boundedParserText(row.textContent);
      activity.warnings = rowWarnings.slice(0, PARSER_MAX_WARNINGS);
    }
    activities.push(activity);
  });
  return attachParserWarnings(activities, parserWarnings);
}

/* ---------- school stats parsing (house points / attendance / canteen) ----------
   GET / (the school HOME dashboard, site root). Lists each child as a
   `<td class="cell c1 lastcol">Ryshi 10a</td>` heading followed by tiles
   whose text (document.body.innerText) contains, per kid, in order:
     - house points: /(\d+)\s*points/i
     - attendance:   /(\d+)%\s*Attend/i
     - punctual:     /(\d+)%\s*Punctual/i
     - canteen:      /Balance\s*฿?\s*(\d+)/i
   Kid FIRST names come from the td.cell.c1.lastcol headings (e.g.
   "Ryshi 10a" -> "Ryshi"). Family-wide (not per-mapped-kid) — fetched ONCE
   per sync from the site root, not per kid. Verified live 2026-07-03:
   Ryshi {points:108, attend:99, punctual:98, balance:201}; Arya
   {points:0, attend:100, punctual:100, balance:180}. */
function parseSchoolStatsHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const headings = Array.from(doc.querySelectorAll("td.cell.c1.lastcol"));
  const bodyText = (doc.body && doc.body.textContent) || "";

  // Kid name -> first occurrence index of that name in the body text, so we
  // can slice the text into per-kid blocks in document order.
  const names = headings
    .map((td) => (td.textContent || "").trim())
    .filter(Boolean)
    .map((full) => full.split(/\s+/)[0]) // first name only, e.g. "Ryshi 10a" -> "Ryshi"
    .filter((name, i, arr) => arr.indexOf(name) === i); // dedupe

  const positions = names
    .map((name) => ({ name, idx: bodyText.indexOf(name) }))
    .filter((p) => p.idx !== -1)
    .sort((a, b) => a.idx - b.idx);

  const results = positions.map((p, i) => {
    const start = p.idx;
    const end = i + 1 < positions.length ? positions[i + 1].idx : bodyText.length;
    const block = bodyText.slice(start, end);

    const pointsMatch = block.match(/(\d+)\s*points/i);
    const attendMatch = block.match(/(\d+)%\s*Attend/i);
    const punctualMatch = block.match(/(\d+)%\s*Punctual/i);
    const balanceMatch = block.match(/Balance\s*฿?\s*(\d+)/i);

    return {
      name: p.name,
      housePoints: pointsMatch ? Number(pointsMatch[1]) : null,
      attendance: attendMatch ? Number(attendMatch[1]) : null,
      punctual: punctualMatch ? Number(punctualMatch[1]) : null,
      canteenBalance: balanceMatch ? Number(balanceMatch[1]) : null,
    };
  });

  return results;
}

/* ---------- Moodle page URLs ---------- */
const MOODLE_BASE = "https://bangkok.learn.nae.school";
function moodleHomeworkUrl(moodleUserId) {
  return `${MOODLE_BASE}/mod/homework/view.php?h=2&userid=${encodeURIComponent(moodleUserId)}&showcompleted=0&limit=0`;
}
function moodleTimetableUrl(moodleUserId) {
  return `${MOODLE_BASE}/local/sta/pages/timetable.php?id=${encodeURIComponent(moodleUserId)}`;
}
function moodleHomeUrl() {
  return `${MOODLE_BASE}/`;
}

/* Exposed as plain globals — loaded via a <script> tag (popup.html) or as an
   additional content_scripts file (manifest.json), both non-module contexts. */
if (typeof window !== "undefined") {
  window.famParse = {
    MOODLE_BASE,
    looksLikeMoodleLoginPage,
    parseHomeworkHtml,
    parseTimetableHtml,
    parseSignedUpActivitiesHtml,
    parseSchoolStatsHtml,
    moodleHomeworkUrl,
    moodleTimetableUrl,
    moodleHomeUrl,
  };
}
