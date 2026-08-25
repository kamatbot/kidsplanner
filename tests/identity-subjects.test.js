"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const identities = require("../lib/identity-subjects");

test("pairwise subject is stable for one client and opaque across clients", () => {
  const secret = "pairwise-test-secret-0123456789abcdef";
  const a = identities.derivePairwiseSubject("subj_123", "pathodds", secret);
  const b = identities.derivePairwiseSubject("subj_123", "pathodds", secret);
  const other = identities.derivePairwiseSubject("subj_123", "another-client", secret);
  assert.equal(a, b);
  assert.notEqual(a, other);
  assert.match(a, /^pws_[A-Za-z0-9_-]+$/);
  assert.equal(a.includes("subj_123"), false);
});

test("parent and kid principals cannot collide", () => {
  assert.equal(identities.principalKey("parent", "f_1", "u_1"), "parent:u_1");
  assert.equal(identities.principalKey("kid", "f_1", "u_1"), "kid:f_1:u_1");
});

test("identity subject creation is idempotent on an isolated root", () => {
  const root = { users: {}, families: {} };
  const first = identities.ensureKidSubject("f_1", "k_1", undefined, { root });
  const second = identities.ensureKidSubject("f_1", "k_1", "u_kid", { root });
  assert.equal(first.id, second.id);
  assert.equal(second.userId, "u_kid");
  assert.equal(Object.keys(root.identitySubjects.byId).length, 1);
});
