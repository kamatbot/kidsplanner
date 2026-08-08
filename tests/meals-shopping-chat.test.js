"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-meals-shopping-chat-"));

const store = require("../lib/store");
const family = require("../lib/family");
const meals = require("../lib/meals");
const mealsRoutes = require("../lib/routes/meals");

const sourceMessages = new Map();
const chat = {
  getMessage(_scope, id) { return sourceMessages.get(id) || null; },
};

function userRole(user) {
  return user && user.data && user.data.kid ? "kid" : "parent";
}

function buildHarness() {
  const routes = {};
  const register = (method) => (pathName, ...handlers) => { routes[`${method} ${pathName}`] = { method, handlers }; };
  const app = { get: register("GET"), post: register("POST"), patch: register("PATCH"), delete: register("DELETE") };
  mealsRoutes(app, {
    meals, store, family, chat, userRole,
    requireAuth: (req, res, next) => (req.user ? next() : res.status(401).json({ error: "Not authenticated" })),
    requireParent: (req, res, next) => (userRole(req.user) === "kid" ? res.status(403).json({ error: "Parents only." }) : next()),
    requireFamily: (req, res, next) => {
      if (userRole(req.user) === "kid") {
        const fam = family.familyForKidUser(req.user);
        if (!fam) return res.status(404).json({ error: "No family found for this account." });
        req.family = fam;
        return next();
      }
      const fams = family.familiesForUser(req.user.id);
      if (!fams.length) return res.status(404).json({ error: "No family yet — create or join one first." });
      req.family = fams[0];
      next();
    },
  });
  return routes;
}

function call(route, { body, params, user } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      body: null,
      set() { return this; },
      status(code) { this.statusCode = code; return this; },
      json(bodyValue) { this.body = bodyValue; resolve(this); },
      end() { this.body = null; resolve(this); },
    };
    const req = { method: route.method, body: body || {}, params: params || {}, query: {}, user: user || null };
    let index = 0;
    const next = () => { index++; if (index < route.handlers.length) route.handlers[index](req, res, next); };
    route.handlers[0](req, res, next);
  });
}

let familyCounter = 0;
function freshFamily(label) {
  familyCounter++;
  const parent = store.createUser(`${label}${familyCounter}@example.com`, `Parent ${label}${familyCounter}`);
  const fam = family.createFamily(parent.id, `${label} Family`);
  const { kid } = family.addKid(fam.id, parent.id, { name: `Kid ${label}${familyCounter}` });
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
  return { parent, fam, kid, kidUser };
}

function putMessage(message) {
  sourceMessages.set(message.id, Object.assign({
    senderType: "parent",
    senderId: "parent",
    postedByUserId: "parent",
    roomId: "family",
    deleted: false,
    card: null,
    media: null,
  }, message));
}

test("chat shopping conversion is family-scoped, editable at confirmation, and idempotent", async () => {
  const routes = buildHarness();
  const { parent, fam, kid, kidUser } = freshFamily("SC");
  const source = { id: "m_chat_source_1", familyId: fam.id, text: "Please get mangoes" };
  putMessage(source);

  const first = await call(routes["POST /api/meals/shopping"], {
    user: parent,
    body: {
      text: "Mangoes",
      category: "produce",
      assigneeUserId: kid.id,
      sourceType: "chat",
      sourceId: source.id,
    },
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.existing, false);
  assert.equal(first.body.item.text, "Mangoes");
  assert.equal(first.body.item.sourceType, "chat");
  assert.equal(first.body.item.sourceId, source.id);
  assert.equal(first.body.item.assigneeUserId, kid.id);

  const retry = await call(routes["POST /api/meals/shopping"], {
    user: kidUser,
    body: { text: "Changed on retry", category: "other", sourceType: "chat", sourceId: source.id },
  });
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.existing, true);
  assert.equal(retry.body.item.id, first.body.item.id);
  assert.equal(retry.body.item.text, "Mangoes");
  assert.equal(retry.body.item.category, "produce");
  assert.equal(retry.body.item.addedBy, parent.id);

  // Editing the source after conversion does not mutate the object.
  sourceMessages.get(source.id).text = "Please get pears instead";
  assert.equal(meals.getShoppingItem(fam.id, first.body.item.id).text, "Mangoes");

  // Deleting/scrubbing the source also leaves the object available.
  sourceMessages.get(source.id).deleted = true;
  sourceMessages.get(source.id).text = "";
  const itemAfterDelete = meals.getShoppingItem(fam.id, first.body.item.id);
  assert.equal(itemAfterDelete.text, "Mangoes");
  assert.equal(itemAfterDelete.sourceId, source.id);
  const afterDelete = await call(routes["GET /api/meals/shopping"], { user: kidUser });
  assert.equal(afterDelete.statusCode, 200, JSON.stringify(afterDelete.body));
  assert.equal(afterDelete.body.shopping[0].text, "Mangoes");
});

test("kids can convert family messages and invalid/deleted/event/trip/foreign sources reject", async () => {
  const routes = buildHarness();
  const first = freshFamily("SV");
  const second = freshFamily("SVX");

  const kidSource = { id: "m_kid_source_1", familyId: first.fam.id, senderType: "kid", senderId: first.kid.id, text: "Buy yoghurt" };
  putMessage(kidSource);
  const kidAdd = await call(routes["POST /api/meals/shopping"], {
    user: first.kidUser,
    body: { text: "Yoghurt", category: "dairy", sourceType: "chat", sourceId: kidSource.id },
  });
  assert.equal(kidAdd.statusCode, 200);
  assert.equal(kidAdd.body.item.addedBy, first.kidUser.id);

  const invalid = [
    { id: "m_deleted_1", familyId: first.fam.id, text: "Milk", deleted: true },
    { id: "m_media_only_1", familyId: first.fam.id, text: "", media: { type: "gif" } },
    { id: "m_event_card_1", familyId: first.fam.id, text: "School event", card: { type: "event", id: "ev_1" } },
    { id: "m_trip_1", familyId: "trip:t1", roomId: "trip:t1", text: "Trip snacks" },
    { id: "m_foreign_1", familyId: second.fam.id, text: "Foreign family" },
  ];
  for (const message of invalid) {
    putMessage(message);
    const response = await call(routes["POST /api/meals/shopping"], {
      user: first.parent,
      body: { text: "Should reject", sourceType: "chat", sourceId: message.id },
    });
    assert.equal(response.statusCode, 400, message.id);
  }

  for (const body of [
    { sourceType: "calendar", sourceId: "m_bad_type" },
    { sourceType: "chat", sourceId: "not-a-message" },
    { sourceType: "chat" },
    { sourceId: "m_missing_type" },
  ]) {
    const response = await call(routes["POST /api/meals/shopping"], {
      user: first.parent,
      body: Object.assign({ text: "Should reject" }, body),
    });
    assert.equal(response.statusCode, 400);
  }
});
