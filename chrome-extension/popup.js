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
  const tabs = await chrome.tabs.query({ url: [`${MOODLE_BASE}/*`] });
  const schoolTab = tabs
    .filter((tab) => Number.isInteger(tab.id))
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  if (!schoolTab) {
    const error = new Error("NO_MOODLE_TAB");
    error.code = "NO_MOODLE_TAB";
    throw error;
  }

  let execution;
  try {
    execution = await chrome.scripting.executeScript({
      target: { tabId: schoolTab.id },
      args: [moodleHomeUrl()],
      func: async (url) => {
        const response = await fetch(url, { credentials: "include" });
        return { ok: response.ok, html: await response.text() };
      },
    });
  } catch (cause) {
    const error = new Error("MOODLE_TAB_NOT_READY");
    error.code = "MOODLE_TAB_NOT_READY";
    error.cause = cause;
    throw error;
  }

  const page = execution && execution[0] && execution[0].result;
  if (!page || !page.ok || looksLikeMoodleLoginPage(page.html)) {
    const error = new Error("MOODLE_LOGIN_REQUIRED");
    error.code = "MOODLE_LOGIN_REQUIRED";
    throw error;
  }
  return Array.from(parseSchoolStatsHtml(page.html));
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
    if (error && error.code === "NO_MOODLE_TAB") {
      setStatus(`Open ${MOODLE_BASE} in a tab, sign in, then try again.`, "error");
    } else if (error && error.code === "MOODLE_TAB_NOT_READY") {
      setStatus("Reload the open Moodle tab, then try again.", "error");
    } else if (error && error.code === "MOODLE_LOGIN_REQUIRED") {
      setStatus(`Sign in to ${MOODLE_BASE} first, then try again.`, "error");
    } else {
      setStatus("School stats could not be read right now.", "error");
    }
  } finally {
    button.disabled = false;
  }
}

button.addEventListener("click", syncStats);
