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

/* ---------- homework parsing ----------
   GET /mod/homework/view.php?h=2&userid=<id>&showcompleted=1&limit=0
   Task = <div class="accordion-item applyhwclass ...">, completed tasks
   also carry class "tickon". Inside: <span class="subject">,
   <span class="title">, <div class="date" title="This task was completed
   on <D>\nIt was set <D>">visible date</div>.
*/
function parseHomeworkHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const nodes = doc.querySelectorAll(".accordion-item.applyhwclass");
  const items = [];

  nodes.forEach((node) => {
    const subjectEl = node.querySelector(".subject");
    const titleEl = node.querySelector(".title");
    const dateEl = node.querySelector(".date");
    if (!titleEl) return;

    const completed = node.classList.contains("tickon");
    const subject = (subjectEl && subjectEl.textContent.trim()) || "";
    const title = titleEl.textContent.trim();
    const visibleDate = (dateEl && dateEl.textContent.trim()) || "";
    const titleAttr = (dateEl && dateEl.getAttribute("title")) || "";

    // titleAttr looks like: "This task was completed on <D>\nIt was set <D>"
    // or just "It was set <D>" for incomplete tasks.
    let setDate = null;
    const setMatch = titleAttr.match(/It was set\s+([^\n]+)/i);
    if (setMatch) setDate = setMatch[1].trim();

    items.push({
      subject,
      title,
      dueDate: visibleDate, // e.g. "Thu 18 June" — normalized app-side
      setDate,
      completed,
    });
  });

  return items;
}

/* ---------- timetable parsing ----------
   GET /local/sta/pages/timetable.php?id=<id>
   <table class="sta_timetable generaltable table">: header cells like
   "Reg07:45","P108:00",... (period code + HH:MM). Each following <tr> is a
   day; each td.cell holds concatenated "SubjectTeacher Room Group" text.
   May be a 2-week (Wk1/Wk2) timetable — best-effort, noted as a limitation.
*/
function splitPeriodHeader(text) {
  // e.g. "P108:00" -> { period: "P1", time: "08:00" }; "Reg07:45" -> { period: "Reg", time: "07:45" }
  const m = String(text || "").trim().match(/^(.*?)(\d{1,2}:\d{2})$/);
  if (!m) return { period: String(text || "").trim(), time: "" };
  return { period: m[1].trim(), time: m[2].trim() };
}

function parseTimetableHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = doc.querySelector("table.sta_timetable");
  if (!table) return { lessons: [], twoWeek: false };

  const rows = Array.from(table.querySelectorAll("tr"));
  if (!rows.length) return { lessons: [], twoWeek: false };

  const headerCells = Array.from(rows[0].querySelectorAll("th, td")).slice(1); // first cell is usually blank/day label col
  const periods = headerCells.map((c) => splitPeriodHeader(c.textContent));

  const dayRows = rows.slice(1);
  const lessons = [];
  let twoWeek = false;

  dayRows.forEach((row, dayIdx) => {
    const cells = Array.from(row.querySelectorAll("td"));
    if (!cells.length) return;
    // First cell is typically the day name (may include "Wk1"/"Wk2" — treat
    // as a 2-week timetable if we see that pattern anywhere).
    const dayLabel = cells[0].textContent.trim();
    if (/wk\s*[12]/i.test(dayLabel)) twoWeek = true;
    if (dayIdx > 4) return; // only Mon-Fri (rows beyond index 4 likely a Wk2 block)

    const lessonCells = cells.slice(1);
    lessonCells.forEach((cell, i) => {
      const text = cell.textContent.replace(/\s+/g, " ").trim();
      if (!text) return;
      const period = periods[i] || {};
      if (!period.time) return;
      lessons.push({
        day: dayIdx, // 0=Mon .. 4=Fri
        period: period.period || "",
        time: period.time,
        subject: text, // best-effort: whole cell text (Subject/Teacher/Room/Group concatenated)
      });
    });
  });

  return { lessons, twoWeek };
}

/* ---------- Moodle page URLs ---------- */
const MOODLE_BASE = "https://bangkok.learn.nae.school";
function moodleHomeworkUrl(moodleUserId) {
  return `${MOODLE_BASE}/mod/homework/view.php?h=2&userid=${encodeURIComponent(moodleUserId)}&showcompleted=1&limit=0`;
}
function moodleTimetableUrl(moodleUserId) {
  return `${MOODLE_BASE}/local/sta/pages/timetable.php?id=${encodeURIComponent(moodleUserId)}`;
}

/* Exposed as plain globals — loaded via a <script> tag (popup.html) or as an
   additional content_scripts file (manifest.json), both non-module contexts. */
if (typeof window !== "undefined") {
  window.famParse = {
    MOODLE_BASE,
    looksLikeMoodleLoginPage,
    parseHomeworkHtml,
    parseTimetableHtml,
    moodleHomeworkUrl,
    moodleTimetableUrl,
  };
}
