"use strict";
/* ============================================================
   Fam ETC School Import — popup.js
   Runs in the extension popup as a MANUAL fallback trigger (auto-sync is
   handled by content.js + background.js — see README.md). Fetches Moodle
   homework + timetable pages from the parent's already-logged-in browser
   session (host_permissions grant cookie-bearing fetches to
   bangkok.learn.nae.school), parses them with the shared parse.js helpers,
   then injects a small function into an open, logged-in fametc.com tab to
   hand the parsed data to window.famImportSchoolData.

   Why inject into the tab instead of POSTing straight to the Fam ETC
   server from here? The extension has no access to the fametc.com
   sameSite=lax session cookie in a cross-context fetch — only same-origin
   script running IN the page can rely on that cookie automatically. So we
   run the "write" step inside the authenticated tab via
   chrome.scripting.executeScript, exactly like a same-origin script would
   (this happens in background.js, which the popup delegates to).
============================================================ */

const {
  MOODLE_BASE: popupMoodleBase,
  looksLikeMoodleLoginPage: popupLooksLikeMoodleLoginPage,
  parseHomeworkHtml: popupParseHomeworkHtml,
  parseTimetableHtml: popupParseTimetableHtml,
  parseSignedUpActivitiesHtml: popupParseSignedUpActivitiesHtml,
  parseSchoolStatsHtml: popupParseSchoolStatsHtml,
  moodleHomeworkUrl: popupMoodleHomeworkUrl,
  moodleTimetableUrl: popupMoodleTimetableUrl,
  moodleHomeUrl: popupMoodleHomeUrl,
} = window.famParse;

const el = {
  moodleUserId: document.getElementById("moodle-user-id"),
  kidId: document.getElementById("fametc-kid-id"),
  btn: document.getElementById("import-btn"),
  status: document.getElementById("status"),
  mappingsHint: document.getElementById("mappings-hint"),
};

function setStatus(msg, kind) {
  el.status.textContent = msg;
  el.status.className = kind || "info";
}

/* ---------- prefill Moodle user id from the active Moodle tab's URL ---------- */
async function prefillMoodleUserId() {
  try {
  const tabs = await chrome.tabs.query({ url: `${popupMoodleBase}/*` });
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

/* ---------- prefill from Fam ETC's saved kid<->Moodle-id mappings, via background ---------- */
async function prefillFromMappings() {
  if (!el.mappingsHint) return;
  try {
    const check = await chrome.runtime.sendMessage({ type: "AUTO_SYNC_CHECK" });
    if (!check || !check.famOpen) {
      el.mappingsHint.textContent = "Tip: open a fametc.com tab to auto-prefill your kids' saved Moodle IDs.";
      return;
    }
    if (!check.mappings || !check.mappings.length) {
      el.mappingsHint.textContent = "No Moodle IDs saved yet — set them in Fam ETC → Settings, or enter one below.";
      return;
    }
    el.mappingsHint.innerHTML =
      "Saved kids: " +
      check.mappings.map((m) => `<a href="#" data-kid-id="${m.kidId}" data-moodle-id="${m.moodleUserId}">${m.kidName || "Kid"}</a>`).join(", ");
    el.mappingsHint.querySelectorAll("a[data-kid-id]").forEach((a) => {
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        el.moodleUserId.value = a.getAttribute("data-moodle-id") || "";
        el.kidId.value = a.textContent || "";
      });
    });
  } catch (e) {
    /* non-fatal — background not reachable yet */
  }
}

/* ---------- fetch helpers ---------- */
async function fetchMoodlePage(url) {
  const res = await fetch(url, { credentials: "include" });
  const text = await res.text();
  if (popupLooksLikeMoodleLoginPage(text)) {
    const err = new Error("MOODLE_LOGIN_REQUIRED");
    err.code = "MOODLE_LOGIN_REQUIRED";
    throw err;
  }
  return text;
}

/* ---------- family-wide school stats (house points/attendance/canteen),
   fetched once from the HOME dashboard — best-effort, never blocks the
   homework/timetable import if it fails. ---------- */
async function fetchSchoolStats() {
  try {
    const html = await fetchMoodlePage(popupMoodleHomeUrl());
    return popupParseSchoolStatsHtml(html);
  } catch (e) {
    return [];
  }
}

/* Parse confirmed activities from any open ECA signup page for this kid.
   Fetching the visible page URL reuses the parent's authenticated Moodle
   session and lets the popup remain a complete manual fallback. */
async function fetchSignedUpActivitySnapshots(moodleUserId) {
  try {
    const tabs = await chrome.tabs.query({ url: `${popupMoodleBase}/mod/eca/view_student.php*` });
    const byEcaId = new Map();
    for (const tab of tabs) {
      if (!tab.url) continue;
      const url = new URL(tab.url);
      if (url.searchParams.get("userid") !== String(moodleUserId)) continue;
      const ecaId = url.searchParams.get("e");
      if (!ecaId) continue;
      const html = await fetchMoodlePage(tab.url);
      byEcaId.set(ecaId, {
        ecaId,
        activities: popupParseSignedUpActivitiesHtml(html),
      });
    }
    return Array.from(byEcaId.values());
  } catch (e) {
    return [];
  }
}

/* ---------- main flow ---------- */
async function handleImport() {
  const moodleUserId = el.moodleUserId.value.trim();
  // The field now takes the child's NAME (as shown in Fam ETC), and is
  // optional if there's only one child — the in-app bridge resolves it.
  const kidName = el.kidId.value.trim();

  if (!moodleUserId || !/^\d+$/.test(moodleUserId)) {
    setStatus("Enter a valid Moodle user id (numbers only).", "error");
    return;
  }

  el.btn.disabled = true;
  setStatus("Fetching homework & timetable from Moodle…", "info");

  try {
    const hwUrl = popupMoodleHomeworkUrl(moodleUserId);
    const ttUrl = popupMoodleTimetableUrl(moodleUserId);

    let hwHtml, ttHtml;
    try {
      [hwHtml, ttHtml] = await Promise.all([fetchMoodlePage(hwUrl), fetchMoodlePage(ttUrl)]);
    } catch (e) {
      if (e.code === "MOODLE_LOGIN_REQUIRED") {
        setStatus(
          "Looks like you're not logged into Moodle in this browser. Please log into " +
            popupMoodleBase +
            " first, then try again.",
          "error"
        );
        return;
      }
      throw e;
    }

    const homework = popupParseHomeworkHtml(hwHtml);
    const { lessons: timetable, twoWeek } = popupParseTimetableHtml(ttHtml);

    const activitySnapshots = await fetchSignedUpActivitySnapshots(moodleUserId);
    const activityCount = activitySnapshots.reduce((sum, snapshot) => sum + snapshot.activities.length, 0);

    if (!homework.length && !timetable.length && !activitySnapshots.length) {
      setStatus(
        "No homework, timetable, or signed-up activity rows were found. The page structure may have changed, or this Moodle account has nothing posted yet.",
        "error"
      );
      return;
    }

    setStatus(
      `Parsed ${homework.length} homework item(s), ${timetable.length} lesson(s), and ${activityCount} signed-up activity event(s)` +
        (twoWeek ? " (looks like a 2-week timetable — only the first week shown was imported)." : ".") +
        " Sending to Fam ETC…",
      "info"
    );

    const schoolStats = await fetchSchoolStats();

    const response = await chrome.runtime.sendMessage({
      type: "IMPORT",
      kidId: null,
      kidName,
      moodleUserId,
      homework,
      timetable,
      activitySnapshots,
      schoolStats,
    });

    if (!response || response.error === "NO_FAMETC_TAB") {
      setStatus(
        "No open fametc.com tab found. Please open and log into https://www.fametc.com in another tab, then try again.",
        "error"
      );
      return;
    }
    if (response.error === "NOT_LOADED") {
      setStatus(
        "The Fam ETC tab doesn't have the import bridge loaded yet. Reload the fametc.com tab (make sure you're logged in) and try again.",
        "error"
      );
      return;
    }
    if (response.error) {
      setStatus(`Could not run the import in the Fam ETC tab: ${response.error}`, "error");
      return;
    }

    const result = response.result || {};
    setStatus(
      `Done! Added ${result.homeworkAdded || 0} homework item(s), ${result.timetableEventsAdded || 0} timetable event(s), and ${result.activityEventsAdded || 0} activit${result.activityEventsAdded === 1 ? "y" : "ies"}; removed ${result.activityEventsRemoved || 0} unsigned activit${result.activityEventsRemoved === 1 ? "y" : "ies"}` +
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
document.addEventListener("DOMContentLoaded", () => {
  prefillMoodleUserId();
  prefillFromMappings();
});
prefillMoodleUserId();
prefillFromMappings();
