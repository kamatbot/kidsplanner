"use strict";
// HTTP-level coverage for lib/routes/goals.js's kid-self-serve / parent-full-
// control split (see lib/goals.js addGoal/canDelete for the primitives this
// exercises through real requests + signed session cookies, same pattern as
// tests/own-name.test.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");
const Keygrip = require("keygrip");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-test-goals-routes-"));
process.env.PORT = "0";
process.env.SESSION_SECRET = "goals-routes-test-secret-please-change";
process.env.NODE_ENV = "test";

const store = require("../lib/store");
const family = require("../lib/family");
const app = require("../server");

function cookieFor(user) {
  const value = Buffer.from(JSON.stringify({ uid: user.id, authGen: store.sessionGeneration(user) }), "utf8").toString("base64");
  const sig = new Keygrip([process.env.SESSION_SECRET]).sign(`fam_sess=${value}`);
  return `fam_sess=${value}; fam_sess.sig=${sig}`;
}

test("goal creation/deletion: kids self-serve their own goals, parents keep full control", async (t) => {
  const server = app.server;
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const parent = store.createUser("goals-routes-p@example.com", "Parent GR");
  const fam = family.createFamily(parent.id, "Goals Routes Family");
  const { kid } = family.addKid(fam.id, parent.id, { name: "KidGR" });
  const { kid: sibling } = family.addKid(fam.id, parent.id, { name: "SiblingGR" });
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
  const siblingUser = store.findOrCreateKidUser(fam.id, sibling.id, sibling.name);

  const post = (cookie, body) => fetch(`${base}/api/goals`, {
    method: "POST",
    headers: Object.assign({ "Content-Type": "application/json", Origin: base }, cookie ? { Cookie: cookie } : {}),
    body: JSON.stringify(body),
  });
  const del = (cookie, id) => fetch(`${base}/api/goals/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: Object.assign({ Origin: base }, cookie ? { Cookie: cookie } : {}),
  });
  const get = (cookie) => fetch(`${base}/api/goals`, { headers: cookie ? { Cookie: cookie } : {} });

  // No session -> 401 (requireAuth still gates the route).
  const noSession = await post(null, { kidId: kid.id, title: "X", type: "habit", target: 7 });
  assert.equal(noSession.status, 401);

  // A kid's body.kidId is ignored entirely, even pointing at a sibling — the
  // goal always belongs to the kid making the request, tagged createdBy kid.
  const kidPost = await post(cookieFor(kidUser), { kidId: sibling.id, title: "Kid's own goal", type: "habit", target: 7 });
  assert.equal(kidPost.status, 200);
  const kidGoal = (await kidPost.json()).goal;
  assert.equal(kidGoal.kidId, kid.id, "goal belongs to the requesting kid, not the sibling id in the body");
  assert.equal(kidGoal.createdByRole, "kid");

  // A parent still targets any kid via body.kidId, tagged createdBy parent.
  const parentPost = await post(cookieFor(parent), { kidId: kid.id, title: "Parent set goal", type: "habit", target: 7 });
  assert.equal(parentPost.status, 200);
  const parentGoal = (await parentPost.json()).goal;
  assert.equal(parentGoal.kidId, kid.id);
  assert.equal(parentGoal.createdByRole, "parent");

  // Kid GET still lists only their own (both goals above belong to `kid`).
  const kidList = await (await get(cookieFor(kidUser))).json();
  assert.equal(kidList.goals.length, 2);
  assert.ok(kidList.goals.every((g) => g.kidId === kid.id));

  // Kid deletes the goal they created for themselves -> 200.
  const kidDeletesOwn = await del(cookieFor(kidUser), kidGoal.id);
  assert.equal(kidDeletesOwn.status, 200);

  // Kid cannot delete a goal a PARENT set for them, even though it's their
  // own kidId -> 403 (they can still check it in / progress it elsewhere).
  const kidDeletesParentSet = await del(cookieFor(kidUser), parentGoal.id);
  assert.equal(kidDeletesParentSet.status, 403);
  assert.equal((await kidDeletesParentSet.json()).error, "Only a parent can remove a goal they set.");

  // Kid cannot delete a SIBLING's goal either. The route finds it (same
  // family, so it's not a 404 "doesn't exist") but canDelete rejects a
  // goal.kidId that isn't the caller's own -> 403, the same ownership-denial
  // code as the parent-set case above (404 is reserved for goals that don't
  // exist / belong to a different family).
  const siblingPost = await post(cookieFor(siblingUser), { title: "Sibling's own goal", type: "habit", target: 7 });
  assert.equal(siblingPost.status, 200);
  const siblingGoal = (await siblingPost.json()).goal;
  const kidDeletesSibling = await del(cookieFor(kidUser), siblingGoal.id);
  assert.equal(kidDeletesSibling.status, 403);

  // Parent deletes a kid-created goal -> 200 (parents keep full control).
  const parentDeletesKidCreated = await del(cookieFor(parent), siblingGoal.id);
  assert.equal(parentDeletesKidCreated.status, 200);

  // Deleting something that plain doesn't exist is still a 404.
  const missing = await del(cookieFor(parent), "gl_does_not_exist");
  assert.equal(missing.status, 404);
});
