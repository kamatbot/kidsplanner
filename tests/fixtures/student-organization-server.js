"use strict";
// Local native acceptance fixture using the real application routes and stores.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Keygrip = require("keygrip");
const dataRoot = path.resolve(__dirname, "../../.dev-data");
fs.mkdirSync(dataRoot, { recursive: true });
process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(dataRoot, "student-ui-"));
process.env.NODE_ENV = "test";
process.env.PORT = "0";
process.env.SESSION_SECRET = "synthetic-local-student-ui-session-only";
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
process.env.RL_API_MAX = "100000";
process.env.RL_AUTH_MAX = "100000";
// This fixture must never load local provider credentials or production settings.
require("../../lib/loadenv").load = () => {};
const app = require("../../server");
const db = require("../../lib/db");
const store = require("../../lib/store");
const family = require("../../lib/family");
const homework = require("../../lib/homework");
const support = require("../../lib/student-support");
const school = require("../../lib/school-api");
school.stopScheduler();

const parent = store.createUser("student-ui@example.test", "QA Parent");
const fam = family.createFamily(parent.id, "Organizer QA", { plan: "full", timezone: "Asia/Bangkok" });
const kid = family.addKid(fam.id, parent.id, { name: "QA Student", grade: "9" }).kid;
const child = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const tomorrow = new Date(Date.parse(today) + 86400000).toISOString().slice(0, 10);
const assignment = homework.addHomework(fam.id, { kidId: kid.id, title: "QA English worksheet", subject: "English", dueDate: tomorrow,
  notes: "Read the paragraph and answer question one.", checklist: [{ text: "Answer question one", done: false }] }).homework;
db.load().schoolApiFeeds = { [fam.id]: { connections: { [kid.id]: {
  secretBlob: "synthetic-presence-only", lastSyncAt: new Date().toISOString(), lastAttemptAt: new Date().toISOString(),
  paused: false, lastError: null, timetableEvents: [{ uid: "qa-maths", familyId: fam.id, kidId: kid.id, title: "Maths", feedId: "sta-child-timetable",
    start: `${tomorrow}T09:00:00+07:00`, end: `${tomorrow}T10:00:00+07:00`, allDay: false }],
} } } };
// Preserve the source-shaped cached timetable without ever contacting a school.
school.syncFamily = async () => ({ ok: true, results: [], errors: [] });
let snapshot = support.getSnapshot(fam.id, kid.id);
const command = (type, payload) => {
  snapshot = support.command(fam.id, kid.id, { userId: parent.id, parent: true, watch: false }, {
    kidId: kid.id, commandId: crypto.randomUUID(), expectedRevision: snapshot.revision, type, payload,
  });
};
command("configure", { enabled: true,
  materialRules: [{ id: "qa-calculator", title: "QA Calculator", matchKind: "subject", matchValue: "Maths", phase: "evening", location: "home" }],
  routines: [{ id: "qa-dog", title: "QA Walk the dog", weekdays: [1, 2, 3, 4, 5, 6, 7], time: "17:00", steps: [{ id: "qa-leash", title: "Bring leash and bags" }], active: true }],
});
command("homework_plan", { homeworkId: assignment.id, nextStep: "Open the worksheet and answer question one", plannedDate: today, handInMethod: "teacher", submission: "pending" });
function cookie(user) {
  const encoded = Buffer.from(JSON.stringify({ uid: user.id, authGen: store.sessionGeneration(user) })).toString("base64");
  return `fam_sess=${encoded}; fam_sess.sig=${new Keygrip([process.env.SESSION_SECRET]).sign(`fam_sess=${encoded}`)}`;
}
app.get("/__qa/student", (req, res) => res.json({ parentCookie: cookie(parent), childCookie: cookie(child), kidId: kid.id, homeworkId: assignment.id,
  support: support.getSnapshot(fam.id, kid.id), homework: homework.getById(fam.id, assignment.id) }));
app.server.once("listening", () => app.server.close(() => {
  app.server.listen(18465, "127.0.0.1", () => console.log("Student organization UI fixture ready on 127.0.0.1:18465"));
}));
