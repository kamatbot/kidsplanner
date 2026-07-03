"use strict";
/* ============================================================
   Fam ETC School Import — content.js
   Runs on every bangkok.learn.nae.school page (document_idle). Detects a
   logged-in Moodle session, then either:
     - shows a callout nudging the parent to open fametc.com, or
     - shows a "set up your kids' Moodle IDs" nudge, or
     - silently auto-syncs each mapped kid's homework/timetable (throttled).

   Uses window.famParse (parse.js, loaded as an earlier content_scripts
   entry in manifest.json) for the homework/timetable HTML parsing — the
   exact same functions popup.js uses for the manual trigger, so auto-sync
   and manual import never drift apart.
============================================================ */

const THROTTLE_MS = 10 * 60 * 1000; // ~10 minutes between auto-syncs
const STORAGE_KEY_LAST_SYNC = "famEtcLastAutoSyncAt";
const BANNER_ID = "fam-etc-callout-banner";

/* ---------- logged-in detection ----------
   The Moodle login page has a password field; a logged-in page has Moodle's
   global nav (usernav / user menu) and no login form. Reuse the same
   heuristic as parse.js's looksLikeMoodleLoginPage against the live DOM
   instead of fetched HTML, plus a direct login-form check as a fast path. */
function isLoggedIn() {
  if (document.querySelector('form#login, input[name="password"]#password')) {
    // Still could be a false positive on a page that merely embeds a login
    // widget, but the honest login page also lacks Moodle's user nav — so
    // require BOTH signals absent before bailing.
    if (!document.querySelector(".usermenu, #usernavigation, .userinitials")) {
      return false;
    }
  }
  return !!document.querySelector(".usermenu, #usernavigation, .userinitials, body.pagelayout-mydashboard, body.pagelayout-course");
}

/* ---------- banner helpers ---------- */
function removeBanner() {
  const el = document.getElementById(BANNER_ID);
  if (el) el.remove();
}

function showBanner(html, { autoHideMs } = {}) {
  removeBanner();
  const el = document.createElement("div");
  el.id = BANNER_ID;
  el.style.cssText = [
    "position:fixed", "top:16px", "right:16px", "z-index:2147483647",
    "background:#fff", "color:#1a1a2e", "border:1px solid #ddd",
    "border-radius:10px", "box-shadow:0 6px 24px rgba(0,0,0,0.15)",
    "padding:14px 16px", "max-width:320px",
    "font:13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif",
  ].join(";");
  el.innerHTML = html;
  document.documentElement.appendChild(el);

  const closeBtn = el.querySelector("[data-fam-close]");
  if (closeBtn) closeBtn.addEventListener("click", removeBanner);

  if (autoHideMs) {
    setTimeout(() => {
      if (document.getElementById(BANNER_ID) === el) removeBanner();
    }, autoHideMs);
  }
  return el;
}

function showOpenFamEtcCallout() {
  const el = showBanner(`
    <div style="font-weight:700;margin-bottom:6px">Fam ETC</div>
    <div style="margin-bottom:10px">Open fametc.com to auto-sync homework &amp; timetable.</div>
    <div style="display:flex;gap:8px">
      <button data-fam-open style="flex:1;background:#6C63FF;color:#fff;border:none;border-radius:6px;padding:7px 10px;font-weight:700;cursor:pointer">Open Fam ETC</button>
      <button data-fam-close style="background:#eee;color:#333;border:none;border-radius:6px;padding:7px 10px;cursor:pointer">Dismiss</button>
    </div>
  `);
  const openBtn = el.querySelector("[data-fam-open]");
  if (openBtn) {
    openBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "OPEN_FAMETC" });
      removeBanner();
    });
  }
}

function showSetUpMoodleIdsCallout() {
  showBanner(`
    <div style="font-weight:700;margin-bottom:6px">Fam ETC</div>
    <div style="margin-bottom:10px">Set your kids' Moodle IDs in Fam ETC &rarr; Settings to enable auto-sync.</div>
    <button data-fam-close style="background:#eee;color:#333;border:none;border-radius:6px;padding:7px 10px;cursor:pointer">Dismiss</button>
  `);
}

function showSuccessCallout(summary) {
  showBanner(`
    <div style="font-weight:700;margin-bottom:6px">Fam ETC ✅</div>
    <div style="margin-bottom:10px">${summary}</div>
    <button data-fam-close style="background:#eee;color:#333;border:none;border-radius:6px;padding:7px 10px;cursor:pointer">Dismiss</button>
  `, { autoHideMs: 15000 });
}

/* ---------- throttle (chrome.storage.local — persists across page loads) ---------- */
function getLastSyncAt() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY_LAST_SYNC], (res) => {
      resolve((res && res[STORAGE_KEY_LAST_SYNC]) || 0);
    });
  });
}
function setLastSyncAt(ts) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY_LAST_SYNC]: ts }, resolve);
  });
}

/* ---------- fetch + parse a single kid's homework/timetable ---------- */
async function fetchAndParseForKid(moodleUserId) {
  const { moodleHomeworkUrl, moodleTimetableUrl, looksLikeMoodleLoginPage, parseHomeworkHtml, parseTimetableHtml } = window.famParse;

  const [hwRes, ttRes] = await Promise.all([
    fetch(moodleHomeworkUrl(moodleUserId), { credentials: "include" }),
    fetch(moodleTimetableUrl(moodleUserId), { credentials: "include" }),
  ]);
  const [hwHtml, ttHtml] = await Promise.all([hwRes.text(), ttRes.text()]);

  if (looksLikeMoodleLoginPage(hwHtml) || looksLikeMoodleLoginPage(ttHtml)) {
    const err = new Error("MOODLE_LOGIN_REQUIRED");
    err.code = "MOODLE_LOGIN_REQUIRED";
    throw err;
  }

  const homework = parseHomeworkHtml(hwHtml);
  const { lessons: timetable } = parseTimetableHtml(ttHtml);
  return { homework, timetable };
}

/* ---------- main auto-sync flow ---------- */
async function runAutoSync(mappings) {
  let totalHw = 0;
  let totalEvents = 0;
  let anySynced = false;

  for (const mapping of mappings) {
    if (!mapping || !mapping.moodleUserId) continue;
    try {
      const { homework, timetable } = await fetchAndParseForKid(mapping.moodleUserId);
      const response = await chrome.runtime.sendMessage({
        type: "IMPORT",
        kidId: mapping.kidId,
        moodleUserId: mapping.moodleUserId,
        homework,
        timetable,
      });
      if (response && response.result) {
        totalHw += response.result.homeworkAdded || 0;
        totalEvents += response.result.eventsAdded || 0;
        anySynced = true;
      }
    } catch (e) {
      // One kid failing (e.g. bad Moodle id) shouldn't block the others.
      console.warn("[Fam ETC] auto-sync failed for kid", mapping.kidId, e && e.message);
    }
  }

  if (anySynced) {
    showSuccessCallout(`Synced ${mappings.length} kid(s): ${totalHw} homework item(s), ${totalEvents} timetable event(s) added.`);
    await setLastSyncAt(Date.now());
  }
}

async function main() {
  if (!isLoggedIn()) return; // on the login page (or can't tell) — do nothing

  let check;
  try {
    check = await chrome.runtime.sendMessage({ type: "AUTO_SYNC_CHECK" });
  } catch (e) {
    return; // extension context not ready / background not reachable — silently skip
  }
  if (!check) return;

  if (!check.famOpen) {
    showOpenFamEtcCallout();
    return;
  }

  if (!check.mappings || !check.mappings.length) {
    showSetUpMoodleIdsCallout();
    return;
  }

  const lastSync = await getLastSyncAt();
  if (Date.now() - lastSync < THROTTLE_MS) {
    return; // throttled — manual sync via the popup is still always available
  }

  await runAutoSync(check.mappings);
}

main();
