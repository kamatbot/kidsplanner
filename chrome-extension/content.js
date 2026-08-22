"use strict";
/* ============================================================
   Fam ETC School Import — content.js
   Runs on every bangkok.learn.nae.school page (document_idle). Detects a
   logged-in Moodle session, then either:
     - shows a callout nudging the parent to open fametc.com, or
     - shows a "set up your kids' Moodle IDs" nudge, or
     - silently auto-syncs each mapped kid's homework/timetable and any
       signed-up activities visible on the current ECA page (throttled).

   Uses window.famParse (parse.js, loaded as an earlier content_scripts
   entry in manifest.json) for the homework/timetable HTML parsing — the
   exact same functions popup.js uses for the manual trigger, so auto-sync
   and manual import never drift apart.
============================================================ */

const THROTTLE_MS = 10 * 60 * 1000; // ~10 minutes between auto-syncs
const STORAGE_KEY_LAST_SYNC = "famEtcLastAutoSyncAt";
const BANNER_ID = "fam-etc-callout-banner";
const ECA_SYNC_DEBOUNCE_MS = 800;

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
    <div style="margin-bottom:10px">Open fametc.com to auto-sync homework, timetable, and signed-up activities.</div>
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

function warningMessage(warning) {
  if (typeof warning === "string") return warning.slice(0, 300);
  if (!warning || typeof warning !== "object") return "Import warning";
  return [warning.title, warning.message].filter(Boolean).join(": ").slice(0, 300) || "Import warning";
}

function collectWarnings(...sources) {
  const warnings = [];
  sources.flat().forEach((warning) => {
    const message = warningMessage(warning).trim();
    if (message && !warnings.includes(message) && warnings.length < 40) warnings.push(message);
  });
  return warnings;
}

function showWarningCallout(summary, warnings) {
  const el = showBanner(`
    <div style="font-weight:700;margin-bottom:6px">Fam ETC ⚠️</div>
    <div data-fam-warning-summary style="margin-bottom:6px"></div>
    <div data-fam-warning-message style="margin-bottom:10px;color:#9c2f00"></div>
    <button data-fam-close style="background:#eee;color:#333;border:none;border-radius:6px;padding:7px 10px;cursor:pointer">Dismiss</button>
  `, { autoHideMs: 20000 });
  el.querySelector("[data-fam-warning-summary]").textContent = summary;
  el.querySelector("[data-fam-warning-message]").textContent = warnings[0] || "Import warning";
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
  const timetableResult = parseTimetableHtml(ttHtml);
  return {
    homework: Array.from(homework),
    timetable: timetableResult.lessons,
    parseWarnings: collectWarnings(homework.parserWarnings, timetableResult.parserWarnings),
  };
}

/* Signed-up activities are available on ECA enrollment pages rather than a
   stable per-kid endpoint. When auto-sync is triggered from such a page,
   attach its confirmed rows only to the kid named by that page's userid=. */
function activitySnapshotVisibleForKid(moodleUserId) {
  const url = new URL(window.location.href);
  if (url.pathname !== "/mod/eca/view_student.php") return null;
  if (url.searchParams.get("userid") !== String(moodleUserId)) return null;
  const ecaId = url.searchParams.get("e");
  if (!ecaId) return null;
  const activities = window.famParse.parseSignedUpActivitiesHtml(document.documentElement.outerHTML);
  const snapshot = {
    ecaId,
    activities: Array.from(activities),
  };
  Object.defineProperty(snapshot, "parseWarnings", {
    value: collectWarnings(activities.parserWarnings),
    enumerable: false,
  });
  return snapshot;
}

function visibleActivitiesSignature(activities) {
  return (activities || [])
    .map((activity) => `${activity.clubId || ""}|${activity.date}|${activity.time}|${activity.title}`)
    .sort()
    .join("\n");
}

/* Moodle updates ECA rows in-place after a signup is saved, without loading
   a new page. Watch only the activity table so the extension notices that
   transition and imports the new confirmed set immediately. Calendar-side
   deduplication makes resending the other confirmed rows safe. */
function watchEcaSignupChanges() {
  const url = new URL(window.location.href);
  const table = document.querySelector("table#ecastudentview");
  const moodleUserId = url.pathname === "/mod/eca/view_student.php"
    ? url.searchParams.get("userid")
    : null;
  const ecaId = url.searchParams.get("e");
  if (!table || !moodleUserId || !ecaId) return;

  let lastSignature = visibleActivitiesSignature(
    window.famParse.parseSignedUpActivitiesHtml(document.documentElement.outerHTML)
  );
  let timer = null;
  let syncing = false;

  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const activities = window.famParse.parseSignedUpActivitiesHtml(document.documentElement.outerHTML);
      const parseWarnings = collectWarnings(activities.parserWarnings);
      const nextSignature = visibleActivitiesSignature(activities);
      if (nextSignature === lastSignature) return;
      lastSignature = nextSignature;
      if (syncing) return;

      syncing = true;
      try {
        const check = await chrome.runtime.sendMessage({ type: "AUTO_SYNC_CHECK" });
        const mapping = check && check.famOpen && Array.isArray(check.mappings)
          ? check.mappings.find((item) => item && String(item.moodleUserId) === String(moodleUserId))
          : null;
        if (!mapping) return;

        const response = await chrome.runtime.sendMessage({
          type: "IMPORT",
          kidId: mapping.kidId,
          moodleUserId,
          homework: [],
          timetable: [],
          activitySnapshots: [{ ecaId, activities: Array.from(activities) }],
          schoolStats: [],
          parseWarnings,
        });
        if (response && response.result) {
          const warnings = collectWarnings(parseWarnings, response.result.importWarnings);
          const summary = `Synced activities: ${response.result.activityEventsAdded || 0} added, ${response.result.activityEventsRemoved || 0} removed.`;
          if (warnings.length) {
            showWarningCallout(`${summary} Warnings (${warnings.length}):`, warnings);
          } else {
            showSuccessCallout(summary);
          }
          await setLastSyncAt(Date.now());
        }
      } catch (e) {
        console.warn("[Fam ETC] live activity sync failed", e && e.message);
        showWarningCallout(
          "Live activity sync could not complete.",
          ["Could not sync the signed-up activity change; retry the page sync or use Manual Import."]
        );
      } finally {
        syncing = false;
      }
    }, ECA_SYNC_DEBOUNCE_MS);
  });

  observer.observe(table, { childList: true, subtree: true, characterData: true, attributes: true });
}

/* ---------- fetch + parse the family-wide school stats (house points,
   attendance, canteen balance) from the HOME dashboard. Fetched ONCE per
   sync (not per kid) — best-effort: any failure just means no schoolStats
   this round, homework/timetable sync still proceeds. ---------- */
async function fetchSchoolStats() {
  const { moodleHomeUrl, looksLikeMoodleLoginPage, parseSchoolStatsHtml } = window.famParse;
  try {
    const res = await fetch(moodleHomeUrl(), { credentials: "include" });
    const html = await res.text();
    if (looksLikeMoodleLoginPage(html)) return [];
    return parseSchoolStatsHtml(html);
  } catch (e) {
    console.warn("[Fam ETC] school stats fetch failed", e && e.message);
    return [];
  }
}

/* ---------- main auto-sync flow ---------- */
async function runAutoSync(mappings) {
  let totalHw = 0;
  let totalEvents = 0;
  let anySynced = false;
  const parserWarnings = [];
  const importWarnings = [];

  const schoolStats = await fetchSchoolStats();

  for (const mapping of mappings) {
    if (!mapping || !mapping.moodleUserId) continue;
    try {
      const { homework, timetable, parseWarnings } = await fetchAndParseForKid(mapping.moodleUserId);
      parserWarnings.push(...parseWarnings);
      const activitySnapshot = activitySnapshotVisibleForKid(mapping.moodleUserId);
      if (activitySnapshot) parserWarnings.push(...(activitySnapshot.parseWarnings || []));
      const response = await chrome.runtime.sendMessage({
        type: "IMPORT",
        kidId: mapping.kidId,
        moodleUserId: mapping.moodleUserId,
        homework,
        timetable,
        activitySnapshots: activitySnapshot ? [activitySnapshot] : [],
        schoolStats,
        parseWarnings: collectWarnings(parseWarnings, activitySnapshot && activitySnapshot.parseWarnings),
      });
      if (response && response.result) {
        totalHw += response.result.homeworkAdded || 0;
        totalEvents += response.result.eventsAdded || 0;
        importWarnings.push(...(response.result.importWarnings || []));
        anySynced = true;
      }
    } catch (e) {
      // One kid failing (e.g. bad Moodle id) shouldn't block the others.
      console.warn("[Fam ETC] auto-sync failed for kid", mapping.kidId, e && e.message);
      importWarnings.push("Auto-sync could not complete for one child; retry the sync or use Manual Import.");
    }
  }

  const warnings = collectWarnings(parserWarnings, importWarnings);
  if (anySynced || warnings.length) {
    const summary = `Synced ${mappings.length} kid(s): ${totalHw} homework item(s), ${totalEvents} calendar event(s) added.`;
    if (warnings.length) showWarningCallout(`${summary} Warnings (${warnings.length}):`, warnings);
    else showSuccessCallout(summary);
    if (anySynced) await setLastSyncAt(Date.now());
  }
}

async function main() {
  if (!isLoggedIn()) return; // on the login page (or can't tell) — do nothing

  watchEcaSignupChanges();

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
  // A confirmed ECA signup should reach the calendar as soon as the parent
  // visits that page, even if a routine homework sync ran a few minutes ago.
  const hasVisibleActivityPage = check.mappings.some(
    (mapping) => mapping && mapping.moodleUserId && activitySnapshotVisibleForKid(mapping.moodleUserId)
  );
  if (!hasVisibleActivityPage && Date.now() - lastSync < THROTTLE_MS) {
    return; // throttled — manual sync via the popup is still always available
  }

  await runAutoSync(check.mappings);
}

main();
