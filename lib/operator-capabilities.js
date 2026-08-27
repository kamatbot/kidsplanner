"use strict";

/**
 * Short-lived actor capabilities for the Hermes bridge.
 *
 * The family bearer authenticates Hermes as an integration, but it must not
 * erase which human initiated a request. Each inbound @Hermes message is
 * therefore accompanied by a signed actor token. Tools that create a case or
 * request fresh family context require that token instead of trusting an actor
 * id supplied by the model.
 *
 * Tokens are HMAC-bound to the current Hermes connection's token hash, so
 * rotating/revoking the family connection invalidates all outstanding actor
 * capabilities without another revocation list.
 */
const crypto = require("crypto");
const operator = require("./operator");

const VERSION = "opact1";
const DEFAULT_TTL_MS = 15 * 60 * 1000;
const MAX_TTL_MS = 60 * 60 * 1000;

class ActorCapabilityError extends Error {
  constructor(message, code = "ACTOR_CAPABILITY_INVALID") {
    super(message);
    this.name = "ActorCapabilityError";
    this.code = code;
  }
}

function signingKey(connection) {
  const tokenHash = connection && String(connection.tokenHash || "");
  if (!/^[0-9a-f]{64}$/i.test(tokenHash)) {
    throw new ActorCapabilityError("Hermes connection cannot sign actor capabilities.");
  }
  return Buffer.from(tokenHash, "hex");
}

function sign(encodedPayload, connection) {
  return crypto.createHmac("sha256", signingKey(connection)).update(`${VERSION}.${encodedPayload}`).digest("base64url");
}

function issue({ family: fam, connection, actor, messageId, roomId, ttlMs = DEFAULT_TTL_MS } = {}) {
  if (!fam || !fam.id) throw new ActorCapabilityError("Family is required.");
  const validatedActor = operator.validateActor(fam, actor);
  const boundedTtl = Math.max(1000, Math.min(Number(ttlMs) || DEFAULT_TTL_MS, MAX_TTL_MS));
  const issuedAt = Date.now();
  const payload = {
    v: 1,
    familyId: fam.id,
    actor: validatedActor,
    messageId: String(messageId || "").slice(0, 160) || null,
    roomId: String(roomId || "").slice(0, 160) || null,
    iat: issuedAt,
    exp: issuedAt + boundedTtl,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${VERSION}.${encoded}.${sign(encoded, connection)}`;
}

function verify({ family: fam, connection, token, roomId = null } = {}) {
  if (!fam || !fam.id) throw new ActorCapabilityError("Family is required.");
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== VERSION || parts[1].length > 4096 || parts[2].length > 128) {
    throw new ActorCapabilityError("Actor capability is malformed.");
  }
  const expected = Buffer.from(sign(parts[1], connection), "utf8");
  const actual = Buffer.from(parts[2], "utf8");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new ActorCapabilityError("Actor capability signature is invalid.");
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch (error) {
    throw new ActorCapabilityError("Actor capability payload is invalid.");
  }
  if (!payload || payload.v !== 1 || payload.familyId !== fam.id) {
    throw new ActorCapabilityError("Actor capability belongs to another family.");
  }
  const now = Date.now();
  if (!Number.isFinite(payload.iat) || !Number.isFinite(payload.exp) || payload.iat > now + 60000 || payload.exp <= now) {
    throw new ActorCapabilityError("Actor capability has expired.", "ACTOR_CAPABILITY_EXPIRED");
  }
  if (payload.exp - payload.iat > MAX_TTL_MS + 1000) {
    throw new ActorCapabilityError("Actor capability lifetime is invalid.");
  }
  if (roomId && payload.roomId && payload.roomId !== roomId) {
    throw new ActorCapabilityError("Actor capability belongs to another room.");
  }
  const actor = operator.validateActor(fam, payload.actor);
  return {
    actor,
    familyId: fam.id,
    messageId: payload.messageId || null,
    roomId: payload.roomId || null,
    issuedAt: new Date(payload.iat).toISOString(),
    expiresAt: new Date(payload.exp).toISOString(),
  };
}

module.exports = {
  VERSION,
  DEFAULT_TTL_MS,
  MAX_TTL_MS,
  ActorCapabilityError,
  issue,
  verify,
};
