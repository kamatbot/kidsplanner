/* ============================================================
   TODAY ACTION QUEUE — pure grouping/sorting helpers
   The dashboard owns fetching and rendering. Keeping the queue's ordering
   rules here makes them easy to test and keeps the API's list order from
   becoming an accidental product decision.
============================================================ */
(function (root) {
  "use strict";

  function asDate(value) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function localIsoDate(value) {
    const date = asDate(value) || new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function dateAfter(value, days) {
    const date = asDate(value) || new Date();
    date.setDate(date.getDate() + days);
    return date;
  }

  function timePart(date) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  // Snoozing is deliberately expressed as a timestamp with an explicit
  // timezone. The server normalizes this to UTC, so a family sees the same
  // intended instant regardless of which device submits the action.
  function snoozeUntil(preset, nowValue) {
    const now = asDate(nowValue) || new Date();
    const target = new Date(now.getTime());
    if (preset === "later-today") {
      target.setMinutes(0, 0, 0);
      target.setHours(target.getHours() + 2);
      // Keep the preset on the current local day when it is already late.
      if (target.getDate() !== now.getDate()) {
        target.setDate(now.getDate());
        target.setMonth(now.getMonth());
        target.setFullYear(now.getFullYear());
        target.setHours(23, 59, 0, 0);
      }
      if (target.getTime() <= now.getTime()) target.setTime(now.getTime() + 30 * 60 * 1000);
    } else if (preset === "tomorrow") {
      target.setDate(target.getDate() + 1);
      target.setHours(9, 0, 0, 0);
    } else if (preset === "next-week") {
      target.setDate(target.getDate() + 7);
      target.setHours(9, 0, 0, 0);
    } else {
      return null;
    }
    return target.toISOString();
  }

  function effectiveDue(action, nowValue) {
    const now = asDate(nowValue) || new Date();
    const snoozedMs = action && action.snoozedUntil ? Date.parse(action.snoozedUntil) : NaN;
    if (action && action.status === "snoozed" && Number.isFinite(snoozedMs) && snoozedMs > now.getTime()) {
      const snoozed = new Date(snoozedMs);
      return {
        date: localIsoDate(snoozed),
        time: timePart(snoozed),
        snoozed: true,
        timestamp: snoozedMs,
      };
    }
    if (action && action.dueDate) {
      return {
        date: String(action.dueDate),
        time: action.dueTime ? String(action.dueTime) : "",
        snoozed: false,
        timestamp: NaN,
      };
    }
    // A date-less snooze becomes actionable again when its reminder time has
    // passed. It belongs in Now instead of disappearing into the no-date shelf.
    if (action && action.status === "snoozed" && Number.isFinite(snoozedMs)) {
      return { date: localIsoDate(now), time: "", snoozed: false, timestamp: snoozedMs };
    }
    return null;
  }

  function compareText(a, b) {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }

  function compareActions(a, b, nowValue) {
    const aDue = effectiveDue(a, nowValue);
    const bDue = effectiveDue(b, nowValue);
    const aDueKey = aDue ? `${aDue.date} ${aDue.time || "99:99"}` : "9999-12-31 99:99";
    const bDueKey = bDue ? `${bDue.date} ${bDue.time || "99:99"}` : "9999-12-31 99:99";
    const dueOrder = compareText(aDueKey, bDueKey);
    if (dueOrder) return dueOrder;
    const createdOrder = compareText(String(a && a.createdAt || ""), String(b && b.createdAt || ""));
    if (createdOrder) return createdOrder;
    return compareText(String(a && a.id || ""), String(b && b.id || ""));
  }

  function sortActions(items, nowValue) {
    return (Array.isArray(items) ? items : []).slice().sort((a, b) => compareActions(a, b, nowValue));
  }

  function groupActions(items, nowValue) {
    const now = asDate(nowValue) || new Date();
    const today = localIsoDate(now);
    const nextWeek = localIsoDate(dateAfter(now, 7));
    // Deterministic priority: (1) open/snoozed actions overdue or due today,
    // (2) dated actions in the next seven days, (3) undated shared/assigned
    // actions, then (4) a compact completed shelf. Snoozed actions use their
    // future reminder timestamp so snoozing genuinely moves work out of Now.
    const groups = {
      now: [],
      next7: [],
      sharedNoDate: [],
      later: [],
      completed: [],
    };

    (Array.isArray(items) ? items : []).forEach((action) => {
      if (!action) return;
      if (action.status === "done") {
        groups.completed.push(action);
        return;
      }

      const due = effectiveDue(action, now);
      if (!due) {
        groups.sharedNoDate.push(action);
      } else if (due.date <= today) {
        groups.now.push(action);
      } else if (due.date <= nextWeek) {
        groups.next7.push(action);
      } else {
        // Keep dated actions visible without weakening the three primary
        // shelves. The dashboard renders this lower-priority tail inside the
        // Next 7 days shelf after the near-term items.
        groups.later.push(action);
      }
    });

    Object.keys(groups).forEach((key) => {
      groups[key] = sortActions(groups[key], now);
    });
    return groups;
  }

  root.famActionQueue = {
    localIsoDate,
    effectiveDue,
    snoozeUntil,
    compareActions,
    sortActions,
    groupActions,
  };
})(typeof window !== "undefined" ? window : globalThis);
