"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-decisions-"));

const db = require("../lib/db");
const store = require("../lib/store");
const family = require("../lib/family");
const decisions = require("../lib/decisions");
const decisionRoutes = require("../lib/routes/decisions");

function userRole(user) {
  return (user && user.data && user.data.profile && user.data.profile.role) || "parent";
}

function makeFamily(label) {
  const parent = store.createUser(`${label}-parent@example.com`, `Parent ${label}`);
  const parent2 = store.createUser(`${label}-parent2@example.com`, `Parent Two ${label}`);
  const fam = family.createFamily(parent.id, `${label} Family`);
  family.joinFamilyAsParent(fam.inviteCode, parent2.id);
  const { kid } = family.addKid(fam.id, parent.id, { name: `${label} Kid` });
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
  return { fam, parent, parent2, kid, kidUser };
}

function makeResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function buildHarness() {
  const routes = {};
  const register = (method) => (route, ...handlers) => {
    routes[`${method} ${route}`] = handlers;
  };
  const app = {
    get: register("GET"),
    post: register("POST"),
    patch: register("PATCH"),
    delete: register("DELETE"),
  };
  const messages = new Map();
  decisionRoutes(app, {
    decisions,
    chat: {
      getMessage(familyId, messageId) {
        return messages.get(`${familyId}:${messageId}`) || null;
      },
    },
    requireAuth(req, res, next) {
      if (!req.user) return res.status(401).json({ error: "Not authenticated" });
      next();
    },
    requireFamily(req, res, next) {
      const fam = userRole(req.user) === "kid"
        ? family.familyForKidUser(req.user)
        : family.familiesForUser(req.user.id)[0];
      if (!fam) return res.status(404).json({ error: "No family found." });
      req.family = fam;
      next();
    },
  });
  return { routes, messages };
}

function call(handlers, { user, body, query, params } = {}) {
  const req = { user, body: body || {}, query: query || {}, params: params || {} };
  const res = makeResponse();
  let index = 0;
  const next = () => {
    const handler = handlers[index++];
    if (handler) handler(req, res, next);
  };
  next();
  return res;
}

function createDecisionFor(fam, user, labels = ["Yes", "No"], extra = {}) {
  const result = decisions.createDecision(fam.id, {
    question: "Which option?",
    options: labels,
    createdBy: user.id,
    ...extra,
  });
  assert.ok(!result.error, result.error);
  return result.decision;
}

test("decision model: bounded family-scoped shape, source fields, and safe serialization", () => {
  const { fam, parent } = makeFamily("model-shape");
  const created = createDecisionFor(fam, parent, ["  Yes  ", "No"], {
    deadline: "2026-08-20",
    sourceType: "chat",
    sourceId: "m_source_1",
  });

  assert.equal(created.familyId, fam.id);
  assert.equal(created.status, "open");
  assert.equal(created.createdBy, parent.id);
  assert.equal(created.deadline, "2026-08-20");
  assert.deepEqual(created.options.map((option) => option.label), ["Yes", "No"]);
  assert.equal(created.sourceType, "chat");
  assert.equal(created.sourceId, "m_source_1");
  assert.deepEqual(created.responses, []);

  assert.ok(decisions.createDecision(fam.id, { question: "Too few", options: ["Only"], createdBy: parent.id }).error);
  assert.ok(decisions.createDecision(fam.id, { question: "Too many", options: ["1", "2", "3", "4", "5", "6", "7"], createdBy: parent.id }).error);
  assert.ok(decisions.createDecision(fam.id, { question: "No options", options: [], createdBy: parent.id }).error);
  assert.ok(decisions.createDecision(fam.id, { question: "Bad deadline", options: ["A", "B"], deadline: "2026-02-31", createdBy: parent.id }).error);
  assert.ok(decisions.createDecision(fam.id, { question: "Foreign", options: ["A", "B"], createdBy: "u_foreign" }).error);

  created.internalSecret = "must not be public";
  const publicView = decisions.publicDecision(created);
  assert.equal(publicView.internalSecret, undefined);
  publicView.options[0].label = "Changed outside";
  assert.equal(created.options[0].label, "Yes");
  assert.deepEqual(publicView.responses, []);
  assert.deepEqual(publicView.history, []);
});

test("decision model: reordering string options preserves response identity", () => {
  const { fam, parent, parent2 } = makeFamily("model-option-reorder");
  const created = createDecisionFor(fam, parent, ["Home", "Out"]);
  const response = decisions.respondToDecision(fam.id, created.id, created.options[0].id, parent2.id);
  assert.ok(!response.error, response.error);

  const updated = decisions.updateDecision(fam.id, created.id, { options: ["Out", "Home"] });
  assert.ok(!updated.error, updated.error);
  const home = updated.decision.options.find((option) => option.label === "Home");
  assert.equal(updated.decision.responses[0].optionId, home.id);
});

test("decision model: deterministic list ordering and family isolation", () => {
  const first = makeFamily("model-order-one");
  const second = makeFamily("model-order-two");
  const later = createDecisionFor(first.fam, first.parent, ["Later", "No"], { deadline: "2026-09-01" });
  const sooner = createDecisionFor(first.fam, first.parent, ["Sooner", "No"], { deadline: "2026-08-01" });
  const resolved = createDecisionFor(first.fam, first.parent, ["Resolved", "No"], { deadline: "2026-07-01" });
  decisions.resolveDecision(first.fam.id, resolved.id, resolved.options[0].id, first.parent.id);

  const listed = decisions.listDecisions(first.fam.id);
  assert.deepEqual(listed.map((decision) => decision.id), [sooner.id, later.id, resolved.id]);
  assert.equal(decisions.getDecision(second.fam.id, later.id), null);
  assert.deepEqual(decisions.listDecisions(second.fam.id), []);
});

test("decision routes: any family member can create/edit/respond/resolve/reopen, with server-owned identity", () => {
  const { routes } = buildHarness();
  const one = makeFamily("routes-members-one");
  const other = makeFamily("routes-members-two");

  const created = call(routes["POST /api/family/decisions"], {
    user: one.parent,
    body: {
      familyId: other.fam.id,
      createdBy: other.parent.id,
      question: "Where should we eat?",
      options: ["Home", "Out"],
    },
  });
  assert.equal(created.statusCode, 200);
  assert.equal(created.body.decision.createdBy, one.parent.id);
  assert.equal(created.body.decision.familyId, one.fam.id);
  const id = created.body.decision.id;

  const listed = call(routes["GET /api/family/decisions"], { user: one.kidUser });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.headers["Cache-Control"], "no-store");
  assert.deepEqual(listed.body.decisions.map((decision) => decision.id), [id]);

  const edited = call(routes["PATCH /api/family/decisions/:id"], {
    user: one.kidUser,
    params: { id },
    body: { question: "Where should the family eat?", createdBy: other.parent.id, familyId: other.fam.id },
  });
  assert.equal(edited.statusCode, 200);
  assert.equal(edited.body.decision.question, "Where should the family eat?");
  assert.equal(edited.body.decision.createdBy, one.parent.id);

  const options = edited.body.decision.options;
  const firstResponse = call(routes["POST /api/family/decisions/:id/respond"], {
    user: one.kidUser,
    params: { id },
    body: { optionId: options[0].id, userId: other.parent.id },
  });
  assert.equal(firstResponse.statusCode, 200);
  assert.equal(firstResponse.body.decision.responses.length, 1);
  assert.equal(firstResponse.body.decision.responses[0].userId, one.kidUser.id);

  const changedResponse = call(routes["POST /api/family/decisions/:id/respond"], {
    user: one.kidUser,
    params: { id },
    body: { optionId: options[1].id },
  });
  assert.equal(changedResponse.statusCode, 200);
  assert.equal(changedResponse.body.decision.responses.length, 1);
  assert.equal(changedResponse.body.decision.responses[0].optionId, options[1].id);

  const resolved = call(routes["POST /api/family/decisions/:id/resolve"], {
    user: one.parent2,
    params: { id },
    body: { optionId: options[0].id, userId: other.parent.id },
  });
  assert.equal(resolved.statusCode, 200);
  assert.equal(resolved.body.decision.status, "resolved");
  assert.equal(resolved.body.decision.resolvedOptionId, options[0].id);
  assert.equal(resolved.body.decision.resolvedBy, one.parent2.id);

  const foreign = call(routes["GET /api/family/decisions"], { user: other.parent });
  assert.equal(foreign.statusCode, 200);
  assert.deepEqual(foreign.body.decisions, []);
});

test("decision routes: generic create cannot bypass family chat source validation", () => {
  const { routes } = buildHarness();
  const { fam, parent } = makeFamily("routes-source-bypass");
  const result = call(routes["POST /api/family/decisions"], {
    user: parent,
    body: {
      question: "Unsafe source",
      options: ["A", "B"],
      sourceType: "chat",
      sourceId: "m_trip_message",
    },
  });
  assert.equal(result.statusCode, 400);
  assert.deepEqual(decisions.listDecisions(fam.id), []);
});

test("decision transitions: explicit resolution, delete protection, and reopen preserve responses/history", () => {
  const { routes } = buildHarness();
  const { fam, parent, parent2, kidUser } = makeFamily("routes-transitions");
  const created = createDecisionFor(fam, parent, ["Alpha", "Beta"]);
  const beforeResolve = call(routes["POST /api/family/decisions/:id/respond"], {
    user: parent,
    params: { id: created.id },
    body: { optionId: created.options[0].id },
  });
  assert.equal(beforeResolve.statusCode, 200);
  const tie = call(routes["POST /api/family/decisions/:id/respond"], {
    user: parent2,
    params: { id: created.id },
    body: { optionId: created.options[1].id },
  });
  assert.equal(tie.statusCode, 200);

  const invalidResolve = call(routes["POST /api/family/decisions/:id/resolve"], {
    user: parent,
    params: { id: created.id },
    body: { optionId: "opt_not_an_option" },
  });
  assert.equal(invalidResolve.statusCode, 400);
  assert.equal(decisions.getDecision(fam.id, created.id).status, "open");

  const resolved = call(routes["POST /api/family/decisions/:id/resolve"], {
    user: parent,
    params: { id: created.id },
    body: { resolvedOptionId: created.options[1].id },
  });
  assert.equal(resolved.statusCode, 200);
  assert.equal(resolved.body.decision.responses.length, 2);
  assert.equal(resolved.body.decision.history.length, 1);

  const cannotDelete = call(routes["DELETE /api/family/decisions/:id"], {
    user: kidUser,
    params: { id: created.id },
  });
  assert.equal(cannotDelete.statusCode, 400);
  assert.ok(decisions.getDecision(fam.id, created.id));

  const cannotRespond = call(routes["POST /api/family/decisions/:id/respond"], {
    user: kidUser,
    params: { id: created.id },
    body: { optionId: created.options[0].id },
  });
  assert.equal(cannotRespond.statusCode, 400);

  const reopened = call(routes["POST /api/family/decisions/:id/reopen"], {
    user: kidUser,
    params: { id: created.id },
  });
  assert.equal(reopened.statusCode, 200);
  assert.equal(reopened.body.decision.status, "open");
  assert.equal(reopened.body.decision.resolvedOptionId, null);
  assert.equal(reopened.body.decision.resolvedBy, null);
  assert.equal(reopened.body.decision.resolvedAt, null);
  assert.equal(reopened.body.decision.responses.length, 2);
  assert.equal(reopened.body.decision.history.length, 2);

  const deleted = call(routes["DELETE /api/family/decisions/:id"], {
    user: kidUser,
    params: { id: created.id },
  });
  assert.equal(deleted.statusCode, 200);
  assert.equal(decisions.getDecision(fam.id, created.id), null);

  const foreignFamily = makeFamily("routes-transitions-foreign");
  const foreignDecision = createDecisionFor(foreignFamily.fam, foreignFamily.parent);
  const foreign = call(routes["PATCH /api/family/decisions/:id"], {
    user: parent,
    params: { id: foreignDecision.id },
    body: { question: "Should not be reachable" },
  });
  assert.equal(foreign.statusCode, 404);
});

test("chat conversion: one-to-one family text conversion, source independence, and unsafe source rejection", () => {
  const { routes, messages } = buildHarness();
  const one = makeFamily("routes-chat-one");
  const other = makeFamily("routes-chat-two");

  const source = {
    id: "m_question_1",
    familyId: one.fam.id,
    text: "Which movie should we watch?",
    card: null,
    deleted: false,
    media: null,
  };
  messages.set(`${one.fam.id}:${source.id}`, source);
  const first = call(routes["POST /api/family/decisions/from-chat"], {
    user: one.parent,
    body: { sourceType: "chat", sourceId: source.id, options: ["Comedy", "Adventure"] },
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.existing, false);
  assert.equal(first.body.decision.question, source.text);
  assert.equal(first.body.decision.sourceType, "chat");
  assert.equal(first.body.decision.sourceId, source.id);

  source.text = "Edited source text";
  source.deleted = true;
  const retry = call(routes["POST /api/family/decisions/from-chat"], {
    user: one.parent,
    body: { sourceType: "chat", sourceId: source.id, question: "A different question", options: ["A", "B"] },
  });
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.existing, true);
  assert.equal(retry.body.decision.id, first.body.decision.id);
  assert.equal(retry.body.decision.question, "Which movie should we watch?");

  const event = { id: "m_event", familyId: one.fam.id, text: "Event", card: { type: "event" }, deleted: false };
  messages.set(`${one.fam.id}:${event.id}`, event);
  assert.equal(call(routes["POST /api/family/decisions/from-chat"], {
    user: one.parent,
    body: { sourceId: event.id, options: ["A", "B"] },
  }).statusCode, 400);

  const mediaOnly = { id: "m_media", familyId: one.fam.id, text: "", media: { type: "gif" }, deleted: false };
  messages.set(`${one.fam.id}:${mediaOnly.id}`, mediaOnly);
  assert.equal(call(routes["POST /api/family/decisions/from-chat"], {
    user: one.parent,
    body: { sourceId: mediaOnly.id, options: ["A", "B"] },
  }).statusCode, 400);

  const deleted = { id: "m_deleted", familyId: one.fam.id, text: "Old text", deleted: true };
  messages.set(`${one.fam.id}:${deleted.id}`, deleted);
  assert.equal(call(routes["POST /api/family/decisions/from-chat"], {
    user: one.parent,
    body: { sourceId: deleted.id, options: ["A", "B"] },
  }).statusCode, 400);

  const tripRoom = { id: "m_trip", familyId: one.fam.id, text: "Trip question", deleted: false };
  messages.set(`${one.fam.id}:${tripRoom.id}`, tripRoom);
  assert.equal(call(routes["POST /api/family/decisions/from-chat"], {
    user: one.parent,
    body: { roomId: "trip:t_1", sourceId: tripRoom.id, options: ["A", "B"] },
  }).statusCode, 400);

  const foreignMessage = { id: "m_foreign", familyId: other.fam.id, text: "Foreign question", deleted: false };
  messages.set(`${one.fam.id}:${foreignMessage.id}`, foreignMessage);
  assert.equal(call(routes["POST /api/family/decisions/from-chat"], {
    user: one.parent,
    body: { sourceId: foreignMessage.id, options: ["A", "B"] },
  }).statusCode, 400);

  assert.equal(call(routes["POST /api/family/decisions/from-chat"], {
    user: one.parent,
    body: { sourceId: "m_missing", options: ["A", "B"] },
  }).statusCode, 400);
  assert.equal(call(routes["POST /api/family/decisions/from-chat"], {
    user: one.parent,
    body: { sourceId: event.id },
  }).statusCode, 400);
});

test("decision model persists its family index", () => {
  const { fam, parent } = makeFamily("model-persist");
  const decision = createDecisionFor(fam, parent);
  db.flushSync();
  const disk = JSON.parse(fs.readFileSync(db.DB_FILE, "utf8"));
  assert.ok(disk.decisions[fam.id].some((item) => item.id === decision.id));
});
