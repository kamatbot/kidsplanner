"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createDisplayAuth, PAIRING_TTL_MS, MAX_DEVICES_PER_FAMILY } = require("../lib/display-auth");

function fixture(saved) {
  const root = saved || {
    users: {
      parent: { id: "parent", data: { profile: { role: "parent" } } },
      other: { id: "other", data: { profile: { role: "parent" } } },
      kid: { id: "kid", data: { profile: { role: "kid" } } },
    },
    families: { f1: { id: "f1", parentIds: ["parent"], plan: "full" }, f2: { id: "f2", parentIds: ["other"] } },
  };
  const persistence = { mutationGeneration: 0, committedGeneration: 0, lastWriteError: null };
  let milliseconds = Date.parse("2026-10-20T06:00:00Z");
  let fail = false;
  let stall = false;
  let snapshot = JSON.parse(JSON.stringify(root));
  const database = {
    load: () => root,
    persist: () => { persistence.mutationGeneration++; },
    flushSync: () => {
      if (stall) return;
      if (fail) persistence.lastWriteError = "simulated disk failure";
      else {
        snapshot = JSON.parse(JSON.stringify(root));
        persistence.committedGeneration = persistence.mutationGeneration;
        persistence.lastWriteError = null;
      }
    },
    persistenceStatus: () => ({ ...persistence }),
  };
  const familyStore = { getFamily: (id) => root.families[id], isFull: (fam) => fam.plan !== "screen_time" };
  const auth = createDisplayAuth({ database, familyStore, now: () => milliseconds });
  const pair = (settings = {}) => auth.createPairing({ familyId: "f1", createdBy: "parent", ...settings });
  return { root, auth, pair, persistence, advance: (ms) => { milliseconds += ms; },
    failDisk: () => { fail = true; }, stallDisk: () => { stall = true; },
    restart: () => fixture(JSON.parse(JSON.stringify(snapshot))),
  };
}

test("a phone-approved pairing commits one hashed code and issues one separate display credential", () => {
  const f = fixture();
  const result = f.pair({ label: "Kitchen", timeZone: "Asia/Bangkok", showHomework: false });
  assert.equal(result.pairing.code.length, 8);
  assert.equal(JSON.stringify(f.root).includes(result.pairing.code), false);
  assert.equal(f.persistence.committedGeneration, f.persistence.mutationGeneration);
  const connected = f.auth.claimPairing(result.pairing.code, "Portal 10");
  assert.match(connected.token, /^fdp_[A-Za-z0-9_-]{43}$/);
  assert.equal(connected.device.showHomework, false);
  assert.equal(connected.device.showMeals, true);
  assert.equal(connected.device.model, "Portal 10");
  assert.equal(JSON.stringify(f.root).includes(connected.token), false);
  assert.equal(f.auth.claimPairing(result.pairing.code).code, "pairing_invalid");
  assert.equal(f.auth.resolveToken(connected.token).family.id, "f1");
  assert.equal(Object.hasOwn(connected.device, "tokenHash"), false);
  assert.equal(Object.hasOwn(connected.device, "createdBy"), false);
  assert.equal(Object.hasOwn(connected.device, "familyId"), false);
  assert.equal(f.auth.resolveToken("fwt_" + connected.token.slice(4)), null);
});

test("replacement and expired pairing codes cannot be redeemed", () => {
  const f = fixture();
  const first = f.pair();
  const second = f.pair();
  assert.equal(f.auth.claimPairing(first.pairing.code).status, 400);
  f.advance(PAIRING_TTL_MS);
  assert.equal(f.auth.claimPairing(second.pairing.code).status, 400);
});

test("reopening the committed snapshot preserves single use and later revocation", () => {
  const f = fixture();
  const code = f.pair().pairing.code;
  const linked = f.auth.claimPairing(code);
  const reopened = f.restart();
  assert.equal(reopened.auth.claimPairing(code).code, "pairing_invalid");
  assert.equal(reopened.auth.resolveToken(linked.token).family.id, "f1");
  reopened.auth.revokeDevice("f1", linked.device.id);
  assert.equal(reopened.restart().auth.resolveToken(linked.token), null);
});

test("device access follows the approving parent's live family membership and plan", () => {
  const f = fixture();
  const linked = f.auth.claimPairing(f.pair().pairing.code);
  f.root.families.f1.plan = "screen_time";
  assert.equal(f.auth.resolveToken(linked.token).status, 403);
  f.root.families.f1.plan = "full";
  f.root.families.f1.parentIds = [];
  assert.equal(f.auth.resolveToken(linked.token), null);
  assert.equal(f.pair().status, 403);
  f.root.families.f1.parentIds = ["parent"];
  delete f.root.users.parent;
  assert.equal(f.auth.resolveToken(linked.token), null);
});

test("a device cannot be moved to another family by management updates", () => {
  const f = fixture();
  const linked = f.auth.claimPairing(f.pair().pairing.code);
  assert.equal(f.auth.updateDevice("f2", linked.device.id, { label: "Wrong family" }).status, 404);
  assert.equal(f.auth.revokeDevice("f2", linked.device.id).status, 404);
  f.auth.updateDevice("f1", linked.device.id, { familyId: "f2", createdBy: "other", showMeals: false });
  const access = f.auth.resolveToken(linked.token);
  assert.equal(access.device.familyId, "f1");
  assert.equal(access.device.createdBy, "parent");
  assert.equal(access.device.showMeals, false);
});

test("parent revocation commits before success and immediately rejects the bearer", () => {
  const f = fixture();
  const linked = f.auth.claimPairing(f.pair().pairing.code);
  assert.deepEqual(f.auth.revokeDevice("f1", linked.device.id), { ok: true });
  assert.equal(f.persistence.committedGeneration, f.persistence.mutationGeneration);
  assert.equal(f.auth.resolveToken(linked.token), null);
});

test("failed durable writes do not return a pairing code, credential or successful revocation", () => {
  const start = fixture();
  start.failDisk();
  assert.throws(() => start.pair(), (error) => error.status === 503 && error.code === "display_storage_unavailable");
  const claim = fixture();
  const pending = claim.pair();
  claim.failDisk();
  assert.throws(() => claim.auth.claimPairing(pending.pairing.code), (error) => error.status === 503);
  const revoke = fixture();
  const linked = revoke.auth.claimPairing(revoke.pair().pairing.code);
  revoke.failDisk();
  assert.throws(() => revoke.auth.revokeDevice("f1", linked.device.id), (error) => error.status === 503);
  const lagged = fixture();
  lagged.stallDisk();
  assert.throws(() => lagged.pair(), (error) => error.status === 503,
    "an uncommitted generation must fail even when lastWriteError is empty");
});

test("family device capacity and input validation cannot be bypassed by strings or extra fields", () => {
  const f = fixture();
  assert.equal(f.pair({ showHomework: "false" }).status, 400);
  assert.equal(f.pair({ timeZone: "not/a/timezone" }).status, 400);
  assert.equal(f.pair({ timeZone: "+07:00" }).status, 400);
  assert.equal(f.pair({ label: " " }).status, 400);
  assert.equal(f.auth.createPairing({ familyId: "f1", createdBy: "kid" }).status, 403);
  for (let i = 0; i < MAX_DEVICES_PER_FAMILY; i++) {
    const pairing = f.pair({ label: `Display ${i}` });
    assert.ok(f.auth.claimPairing(pairing.pairing.code).token);
  }
  assert.equal(f.pair().code, "display_limit");
});

test("active displays remain manageable after many newer revoked records", () => {
  const f = fixture();
  const linked = f.auth.claimPairing(f.pair({ label: "Still active" }).pairing.code);
  for (let i = 0; i < 110; i++) {
    f.advance(1000);
    const device = f.auth.claimPairing(f.pair({ label: `Retired ${i}` }).pairing.code).device;
    f.auth.revokeDevice("f1", device.id);
  }
  const devices = f.auth.listDevices("f1");
  assert.equal(devices[0].id, linked.device.id);
  assert.ok(devices.length <= 100);
});
