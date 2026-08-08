"use strict";

// Best-effort month abbreviation lookup for trip flight/lodging free-text
// dates ("Jun 3, 21:50") — see parseTripFreeTextDate below.
const MONTH_INDEX = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// Parses a free-text flight/lodging date ("Jun 3, 21:50", "June 3") into
// YYYY-MM-DD using the trip's own year(s) — never guesses a year that isn't
// the trip's start or end year. Returns null (caller SKIPS the synthetic
// event) when the month/day can't be read, or when the trip spans two
// different years and neither placement falls inside [startDate, endDate].
function parseTripFreeTextDate(freeText, trip) {
  const m = /([A-Za-z]{3,9})\.?\s+(\d{1,2})\b/.exec(String(freeText || ""));
  if (!m) return null;
  const month = MONTH_INDEX[m[1].slice(0, 3).toLowerCase()];
  if (month === undefined) return null;
  const day = Number(m[2]);
  if (!(day >= 1 && day <= 31)) return null;
  const mm = String(month + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  const startYear = Number(trip.startDate.slice(0, 4));
  const endYear = Number(trip.endDate.slice(0, 4));
  if (startYear === endYear) return `${startYear}-${mm}-${dd}`; // sole candidate year, even if outside the range (early/late travel)
  for (const y of [startYear, endYear]) {
    const candidate = `${y}-${mm}-${dd}`;
    if (candidate >= trip.startDate && candidate <= trip.endDate) return candidate;
  }
  return null; // trip crosses a year boundary and neither year places it in range — ambiguous, don't guess
}

module.exports = (app, deps) => {
  const { schoolFeeds, homework, actions, events, chat, trips, meals, requireAuth, requireParent, requireFamily, userRole, kidIdForUser, friendlyDate } = deps;

  // Visibility for a trip's synthetic calendar events (docs/TRIPS-PLAN.md
  // "Calendar merge"): the requesting user is a member, OR (parent) any
  // parent in their family is a member, OR (kid session) accessFor grants
  // kid-read. Never reuses trips.accessFor's "member" branch directly for a
  // parent, since a co-parent may be on the trip without this parent being
  // a member themselves.
  function tripVisibleToRequest(trip, req) {
    if (userRole(req.user) === "kid") return trips.accessFor(req.user, trip) === "kid-read";
    return (req.family.parentIds || []).some((pid) => trip.members.some((mem) => mem.userId === pid));
  }

  // Read-only, synthetic — never persisted, never editable (canEdit:false).
  // Shape mirrors lib/events.js's FamilyEvent exactly so the iOS decoder and
  // web calendar need zero changes to render them. familyId is the
  // REQUESTER's family (req.family.id), not trip.familyId — the trip may be
  // guest-owned (familyId null) or belong to a co-parent's own family record;
  // this event is being merged into the viewing family's calendar.
  function syntheticTripEvent(req, trip, { id, title, date, endDate, notes }) {
    return {
      id,
      familyId: req.family.id,
      title,
      date,
      endDate: endDate || null,
      time: "",
      endTime: "",
      notes: notes || "",
      category: "trip",
      kidId: null,
      repeat: "none",
      repeatUntil: null,
      source: "trip",
      createdBy: null,
      createdAt: trip.createdAt,
      canEdit: false,
    };
  }

  function tripCalendarEvents(req) {
    const out = [];
    if (!trips) return out;
    for (const trip of trips.allTrips()) {
      if (!tripVisibleToRequest(trip, req)) continue;
      out.push(syntheticTripEvent(req, trip, {
        id: "trip_ev_" + trip.id,
        title: "✈ " + trip.name,
        date: trip.startDate,
        endDate: trip.endDate,
        notes: trip.destination,
      }));
      for (const f of trip.flights) {
        const d = parseTripFreeTextDate(f.departs, trip);
        if (!d) continue; // unparseable free-text date — skip rather than guess
        out.push(syntheticTripEvent(req, trip, {
          id: "trip_ev_" + trip.id + "_" + f.id,
          title: "✈ " + [f.airline, f.flightNo].filter(Boolean).join(" ") + ([f.from, f.to].some(Boolean) ? ` (${f.from}→${f.to})` : ""),
          date: d,
          notes: f.confirmation ? `Confirmation: ${f.confirmation}` : "",
        }));
      }
      for (const l of trip.lodging) {
        const inD = parseTripFreeTextDate(l.checkIn, trip);
        if (inD) {
          out.push(syntheticTripEvent(req, trip, {
            id: "trip_ev_" + trip.id + "_" + l.id + "_in",
            title: "🏨 Check in: " + l.name,
            date: inD,
            notes: l.address,
          }));
        }
        const outD = parseTripFreeTextDate(l.checkOut, trip);
        if (outD) {
          out.push(syntheticTripEvent(req, trip, {
            id: "trip_ev_" + trip.id + "_" + l.id + "_out",
            title: "🏨 Check out: " + l.name,
            date: outD,
            notes: l.address,
          }));
        }
      }
    }
    return out;
  }

  // Tonight's dinner on the family calendar (docs/MEALS-PLAN.md §7) — the same
  // synthetic read-only merge Trips uses, which is what lets the NATIVE iOS
  // calendar show meals with no app change (it decodes these as FamilyEvents).
  // kidId stays null: dinner is family-wide even though Meals itself is a
  // parent tool, so a kid still sees what's for dinner on the calendar.
  function mealCalendarEvents(req) {
    if (!meals) return [];
    const state = meals.getState(req.family.id);
    const time = (state.prefs && state.prefs.dinnerTime) || "18:30";
    return (state.menu || []).map((e) => ({
      id: "meal_ev_" + e.id,
      familyId: req.family.id,
      title: "\u{1F37D} " + e.title,
      date: e.date,
      endDate: null,
      time: e.slot === "dinner" ? time : "",
      endTime: "",
      notes: e.note || "",
      category: "other",
      kidId: null,
      repeat: "none",
      repeatUntil: null,
      source: "menu",
      createdBy: null,
      createdAt: e.createdAt,
      canEdit: false,
    }));
  }

  // Feed subscriptions are family data (shared across parents), so reads open
  // to any signed-in family member (kids included — they should see their own
  // school calendar) but mutations (subscribe/unsubscribe/preview-fetch) are
  // parent-only, matching the family/kids routes above.
  app.get("/api/calendar/feeds", requireAuth, requireFamily, (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(schoolFeeds.listFeedsForFamily(req.family.id));
  });

  app.post("/api/calendar/feeds/preview", requireAuth, requireParent, async (req, res) => {
    const url = (req.body || {}).url;
    if (!url || typeof url !== "string") return res.status(400).json({ error: "Provide a calendar URL to preview." });
    try {
      const preview = await schoolFeeds.previewFeed(url.trim());
      if (!preview.ok) return res.status(400).json({ error: preview.error });
      res.json(preview);
    } catch (e) {
      console.error("[calendar] preview error:", e.message);
      res.status(502).json({ error: "Could not check that calendar right now. Please try again." });
    }
  });

  app.post("/api/calendar/feeds/subscribe", requireAuth, requireParent, requireFamily, (req, res) => {
    const { kidId, feedId, customUrl, customName, filterKeyword } = req.body || {};
    const result = schoolFeeds.subscribe(req.family.id, { kidId, feedId, customUrl, customName, filterKeyword });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ subscription: result.subscription });
  });

  app.post("/api/calendar/feeds/unsubscribe", requireAuth, requireParent, requireFamily, (req, res) => {
    const { kidId, feedId, customUrl, subscriptionId } = req.body || {};
    const result = schoolFeeds.unsubscribe(req.family.id, { kidId, feedId, customUrl, subscriptionId });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  });

  app.post("/api/calendar/school-events/hide", requireAuth, requireParent, requireFamily, (req, res) => {
    const { subscriptionId, uid } = req.body || {};
    const result = schoolFeeds.hideEvent(req.family.id, { subscriptionId, uid });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  });

  // Reads are open to kids too (they should see their own synced school
  // events); the sync itself only fetches/writes family-level subscription
  // data that a parent already configured, so no requireParent here.
  app.post("/api/calendar/sync", requireAuth, requireFamily, async (req, res) => {
    res.set("Cache-Control", "no-store");
    const force = !!(req.body && req.body.force) && userRole(req.user) !== "kid";
    try {
      const result = await schoolFeeds.syncFamily(req.family.id, { force });
      // Only project the events returned by a successful sync. This includes
      // cached/throttled results and deliberately avoids reaching into feed
      // storage or inferring work from ordinary calendar events.
      if (result && !result.error && actions && typeof actions.projectSchoolDeadlines === "function") {
        actions.projectSchoolDeadlines(req.family.id, Array.isArray(result.events) ? result.events : []);
      }
      // NOTE: public school calendars are informational (term dates, university
      // deadlines, IA copies) — NOT assignable homework. We do NOT create
      // homework items from them. Real homework comes from the school's
      // authenticated homework portal (see the homework-import feature).
      // Purge any homework a previous build auto-ingested from these feeds.
      try { homework.removeBySource(req.family.id, "school"); } catch (e) { /* non-fatal */ }
      res.json(result);
    } catch (e) {
      console.error("[calendar] sync error:", e.message);
      res.status(502).json({ error: "Could not sync school calendars right now. Please try again." });
    }
  });

  // ----- Family calendar events (manual appointments, server-synced) -----
  // Post a family-chat note (with a tappable card) when an event is added.
  function postEventChat(req, ev) {
    try {
      const isKid = userRole(req.user) === "kid";
      const when = ev.time ? `${friendlyDate(ev.date)} at ${ev.time}` : friendlyDate(ev.date);
      chat.sendMessage(req.family.id, {
        senderType: isKid ? "kid" : "parent",
        senderId: isKid ? req.user.data.kid.kidId : req.user.id,
        postedByUserId: req.user.id,
        text: `📅 New event: ${ev.title} — ${when}`,
        card: { type: "event", id: ev.id, title: ev.title },
      });
    } catch (e) { /* never block on a chat error */ }
  }

  app.get("/api/calendar/events", requireAuth, requireFamily, (req, res) => {
    res.set("Cache-Control", "no-store");
    const isParent = userRole(req.user) !== "kid";
    const list = events.listEvents(req.family.id, { from: req.query.from, to: req.query.to })
      .map((ev) => Object.assign({}, ev, { canEdit: events.canManage(ev, { userId: req.user.id, isParent }) }));
    // Read-only trip events (docs/TRIPS-PLAN.md "Calendar merge") — never
    // filtered by from/to, the trip list is small enough not to need it.
    res.json({ events: list.concat(tripCalendarEvents(req), mealCalendarEvents(req)) });
  });
  // Resolve an event's audience (its kidId) from the request.
  //   • Parents may target the whole family (null) or any kid.
  //   • Kids may target the whole family (null) or THEMSELVES — never a
  //     sibling; a kid pointing at another kid is coerced to the family
  //     scope rather than rejected (they get the safest non-error outcome).
  // null / "" / "family" all mean the shared family calendar.
  function resolveEventKidId(req, rawKidId) {
    const kidId = rawKidId === "" || rawKidId === "family" ? null : (rawKidId ?? null);
    if (userRole(req.user) !== "kid") return kidId;               // parent: as requested
    const own = kidIdForUser(req);
    return kidId === own ? own : null;                            // kid: self or family only
  }

  app.post("/api/calendar/events", requireAuth, requireFamily, (req, res) => {
    const b = req.body || {};
    const kidId = resolveEventKidId(req, b.kidId);
    const result = events.addEvent(req.family.id, {
      title: b.title, date: b.date, time: b.time, endTime: b.endTime,
      notes: b.notes, category: b.category, kidId,
      endDate: b.endDate, repeat: b.repeat, repeatUntil: b.repeatUntil,
      createdBy: req.user.id,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    // silent: bulk imports / one-time localStorage migration from the web app —
    // announcing each of dozens of timetable rows would flood the family chat.
    if (!b.silent) postEventChat(req, result.event);
    res.json({ event: result.event });
  });
  app.patch("/api/calendar/events/:id", requireAuth, requireFamily, (req, res) => {
    const isParent = userRole(req.user) !== "kid";
    const ev = events.getById(req.family.id, req.params.id);
    if (!ev) return res.status(404).json({ error: "Event not found." });
    if (!events.canManage(ev, { userId: req.user.id, isParent })) {
      return res.status(403).json({ error: "You can only edit events you created." });
    }
    const b = req.body || {};
    const patch = {
      title: b.title, date: b.date, time: b.time, endTime: b.endTime,
      notes: b.notes, category: b.category,
      endDate: b.endDate, repeat: b.repeat, repeatUntil: b.repeatUntil,
    };
    // Retarget the audience ONLY when the client actually sends kidId —
    // otherwise leave the event's current scope untouched (updateEvent skips
    // undefined fields; passing a resolved null on every edit would silently
    // move an event to the family calendar). Same rule as POST: kids may
    // retarget only to family or self.
    if (b.kidId !== undefined) patch.kidId = resolveEventKidId(req, b.kidId);
    const result = events.updateEvent(req.family.id, req.params.id, patch);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ event: result.event });
  });
  app.delete("/api/calendar/events/:id", requireAuth, requireFamily, (req, res) => {
    const isParent = userRole(req.user) !== "kid";
    const ev = events.getById(req.family.id, req.params.id);
    if (!ev) return res.status(404).json({ error: "Event not found." });
    if (!events.canManage(ev, { userId: req.user.id, isParent })) {
      return res.status(403).json({ error: "You can only delete events you created." });
    }
    const result = events.removeEvent(req.family.id, req.params.id);
    if (result.error) return res.status(404).json({ error: result.error });
    res.json({ ok: true });
  });
};
