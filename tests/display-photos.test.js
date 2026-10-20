"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-display-photos-"));
process.env.CHAT_ATTACHMENTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-display-photos-att-"));

const store = require("../lib/store");
const family = require("../lib/family");
const chatAttachments = require("../lib/chat-attachments");
const displayPhotos = require("../lib/display-photos");
const { deleteParentAccount } = require("../lib/account-deletion");
const mount = require("../lib/routes/display");

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
const photoFile = (buffer = JPEG, mimetype = "image/jpeg") => ({ buffer, mimetype });

function seed(label) {
  const parent = store.createUser(`${label}@example.test`, "Kate");
  const fam = family.createFamily(parent.id, `${label} family`, { plan: "full" });
  return { parent, fam };
}

test("photos are stored per family, newest first, and survive the unclaimed-upload sweep", async () => {
  const { parent, fam } = seed("photos-a");
  const first = await displayPhotos.add(fam.id, parent.id, photoFile());
  const second = await displayPhotos.add(fam.id, parent.id, photoFile());
  assert.match(first.photo.id, chatAttachments.ID_RE);
  assert.deepEqual(displayPhotos.list(fam.id).map((p) => p.id), [second.photo.id, first.photo.id]);
  assert.equal(chatAttachments.sweepUnclaimed(Date.now() + 2 * chatAttachments.UNCLAIMED_TTL_MS), 0);
  const read = await displayPhotos.read(fam.id, first.photo.id);
  assert.deepEqual(read.buffer, JPEG);
  assert.equal(read.meta.mimeType, "image/jpeg");
});

test("a family can only read its own photos", async () => {
  const a = seed("photos-own-a");
  const b = seed("photos-own-b");
  const { photo } = await displayPhotos.add(a.fam.id, a.parent.id, photoFile());
  assert.equal(await displayPhotos.read(b.fam.id, photo.id), null);
  assert.equal(await displayPhotos.read(a.fam.id, "a_" + "0".repeat(36)), null);
  assert.equal(await displayPhotos.read(a.fam.id, "../etc/passwd"), null);
});

test("uploads are validated by type, content and the per-family limit", async () => {
  const { parent, fam } = seed("photos-limit");
  assert.equal((await displayPhotos.add(fam.id, parent.id, photoFile(JPEG, "image/gif"))).status, 400);
  assert.equal((await displayPhotos.add(fam.id, parent.id, photoFile(Buffer.from("not an image"), "image/jpeg"))).status, 400);
  assert.equal((await displayPhotos.add(fam.id, parent.id, null)).status, 400);
  for (let i = 0; i < displayPhotos.MAX_PHOTOS; i++) assert.ok((await displayPhotos.add(fam.id, parent.id, photoFile())).photo);
  const over = await displayPhotos.add(fam.id, parent.id, photoFile());
  assert.equal(over.status, 409);
  assert.equal(over.code, "photo_limit");
  assert.equal(displayPhotos.list(fam.id).length, displayPhotos.MAX_PHOTOS);
});

test("removing a photo deletes its bytes", async () => {
  const { parent, fam } = seed("photos-remove");
  const { photo } = await displayPhotos.add(fam.id, parent.id, photoFile());
  assert.deepEqual(displayPhotos.remove(fam.id, photo.id), { ok: true });
  assert.equal(chatAttachments.readMeta(photo.id), null);
  assert.equal(displayPhotos.remove(fam.id, photo.id).status, 404);
});

test("deleting the last parent removes the family's display photos", async () => {
  const { parent, fam } = seed("photos-delete");
  const { photo } = await displayPhotos.add(fam.id, parent.id, photoFile());
  deleteParentAccount(parent.id);
  assert.equal(chatAttachments.readMeta(photo.id), null);
  assert.deepEqual(displayPhotos.list(fam.id), []);
});

function routeFixture() {
  const routes = new Map();
  const app = {};
  for (const method of ["get", "post", "patch", "delete"]) {
    app[method] = (route, ...handlers) => routes.set(`${method.toUpperCase()} ${route}`, handlers);
  }
  const parent = { id: "parent-a", data: { profile: { role: "parent" } } };
  const fam = { id: "family-a", parentIds: [parent.id], plan: "full" };
  const token = "fdp_" + "b".repeat(43);
  const calls = [];
  const photoId = "a_" + "1".repeat(36);
  mount(app, {
    CANONICAL_HOST: "https://www.fametc.com",
    currentUser: (req) => req.cookieUser || null,
    family: { familiesForUser: () => [fam], isFull: () => true },
    authLimiter: (req, res, next) => next(), apiLimiter: (req, res, next) => next(),
    displayAuth: { resolveToken: (value) => value === token ? { family: fam, device: { id: "d", familyId: fam.id } } : null },
    displayContext: { buildContext: () => ({ schemaVersion: 1 }) },
    displayPhotos: {
      MAX_BYTES: 1024, MAX_PHOTOS: 12,
      list: (familyId) => { calls.push(["list", familyId]); return [{ id: photoId, createdAt: "2026-10-20T00:00:00.000Z" }]; },
      remove: (familyId, id) => { calls.push(["remove", familyId, id]); return { ok: true }; },
      read: async (familyId, id) => { calls.push(["read", familyId, id]); return id === photoId ? { meta: { mimeType: "image/jpeg" }, buffer: JPEG } : null; },
      add: async () => ({ photo: { id: photoId } }),
    },
  });
  async function request(method, route, { user = null, headers = {}, params = {} } = {}) {
    const normalized = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    const req = { cookieUser: user, body: {}, params, get: (key) => normalized[key.toLowerCase()] };
    let done;
    const finished = new Promise((resolve) => { done = resolve; });
    const res = { statusCode: 200, headers: {}, headersSent: false,
      set(k, v) { this.headers[k.toLowerCase()] = v; return this; },
      status(v) { this.statusCode = v; return this; },
      json(v) { this.body = v; this.headersSent = true; done(); return this; },
      send(v) { this.body = v; this.headersSent = true; done(); return this; },
    };
    const handlers = routes.get(`${method} ${route}`);
    assert.ok(handlers, `${method} ${route} must be mounted`);
    let index = 0;
    const next = () => handlers[index++](req, res, next);
    next();
    await finished;
    assert.equal(res.headers["cache-control"], "no-store");
    return res;
  }
  return { request, parent, token, photoId, calls };
}

test("photo routes: parents manage with a signed session, displays read with their own credential", async () => {
  const f = routeFixture();
  assert.equal((await f.request("GET", "/api/displays/photos")).statusCode, 401);
  assert.equal((await f.request("GET", "/api/displays/photos", { user: { id: "kid", data: { profile: { role: "kid" } } } })).statusCode, 403);
  assert.equal((await f.request("DELETE", "/api/displays/photos/:id", { user: f.parent, params: { id: f.photoId }, headers: { Origin: "https://evil.example" } })).statusCode, 403);
  assert.equal(f.calls.length, 0);

  const listed = await f.request("GET", "/api/displays/photos", { user: f.parent });
  assert.equal(listed.body.photos.length, 1);
  const removed = await f.request("DELETE", "/api/displays/photos/:id", { user: f.parent, params: { id: f.photoId }, headers: { Origin: "https://www.fametc.com" } });
  assert.deepEqual(removed.body, { ok: true });

  assert.equal((await f.request("GET", "/api/display/photos/:id", { params: { id: f.photoId } })).statusCode, 401);
  const image = await f.request("GET", "/api/display/photos/:id", { params: { id: f.photoId }, headers: { Authorization: `Bearer ${f.token}` } });
  assert.equal(image.headers["content-type"], "image/jpeg");
  assert.equal(image.headers["x-content-type-options"], "nosniff");
  assert.deepEqual(image.body, JPEG);
  const missing = await f.request("GET", "/api/display/photos/:id", { params: { id: "a_" + "2".repeat(36) }, headers: { Authorization: `Bearer ${f.token}` } });
  assert.equal(missing.statusCode, 404);

  const context = await f.request("GET", "/api/display/context", { headers: { Authorization: `Bearer ${f.token}` } });
  assert.deepEqual(context.body.photos, [{ id: f.photoId, createdAt: "2026-10-20T00:00:00.000Z" }]);
  assert.ok(f.calls.some(([action, familyId]) => action === "read" && familyId === "family-a"));
});
