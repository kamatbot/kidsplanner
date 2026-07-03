"use strict";
/* ============================================================
   Fam ETC — school stats pure helpers (house points / attendance /
   canteen balance change-detection + kid matching).

   Dependency-free on purpose: loaded as a plain <script> tag in the
   browser (public/index.html, before app.js) AND required directly from
   node --test (tests/school-stats.test.js) — see the module.exports guard
   at the bottom. No DOM, no localStorage, no fetch: app.js owns all of
   that and calls into these pure functions.
============================================================ */

// Wrapped in an IIFE so these internal consts/functions do NOT leak into the
// browser global scope — app.js declares the same names by destructuring
// window.famSchoolStats, and two same-named globals is a fatal
// "already declared" SyntaxError that kills the whole app.
(function () {

const LOW_BALANCE_THRESHOLD = 200; // ฿ — "below ฿200" per the notification spec
const LOW_BALANCE_RENOTIFY_MS = 24 * 60 * 60 * 1000; // don't re-notify low balance more than once/24h

// Pure comparator: given the previous stored stat (or null/undefined for
// "never seen before") and the freshly-parsed stat for a kid, decide what
// notifications (if any) should fire this run, and what the new stored
// record should look like.
//   prev: { housePoints, attendance, punctual, canteenBalance, updatedAt,
//           lastLowBalanceNotifiedAt } | null
//   next: { housePoints, attendance, punctual, canteenBalance } (numbers or null)
//   now:  epoch ms (injectable for tests)
// Returns { record, notifications: [{ title, body, tag }] }
function compareSchoolStats(kidName, prev, next, now) {
  now = typeof now === "number" ? now : Date.now();
  const notifications = [];
  const record = {
    housePoints: next.housePoints,
    attendance: next.attendance,
    punctual: next.punctual,
    canteenBalance: next.canteenBalance,
    updatedAt: now,
    lastLowBalanceNotifiedAt: (prev && prev.lastLowBalanceNotifiedAt) || null,
  };

  // Attendance change — only when both values are known and differ.
  if (
    next.attendance !== null && next.attendance !== undefined &&
    prev && prev.attendance !== null && prev.attendance !== undefined &&
    next.attendance !== prev.attendance
  ) {
    notifications.push({
      title: `${kidName}'s attendance changed`,
      body: `${prev.attendance}% → ${next.attendance}%`,
      tag: "school-attendance",
    });
  }

  // Low canteen balance — fires when balance is (now) below threshold AND
  // either it just crossed below threshold (was >= threshold or unknown
  // before) OR it's been >=24h since the last low-balance notification for
  // this kid (so a persistently-low balance still nudges daily, not every
  // sync).
  if (next.canteenBalance !== null && next.canteenBalance !== undefined && next.canteenBalance < LOW_BALANCE_THRESHOLD) {
    const wasAboveOrUnknown = !prev || prev.canteenBalance === null || prev.canteenBalance === undefined || prev.canteenBalance >= LOW_BALANCE_THRESHOLD;
    const last = record.lastLowBalanceNotifiedAt ? new Date(record.lastLowBalanceNotifiedAt).getTime() : 0;
    const staleEnough = (now - last) >= LOW_BALANCE_RENOTIFY_MS;
    if (wasAboveOrUnknown || staleEnough) {
      notifications.push({
        title: `${kidName}'s canteen balance is low`,
        body: `฿${next.canteenBalance} (below ฿${LOW_BALANCE_THRESHOLD} — top up)`,
        tag: "school-canteen-low",
      });
      record.lastLowBalanceNotifiedAt = now;
    }
  }

  return { record, notifications };
}

// Match a family-wide stats row (from the extension, keyed by first name)
// to a Fam ETC kid by case-insensitive first-name comparison.
function matchKidByFirstName(kids, statName) {
  const target = String(statName || "").trim().toLowerCase();
  if (!target) return null;
  return (kids || []).find((k) => {
    const first = String((k && k.name) || "").trim().split(/\s+/)[0].toLowerCase();
    return first === target;
  }) || null;
}

const api = { LOW_BALANCE_THRESHOLD, LOW_BALANCE_RENOTIFY_MS, compareSchoolStats, matchKidByFirstName };

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}
if (typeof window !== "undefined") {
  window.famSchoolStats = api;
}

})();
