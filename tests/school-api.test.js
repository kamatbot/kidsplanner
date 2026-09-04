"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-school-api-"));
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");

const db = require("../lib/db");
const datacrypto = require("../lib/datacrypto");
const store = require("../lib/store");
const family = require("../lib/family");
const homework = require("../lib/homework");
const actions = require("../lib/actions");
const events = require("../lib/events");
const schoolApi = require("../lib/school-api");

const CODE = "testCapabilityCode_1234567890";
const HOMEWORK_URL = `${schoolApi.FEED_ORIGIN}${schoolApi.HOMEWORK_PATH}?code=${CODE}`;
const TIMETABLE_URL = `${schoolApi.FEED_ORIGIN}${schoolApi.TIMETABLE_PATH}?code=${CODE}`;

function makeFamily(label) {
  const parent = store.createUser(`${label}-${Math.random()}@example.com`, `Parent ${label}`);
  const fam = family.createFamily(parent.id, `${label} family`);
  const { kid } = family.addKid(fam.id, parent.id, { name: `${label} kid`, grade: "9" });
  return { parent, fam, kid };
}

function jsonResponse(body, etag) {
  return new Response(JSON.stringify(body), { status: 200, headers: etag ? { ETag: etag } : {} });
}

function homeworkPayload(items, week = 4) {
  return { ok: true, version: 1, generated: 1, timezone: "Asia/Bangkok", week, homework: items };
}

function timetablePayload(items, week = 4) {
  return { ok: true, version: 1, generated: 1, timezone: "Asia/Bangkok", week, lessons: items };
}

test("private link validation pins the school origin, endpoint, and one child code", () => {
  assert.deepEqual(schoolApi.validateLinks({ homeworkUrl: HOMEWORK_URL, timetableUrl: TIMETABLE_URL }), { code: CODE });
  assert.match(schoolApi.validateLinks({
    homeworkUrl: `https://evil.example${schoolApi.HOMEWORK_PATH}?code=${CODE}`,
    timetableUrl: TIMETABLE_URL,
  }).error, /St Andrews/);
  assert.match(schoolApi.validateLinks({
    homeworkUrl: HOMEWORK_URL,
    timetableUrl: `${schoolApi.FEED_ORIGIN}${schoolApi.TIMETABLE_PATH}?code=anotherCapabilityCode_1234`,
  }).error, /same child/);
});

test("saved capability is encrypted and status never returns a URL or code", () => {
  const { parent, fam, kid } = makeFamily("encrypted");
  const saved = schoolApi.saveConnection(fam.id, parent.id, kid.id, {
    homeworkUrl: HOMEWORK_URL,
    timetableUrl: TIMETABLE_URL,
  });
  assert.equal(saved.ok, true);

  const record = db.load().schoolApiFeeds[fam.id].connections[kid.id];
  assert.equal(datacrypto.isEncrypted(record.secretBlob), true);
  assert.equal(JSON.stringify(record).includes(CODE), false);
  assert.equal(JSON.stringify(record).includes("childhomework.php"), false);
  const publicStatus = schoolApi.listStatus(fam.id);
  assert.equal(JSON.stringify(publicStatus).includes(CODE), false);
  assert.deepEqual(Object.keys(publicStatus[0]).sort(), [
    "connected", "homeworkCount", "kidId", "lastAttemptAt", "lastError", "lastSyncAt",
    "nextSyncAt", "paused", "syncDue", "timetableCount", "updatedAt", "week",
  ]);
});

test("sync imports homework and timetable activities, then honors the eight-hour interval and ETags", async () => {
  const { parent, fam, kid } = makeFamily("sync");
  homework.addHomework(fam.id, {
    kidId: kid.id,
    title: "Old manual homework",
    dueDate: "2026-09-09",
    source: "manual",
  });
  const oldImported = homework.addHomework(fam.id, {
    kidId: kid.id,
    title: "Old imported homework",
    dueDate: "2026-09-09",
    source: "school-portal",
    moodleIdentity: {
      origin: schoolApi.FEED_ORIGIN,
      homeworkViewId: "2",
      userId: "123",
      taskId: "999",
    },
  }).homework;
  actions.projectSchoolAssignments(fam.id, [oldImported]);
  assert.equal(actions.listForFamily(fam.id, { sourceType: "homework" }).length, 1);
  schoolApi.saveConnection(fam.id, parent.id, kid.id, { homeworkUrl: HOMEWORK_URL, timetableUrl: TIMETABLE_URL });
  const sunday = Date.parse("2026-09-06T02:00:00Z"); // 09:00 Sunday in Bangkok; feed describes the coming week.
  let calls = 0;
  const firstFetch = async (url, options) => {
    calls += 1;
    assert.equal(url.searchParams.get("code"), CODE);
    assert.equal(options.redirect, "error");
    if (url.pathname === schoolApi.HOMEWORK_PATH) {
      return jsonResponse(homeworkPayload([
        { id: 101, title: "Math worksheet", description: "Questions 1–8", link: "https://classroom.example/task", subject: "Maths", code: "9MAT.3", setby: "Teacher One", due: "2026-09-08", duration: 30, selfset: false },
        { id: 102, title: "Reading list", description: "Read when ready", link: "", subject: null, code: null, setby: null, due: "2050-01-01", duration: 0, selfset: true },
      ]), '"hw-v1"');
    }
    return jsonResponse(timetablePayload([
      { day: 1, periodnum: 2, period: "P1", start: "08:00", end: "09:00", subject: "Maths", subjectfull: "Mathematics", code: "9MAT.3", room: "4c Blue", teacher: "Teacher One", classid: 8821 },
      { day: 2, periodnum: 9, period: "ECA1", start: "15:00", end: "16:00", subject: "Basketball", subjectfull: "Basketball", code: "ECA.BB", room: "Sports Hall", teacher: "Coach Two", classid: 9922 },
    ]), '"tt-v1"');
  };

  const first = await schoolApi.syncKid(fam.id, kid.id, { force: true, nowMs: sunday, fetchImpl: firstFetch });
  assert.equal(first.ok, true);
  assert.equal(calls, 2);
  const imported = homework.listForFamily(fam.id, { kidId: kid.id });
  assert.equal(imported.length, 1);
  assert.equal(imported.some((item) => item.title === "Old manual homework"), false, "first valid feed snapshot replaces the child's whole homework list");
  assert.equal(imported.some((item) => item.title === "Old imported homework"), false);
  assert.equal(imported[0].source, "school-api");
  assert.equal(imported.some((item) => item.sourceTaskId === "102"), false, "2050 sentinel tasks stay out of dated homework views");
  const projected = actions.listForFamily(fam.id, { sourceType: "homework" });
  assert.equal(projected.length, 1);
  assert.equal(projected[0].title, "Math worksheet", "stale Today projections are replaced with feed homework");

  const events = schoolApi.listTimetableEvents(fam.id);
  assert.equal(events.length, 2);
  assert.equal(events[0].start.slice(0, 10), "2026-09-07");
  assert.equal(events[1].title, "Basketball");
  assert.equal(events[1].start.slice(0, 10), "2026-09-08");

  const manualThrottle = await schoolApi.syncKid(fam.id, kid.id, {
    force: true,
    nowMs: sunday + schoolApi.MIN_MANUAL_SYNC_MS - 1,
    fetchImpl: firstFetch,
  });
  assert.equal(manualThrottle.throttled, true, "manual sync still respects the school's 30-minute floor");
  assert.equal(calls, 2);

  const throttled = await schoolApi.syncKid(fam.id, kid.id, { nowMs: sunday + 60 * 60 * 1000, fetchImpl: firstFetch });
  assert.equal(throttled.throttled, true);
  assert.equal(calls, 2);

  const etags = [];
  const unchangedFetch = async (url, options) => {
    etags.push(options.headers["If-None-Match"]);
    return new Response(null, { status: 304 });
  };
  const unchanged = await schoolApi.syncKid(fam.id, kid.id, {
    nowMs: sunday + schoolApi.SYNC_INTERVAL_MS,
    fetchImpl: unchangedFetch,
  });
  assert.equal(unchanged.ok, true);
  assert.deepEqual(etags.sort(), ['"hw-v1"', '"tt-v1"']);
  assert.equal(homework.listForFamily(fam.id, { kidId: kid.id }).length, 1);
  assert.equal(schoolApi.listTimetableEvents(fam.id).length, 2);
});

test("a successful empty homework snapshot removes stale API homework and its Today projection", async () => {
  const { parent, fam, kid } = makeFamily("reconcile");
  schoolApi.saveConnection(fam.id, parent.id, kid.id, { homeworkUrl: HOMEWORK_URL, timetableUrl: TIMETABLE_URL });
  const now = Date.parse("2026-09-01T00:00:00Z");
  let homeworkRows = [{ id: 201, title: "Science", description: "", link: "", subject: "Science", code: "", setby: "", due: "2026-09-03", duration: 20, selfset: false }];
  const fetchImpl = async (url) => url.pathname === schoolApi.HOMEWORK_PATH
    ? jsonResponse(homeworkPayload(homeworkRows))
    : jsonResponse(timetablePayload([]));

  await schoolApi.syncKid(fam.id, kid.id, { force: true, nowMs: now, fetchImpl });
  assert.equal(homework.listForFamily(fam.id, { kidId: kid.id }).length, 1);
  assert.equal(actions.listForFamily(fam.id, { sourceType: "homework" }).length, 1);
  homeworkRows = [];
  await schoolApi.syncKid(fam.id, kid.id, { force: true, nowMs: now + schoolApi.SYNC_INTERVAL_MS, fetchImpl });
  assert.equal(homework.listForFamily(fam.id, { kidId: kid.id }).length, 0);
  assert.equal(actions.listForFamily(fam.id, { sourceType: "homework" }).length, 0);
});

test("sync clears old extension timetable and activity events without touching family events", async () => {
  const { parent, fam, kid } = makeFamily("calendar-cleanup");
  const sibling = family.addKid(fam.id, parent.id, { name: "Sibling", grade: "7" }).kid;
  const date = "2026-09-07";
  const add = (values) => events.addEvent(fam.id, {
    title: values.title,
    date,
    time: "08:00",
    category: values.category || "school",
    notes: values.notes || "",
    kidId: values.kidId || kid.id,
    createdBy: parent.id,
    sourceType: values.sourceType,
    sourceId: values.sourceId,
  }).event;

  const oldIds = [
    add({ title: "Maths", notes: "Timetable" }).id,
    add({ title: "Imported timetable item — needs review", notes: "Import warning — needs review: time is missing\nRaw values — day: Mon; period: P1" }).id,
    add({ title: "Chess", notes: "Signed up activity" }).id,
    add({ title: "Basketball", notes: "Signed up activity", sourceType: "eca", sourceId: `${kid.id}:834:64894` }).id,
    add({ title: "Imported activity — needs review", notes: "Import warning — needs review: club is missing\nRaw values — title: Club; clubId: (missing); timeslot: Tue" }).id,
  ];
  const manual = add({ title: "Parent meeting", notes: "Added by the family" });
  const siblingLegacy = add({ title: "Sibling maths", notes: "Timetable", kidId: sibling.id });

  schoolApi.saveConnection(fam.id, parent.id, kid.id, { homeworkUrl: HOMEWORK_URL, timetableUrl: TIMETABLE_URL });
  const now = Date.parse("2026-09-07T00:00:00Z");
  const emptyFeeds = async (url) => url.pathname === schoolApi.HOMEWORK_PATH
    ? jsonResponse(homeworkPayload([]))
    : jsonResponse(timetablePayload([]));
  const first = await schoolApi.syncKid(fam.id, kid.id, { force: true, nowMs: now, fetchImpl: emptyFeeds });
  assert.equal(first.ok, true);

  let remaining = events.listEvents(fam.id, { from: date, to: date });
  assert.equal(remaining.some((event) => oldIds.includes(event.id)), false);
  assert.equal(remaining.some((event) => event.id === manual.id), true, "ordinary family-created school events remain");
  assert.equal(remaining.some((event) => event.id === siblingLegacy.id), true, "a connected child cleanup does not touch siblings");

  const resurrected = add({ title: "Old cached timetable", notes: "Timetable" });
  const throttled = await schoolApi.syncKid(fam.id, kid.id, { force: true, nowMs: now + 1, fetchImpl: emptyFeeds });
  assert.equal(throttled.throttled, true);
  remaining = events.listEvents(fam.id, { from: date, to: date });
  assert.equal(remaining.some((event) => event.id === resurrected.id), false, "cleanup runs before the network throttle");
});

test("API reconciliation adopts the matching legacy assignment without losing student progress", () => {
  const { fam, kid } = makeFamily("migration");
  const legacy = homework.addHomework(fam.id, {
    kidId: kid.id,
    title: "Old title",
    subject: "Maths",
    dueDate: "2026-09-10",
    source: "school-portal",
    notes: "My own reminder",
    status: "in_progress",
    checklist: [{ text: "Finish questions", done: true }],
    moodleIdentity: {
      origin: schoolApi.FEED_ORIGIN,
      homeworkViewId: "2",
      userId: "123",
      taskId: "303",
    },
  }).homework;
  homework.updateHomework(fam.id, legacy.id, { status: "in_progress" });

  const result = homework.syncSchoolApi(fam.id, kid.id, [{
    sourceTaskId: "303",
    title: "Updated title",
    subject: "Mathematics",
    dueDate: "2026-09-11",
    sourceDueDate: "2026-09-11",
    description: "Teacher description",
    link: "https://classroom.example/303",
    effortMin: 45,
  }]);

  assert.deepEqual({ created: result.created, updated: result.updated, removed: result.removed }, { created: 0, updated: 1, removed: 0 });
  const [adopted] = homework.listForFamily(fam.id, { kidId: kid.id });
  assert.equal(adopted.id, legacy.id);
  assert.equal(adopted.source, "school-api");
  assert.equal(adopted.moodleIdentity, undefined);
  assert.equal(adopted.title, "Updated title");
  assert.equal(adopted.status, "in_progress");
  assert.equal(adopted.notes, "My own reminder");
  assert.deepEqual(adopted.checklist, [{ text: "Finish questions", done: true }]);
});

test("a 404 pauses polling without exposing the capability", async () => {
  const { parent, fam, kid } = makeFamily("revoked");
  schoolApi.saveConnection(fam.id, parent.id, kid.id, { homeworkUrl: HOMEWORK_URL, timetableUrl: TIMETABLE_URL });
  let calls = 0;
  const notFound = async () => { calls += 1; return new Response(null, { status: 404 }); };
  const result = await schoolApi.syncKid(fam.id, kid.id, { force: true, fetchImpl: notFound });
  assert.equal(result.ok, false);
  assert.equal(result.paused, true);
  assert.equal(result.error.includes(CODE), false);
  await schoolApi.syncKid(fam.id, kid.id, { fetchImpl: notFound });
  assert.equal(calls, 2, "both endpoints are attempted once, then the paused connection stops polling");
});
