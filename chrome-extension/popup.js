"use strict";

// Manual school-stats sync. Homework, timetable, and activities are owned by
// the official private feeds configured in Fam ETC Settings.
const {
  MOODLE_BASE,
  looksLikeMoodleLoginPage,
  parseSchoolStatsHtml,
  moodleHomeUrl,
} = window.famParse;

const button = document.getElementById("import-btn");
const status = document.getElementById("status");

function setStatus(message, kind = "info") {
  status.textContent = message;
  status.className = kind;
}

async function fetchSchoolStats() {
  const response = await fetch(moodleHomeUrl(), { credentials: "include" });
  const html = await response.text();
  if (!response.ok || looksLikeMoodleLoginPage(html)) {
    const error = new Error("MOODLE_LOGIN_REQUIRED");
    error.code = "MOODLE_LOGIN_REQUIRED";
    throw error;
  }
  return Array.from(parseSchoolStatsHtml(html));
}

async function syncStats() {
  button.disabled = true;
  setStatus("Reading school stats…");
  try {
    const schoolStats = await fetchSchoolStats();
    if (!schoolStats.length) {
      setStatus("No school stats were found on the Moodle home page.", "error");
      return;
    }
    const response = await chrome.runtime.sendMessage({ type: "IMPORT_STATS", schoolStats });
    if (!response || response.error === "NO_FAMETC_TAB") {
      setStatus("Open and sign in to fametc.com in another tab, then try again.", "error");
      return;
    }
    if (response.error === "NOT_LOADED") {
      setStatus("Reload the open Fam ETC tab, then try again.", "error");
      return;
    }
    if (response.error) {
      setStatus("School stats could not be updated in Fam ETC.", "error");
      return;
    }
    const updated = Number(response.result && response.result.schoolStatsUpdated) || 0;
    setStatus(
      updated ? `Updated school stats for ${updated} child${updated === 1 ? "" : "ren"}.` : "No matching child stats were found.",
      updated ? "ok" : "error"
    );
  } catch (error) {
    setStatus(
      error && error.code === "MOODLE_LOGIN_REQUIRED"
        ? `Sign in to ${MOODLE_BASE} first, then try again.`
        : "School stats could not be read right now.",
      "error"
    );
  } finally {
    button.disabled = false;
  }
}

button.addEventListener("click", syncStats);
