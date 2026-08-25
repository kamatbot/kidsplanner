"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const oidc = require("../lib/oidc-provider");

test("FamETC signs PathOdds ID tokens with the published Ed25519 key", () => {
  const previousKey = process.env.OIDC_SIGNING_PRIVATE_KEY;
  const previousKid = process.env.OIDC_SIGNING_KEY_ID;
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  process.env.OIDC_SIGNING_PRIVATE_KEY = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  process.env.OIDC_SIGNING_KEY_ID = "test-key";
  try {
    const token = oidc.signIdToken({ iss: "https://www.fametc.com", sub: "pws_test", aud: "pathodds", exp: 9999999999 });
    const [headerPart, payloadPart, signaturePart] = token.split(".");
    const header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8"));
    assert.equal(header.alg, "EdDSA");
    assert.equal(header.kid, "test-key");
    const jwk = oidc.publicJwk();
    const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
    assert.equal(
      crypto.verify(null, Buffer.from(`${headerPart}.${payloadPart}`), publicKey, Buffer.from(signaturePart, "base64url")),
      true
    );
  } finally {
    if (previousKey === undefined) delete process.env.OIDC_SIGNING_PRIVATE_KEY; else process.env.OIDC_SIGNING_PRIVATE_KEY = previousKey;
    if (previousKid === undefined) delete process.env.OIDC_SIGNING_KEY_ID; else process.env.OIDC_SIGNING_KEY_ID = previousKid;
  }
});

test("S256 helper matches the OAuth PKCE definition", () => {
  const verifier = "v".repeat(43);
  assert.equal(oidc.sha256(verifier), crypto.createHash("sha256").update(verifier).digest("base64url"));
});
