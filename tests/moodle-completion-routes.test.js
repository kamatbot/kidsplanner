"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-moodle-completion-routes-"));

const store = require("../lib/store");
const family = require("../lib/family");
const homework = require("../lib/homework");
const schoolRoutes = require("../lib/routes/school");

const ORIGIN = "https://bangkok.learn.nae.school";

function makeFamily(label) {
  const parent = store.createUser(`${label}-${Math.random()}@example.com`, `Parent ${label}`);
  const fam = family.createFamily(parent.id, `${label} Family`);
  const { kid } = family.addKid(fam.id, parent.id, { name: `${label} Kid`, grade: "8" });
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
  return { parent, fam, kid, kidUser };
}

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function execute(handlers, req) {
  const res = response();
  async function run(index) {
    if (index >= handlers.length) return;
    let nextCalled = false;
    await handlers[index](req, res, () => { nextCalled = true; });
    if (nextCalled) await run(index + 1);
  }
  await run(0);
  return res;
}

function registerSchoolRoutes({ mappings = new Map(), baseUrl } = {}) {
  const previousBaseUrl = process.env.SCHOOL_MOODLE_BASE_URL;
  if (baseUrl === undefined) delete process.env.SCHOOL_MOODLE_BASE_URL;
  else process.env.SCHOOL_MOODLE_BASE_URL = baseUrl;

  const routes = new Map();
  const app = {
    get(route, ...handlers) { routes.set(`GET ${route}`, handlers); },
    post(route, ...handlers) { routes.set(`POST ${route}`, handlers); },
  };
  const requireAuth = (req, res, next) => req.user
    ? next()
    : res.status(401).json({ error: "Not authenticated" });
  const requireParent = (req, res, next) => {
    if (req.watchAuth) return res.status(403).json({ error: "This action requires an interactive Fam ETC session." });
    if (req.user && req.user.data && req.user.data.profile && req.user.data.profile.role === "kid") {
      return res.status(403).json({ error: "Parents only." });
    }
    next();
  };
  const requireFamily = (req, res, next) => {
    if (!req.authFamily) return res.status(404).json({ error: "No family found." });
    req.family = req.authFamily;
    next();
  };
  schoolRoutes(app, {
    schoolAccount: {
      getMoodleUserId(familyId, kidId) { return mappings.get(`${familyId}:${kidId}`) || null; },
    },
    moodleClient: {},
    family,
    homework,
    actions: { projectMoodleAssignments() {} },
    requireAuth,
    requireParent,
    requireFamily,
    authLimiter: (req, res, next) => next(),
  });

  if (previousBaseUrl === undefined) delete process.env.SCHOOL_MOODLE_BASE_URL;
  else process.env.SCHOOL_MOODLE_BASE_URL = previousBaseUrl;
  return { routes, requireAuth, requireParent, requireFamily };
}

function routeRequest(user, authFamily, body = {}) {
  return { user, authFamily, body, query: {}, params: {} };
}

function identity(taskId, userId = "14197") {
  return { origin: ORIGIN, homeworkViewId: "2", userId, taskId: String(taskId) };
}

function addExact(fam, kid, taskId, userId = "14197") {
  return homework.addHomework(fam.id, {
    kidId: kid.id,
    title: `Task ${taskId}`,
    dueDate: "2026-09-20",
    source: "school-portal",
    moodleIdentity: identity(taskId, userId),
  }).homework;
}

test("completion routes register the parent-only family middleware chain and return no-store family data", async () => {
  const first = makeFamily("routes-first");
  const second = makeFamily("routes-second");
  const firstItem = addExact(first.fam, first.kid, "1000001");
  const secondItem = addExact(second.fam, second.kid, "1000002", "24298");
  const firstRequest = homework.updateHomework(first.fam.id, firstItem.id, { status: "done" }).completionSync.requestId;
  const secondRequest = homework.updateHomework(second.fam.id, secondItem.id, { status: "done" }).completionSync.requestId;
  const { routes, requireAuth, requireParent, requireFamily } = registerSchoolRoutes();
  const pendingHandlers = routes.get("GET /api/school/completions/pending");
  const claimHandlers = routes.get("POST /api/school/completions/claim");
  const ackHandlers = routes.get("POST /api/school/completions/ack");

  assert.deepEqual(pendingHandlers.slice(0, 3), [requireAuth, requireParent, requireFamily]);
  assert.deepEqual(claimHandlers.slice(0, 3), [requireAuth, requireParent, requireFamily]);
  assert.deepEqual(ackHandlers.slice(0, 3), [requireAuth, requireParent, requireFamily]);

  const pending = await execute(pendingHandlers, routeRequest(first.parent, first.fam));
  assert.equal(pending.statusCode, 200);
  assert.equal(pending.headers["Cache-Control"], "no-store");
  assert.deepEqual(pending.body.completions.map((item) => item.requestId), [firstRequest]);
  assert.equal(pending.body.hasMore, false);

  const foreignAck = await execute(ackHandlers, routeRequest(first.parent, first.fam, { requestIds: [secondRequest] }));
  assert.deepEqual(foreignAck.body, { acknowledgedRequestIds: [] });
  assert.equal(foreignAck.headers["Cache-Control"], "no-store");
  assert.equal(homework.listPendingMoodleCompletions(second.fam.id).completions[0].requestId, secondRequest);

  const kid = await execute(pendingHandlers, routeRequest(first.kidUser, first.fam));
  assert.equal(kid.statusCode, 403);
  assert.equal((await execute(ackHandlers, routeRequest(first.kidUser, first.fam, { requestIds: [firstRequest] }))).statusCode, 403);
  assert.equal((await execute(claimHandlers, routeRequest(first.kidUser, first.fam, { requestId: firstRequest }))).statusCode, 403);
  const watch = routeRequest(first.parent, first.fam);
  watch.watchAuth = { familyId: first.fam.id };
  assert.equal((await execute(ackHandlers, watch)).statusCode, 403);
  assert.equal((await execute(claimHandlers, watch)).statusCode, 403);
  assert.equal((await execute(pendingHandlers, watch)).statusCode, 403);
});

test("claim route validates one exact request and atomically rejects a generation cancelled after listing", async () => {
  const { parent, fam, kid } = makeFamily("claim-gate");
  const item = addExact(fam, kid, "1500001");
  const requestId = homework.updateHomework(fam.id, item.id, { status: "done" }).completionSync.requestId;
  const { routes } = registerSchoolRoutes();
  const pending = routes.get("GET /api/school/completions/pending");
  const claim = routes.get("POST /api/school/completions/claim");

  const snapshot = await execute(pending, routeRequest(parent, fam));
  assert.equal(snapshot.body.completions[0].requestId, requestId);
  homework.updateHomework(fam.id, item.id, { status: "todo" });

  const rejected = await execute(claim, routeRequest(parent, fam, { requestId }));
  assert.equal(rejected.statusCode, 200);
  assert.equal(rejected.headers["Cache-Control"], "no-store");
  assert.deepEqual(rejected.body, { completion: null });

  for (const body of [{}, { requestId: "bad" }, { requestId, familyId: fam.id }]) {
    const invalid = await execute(claim, routeRequest(parent, fam, body));
    assert.equal(invalid.statusCode, 400);
    assert.deepEqual(invalid.body, { error: "Invalid completion claim." });
  }
});

test("pending route caps serialized work and reports another batch", async () => {
  const { parent, fam, kid } = makeFamily("route-bound");
  for (let index = 0; index < 51; index++) {
    const item = addExact(fam, kid, String(1600000 + index));
    homework.updateHomework(fam.id, item.id, { status: "done" });
  }
  const pending = registerSchoolRoutes().routes.get("GET /api/school/completions/pending");

  const response = await execute(pending, routeRequest(parent, fam));
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.completions.length, 50);
  assert.equal(response.body.hasMore, true);
});

test("ack route rejects malformed, duplicate, oversized, and non-exact bodies before model acknowledgement", async () => {
  const { parent, fam } = makeFamily("validation");
  const ack = registerSchoolRoutes().routes.get("POST /api/school/completions/ack");
  const invalidBodies = [
    {},
    null,
    { requestIds: "mcr_one" },
    { requestIds: ["not-a-request"] },
    { requestIds: [`mcr_${"a".repeat(125)}`] },
    { requestIds: ["mcr_same", "mcr_same"] },
    { requestIds: ["mcr_one"], familyId: fam.id },
    { requestIds: Array.from({ length: 101 }, (_, index) => `mcr_${index}`) },
  ];

  for (const body of invalidBodies) {
    const result = await execute(ack, routeRequest(parent, fam, body));
    assert.equal(result.statusCode, 400);
    assert.equal(result.headers["Cache-Control"], "no-store");
    assert.deepEqual(result.body, { error: "Invalid completion acknowledgement." });
  }
  const empty = await execute(ack, routeRequest(parent, fam, { requestIds: [] }));
  assert.equal(empty.statusCode, 200);
  assert.deepEqual(empty.body, { acknowledgedRequestIds: [] });
});

test("ack route acknowledges only valid current family generations and is idempotent", async () => {
  const first = makeFamily("ack-current");
  const second = makeFamily("ack-foreign");
  const validItem = addExact(first.fam, first.kid, "2000001");
  const cancelledItem = addExact(first.fam, first.kid, "2000002");
  const staleItem = addExact(first.fam, first.kid, "2000003");
  const foreignItem = addExact(second.fam, second.kid, "2000004", "24298");
  const validId = homework.updateHomework(first.fam.id, validItem.id, { status: "done" }).completionSync.requestId;
  const cancelledId = homework.updateHomework(first.fam.id, cancelledItem.id, { status: "done" }).completionSync.requestId;
  homework.updateHomework(first.fam.id, cancelledItem.id, { status: "todo" });
  const staleId = homework.updateHomework(first.fam.id, staleItem.id, { status: "done" }).completionSync.requestId;
  staleItem.moodleIdentity = identity("2999999");
  const foreignId = homework.updateHomework(second.fam.id, foreignItem.id, { status: "done" }).completionSync.requestId;
  const routes = registerSchoolRoutes().routes;
  const claim = routes.get("POST /api/school/completions/claim");
  const ack = routes.get("POST /api/school/completions/ack");
  const claimed = await execute(claim, routeRequest(first.parent, first.fam, { requestId: validId }));
  assert.equal(claimed.body.completion.requestId, validId);

  const result = await execute(ack, routeRequest(first.parent, first.fam, {
    requestIds: [foreignId, cancelledId, staleId, validId],
  }));
  assert.deepEqual(result.body, { acknowledgedRequestIds: [validId] });
  const repeated = await execute(ack, routeRequest(first.parent, first.fam, { requestIds: [validId] }));
  assert.deepEqual(repeated.body, { acknowledgedRequestIds: [validId] });
});

test("stored confirm uses server mapping for exact identity and keeps distinct same-title Moodle tasks", async () => {
  const { parent, fam, kid } = makeFamily("exact-import");
  const mappings = new Map([[`${fam.id}:${kid.id}`, "14197"]]);
  const confirm = registerSchoolRoutes({ mappings, baseUrl: `${ORIGIN}/moodle/` }).routes.get("POST /api/school/import/confirm");
  const common = { title: "Same worksheet", subject: "Math", dueDate: "2026-09-22", completed: false, userId: "99999" };
  const body = {
    kidId: kid.id,
    homework: [
      Object.assign({}, common, { moodleTaskId: "3000001" }),
      Object.assign({}, common, { moodleTaskId: "3000002" }),
      { title: "Already complete", dueDate: "2026-09-22", completed: true, moodleTaskId: "3000003" },
    ],
    timetable: [{ title: "Math", date: "2026-09-22" }],
  };

  const first = await execute(confirm, routeRequest(parent, fam, body));
  const repeated = await execute(confirm, routeRequest(parent, fam, body));
  assert.deepEqual(first.body, { ok: true, homeworkCreated: 2, homeworkSkipped: 1, timetable: body.timetable });
  assert.equal(repeated.body.homeworkCreated, 0);
  assert.equal(repeated.body.homeworkSkipped, 3);
  const imported = homework.listForFamily(fam.id, { kidId: kid.id });
  assert.equal(imported.length, 2);
  assert.deepEqual(imported.map((item) => item.moodleIdentity.taskId).sort(), ["3000001", "3000002"]);
  assert.ok(imported.every((item) => item.moodleIdentity.userId === "14197"));
  assert.deepEqual(imported.map((item) => item.sourceUid).sort(), ["moodle:2:14197:3000001", "moodle:2:14197:3000002"]);
});

test("stored confirm safely adopts one done legacy row once and avoids ambiguous legacy adoption", async () => {
  const unique = makeFamily("unique-legacy");
  const mappings = new Map([[`${unique.fam.id}:${unique.kid.id}`, "14197"]]);
  const confirm = registerSchoolRoutes({ mappings }).routes.get("POST /api/school/import/confirm");
  const legacy = homework.addHomework(unique.fam.id, {
    kidId: unique.kid.id,
    title: "Legacy assignment",
    dueDate: "2026-09-23",
    source: "school-portal",
  }).homework;
  homework.updateHomework(unique.fam.id, legacy.id, { status: "done" });
  const body = { kidId: unique.kid.id, homework: [{ title: legacy.title, dueDate: legacy.dueDate, moodleTaskId: "4000001" }] };

  const adopted = await execute(confirm, routeRequest(unique.parent, unique.fam, body));
  await execute(confirm, routeRequest(unique.parent, unique.fam, body));
  assert.equal(adopted.body.homeworkCreated, 0);
  assert.deepEqual(legacy.moodleIdentity, identity("4000001"));
  assert.equal(homework.listPendingMoodleCompletions(unique.fam.id).completions.length, 1);

  const ambiguous = makeFamily("ambiguous-legacy");
  mappings.set(`${ambiguous.fam.id}:${ambiguous.kid.id}`, "24298");
  for (let index = 0; index < 2; index++) {
    homework.addHomework(ambiguous.fam.id, {
      kidId: ambiguous.kid.id,
      title: "Repeated title",
      dueDate: "2026-09-24",
      source: "school-portal",
    });
  }
  const ambiguousBody = { kidId: ambiguous.kid.id, homework: [{ title: "Repeated title", dueDate: "2026-09-24", moodleTaskId: "4000002" }] };
  const created = await execute(confirm, routeRequest(ambiguous.parent, ambiguous.fam, ambiguousBody));
  assert.equal(created.body.homeworkCreated, 1);
  const rows = homework.listForFamily(ambiguous.fam.id, { kidId: ambiguous.kid.id });
  assert.equal(rows.length, 3);
  assert.equal(rows.filter((item) => !item.moodleIdentity).length, 2);
  assert.deepEqual(rows.find((item) => item.moodleIdentity).moodleIdentity, identity("4000002", "24298"));
});

test("missing, invalid, unmapped, and non-canonical identities keep legacy title/date imports", async () => {
  const mapped = makeFamily("identity-free");
  const mappings = new Map([[`${mapped.fam.id}:${mapped.kid.id}`, "14197"]]);
  const confirm = registerSchoolRoutes({ mappings }).routes.get("POST /api/school/import/confirm");
  const body = {
    kidId: mapped.kid.id,
    homework: [
      { title: "Missing id", dueDate: "2026-09-25" },
      { title: "Invalid id", dueDate: "2026-09-26", moodleTaskId: "task-5" },
    ],
  };
  await execute(confirm, routeRequest(mapped.parent, mapped.fam, body));
  const repeated = await execute(confirm, routeRequest(mapped.parent, mapped.fam, body));
  assert.equal(repeated.body.homeworkCreated, 0);
  assert.ok(homework.listForFamily(mapped.fam.id).every((item) => !item.moodleIdentity && item.sourceUid === null));

  const unmapped = makeFamily("unmapped");
  const unmappedConfirm = registerSchoolRoutes({ mappings }).routes.get("POST /api/school/import/confirm");
  await execute(unmappedConfirm, routeRequest(unmapped.parent, unmapped.fam, {
    kidId: unmapped.kid.id,
    homework: [{ title: "Unmapped", dueDate: "2026-09-27", moodleTaskId: "5000001", userId: "99999" }],
  }));
  assert.equal(homework.listForFamily(unmapped.fam.id)[0].moodleIdentity, undefined);

  const invalidMapping = makeFamily("invalid-mapping");
  mappings.set(`${invalidMapping.fam.id}:${invalidMapping.kid.id}`, "kid-14197");
  const invalidMappingConfirm = registerSchoolRoutes({ mappings }).routes.get("POST /api/school/import/confirm");
  await execute(invalidMappingConfirm, routeRequest(invalidMapping.parent, invalidMapping.fam, {
    kidId: invalidMapping.kid.id,
    homework: [{ title: "Invalid mapping", dueDate: "2026-09-27", moodleTaskId: "5000003" }],
  }));
  assert.equal(homework.listForFamily(invalidMapping.fam.id)[0].moodleIdentity, undefined);

  const otherOrigin = makeFamily("other-origin");
  mappings.set(`${otherOrigin.fam.id}:${otherOrigin.kid.id}`, "14197");
  const otherConfirm = registerSchoolRoutes({ mappings, baseUrl: "https://moodle.example.test/path" }).routes.get("POST /api/school/import/confirm");
  await execute(otherConfirm, routeRequest(otherOrigin.parent, otherOrigin.fam, {
    kidId: otherOrigin.kid.id,
    homework: [{ title: "Other origin", dueDate: "2026-09-28", moodleTaskId: "5000002" }],
  }));
  assert.equal(homework.listForFamily(otherOrigin.fam.id)[0].moodleIdentity, undefined);
});
