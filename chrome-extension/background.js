"use strict";
/* ============================================================
   Fam ETC School Import — background.js (MV3 service worker)

   The bridge between the Moodle content script and an open, logged-in
   fametc.com tab. Runs window.famGetSchoolMappings() / window.famImportSchoolData()
   inside the tab via chrome.scripting.executeScript world:"MAIN" — the
   default "isolated" world shares the DOM but NOT the page's window globals,
   so those functions (defined by the page's public/js/app.js) are only
   reachable from MAIN, exactly like a same-origin script running in the
   page itself would see them.

   Message types (all sent from content.js or popup.js via
   chrome.runtime.sendMessage):
     - AUTO_SYNC_CHECK -> { famOpen, mappings }
     - IMPORT { kidId, moodleUserId, homework, timetable } -> import result
     - OPEN_FAMETC -> opens/focuses a fametc.com tab
============================================================ */

const FAMETC_URL_PATTERNS = ["https://www.fametc.com/*", "https://fametc.com/*"];

async function findFamEtcTab() {
  const tabs = await chrome.tabs.query({ url: FAMETC_URL_PATTERNS });
  return tabs[0] || null;
}

async function getMappingsFromTab(tabId) {
  try {
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        if (typeof window.famGetSchoolMappings !== "function") return [];
        try {
          return window.famGetSchoolMappings() || [];
        } catch (e) {
          return [];
        }
      },
    });
    return Array.isArray(result) ? result : [];
  } catch (e) {
    return [];
  }
}

async function importIntoTab(tabId, payload) {
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
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

async function handleAutoSyncCheck() {
  const tab = await findFamEtcTab();
  if (!tab) return { famOpen: false, mappings: [] };
  const mappings = await getMappingsFromTab(tab.id);
  return { famOpen: true, mappings };
}

async function handleImport(msg) {
  const tab = await findFamEtcTab();
  if (!tab) return { error: "NO_FAMETC_TAB" };
  const payload = {
    kidId: msg.kidId || undefined,
    kidName: msg.kidName || undefined,
    moodleUserId: msg.moodleUserId,
    homework: msg.homework || [],
    timetable: msg.timetable || [],
    schoolStats: msg.schoolStats || [],
  };
  try {
    const result = await importIntoTab(tab.id, payload);
    if (!result || result.error === "NOT_LOADED") {
      return { error: "NOT_LOADED" };
    }
    return { result };
  } catch (e) {
    return { error: (e && e.message) || "IMPORT_FAILED" };
  }
}

async function handleOpenFametc() {
  const existing = await findFamEtcTab();
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId != null) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    return { opened: false, focused: true };
  }
  await chrome.tabs.create({ url: "https://www.fametc.com/" });
  return { opened: true };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  if (msg.type === "AUTO_SYNC_CHECK") {
    handleAutoSyncCheck().then(sendResponse);
    return true; // keep the message channel open for the async response
  }

  if (msg.type === "IMPORT") {
    handleImport(msg).then(sendResponse);
    return true;
  }

  if (msg.type === "OPEN_FAMETC") {
    handleOpenFametc().then(sendResponse);
    return true;
  }

  return false;
});
