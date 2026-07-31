"use strict";
/*
 * Phase B: calendar merge (lib/routes/calendar.js GET /api/calendar/events
 * additionally returns read-only synthetic trip events — docs/TRIPS-PLAN.md
 * "Calendar merge"). Harness follows tests/calendar-routes.test.js.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-trips-cal-"));

const store = require("../lib/store");
const family = require("../lib/family");
const events = require("../lib/events");
const trips = require("../lib/trips");
const calendarRoutes = require("../lib/routes/calendar");

function buildHarness() {
  const routes = {};
  const register = (method) => (p, ...handlers) => { routes[`${method} ${p}`] = handlers[handlers.length - 1]; };
  const app = { get: register("GET"), post: register("POST"), patch: register("PATCH"), delete: register("DELETE") };
  calendarRoutes(app, {
    schoolFeeds: {}, homework: {}, events, trips,
    chat: { sendMessage: () => {} },
    requireAuth: (req, res, next) => next(),
    requireParent: (req, res, next) => next(),
    requireFamily: (req, res, next) => next(),
    userRole: (user) => (user && user.data && user.data.kid ? "kid" : "parent"),
    kidIdForUser: (req) => req.user.data.kid.kidId,
    friendlyDate: (d) => d,
  });
  return routes;
}

function call(handler, { body, params, query, user, fam } = {}) {
  const res = {
    statusCode: 200,
    body: null,
    set() { return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  handler({
    body: body || {},
    params: params || {},
    query: query || {},
    user: user || { id: "u1", data: {} },
    family: fam,
  }, res);
  return res;
}

let n = 0;
function freshParent(label) {
  n++;
  return store.createUser(`${label}${n}@example.com`, `Parent ${label}${n}`);
}
function makeTrip(label, { startDate = "2026-08-01", endDate = "2026-08-10" } = {}) {
  const owner = freshParent(label);
  const fam = family.createFamily(owner.id, `${label} Family`);
  const { trip } = trips.createTrip(owner.id, fam.id, { name: `${label} Trip`, destination: "Lisbon, PT", startDate, endDate });
  return { owner, fam, trip };
}

test("GET /api/calendar/events: a member's family sees the trip's spanning event, read-only", () => {
  const routes = buildHarness();
  const { owner, fam, trip } = makeTrip("C1");
  const res = call(routes["GET /api/calendar/events"], { user: owner, fam });
  const tripEv = res.body.events.find((e) => e.id === "trip_ev_" + trip.id);
  assert.ok(tripEv, "expected the trip's spanning calendar event");
  assert.equal(tripEv.title, "✈ " + trip.name);
  assert.equal(tripEv.date, trip.startDate);
  assert.equal(tripEv.endDate, trip.endDate);
  assert.equal(tripEv.category, "trip");
  assert.equal(tripEv.source, "trip");
  assert.equal(tripEv.canEdit, false);
  assert.equal(tripEv.familyId, fam.id);
});

test("GET /api/calendar/events: an unrelated family never sees another family's trip", () => {
  const routes = buildHarness();
  makeTrip("C2");
  const otherParent = freshParent("C2other");
  const otherFam = family.createFamily(otherParent.id, "Unrelated Family");
  const res = call(routes["GET /api/calendar/events"], { user: otherParent, fam: otherFam });
  assert.ok(!res.body.events.some((e) => e.id.startsWith("trip_ev_")));
});

test("GET /api/calendar/events: a kid in the trip's family sees it via kid-read", () => {
  const routes = buildHarness();
  const { fam, trip } = makeTrip("C3");
  const { kid } = family.addKid(fam.id, fam.parentIds[0], { name: "Kiddo" });
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
  const res = call(routes["GET /api/calendar/events"], { user: kidUser, fam });
  assert.ok(res.body.events.some((e) => e.id === "trip_ev_" + trip.id));
});

test("GET /api/calendar/events: a parseable flight date produces a synthetic flight event", () => {
  const routes = buildHarness();
  const { owner, fam, trip } = makeTrip("C4");
  const { flight } = trips.addFlight(trip.id, owner.id, { airline: "BA", flightNo: "283", departs: "Aug 3, 21:50", arrives: "Aug 4, 09:10" });
  const res = call(routes["GET /api/calendar/events"], { user: owner, fam });
  const flightEv = res.body.events.find((e) => e.id === "trip_ev_" + trip.id + "_" + flight.id);
  assert.ok(flightEv, "expected a synthetic flight event");
  assert.equal(flightEv.date, "2026-08-03");
  assert.equal(flightEv.canEdit, false);
});

test("GET /api/calendar/events: an unparseable flight date is SKIPPED, not guessed", () => {
  const routes = buildHarness();
  const { owner, fam, trip } = makeTrip("C5");
  const { flight } = trips.addFlight(trip.id, owner.id, { airline: "BA", flightNo: "999", departs: "sometime next week", arrives: "" });
  const res = call(routes["GET /api/calendar/events"], { user: owner, fam });
  assert.ok(!res.body.events.some((e) => e.id === "trip_ev_" + trip.id + "_" + flight.id));
  // the trip's own spanning event is unaffected by the skip
  assert.ok(res.body.events.some((e) => e.id === "trip_ev_" + trip.id));
});

test("GET /api/calendar/events: lodging produces separate check-in and check-out synthetic events", () => {
  const routes = buildHarness();
  const { owner, fam, trip } = makeTrip("C6");
  const { lodging } = trips.addLodging(trip.id, owner.id, { name: "Hotel Lux", checkIn: "Aug 2", checkOut: "Aug 9" });
  const res = call(routes["GET /api/calendar/events"], { user: owner, fam });
  const inEv = res.body.events.find((e) => e.id === "trip_ev_" + trip.id + "_" + lodging.id + "_in");
  const outEv = res.body.events.find((e) => e.id === "trip_ev_" + trip.id + "_" + lodging.id + "_out");
  assert.ok(inEv && outEv);
  assert.equal(inEv.date, "2026-08-02");
  assert.equal(outEv.date, "2026-08-09");
  assert.equal(inEv.canEdit, false);
  assert.equal(outEv.canEdit, false);
});

test("GET /api/calendar/events: an editor's OWN family (co-parent's own family, not the trip's nominal familyId) still sees it if a member of that family is on the trip", () => {
  const routes = buildHarness();
  const { trip } = makeTrip("C7");
  const coParent = freshParent("C7co");
  const coFam = family.createFamily(coParent.id, "CoParent Family");
  trips.joinByCode(trip.inviteCode, coParent.id);
  const res = call(routes["GET /api/calendar/events"], { user: coParent, fam: coFam });
  const tripEv = res.body.events.find((e) => e.id === "trip_ev_" + trip.id);
  assert.ok(tripEv, "the co-parent's OWN family calendar should show the trip");
  assert.equal(tripEv.familyId, coFam.id); // decorated with the REQUESTER's family, not trip.familyId
});
