"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");

const root = path.join(__dirname, "..");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fam-command-brief-"));
process.env.FAM_DATA_DIR = tmpDir;
process.env.DATA_ENCRYPTION_KEY = "a".repeat(64);
test.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

test("phaseForClock classifies morning, afternoon, and evening accurately", () => {
  const { phaseForClock } = require("../lib/command-brief");
  assert.equal(phaseForClock("07:15"), "morning");
  assert.equal(phaseForClock("11:29"), "morning");
  assert.equal(phaseForClock("11:30"), "afternoon");
  assert.equal(phaseForClock("17:59"), "afternoon");
  assert.equal(phaseForClock("18:00"), "evening");
  assert.equal(phaseForClock("21:30"), "evening");
});

test("buildCommandBrief synthesizes parent insights/signals and strictly isolates kid sessions", () => {
  const db = require("../lib/db");
  db.dropCache();
  const store = require("../lib/store");
  const family = require("../lib/family");
  const events = require("../lib/events");
  const homework = require("../lib/homework");
  const decisions = require("../lib/decisions");
  const { buildCommandBrief } = require("../lib/command-brief");

  const parent = store.createUser("Ananya");
  const created = family.createFamily(parent.id, "Kamat Family", { timezone: "Asia/Bangkok", plan: "full" });
  const famId = created.id;
  const maya = family.addKid(famId, parent.id, { name: "Maya", grade: "6th Grade", color: "#0EA58C" }).kid;
  const leo = family.addKid(famId, parent.id, { name: "Leo", grade: "3rd Grade", color: "#D99A00" }).kid;
  const fam = family.getFamily(famId);

  // Fixed afternoon Bangkok time: 2026-11-21 15:15 Asia/Bangkok = 2026-11-21T08:15:00Z
  const now = new Date("2026-11-21T08:15:00.000Z");
  const today = "2026-11-21";
  const tomorrow = "2026-11-22";

  // Overlapping events + unassigned driver for Maya
  events.addEvent(famId, {
    title: "Football Practice",
    date: today,
    time: "16:00",
    endTime: "17:00",
    kidId: maya.id,
    createdBy: parent.id,
  });
  events.addEvent(famId, {
    title: "Piano Lesson",
    date: today,
    time: "16:15",
    endTime: "17:00",
    kidId: leo.id,
    driverMemberId: parent.id,
    createdBy: parent.id,
  });

  // Homework for both kids
  homework.addHomework(famId, {
    title: "Fractions Worksheet",
    subject: "Maths",
    dueDate: tomorrow,
    effortMin: 45,
    kidId: maya.id,
  });
  homework.addHomework(famId, {
    title: "Secret Sibling Task",
    subject: "Reading",
    dueDate: tomorrow,
    effortMin: 20,
    kidId: leo.id,
  });

  // Open family decision
  decisions.createDecision(famId, {
    question: "Friday movie night?",
    options: ["Inside Out 2", "Paddington"],
    createdBy: parent.id,
  });

  // 1. Parent view
  const parentBrief = buildCommandBrief({ family: fam, user: parent, isParent: true, kidId: null, now });
  assert.equal(parentBrief.role, "parent");
  assert.equal(parentBrief.phase, "afternoon");
  assert.ok(parentBrief.insights.some((i) => i.id === "insight-logistics"), "parent gets logistics/driver insight");
  assert.ok(parentBrief.insights.some((i) => i.id === "insight-dinner"), "parent gets evening load + unplanned dinner insight");
  assert.ok(parentBrief.unifiedSignals.some((s) => s.kind === "driver_gap"), "driver gap surfaced in unified signals");
  assert.ok(parentBrief.unifiedSignals.some((s) => s.kind === "decision"), "open family decision surfaced in unified signals");
  assert.equal(parentBrief.runsheet.today.length, 2);
  assert.equal(parentBrief.weekWorkload.length, 7);
  assert.equal(parentBrief.home.openDecisionCount, 1);

  // 2. Kid view (Maya) — must be strictly scoped!
  const kidUser = { id: "kid-user-maya", role: "kid", name: "Maya", data: { kid: { familyId: famId, kidId: maya.id } } };
  const kidBrief = buildCommandBrief({ family: fam, user: kidUser, isParent: false, kidId: maya.id, now });
  assert.equal(kidBrief.role, "kid");
  assert.equal(kidBrief.home.dinner, null, "kid brief never exposes parent-only dinner management");
  assert.deepEqual(kidBrief.screenTimeKids, {}, "kid brief never exposes parent Screen Time overview");
  assert.equal(kidBrief.pendingKidAccessCount, 0, "kid brief never exposes parent access requests");
  assert.ok(kidBrief.kidFocus && kidBrief.kidFocus.title === "Fractions Worksheet", "kid gets own next homework focus");
  assert.ok(!kidBrief.runsheet.today.some((e) => e.kidId === leo.id), "kid runsheet never includes sibling events");
  assert.ok(!kidBrief.unifiedSignals.some((s) => s.kind === "driver_gap" || s.kind === "screen_time_alert" || s.kind === "screen_time_request" || s.kind === "hermes_nudge"), "kid never receives parent-only unified signals");
  assert.ok(kidBrief.unifiedSignals.some((s) => s.kind === "decision"), "kid still sees shared family decisions");
});

test("Web Family OS shell & assets keep fam_ keys and zero legacy prefixes", () => {
  const html = fs.readFileSync(path.join(root, "public/beta.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "public/css/family-os.css"), "utf8");
  const js = fs.readFileSync(path.join(root, "public/js/family-os.js"), "utf8");

  assert.match(html, /href="\/css\/family-os\.css"/);
  assert.match(html, /src="\/js\/family-os\.js"/);
  assert.match(html, /id="tab-home"/);
  assert.match(html, /id="fos-insights-strip"/);
  assert.match(html, /id="fos-unified-inbox"/);
  assert.match(html, /id="fos-runsheet"/);
  assert.match(html, /id="fos-schedule-radar"/);
  assert.match(css, /\.fos-command-columns/);
  assert.match(js, /fam_table_talk_open/);
  assert.match(js, /fam_runsheet_mode/);
  for (const content of [css, js]) {
    assert.doesNotMatch(content, /retireodds|RO_|np_sess|kp_/i);
  }
});

test("GET /api/command/brief enforces auth, hub-plan gate, and serves live Family OS web assets", async (t) => {
  process.env.PORT = "0";
  process.env.SESSION_SECRET = "command-brief-http-test-secret-012345";
  process.env.NODE_ENV = "test";
  process.env.FAM_PROACTIVE = "off";

  const Keygrip = require("keygrip");
  const store = require("../lib/store");
  const family = require("../lib/family");
  const events = require("../lib/events");
  const decisions = require("../lib/decisions");
  const app = require("../server");
  const server = app.server;
  t.after(() => server.close());

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const sign = (session) => {
    const value = Buffer.from(JSON.stringify(session), "utf8").toString("base64");
    const sig = new Keygrip([process.env.SESSION_SECRET]).sign(`fam_sess=${value}`);
    return `fam_sess=${value}; fam_sess.sig=${sig}`;
  };

  // Unauthenticated check + static Family OS assets
  const unauth = await fetch(`${base}/api/command/brief`);
  assert.equal(unauth.status, 401);
  assert.equal((await fetch(`${base}/css/family-os.css`)).status, 200);
  assert.equal((await fetch(`${base}/js/family-os.js`)).status, 200);

  // Full-plan parent
  const parent = store.createUser("parent-brief@example.com", "Ananya");
  const fam = family.createFamily(parent.id, "Kamat Hub", { timezone: "Asia/Bangkok", plan: "full" });
  const maya = family.addKid(fam.id, parent.id, { name: "Maya", grade: "6th Grade", color: "#0EA58C" }).kid;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
  events.addEvent(fam.id, { title: "Football Practice", date: today, time: "16:00", endTime: "17:00", kidId: maya.id, createdBy: parent.id });
  decisions.createDecision(fam.id, { question: "Dinner tonight?", options: ["Thai", "Pasta"], createdBy: parent.id });

  const parentCookie = sign({ uid: parent.id, authGen: store.sessionGeneration(parent) });
  // Production "/" keeps the current shell; the redesign is served at /beta.
  const prodHtml = await (await fetch(`${base}/`, { headers: { Cookie: parentCookie } })).text();
  assert.doesNotMatch(prodHtml, /family-os\.js/);
  assert.match(prodHtml, /\/js\/app\.js/);
  assert.equal((await fetch(`${base}/beta`, { redirect: "manual" })).status, 302);
  const indexRes = await fetch(`${base}/beta`, { headers: { Cookie: parentCookie } });
  assert.equal(indexRes.status, 200);
  const indexHtml = await indexRes.text();
  assert.match(indexHtml, /family-os\.css/);
  assert.match(indexHtml, /family-os\.js/);
  assert.match(indexHtml, /id="tab-home"/);
  assert.match(indexHtml, /\/js\/app-beta\.js/);

  const briefRes = await fetch(`${base}/api/command/brief`, { headers: { Cookie: parentCookie } });
  assert.equal(briefRes.status, 200);
  const brief = await briefRes.json();
  assert.equal(brief.role, "parent");
  assert.ok(brief.runsheet.today.length >= 1);
  assert.ok(brief.unifiedSignals.some((s) => s.kind === "driver_gap"));
  assert.ok(brief.unifiedSignals.some((s) => s.kind === "decision"));
  assert.equal(brief.weekWorkload.length, 7);

  // Screen-Time-only family must be refused by hub-gate
  const stParent = store.createUser("st-brief@example.com", "ST Parent");
  family.createFamily(stParent.id, "ST Family", { plan: "screen_time" });
  const stCookie = sign({ uid: stParent.id, authGen: store.sessionGeneration(stParent) });
  const stRes = await fetch(`${base}/api/command/brief`, { headers: { Cookie: stCookie } });
  assert.equal(stRes.status, 403);
  const stBody = await stRes.json();
  assert.equal(stBody.code, "upgrade_required");
});
