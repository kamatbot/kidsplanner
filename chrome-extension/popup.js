"use strict";
/* ============================================================
   Fam ETC School Import — popup.js
   Runs in the extension popup. Fetches Moodle homework + timetable pages
   from the parent's already-logged-in browser session (host_permissions
   grant cookie-bearing fetches to bangkok.learn.nae.school), parses them
   with DOMParser, then injects a small function into an open, logged-in
   fametc.com tab to hand the parsed data to window.famImportSchoolData.

   Why inject into the tab instead of POSTing straight to the Fam ETC
   server from here? The extension has no access to the fametc.com
   sameSite=lax session cookie in a cross-context fetch — only same-origin
   script running IN the page can rely on that cookie automatically. So we
   run the "write" step inside the authenticated tab via
   chrome.scripting.executeScript, exactly like a same-origin script would.
============================================================ */

const MOODLE_BASE = "https://bangkok.learn.nae.school";

const el = {
  moodleUserId: document.getElementById("moodle-user-id"),
  kidId: document.getElementById("fametc-kid-id"),
  btn: document.getElementById("import-btn"),
  status: document.getElementById("status"),
};

function setStatus(msg, kind) {
  el.status.textContent = msg;
  el.status.className = kind || "info";
}

/* ---------- prefill Moodle user id from the active Moodle tab's URL ---------- */
async function prefillMoodleUserId() {
  try {
    const tabs = await chrome.tabs.query({ url: `${MOODLE_BASE}/*` });
    for (const t of tabs) {
      if (!t.url) continue;
      const u = new URL(t.url);
      const uid = u.searchParams.get("userid") || u.searchParams.get("id");
      if (uid && /^\d+$/.test(uid)) {
        el.moodleUserId.value = uid;
        return;
      }
    }
  } catch (e) {
    /* non-fatal — user can type it in manually */
  }
}

/* ---------- fetch helpers ---------- */
function looksLikeMoodleLoginPage(html) {
  if (!html) return true;
  // The Moodle login page has a password field and no homework/timetable
  // markup. A logged-in homework/timetable page will contain one of our
  // known selectors' class names in the raw HTML.
  const hasPasswordField = /name=["']password["']/i.test(html);
  const hasKnownContent = /applyhwclass|sta_timetable/i.test(html);
  return hasPasswordField && !hasKnownContent;
}

async function fetchMoodlePage(url) {
  const res = await fetch(url, { credentials: "include" });
  const text = await res.text();
  if (looksLikeMoodleLoginPage(text)) {
    const err = new Error("MOODLE_LOGIN_REQUIRED");
    err.code = "MOODLE_LOGIN_REQUIRED";
    throw err;
  }
  return text;
}

/* ---------- homework parsing ----------
   VERIFIED structure (bangkok.learn.nae.school):
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
   VERIFIED structure: GET /local/sta/pages/timetable.php?id=<id>
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

/* ---------- find an open, logged-in fametc.com tab ---------- */
async function findFamEtcTab() {
  const tabs = await chrome.tabs.query({
    url: ["https://www.fametc.com/*", "https://fametc.com/*"],
  });
  return tabs[0] || null;
}

/* ---------- inject the write step into the fametc.com tab ---------- */
async function importIntoTab(tabId, payload) {
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (data) => {
      if (typeof window.famImportSchoolData !== "function") {
        return { error: "NOT_LOADED" };
      }
      return window.famImportSchoolData(data);
    },
    args: [payload],
  });
  return result;
}

/* ---------- main flow ---------- */
async function handleImport() {
  const moodleUserId = el.moodleUserId.value.trim();
  const kidId = el.kidId.value.trim();

  if (!moodleUserId || !/^\d+$/.test(moodleUserId)) {
    setStatus("Enter a valid Moodle user id (numbers only).", "error");
    return;
  }
  if (!kidId) {
    setStatus("Enter the Fam ETC kid id.", "error");
    return;
  }

  el.btn.disabled = true;
  setStatus("Fetching homework & timetable from Moodle…", "info");

  try {
    const hwUrl = `${MOODLE_BASE}/mod/homework/view.php?h=2&userid=${encodeURIComponent(moodleUserId)}&showcompleted=1&limit=0`;
    const ttUrl = `${MOODLE_BASE}/local/sta/pages/timetable.php?id=${encodeURIComponent(moodleUserId)}`;

    let hwHtml, ttHtml;
    try {
      [hwHtml, ttHtml] = await Promise.all([fetchMoodlePage(hwUrl), fetchMoodlePage(ttUrl)]);
    } catch (e) {
      if (e.code === "MOODLE_LOGIN_REQUIRED") {
        setStatus(
          "Looks like you're not logged into Moodle in this browser. Please log into " +
            MOODLE_BASE +
            " first, then try again.",
          "error"
        );
        return;
      }
      throw e;
    }

    const homework = parseHomeworkHtml(hwHtml);
    const { lessons: timetable, twoWeek } = parseTimetableHtml(ttHtml);

    if (!homework.length && !timetable.length) {
      setStatus(
        "No homework or timetable rows were found. The page structure may have changed, or this Moodle account has nothing posted yet.",
        "error"
      );
      return;
    }

    setStatus(
      `Parsed ${homework.length} homework item(s) and ${timetable.length} lesson(s)` +
        (twoWeek ? " (looks like a 2-week timetable — only the first week shown was imported)." : ".") +
        " Looking for an open Fam ETC tab…",
      "info"
    );

    const tab = await findFamEtcTab();
    if (!tab) {
      setStatus(
        "No open fametc.com tab found. Please open and log into https://www.fametc.com in another tab, then try again.",
        "error"
      );
      return;
    }

    const payload = { kidId, moodleUserId, homework, timetable };
    let result;
    try {
      result = await importIntoTab(tab.id, payload);
    } catch (e) {
      setStatus(`Could not run the import in the Fam ETC tab: ${e.message || e}`, "error");
      return;
    }

    if (!result || result.error === "NOT_LOADED") {
      setStatus(
        "The Fam ETC tab doesn't have the import bridge loaded yet. Reload the fametc.com tab (make sure you're logged in) and try again.",
        "error"
      );
      return;
    }

    setStatus(
      `Done! Added ${result.homeworkAdded || 0} homework item(s) and ${result.eventsAdded || 0} timetable event(s)` +
        (result.homeworkSkipped ? ` (${result.homeworkSkipped} skipped, e.g. completed/duplicates).` : "."),
      "ok"
    );
  } catch (e) {
    setStatus(`Import failed: ${(e && e.message) || e}`, "error");
  } finally {
    el.btn.disabled = false;
  }
}

el.btn.addEventListener("click", handleImport);
document.addEventListener("DOMContentLoaded", prefillMoodleUserId);
prefillMoodleUserId();
