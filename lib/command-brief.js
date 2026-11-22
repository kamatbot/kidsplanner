"use strict";
/**
 * Family OS Command Brief aggregator.
 *
 * Synthesizes real family data (calendar, school feeds/timetable, activities,
 * homework, meals, decisions, student support, Hermes nudges, and Screen Time)
 * into time-of-day aware Insights, Unified Action Signals, a Live Day Runsheet,
 * a 7-day Workload Radar, and compact Home/Kid readiness snapshots.
 *
 * Role & privacy invariants:
 * - Kid sessions NEVER receive parent-only data (Screen Time alerts/requests,
 *   parent Hermes nudges, sibling homework/packing/events, kid access requests,
 *   parent-only meal/pantry state).
 * - Parent sessions never receive sibling rankings; every insight is grounded
 *   in observed recorded facts.
 */

const hermesProactive = require("./hermes-proactive");
const hermesThreads = require("./hermes-threads");
const chat = require("./chat");
const events = require("./events");
const schoolFeeds = require("./school-feeds");
const schoolApi = require("./school-api");
const activities = require("./activities");
const homework = require("./homework");
const meals = require("./meals");
const decisions = require("./decisions");
const studentSupport = require("./student-support");
const screenTime = require("./screen-time");
const trips = require("./trips");
const kidAccess = require("./kid-access");
const store = require("./store");

const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const HERMES_PENDING_MAX_AGE_MS = 18 * 3600 * 1000;

function safe(fn, fallback) {
  try {
    const value = fn();
    return value == null ? fallback : value;
  } catch (_) {
    return fallback;
  }
}

function toMinutes(hhmm) {
  if (!HHMM.test(String(hhmm || ""))) return null;
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
}

function phaseForClock(clock) {
  const mins = toMinutes(clock);
  if (mins == null) return "afternoon";
  if (mins < 11 * 60 + 30) return "morning";
  if (mins < 18 * 60) return "afternoon";
  return "evening";
}

function phaseLabel(phase, isKid) {
  if (phase === "morning") return isKid ? "Morning · Bag & Go" : "Morning Launch";
  if (phase === "afternoon") return isKid ? "Afternoon · After School" : "Afternoon · School Run";
  return isKid ? "Evening · Wind Down" : "Evening Reset";
}

function cleanText(value, max = 140) {
  const s = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function parentNameMap(fam) {
  const map = new Map();
  for (const pid of fam.parentIds || []) {
    const u = safe(() => store.getUser(pid), null);
    if (u && u.name) {
      map.set(pid, cleanText(u.name.split(" ")[0] || u.name, 40));
    }
  }
  return map;
}

function mondayOfWeek(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

function dayRunsheet(fam, day, tz, now, viewer, parentsMap) {
  const kidMap = new Map((fam.kids || []).map((k) => [k.id, k]));
  const dow = hermesProactive.weekdayOf(day);
  const items = [];
  const seenKey = new Set();

  const visibleForViewer = (kidId) => {
    if (viewer.isParent) return true;
    return kidId == null || kidId === viewer.kidId;
  };

  // Activity gear lookup by (kidId, normalized name) so calendar/activity rows
  // can attach required gear chips cleanly.
  const activityGearByKid = new Map();
  const kidActivities = [];
  for (const kid of fam.kids || []) {
    if (!visibleForViewer(kid.id)) continue;
    for (const act of safe(() => activities.listActivities(fam.id, { kidId: kid.id }), [])) {
      if (!act) continue;
      kidActivities.push({ kid, act });
      const gear = Array.isArray(act.gear) ? act.gear.filter(Boolean).slice(0, 4) : [];
      if (gear.length) {
        const key = `${kid.id}:${String(act.name || "").toLowerCase().trim()}`;
        activityGearByKid.set(key, gear);
      }
      for (const slot of act.schedule || []) {
        if (!slot || slot.day !== dow) continue;
        const start = HHMM.test(slot.start || "") ? slot.start : null;
        const end = HHMM.test(slot.end || "") ? slot.end : null;
        const dedup = `act:${kid.id}:${String(act.name || "").toLowerCase()}:${start || ""}`;
        seenKey.add(dedup);
        items.push({
          id: `act-${act.id}-${dow}-${start || "all"}`,
          source: "activity",
          editable: false,
          date: day,
          time: start,
          endTime: end,
          title: cleanText(act.name || "Activity", 90),
          kidId: kid.id,
          kidName: kid.name,
          kidColor: kid.color || null,
          location: cleanText(act.location || "", 80) || null,
          driverMemberId: null,
          driverName: null,
          gear,
          moved: false,
          previousStart: null,
          needsDriver: viewer.isParent && !!start,
        });
      }
    }
  }

  // Family manual / recurring events
  const familyEvs = safe(() => events.listEvents(fam.id, { from: day, to: day }), []);
  for (const ev of familyEvs) {
    if (!ev || ev.isImportedTimetable) continue;
    if (!visibleForViewer(ev.kidId || null)) continue;
    const start = HHMM.test(ev.time || "") ? ev.time : null;
    const end = HHMM.test(ev.endTime || "") ? ev.endTime : null;
    const kid = ev.kidId ? kidMap.get(ev.kidId) : null;
    const driverName = ev.driverMemberId ? (parentsMap.get(ev.driverMemberId) || null) : (ev.driverName || null);
    const gear = ev.kidId ? (activityGearByKid.get(`${ev.kidId}:${String(ev.title || "").toLowerCase().trim()}`) || []) : [];
    const dedup = `act:${ev.kidId || ""}:${String(ev.title || "").toLowerCase()}:${start || ""}`;
    if (seenKey.has(dedup)) continue;
    items.push({
      id: ev.id,
      occurrenceDate: ev.occurrenceDate || ev.date || day,
      source: "family",
      editable: true,
      date: day,
      time: start,
      endTime: end,
      title: cleanText(ev.title || "Event", 90),
      kidId: ev.kidId || null,
      kidName: kid ? kid.name : "Family",
      kidColor: kid ? (kid.color || null) : null,
      location: cleanText(ev.notes || "", 80) || null,
      driverMemberId: ev.driverMemberId || null,
      driverName,
      gear,
      moved: false,
      previousStart: null,
      needsDriver: viewer.isParent && !!ev.kidId && !!start && !ev.driverMemberId && !driverName,
    });
  }

  // School feed events (excluding raw class timetable lessons so runsheet stays operational)
  const feedEvs = safe(() => schoolFeeds.collectFromCache(schoolFeeds.famStore(fam.id), now), []);
  for (const ev of feedEvs) {
    if (!ev || ev.feedId === "sta-child-timetable" || ev.isDeadline) continue;
    if (!visibleForViewer(ev.kidId || null)) continue;
    const startMs = ev.start ? Date.parse(ev.start) : NaN;
    if (!Number.isFinite(startMs)) continue;
    const evDay = hermesProactive.dateKey(new Date(startMs), tz);
    if (evDay !== day) continue;
    const start = ev.allDay ? null : hermesProactive.clockKey(new Date(startMs), tz);
    const endMs = ev.end ? Date.parse(ev.end) : NaN;
    const end = !ev.allDay && Number.isFinite(endMs) ? hermesProactive.clockKey(new Date(endMs), tz) : null;
    const kid = ev.kidId ? kidMap.get(ev.kidId) : null;
    items.push({
      id: `school-${ev.id || ev.uid || startMs}`,
      source: "school",
      sourceLabel: cleanText(ev.feedLabel || "School", 40),
      editable: false,
      date: day,
      time: start,
      endTime: end,
      title: cleanText(ev.title || "School event", 90),
      kidId: ev.kidId || null,
      kidName: kid ? kid.name : "School",
      kidColor: kid ? (kid.color || null) : null,
      location: cleanText(ev.location || "", 80) || null,
      driverMemberId: null,
      driverName: null,
      gear: [],
      moved: !!ev.previousStart,
      previousStart: ev.previousStart || null,
      needsDriver: false,
    });
  }

  items.sort((a, b) => {
    const ta = a.time || "99:99";
    const tb = b.time || "99:99";
    if (ta !== tb) return ta.localeCompare(tb);
    return a.title.localeCompare(b.title);
  });

  return items;
}

function hermesOpenNudges(fam, userId, now) {
  const cutoff = now.getTime() - HERMES_PENDING_MAX_AGE_MS;
  const scopeKey = safe(() => hermesThreads.scopeFor(fam.id, userId), null);
  const msgs = scopeKey ? safe(() => chat.listMessages(scopeKey, {}), []) : [];
  const pending = [];
  for (const m of msgs) {
    if (!m || m.deleted || m.senderType !== "agent") continue;
    const card = m.card;
    if (!card || card.type !== "hermes-nudge" || card.kind === "assistant-done") continue;
    if (card.state && card.state.status && card.state.status !== "open") continue;
    const createdMs = Date.parse(m.createdAt);
    if (!Number.isFinite(createdMs) || createdMs < cutoff) continue;
    const actions = Array.isArray(card.actions)
      ? card.actions.filter((a) => a && !a.done && !a.open && a.id !== "undo")
      : [];
    if (!actions.length) continue;
    pending.push({
      messageId: m.id,
      title: cleanText(card.title || m.text || "Hermes suggestion", 110),
      text: cleanText(m.text || "", 180),
      createdAt: m.createdAt,
      actions: actions.slice(0, 3).map((a) => ({
        id: a.id,
        label: cleanText(a.label || a.id, 40),
        style: a.style || "secondary",
      })),
    });
  }
  return pending.slice(-3).reverse();
}

function buildWeekWorkload(fam, today, tz, now, viewer, allHomework) {
  const monday = mondayOfWeek(today);
  const days = [];
  const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const parentsMap = new Map();
  for (let i = 0; i < 7; i++) {
    const date = hermesProactive.addDays(monday, i);
    const evs = dayRunsheet(fam, date, tz, now, viewer, parentsMap);
    const hw = allHomework.filter((h) => h && h.status !== "done" && h.dueDate === date);
    const effortMin = hw.reduce((sum, h) => sum + (Number.isFinite(Number(h.effortMin)) && Number(h.effortMin) > 0 ? Number(h.effortMin) : 25), 0);
    // Normalized 0..100 score combining events + homework effort
    const score = Math.min(100, evs.length * 16 + Math.round(effortMin * 0.7));
    days.push({
      date,
      label: labels[i],
      dayNum: Number(date.slice(8, 10)),
      isToday: date === today,
      eventCount: evs.length,
      homeworkCount: hw.length,
      effortMin,
      score,
      level: score >= 75 ? "heavy" : score >= 45 ? "busy" : "light",
    });
  }
  return days;
}

function buildCommandBrief({ family: fam, user, isParent, kidId, now = new Date() }) {
  const tz = hermesProactive.familyTimezone(fam);
  const today = hermesProactive.dateKey(now, tz);
  const tomorrow = hermesProactive.addDays(today, 1);
  const clock = hermesProactive.clockKey(now, tz);
  const phase = phaseForClock(clock);
  const viewer = { isParent: !!isParent, kidId: isParent ? null : kidId };
  const parentsMap = parentNameMap(fam);

  const visibleKids = isParent
    ? (fam.kids || [])
    : (fam.kids || []).filter((k) => k.id === kidId);

  // Scoped homework
  const allHomework = safe(() => homework.listForFamily(fam.id, isParent ? {} : { kidId }), [])
    .filter((h) => h && (isParent || h.kidId === kidId));

  // Runsheet today + tomorrow peek
  const todayEvents = dayRunsheet(fam, today, tz, now, viewer, parentsMap);
  const tomorrowEvents = dayRunsheet(fam, tomorrow, tz, now, viewer, parentsMap);

  // Open family decisions (both parents & kids participate)
  const openDecisions = safe(() => decisions.listDecisions(fam.id), [])
    .filter((d) => d && d.status === "open")
    .slice(0, 4)
    .map((d) => {
      const pub = decisions.publicDecision ? decisions.publicDecision(d) : d;
      const myVote = Array.isArray(pub.responses)
        ? (pub.responses.find((r) => r.userId === user.id) || {}).optionId || null
        : (pub.responses && typeof pub.responses === "object" ? pub.responses[user.id] || null : null);
      return {
        id: pub.id,
        question: cleanText(pub.question, 140),
        deadline: pub.deadline || null,
        options: (pub.options || []).map((o) => ({
          id: o.id,
          label: cleanText(o.label, 60),
          votes: Number(o.votes || o.count || 0),
        })),
        myVote,
      };
    });

  // Meals & shopping (parent gets full menu/pantry; kid gets shopping count only)
  const mealState = safe(() => meals.getState(fam.id), null);
  const dinner = isParent && mealState
    ? (mealState.menu || []).find((m) => m && m.date === today && (m.slot || "dinner") === "dinner") || null
    : null;
  const openShopping = mealState
    ? (mealState.shopping || []).filter((s) => s && !s.done)
    : [];

  // Active trips count (read-only summary)
  const userTrips = safe(() => trips.allTrips().filter((t) => trips.accessFor(t, user.id, fam.id) !== "none"), []);

  // Student support packing / help exceptions (role-scoped!)
  const packingExceptions = [];
  const kidOwnPacking = [];
  for (const kid of visibleKids) {
    const snap = safe(() => studentSupport.getSnapshot(fam.id, kid.id, now), null);
    if (!snap || !snap.enabled) continue;
    const missing = (snap.packing && Array.isArray(snap.packing.items) ? snap.packing.items : [])
      .filter((it) => it && it.status === "missing");
    const needed = (snap.packing && Array.isArray(snap.packing.items) ? snap.packing.items : [])
      .filter((it) => it && (it.status === "needed" || it.status === "missing"));
    if (isParent) {
      for (const item of missing) {
        packingExceptions.push({
          kidId: kid.id,
          kidName: kid.name,
          itemId: item.id,
          title: cleanText(item.title, 80),
          date: snap.packing.date || today,
        });
      }
      const helpNeeded = (snap.occurrences || []).filter((o) => o && (o.status === "help" || o.status === "handed_off"));
      for (const occ of helpNeeded) {
        packingExceptions.push({
          kidId: kid.id,
          kidName: kid.name,
          itemId: occ.id,
          title: `${cleanText(occ.title, 60)} (${occ.status === "help" ? "help requested" : "handed off"})`,
          date: today,
          kind: "help",
        });
      }
    } else if (kid.id === kidId) {
      for (const item of needed.slice(0, 6)) {
        kidOwnPacking.push({
          id: item.id,
          title: cleanText(item.title, 80),
          phase: item.phase || "evening",
          status: item.status,
        });
      }
    }
  }

  // Screen Time overview (STRICTLY PARENT-ONLY — never returned to kid sessions!)
  const screenTimeKids = {};
  const screenTimeAlerts = [];
  const screenTimeRequests = [];
  if (isParent) {
    const stOverview = safe(() => screenTime.overview(fam), null);
    for (const ks of (stOverview && stOverview.kids) || []) {
      if (!ks || !ks.kidId) continue;
      const kidObj = visibleKids.find((k) => k.id === ks.kidId);
      const kName = kidObj ? kidObj.name : "Child";
      const openAlerts = (ks.alerts || []).filter((a) => a && !a.ackedAt);
      const pendingReqs = (ks.requests || []).filter((r) => r && r.status === "pending");
      const pausedUntil = ks.pause && ks.pause.until && Date.parse(ks.pause.until) > now.getTime() ? ks.pause.until : null;
      screenTimeKids[ks.kidId] = {
        kidId: ks.kidId,
        enabled: !!(ks.policy && ks.policy.enabled),
        paused: !!pausedUntil,
        pausedUntil,
        deviceCount: Array.isArray(ks.devices) ? ks.devices.length : 0,
        openAlertCount: openAlerts.length,
        pendingRequestCount: pendingReqs.length,
      };
      for (const a of openAlerts.slice(0, 2)) {
        screenTimeAlerts.push({
          id: a.id,
          kidId: ks.kidId,
          kidName: kName,
          type: a.type,
          message: cleanText(a.message || "Screen Time attention needed", 130),
          at: a.at,
        });
      }
      for (const r of pendingReqs.slice(0, 2)) {
        screenTimeRequests.push({
          id: r.id,
          kidId: ks.kidId,
          kidName: kName,
          minutes: Number(r.minutes || 15),
          reason: cleanText(r.reason || "", 90) || null,
          at: r.createdAt || r.at || null,
        });
      }
    }
  }

  // Pending kid sign-in access requests (STRICTLY PARENT-ONLY)
  const pendingKidAccess = isParent
    ? safe(() => kidAccess.listPendingForFamily(fam.id), []).map((r) => ({
      id: r.id,
      name: cleanText(r.name || "Child", 50),
      deviceLabel: cleanText(r.deviceLabel || "a device", 60),
    }))
    : [];

  // Hermes pending actionable nudges (per-user private thread; parent only for command triage)
  const hermesPending = isParent ? hermesOpenNudges(fam, user.id, now) : [];

  // ---------------- SYNTHESIZE PROACTIVE INSIGHTS (MAX 3) ----------------
  const insights = [];

  if (isParent) {
    // 1. Logistics & Collision Insight (unassigned driver, moved school event, or 30m overlap across kids)
    const movedEvent = todayEvents.find((e) => e.moved);
    const missingDriver = todayEvents.find((e) => e.editable && e.needsDriver);
    let overlapPair = null;
    for (let i = 0; i < todayEvents.length - 1; i++) {
      const a = todayEvents[i];
      const b = todayEvents[i + 1];
      if (!a.time || !b.time || !a.kidId || !b.kidId || a.kidId === b.kidId) continue;
      const ma = toMinutes(a.time);
      const mb = toMinutes(b.time);
      if (ma != null && mb != null && Math.abs(mb - ma) <= 30) {
        overlapPair = [a, b];
        break;
      }
    }

    if (overlapPair || missingDriver || movedEvent) {
      let text = "";
      let tag = "Logistics";
      let action = null;
      if (overlapPair) {
        tag = `Schedule Crunch · ${overlapPair[0].time}`;
        text = `${overlapPair[0].kidName}’s ${overlapPair[0].title} (${overlapPair[0].time}) overlaps closely with ${overlapPair[1].kidName}’s ${overlapPair[1].title} (${overlapPair[1].time}).`;
        if (missingDriver) {
          text += ` No driver is assigned for ${missingDriver.title}.`;
          action = { kind: "claim-driver", label: "I’ll drive", eventId: missingDriver.id };
        } else {
          action = { kind: "open-tab", label: "Open Schedule", tab: "calendar" };
        }
      } else if (missingDriver) {
        tag = `Pickup Gap · ${missingDriver.time}`;
        text = `${missingDriver.kidName}’s ${missingDriver.title} at ${missingDriver.time} has no driver assigned yet.`;
        action = { kind: "claim-driver", label: "I’ll drive", eventId: missingDriver.id };
      } else if (movedEvent) {
        tag = "School Schedule Change";
        text = `${movedEvent.title} for ${movedEvent.kidName} moved${movedEvent.time ? ` to ${movedEvent.time}` : ""}. Check pickup & gear.`;
        action = { kind: "open-tab", label: "Check Schedule", tab: "calendar" };
      }
      insights.push({
        id: "insight-logistics",
        tone: "danger",
        tag,
        text,
        primaryAction: action,
        secondaryAction: { kind: "open-tab", label: "Schedule", tab: "calendar" },
      });
    }

    // 2. Evening Load + Dinner Insight
    const dueSoonHw = allHomework.filter((h) => h.status !== "done" && h.dueDate && h.dueDate <= tomorrow);
    const totalSoonEffort = dueSoonHw.reduce((s, h) => s + (Number(h.effortMin) > 0 ? Number(h.effortMin) : 25), 0);
    if (!dinner && (phase === "afternoon" || phase === "evening")) {
      const hwClause = dueSoonHw.length > 0
        ? `${dueSoonHw.length} homework task${dueSoonHw.length === 1 ? "" : "s"} (~${totalSoonEffort} min) due by tomorrow and `
        : "";
      insights.push({
        id: "insight-dinner",
        tone: "warn",
        tag: dueSoonHw.length ? "Evening Load + Dinner" : "Tonight’s Dinner",
        text: `${hwClause}tonight’s dinner isn’t planned yet.${openShopping.length ? ` ${openShopping.length} items on your shopping list.` : ""}`,
        primaryAction: { kind: "open-home", label: "Plan Dinner", sub: "meals" },
        secondaryAction: dueSoonHw.length ? { kind: "open-tab", label: "Review Homework", tab: "homework" } : null,
      });
    }

    // 3. Tomorrow Early Start / Packing / Homework Support Insight
    const earlyTomorrow = tomorrowEvents.find((e) => e.time && toMinutes(e.time) != null && toMinutes(e.time) < 8 * 60);
    const overdueHw = allHomework.filter((h) => h.status !== "done" && h.dueDate && h.dueDate < today);
    if (packingExceptions.length > 0) {
      const ex = packingExceptions[0];
      insights.push({
        id: "insight-packing",
        tone: "warn",
        tag: "Readiness Exception",
        text: `${ex.kidName}: ${ex.title}${packingExceptions.length > 1 ? ` (+${packingExceptions.length - 1} more)` : ""}.`,
        primaryAction: { kind: "open-child", label: `Open ${ex.kidName}`, kidId: ex.kidId },
      });
    } else if (phase === "evening" && earlyTomorrow) {
      insights.push({
        id: "insight-tomorrow",
        tone: "accent",
        tag: "Tomorrow Early Start",
        text: `Tomorrow begins at ${earlyTomorrow.time} with ${earlyTomorrow.kidName}’s ${earlyTomorrow.title}${earlyTomorrow.gear.length ? ` (pack: ${earlyTomorrow.gear.join(", ")})` : ""}.`,
        primaryAction: { kind: "open-tab", label: "See Tomorrow", tab: "calendar" },
      });
    } else if (overdueHw.length > 0) {
      const first = overdueHw[0];
      const kid = visibleKids.find((k) => k.id === first.kidId);
      insights.push({
        id: "insight-homework",
        tone: "warn",
        tag: "Homework Support",
        text: `${kid ? kid.name + " has " : ""}${overdueHw.length} overdue assignment${overdueHw.length === 1 ? "" : "s"}, starting with “${cleanText(first.title, 55)}”.`,
        primaryAction: { kind: "review-homework", label: "Review Brief", homeworkId: first.id },
      });
    }
  } else {
    // Kid Insights (strictly own-scoped, encouraging, actionable)
    const openOwnHw = allHomework
      .filter((h) => h.status !== "done")
      .sort((a, b) => String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")));
    if (openOwnHw.length > 0) {
      const top = openOwnHw[0];
      insights.push({
        id: "insight-kid-next",
        tone: "accent",
        tag: "Best Next Step",
        text: `Start with 15 focused minutes on “${cleanText(top.title, 65)}”${top.dueDate === today ? " (due today)" : top.dueDate === tomorrow ? " (due tomorrow)" : ""}.`,
        primaryAction: { kind: "start-focus", label: "Start 15m Focus", homeworkId: top.id },
      });
    } else {
      insights.push({
        id: "insight-kid-clear",
        tone: "teal",
        tag: "Homework Clear",
        text: "No open assignments waiting right now. Close your Daily 4 loop to earn extra fams!",
        primaryAction: { kind: "scroll-daily4", label: "Open Daily 4" },
      });
    }
    if (kidOwnPacking.length > 0) {
      insights.push({
        id: "insight-kid-pack",
        tone: "warn",
        tag: "Bag Check",
        text: `${kidOwnPacking.length} item${kidOwnPacking.length === 1 ? "" : "s"} left to pack: ${kidOwnPacking.slice(0, 2).map((p) => p.title).join(", ")}.`,
        primaryAction: { kind: "open-tab", label: "View Homework & Gear", tab: "homework" },
      });
    }
  }

  // ---------------- UNIFIED EXTRA ACTION SIGNALS ----------------
  // Complements existing #today-actions-card with items Today never showed before.
  const unifiedSignals = [];
  if (isParent) {
    for (const a of screenTimeAlerts) {
      unifiedSignals.push({
        id: `st-alert:${a.id}`,
        priority: "P0",
        kind: "screen_time_alert",
        kidId: a.kidId,
        kidName: a.kidName,
        title: `${a.kidName} · ${a.message}`,
        meta: "Screen Time alert · Parents only",
        payload: a,
      });
    }
    for (const r of screenTimeRequests) {
      unifiedSignals.push({
        id: `st-req:${r.id}`,
        priority: "P0",
        kind: "screen_time_request",
        kidId: r.kidId,
        kidName: r.kidName,
        title: `${r.kidName} asked for +${r.minutes} min`,
        meta: r.reason ? `Screen Time · “${r.reason}”` : "Screen Time request",
        payload: r,
      });
    }
    for (const h of hermesPending) {
      unifiedSignals.push({
        id: `hermes:${h.messageId}`,
        priority: "P1",
        kind: "hermes_nudge",
        kidId: null,
        kidName: "Hermes",
        title: h.title,
        meta: "Hermes proposal · Private",
        payload: h,
      });
    }
    for (const ev of todayEvents.filter((e) => e.editable && e.needsDriver).slice(0, 2)) {
      unifiedSignals.push({
        id: `driver:${ev.id}`,
        priority: "P1",
        kind: "driver_gap",
        kidId: ev.kidId,
        kidName: ev.kidName,
        title: `Assign driver for ${ev.kidName}’s ${ev.title}`,
        meta: `Today · ${ev.time}${ev.location ? " · " + ev.location : ""}`,
        payload: { eventId: ev.id, title: ev.title, time: ev.time },
      });
    }
    for (const ex of packingExceptions.slice(0, 2)) {
      unifiedSignals.push({
        id: `pack:${ex.kidId}:${ex.itemId}`,
        priority: "P1",
        kind: "packing_exception",
        kidId: ex.kidId,
        kidName: ex.kidName,
        title: `${ex.kidName} · ${ex.title}`,
        meta: "Student readiness exception",
        payload: ex,
      });
    }
  }
  for (const d of openDecisions) {
    unifiedSignals.push({
      id: `decision:${d.id}`,
      priority: "P2",
      kind: "decision",
      kidId: null,
      kidName: "Family",
      title: d.question,
      meta: d.deadline ? `Family decision · Closes ${d.deadline}` : "Open family decision",
      payload: d,
    });
  }

  // Next kid homework target for Kid Focus Hero
  const nextKidHomework = !isParent
    ? allHomework
      .filter((h) => h.status !== "done")
      .sort((a, b) => String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")))[0] || null
    : null;

  return {
    generatedAt: now.toISOString(),
    role: isParent ? "parent" : "kid",
    today,
    tomorrow,
    clock,
    timezone: tz,
    phase,
    phaseLabel: phaseLabel(phase, !isParent),
    insights: insights.slice(0, 3),
    unifiedSignals,
    runsheet: {
      today: todayEvents,
      tomorrowPreview: tomorrowEvents.slice(0, 3),
    },
    weekWorkload: buildWeekWorkload(fam, today, tz, now, viewer, allHomework),
    home: {
      dinner: dinner ? { id: dinner.id, title: cleanText(dinner.title, 90), date: dinner.date } : null,
      openShoppingCount: openShopping.length,
      tripCount: userTrips.length,
      openDecisionCount: openDecisions.length,
    },
    screenTimeKids: isParent ? screenTimeKids : {},
    pendingKidAccessCount: pendingKidAccess.length,
    kidFocus: nextKidHomework
      ? {
        id: nextKidHomework.id,
        title: nextKidHomework.title,
        subject: nextKidHomework.subject || "Homework",
        dueDate: nextKidHomework.dueDate || null,
        effortMin: Number(nextKidHomework.effortMin) > 0 ? Number(nextKidHomework.effortMin) : null,
        status: nextKidHomework.status || "todo",
        checklist: Array.isArray(nextKidHomework.checklist) ? nextKidHomework.checklist : [],
      }
      : null,
    kidPacking: !isParent ? kidOwnPacking : [],
  };
}

module.exports = {
  buildCommandBrief,
  phaseForClock,
};
