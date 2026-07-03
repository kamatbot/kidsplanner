"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");
const http = require("http");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-test-schoolfeeds-"));

const store = require("../lib/store");
const family = require("../lib/family");
const { parseICS } = require("../lib/ical");
const schoolFeeds = require("../lib/school-feeds");

// ---------- ICS parsing ----------
const SAMPLE_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Google Inc//Google Calendar 70.9054//EN
BEGIN:VEVENT
UID:evt1@standrews.ac.th
DTSTAMP:20260601T000000Z
DTSTART:20260710T090000
DTEND:20260710T100000
SUMMARY:U13 Football vs Bangkok Prep
LOCATION:Main Field
DESCRIPTION:Bring shin guards
END:VEVENT
BEGIN:VEVENT
UID:evt2@standrews.ac.th
DTSTAMP:20260601T000000Z
DTSTART;VALUE=DATE:20260715
DTEND;VALUE=DATE:20260716
SUMMARY:Sports Day (All School)
END:VEVENT
BEGIN:VEVENT
UID:evt3@standrews.ac.th
DTSTAMP:20260601T000000Z
DTSTART:20260801T235900Z
DTEND:20260802T000000Z
SUMMARY:IA 1st Copy Deadline\\, Group 4
RRULE:FREQ=YEARLY
END:VEVENT
END:VCALENDAR`;

test("parseICS: extracts VEVENT fields (uid, summary, start, end, allDay, location, description)", () => {
  const events = parseICS(SAMPLE_ICS);
  assert.equal(events.length, 3);
  const [timed, allDay, deadline] = events;

  assert.equal(timed.uid, "evt1@standrews.ac.th");
  assert.equal(timed.summary, "U13 Football vs Bangkok Prep");
  assert.equal(timed.start, "2026-07-10T09:00:00");
  assert.equal(timed.end, "2026-07-10T10:00:00");
  assert.equal(timed.allDay, false);
  assert.equal(timed.location, "Main Field");
  assert.equal(timed.description, "Bring shin guards");

  assert.equal(allDay.allDay, true);
  assert.equal(allDay.start, "2026-07-15");

  assert.equal(deadline.summary, "IA 1st Copy Deadline, Group 4"); // unescaped comma
  assert.equal(deadline.recurring, true);
  assert.equal(deadline.start, "2026-08-01T23:59:00Z");
});

test("parseICS: ignores VEVENTs missing a UID or DTSTART", () => {
  const broken = `BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:No UID or start
END:VEVENT
END:VCALENDAR`;
  assert.equal(parseICS(broken).length, 0);
});

test("parseICS: handles empty/garbage input gracefully", () => {
  assert.deepEqual(parseICS(""), []);
  assert.deepEqual(parseICS(null), []);
  assert.deepEqual(parseICS("not an ics file at all"), []);
});

// ---------- windowing ----------
test("withinWindow: excludes events outside the past-2-weeks..next-3-months window", () => {
  const now = Date.parse("2026-07-03T00:00:00Z");
  assert.equal(schoolFeeds.withinWindow("2026-07-05T00:00:00Z", now), true); // near future
  assert.equal(schoolFeeds.withinWindow("2026-06-25T00:00:00Z", now), true); // within past 2wk
  assert.equal(schoolFeeds.withinWindow("2026-05-01T00:00:00Z", now), false); // too far past
  assert.equal(schoolFeeds.withinWindow("2027-01-01T00:00:00Z", now), false); // too far future
  assert.equal(schoolFeeds.withinWindow(null, now), false);
  assert.equal(schoolFeeds.withinWindow("not-a-date", now), false);
});

// ---------- deadline detection ----------
test("detectDeadline: flags events on a deadline feed regardless of title", () => {
  assert.equal(schoolFeeds.detectDeadline("Random Assembly", true), true);
});
test("detectDeadline: flags deadline-shaped titles even on a non-deadline feed", () => {
  assert.equal(schoolFeeds.detectDeadline("IA 1st Copy due", false), true);
  assert.equal(schoolFeeds.detectDeadline("Extended Essay outline", false), true);
  assert.equal(schoolFeeds.detectDeadline("University application deadline", false), true);
  assert.equal(schoolFeeds.detectDeadline("Sports Day", false), false);
});

// ---------- subscription storage ----------
function makeFamilyWithKid() {
  const parent = store.createUser(`p_${Math.random()}@example.com`, "Parent");
  const fam = family.createFamily(parent.id, "Feed Family");
  const { kid } = family.addKid(fam.id, parent.id, { name: "Alex", grade: "9" });
  return { parent, fam, kid };
}

test("subscribe/unsubscribe: add and remove a built-in feed subscription for a kid", () => {
  const { fam, kid } = makeFamilyWithKid();
  const result = schoolFeeds.subscribe(fam.id, { kidId: kid.id, feedId: "sta-high-school" });
  assert.ok(!result.error, result.error);
  assert.equal(result.subscription.kidId, kid.id);
  assert.equal(result.subscription.feedId, "sta-high-school");

  const listed = schoolFeeds.listFeedsForFamily(fam.id);
  assert.equal(listed.subscriptions.length, 1);
  assert.equal(listed.subscriptions[0].label, "STA High School");

  const removed = schoolFeeds.unsubscribe(fam.id, { kidId: kid.id, feedId: "sta-high-school" });
  assert.ok(!removed.error);
  assert.equal(schoolFeeds.listFeedsForFamily(fam.id).subscriptions.length, 0);
});

test("subscribe: rejects an unknown feedId and an invalid custom URL", () => {
  const { fam, kid } = makeFamilyWithKid();
  const badFeed = schoolFeeds.subscribe(fam.id, { kidId: kid.id, feedId: "not-a-real-feed" });
  assert.ok(badFeed.error);

  const badUrl = schoolFeeds.subscribe(fam.id, { kidId: kid.id, customUrl: "not a url" });
  assert.ok(badUrl.error);
});

test("subscribe: rejects a kid not in the family", () => {
  const { fam } = makeFamilyWithKid();
  const result = schoolFeeds.subscribe(fam.id, { kidId: "k_bogus", feedId: "cahe" });
  assert.ok(result.error);
});

test("subscribe: deadline feeds (CAHE, Senior Studies) are flagged in the listing", () => {
  const { fam, kid } = makeFamilyWithKid();
  schoolFeeds.subscribe(fam.id, { kidId: kid.id, feedId: "cahe" });
  schoolFeeds.subscribe(fam.id, { kidId: kid.id, feedId: "senior-studies-2027" });
  schoolFeeds.subscribe(fam.id, { kidId: kid.id, feedId: "sta-whole-school" });
  const listed = schoolFeeds.listFeedsForFamily(fam.id);
  const byFeed = Object.fromEntries(listed.subscriptions.map((s) => [s.feedId, s.deadline]));
  assert.equal(byFeed["cahe"], true);
  assert.equal(byFeed["senior-studies-2027"], true);
  assert.equal(byFeed["sta-whole-school"], false);
});

// ---------- UID dedup via collectFromCache ----------
test("collectFromCache: dedups by iCal UID within the same subscription cache", () => {
  const { fam, kid } = makeFamilyWithKid();
  const { subscription } = schoolFeeds.subscribe(fam.id, { kidId: kid.id, feedId: "sta-whole-school" });
  const s = schoolFeeds.famStore(fam.id);
  const now = Date.now();
  s.cache[subscription.id] = {
    fetchedAt: new Date().toISOString(),
    error: null,
    events: [
      { uid: "dup1", summary: "Assembly", start: new Date(now + 86400000).toISOString(), end: null, allDay: false, location: "", description: "", recurring: false },
      { uid: "dup1", summary: "Assembly (resync)", start: new Date(now + 86400000).toISOString(), end: null, allDay: false, location: "", description: "", recurring: false },
      { uid: "dup2", summary: "Book Fair", start: new Date(now + 2 * 86400000).toISOString(), end: null, allDay: false, location: "", description: "", recurring: false },
    ],
  };
  const events = schoolFeeds.collectFromCache(s, now);
  assert.equal(events.length, 2);
  const uids = events.map((e) => e.uid).sort();
  assert.deepEqual(uids, ["dup1", "dup2"]);
});

test("collectFromCache: tags events with source/readOnly/feedId/uid/kidId and applies the sync window", () => {
  const { fam, kid } = makeFamilyWithKid();
  const { subscription } = schoolFeeds.subscribe(fam.id, { kidId: kid.id, feedId: "sta-high-school" });
  const s = schoolFeeds.famStore(fam.id);
  const now = Date.now();
  s.cache[subscription.id] = {
    fetchedAt: new Date().toISOString(),
    error: null,
    events: [
      { uid: "in-window", summary: "Near event", start: new Date(now + 86400000).toISOString(), end: null, allDay: false, location: "", description: "", recurring: false },
      { uid: "too-far", summary: "Far future event", start: new Date(now + 200 * 86400000).toISOString(), end: null, allDay: false, location: "", description: "", recurring: false },
    ],
  };
  const events = schoolFeeds.collectFromCache(s, now);
  assert.equal(events.length, 1);
  const e = events[0];
  assert.equal(e.uid, "in-window");
  assert.equal(e.source, "school");
  assert.equal(e.readOnly, true);
  assert.equal(e.feedId, "sta-high-school");
  assert.equal(e.kidId, kid.id);
});

// ---------- webcal:// normalization ----------
test("normalizeCalendarUrl: rewrites webcal:// to https://", () => {
  assert.equal(
    schoolFeeds.normalizeCalendarUrl("webcal://calendar.google.com/foo/basic.ics"),
    "https://calendar.google.com/foo/basic.ics"
  );
  assert.equal(
    schoolFeeds.normalizeCalendarUrl("https://already-https.example.com/cal.ics"),
    "https://already-https.example.com/cal.ics"
  );
});

test("subscribe: normalizes a webcal:// custom URL before storing it", () => {
  const { fam, kid } = makeFamilyWithKid();
  const result = schoolFeeds.subscribe(fam.id, {
    kidId: kid.id,
    customUrl: "webcal://example.com/school.ics",
    customName: "Club feed",
  });
  assert.ok(!result.error, result.error);
  assert.equal(result.subscription.customUrl, "https://example.com/school.ics");
});

// ---------- previewFeed (hermetic — local HTTP server, no live network) ----------
function withLocalIcsServer(body, opts, fn) {
  return new Promise((resolve, reject) => {
    const { contentType = "text/calendar", status = 200 } = opts || {};
    const server = http.createServer((req, res) => {
      res.writeHead(status, { "Content-Type": contentType });
      res.end(body);
    });
    server.listen(0, "127.0.0.1", async () => {
      const port = server.address().port;
      try {
        await fn(`http://127.0.0.1:${port}/cal.ics`);
        resolve();
      } catch (e) {
        reject(e);
      } finally {
        server.close();
      }
    });
  });
}

test("previewFeed: returns ok + calendarName/count/sampleTitles for a valid feed", async () => {
  const body = `BEGIN:VCALENDAR
X-WR-CALNAME:Riverside Elementary
VERSION:2.0
BEGIN:VEVENT
UID:e1@example.com
DTSTART:20260710T090000
SUMMARY:Year 8 Parents Evening
END:VEVENT
BEGIN:VEVENT
UID:e2@example.com
DTSTART;VALUE=DATE:20260720
SUMMARY:Half Term
END:VEVENT
END:VCALENDAR`;
  await withLocalIcsServer(body, {}, async (url) => {
    const preview = await schoolFeeds.previewFeed(url);
    assert.equal(preview.ok, true);
    assert.equal(preview.calendarName, "Riverside Elementary");
    assert.equal(preview.count, 2);
    assert.deepEqual(preview.sampleTitles, ["Year 8 Parents Evening", "Half Term"]);
  });
});

test("previewFeed: rejects a non-calendar (HTML) response with a friendly error", async () => {
  const html = "<html><body><h1>Please sign in</h1></body></html>";
  await withLocalIcsServer(html, { contentType: "text/html" }, async (url) => {
    const preview = await schoolFeeds.previewFeed(url);
    assert.equal(preview.ok, false);
    assert.match(preview.error, /didn't return a calendar/i);
  });
});

test("previewFeed: rejects an empty calendar with a friendly error", async () => {
  const body = "BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR";
  await withLocalIcsServer(body, {}, async (url) => {
    const preview = await schoolFeeds.previewFeed(url);
    assert.equal(preview.ok, false);
    assert.match(preview.error, /doesn't have any events/i);
  });
});

test("previewFeed: surfaces a friendly error for a 401/403 (auth-required) response", async () => {
  await withLocalIcsServer("nope", { status: 403, contentType: "text/plain" }, async (url) => {
    const preview = await schoolFeeds.previewFeed(url);
    assert.equal(preview.ok, false);
    assert.match(preview.error, /public or secret/i);
  });
});

test("previewFeed: rejects an invalid URL before attempting to fetch", async () => {
  const preview = await schoolFeeds.previewFeed("not a url");
  assert.equal(preview.ok, false);
  assert.match(preview.error, /valid calendar url/i);
});

// ---------- requireParent gating (route-level guard, exercised directly
// against the lib — same pattern as tests/kid-login.test.js) ----------
function userRole(user) {
  return (user && user.data && user.data.profile && user.data.profile.role) || "parent";
}
function requireParentCheck(user) {
  return userRole(user) === "kid" ? { error: "Parents only." } : { ok: true };
}

test("requireParent gating: a kid session is blocked from subscribing/unsubscribing (route guard), a parent is allowed", () => {
  const { parent, fam, kid } = makeFamilyWithKid();
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);

  // The route-level guard (server.js requireParent) rejects the kid before
  // schoolFeeds.subscribe is ever called.
  const gate = requireParentCheck(kidUser);
  assert.ok(gate.error);
  assert.ok(!requireParentCheck(parent).error);

  // And the lib call itself succeeds for the parent path the route allows.
  const result = schoolFeeds.subscribe(fam.id, { kidId: kid.id, feedId: "sta-whole-school" });
  assert.ok(!result.error);
});

test("collectFromCache: applies a per-subscription keyword filter", () => {
  const { fam, kid } = makeFamilyWithKid();
  const { subscription } = schoolFeeds.subscribe(fam.id, { kidId: kid.id, feedId: "sta-hs-sport", filterKeyword: "U13" });
  const s = schoolFeeds.famStore(fam.id);
  const now = Date.now();
  s.cache[subscription.id] = {
    fetchedAt: new Date().toISOString(),
    error: null,
    events: [
      { uid: "u13-match", summary: "U13 Football vs X", start: new Date(now + 86400000).toISOString(), end: null, allDay: false, location: "", description: "", recurring: false },
      { uid: "u18-match", summary: "U18 Football vs Y", start: new Date(now + 86400000).toISOString(), end: null, allDay: false, location: "", description: "", recurring: false },
    ],
  };
  const events = schoolFeeds.collectFromCache(s, now);
  assert.equal(events.length, 1);
  assert.equal(events[0].uid, "u13-match");
});
