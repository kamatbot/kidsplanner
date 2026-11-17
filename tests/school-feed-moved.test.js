"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");
const http = require("http");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-test-moved-"));

const store = require("../lib/store");
const family = require("../lib/family");
const schoolFeeds = require("../lib/school-feeds");

function makeIcs(uid, summary, start, end) {
  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:${uid}
DTSTAMP:20260601T000000Z
DTSTART:${start}
DTEND:${end}
SUMMARY:${summary}
END:VEVENT
END:VCALENDAR`;
}

test("moved tag: detected on resync when event start time changes", async () => {
  // Setup a test family
  const parent = store.createUser("kate@example.com", "Kate Walker");
  const fam = family.createFamily(parent.id, "Walker Family");
  const kidRes = family.addKid(fam.id, parent.id, "Mia", "2014-05-10");
  const kid = kidRes.kid;

  let currentIcs = "";
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/calendar" });
    res.end(currentIcs);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const feedUrl = `http://127.0.0.1:${port}/calendar.ics`;

  try {
    const subRes = schoolFeeds.subscribe(fam.id, {
      kidId: kid.id,
      customUrl: feedUrl,
      customName: "Soccer Club",
    });
    assert.ok(subRes.subscription, "Subscribed successfully");

    // Sync 1: initial event at 17:00 on future date
    currentIcs = makeIcs("match1@club.com", "U13 Match", "20261125T170000", "20261125T180000");
    const sync1 = await schoolFeeds.syncFamily(fam.id, { force: true });
    assert.equal(sync1.events.length, 1);
    assert.equal(sync1.events[0].title, "U13 Match");
    assert.equal(sync1.events[0].previousStart, undefined, "First sync has no previousStart");
    assert.equal(sync1.events[0].movedAt, undefined, "First sync has no movedAt");
    assert.equal(sync1.events[0].sourceLabel, "Your calendar");

    // Sync 2: resync with same start (unchanged resync gives no moved flag)
    const sync2 = await schoolFeeds.syncFamily(fam.id, { force: true });
    assert.equal(sync2.events.length, 1);
    assert.equal(sync2.events[0].previousStart, undefined, "Unchanged resync gives no moved flag");

    // Sync 3: start changes to 18:00
    currentIcs = makeIcs("match1@club.com", "U13 Match", "20261125T180000", "20261125T190000");
    const sync3 = await schoolFeeds.syncFamily(fam.id, { force: true });
    assert.equal(sync3.events.length, 1, "Resync does not duplicate events");
    const movedEvent = sync3.events[0];
    assert.equal(movedEvent.start, "2026-11-25T18:00:00");
    assert.equal(movedEvent.previousStart, "2026-11-25T17:00:00", "previousStart is recorded and attached");
    assert.ok(movedEvent.movedAt, "movedAt timestamp is recorded and attached");

    // Verify persisted in store
    const famData = schoolFeeds.famStore(fam.id);
    const movedKey = `${subRes.subscription.id}::match1@club.com`;
    assert.ok(famData.moved[movedKey]);
    assert.equal(famData.moved[movedKey].previousStart, "2026-11-25T17:00:00");
  } finally {
    server.close();
  }
});

test("moved tag: flag expires after 7 days", () => {
  const storeData = {
    subscriptions: [
      { id: "sub_1", kidId: "kid_1", feedId: "sta-whole-school", customUrl: null },
    ],
    cache: {
      sub_1: {
        events: [
          {
            uid: "evt_future",
            summary: "Concert",
            start: "2026-11-25T18:00:00Z",
            end: "2026-11-25T19:00:00Z",
            allDay: false,
          },
        ],
      },
    },
    hidden: [],
    moved: {
      "sub_1::evt_future": {
        previousStart: "2026-11-25T17:00:00Z",
        movedAt: "2026-11-10T10:00:00.000Z", // 8 days before 2026-11-18
      },
    },
  };

  const nowAt8Days = Date.parse("2026-11-18T12:00:00.000Z");
  const events = schoolFeeds.collectFromCache(storeData, nowAt8Days);
  assert.equal(events.length, 1);
  assert.equal(events[0].previousStart, undefined, "Flag expired after 7 days");
  assert.equal(events[0].movedAt, undefined);

  // If now is within 7 days (e.g. 3 days after movedAt)
  const nowAt3Days = Date.parse("2026-11-13T10:00:00.000Z");
  const eventsWithin = schoolFeeds.collectFromCache(storeData, nowAt3Days);
  assert.equal(eventsWithin.length, 1);
  assert.equal(eventsWithin[0].previousStart, "2026-11-25T17:00:00Z", "Flag present within 7 days");
  assert.equal(eventsWithin[0].movedAt, "2026-11-10T10:00:00.000Z");
});

test("moved tag: flag expires after event has ended / passed", () => {
  const storeData = {
    subscriptions: [
      { id: "sub_1", kidId: "kid_1", feedId: "sta-whole-school", customUrl: null },
    ],
    cache: {
      sub_1: {
        events: [
          {
            uid: "evt_past",
            summary: "Assembly",
            start: "2026-11-15T09:00:00Z",
            end: "2026-11-15T10:00:00Z",
            allDay: false,
          },
        ],
      },
    },
    hidden: [],
    moved: {
      "sub_1::evt_past": {
        previousStart: "2026-11-15T08:00:00Z",
        movedAt: "2026-11-15T07:00:00.000Z",
      },
    },
  };

  // Now is after the event has ended (2026-11-15 11:00 UTC, event ended at 10:00 UTC)
  const nowAfterEvent = Date.parse("2026-11-15T11:00:00.000Z");
  const events = schoolFeeds.collectFromCache(storeData, nowAfterEvent);
  assert.equal(events.length, 1);
  assert.equal(events[0].previousStart, undefined, "Flag not attached after event has ended");
  assert.equal(events[0].movedAt, undefined);

  // Now is before the event has ended (2026-11-15 08:30 UTC, event ends at 10:00 UTC)
  const nowBeforeEvent = Date.parse("2026-11-15T08:30:00.000Z");
  const eventsBefore = schoolFeeds.collectFromCache(storeData, nowBeforeEvent);
  assert.equal(eventsBefore.length, 1);
  assert.equal(eventsBefore[0].previousStart, "2026-11-15T08:00:00Z", "Flag attached before event has ended");
});
