"use strict";

// The official child feeds now own homework, timetable, and timetable
// activities. This helper intentionally keeps only the Moodle capabilities
// the feeds do not provide: family school stats and delivery of already-queued
// legacy homework completions.
if (window.location.hash !== "#fametc-completion-sync") {
  const THROTTLE_MS = 10 * 60 * 1000;
  const STORAGE_KEY_LAST_SYNC = "famEtcLastStatsSyncAt";
  const BANNER_ID = "fam-etc-callout-banner";

  function isLoggedIn() {
    if (document.querySelector('form#login, input[name="password"]#password')
        && !document.querySelector(".usermenu, #usernavigation, .userinitials")) return false;
    return !!document.querySelector(".usermenu, #usernavigation, .userinitials, body.pagelayout-mydashboard, body.pagelayout-course");
  }

  function removeBanner() {
    const current = document.getElementById(BANNER_ID);
    if (current) current.remove();
  }

  function showBanner({ title, message, action }, autoHideMs) {
    removeBanner();
    const banner = document.createElement("div");
    banner.id = BANNER_ID;
    banner.style.cssText = [
      "position:fixed", "top:16px", "right:16px", "z-index:2147483647",
      "background:#fff", "color:#1a1a2e", "border:1px solid #ddd",
      "border-radius:10px", "box-shadow:0 6px 24px rgba(0,0,0,0.15)",
      "padding:14px 16px", "max-width:320px",
      "font:13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif",
    ].join(";");
    banner.innerHTML = `
      <div data-fam-title style="font-weight:700;margin-bottom:6px"></div>
      <div data-fam-message style="margin-bottom:10px"></div>
      <div style="display:flex;gap:8px">
        ${action ? '<button data-fam-action style="flex:1;background:#6C63FF;color:#fff;border:none;border-radius:6px;padding:7px 10px;font-weight:700;cursor:pointer"></button>' : ''}
        <button data-fam-close style="background:#eee;color:#333;border:none;border-radius:6px;padding:7px 10px;cursor:pointer">Dismiss</button>
      </div>`;
    banner.querySelector("[data-fam-title]").textContent = title;
    banner.querySelector("[data-fam-message]").textContent = message;
    banner.querySelector("[data-fam-close]").addEventListener("click", removeBanner);
    const actionButton = banner.querySelector("[data-fam-action]");
    if (actionButton) {
      actionButton.textContent = action.label;
      actionButton.addEventListener("click", action.run);
    }
    document.documentElement.appendChild(banner);
    if (autoHideMs) setTimeout(() => banner.isConnected && removeBanner(), autoHideMs);
  }

  function showCompletionResult(result) {
    if (!result || (!result.verified && !result.pending)) return;
    const retry = result.pending > 0;
    let message = result.verified
      ? `Marked ${result.verified} legacy Moodle homework task${result.verified === 1 ? "" : "s"} complete.`
      : "A legacy Moodle homework completion could not be confirmed.";
    if (retry) message += " Unconfirmed changes will retry next time Moodle opens.";
    showBanner({ title: retry ? "Fam ETC ⚠️" : "Fam ETC ✅", message }, retry ? 20000 : 15000);
  }

  async function syncMoodleCompletions() {
    try {
      showCompletionResult(await chrome.runtime.sendMessage({ type: "SYNC_MOODLE_COMPLETIONS" }));
    } catch (e) {
      // The durable queue will retry on a later authenticated Moodle page.
    }
  }

  function getLastSyncAt() {
    return new Promise((resolve) => chrome.storage.local.get(
      [STORAGE_KEY_LAST_SYNC],
      (value) => resolve((value && value[STORAGE_KEY_LAST_SYNC]) || 0)
    ));
  }

  function setLastSyncAt(value) {
    return new Promise((resolve) => chrome.storage.local.set({ [STORAGE_KEY_LAST_SYNC]: value }, resolve));
  }

  async function fetchSchoolStats() {
    const { moodleHomeUrl, looksLikeMoodleLoginPage, parseSchoolStatsHtml } = window.famParse;
    try {
      const response = await fetch(moodleHomeUrl(), { credentials: "include" });
      const html = await response.text();
      if (!response.ok || looksLikeMoodleLoginPage(html)) return [];
      return Array.from(parseSchoolStatsHtml(html));
    } catch (e) {
      return [];
    }
  }

  async function syncSchoolStats() {
    const schoolStats = await fetchSchoolStats();
    if (!schoolStats.length) return false;
    const response = await chrome.runtime.sendMessage({ type: "IMPORT_STATS", schoolStats });
    if (!response || response.error) return false;
    const updated = Number(response.result && response.result.schoolStatsUpdated) || 0;
    if (updated) await setLastSyncAt(Date.now());
    return updated > 0;
  }

  async function main() {
    if (!isLoggedIn()) return;
    syncMoodleCompletions();

    let check;
    try {
      check = await chrome.runtime.sendMessage({ type: "AUTO_SYNC_CHECK" });
    } catch (e) {
      return;
    }
    if (!check) return;
    if (!check.famOpen) {
      showBanner({
        title: "Fam ETC",
        message: "Open Fam ETC to sync school stats. Homework, timetable, and activities now sync through the private feeds in Settings.",
        action: {
          label: "Open Fam ETC",
          run: () => {
            chrome.runtime.sendMessage({ type: "OPEN_FAMETC" });
            removeBanner();
          },
        },
      });
      return;
    }

    if (Date.now() - await getLastSyncAt() < THROTTLE_MS) return;
    await syncSchoolStats();
  }

  main();
}
