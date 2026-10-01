"use strict";
/**
 * The plan gate (docs/SCREEN-TIME-ONLY-PLAN.md §1, §10.1): hub surfaces exist
 * only for families on the "full" plan. Screen Time families get auth, family
 * management, Screen Time, push, billing, account deletion and nothing else.
 *
 * The gate is mounted per prefix with app.use() in server.js, BEFORE the route
 * modules. It is deliberately tolerant: a request with no session, or a user
 * with no family yet, falls through so the route's own guard answers (401/404)
 * exactly as it did before plans existed. Only an identified member of a
 * non-full family is refused:
 *
 *   403 { error: "This is part of the whole Fam ETC.", code: "upgrade_required" }
 */
const UPGRADE_MESSAGE = "This is part of the whole Fam ETC.";

// Every hub prefix. A prefix covers itself and everything beneath it
// (Express app.use semantics), so "/api/family/actions" does NOT cover
// "/api/family" — family management stays open to Screen Time families.
const HUB_PREFIXES = [
  "/api/chat",
  "/api/gifs",
  "/api/hermes",
  "/api/operator",
  "/api/calendar",
  "/api/homework",
  "/api/school",
  "/api/meals",
  "/api/trips",
  "/api/activities",
  "/api/goals",
  "/api/news",
  "/api/notes",
  "/api/wordbank",
  "/api/brainteaser",
  "/api/enrichment",
  "/api/children",
  "/api/daily5",
  "/api/family/actions",
  "/api/family/decisions",
  "/api/my-corner",
  "/api/ai",
  "/api/watch",
  "/api/fams",
  // Not named in the contract's list but plainly hub: PathOdds is the SAT
  // learning integration (mounted by routes/learning.js) and /api/uploads is
  // the timetable/homework photo scaffold.
  "/api/pathodds",
  "/api/uploads",
];

// Prefixes that must stay reachable on every plan. Listed so a test can prove
// every registered route is classified one way or the other.
const OPEN_PREFIXES = [
  "/api/webauthn",
  "/api/auth",
  "/api/kid",
  "/api/family",
  "/api/billing",
  "/api/push",
  "/api/screen-time",
  "/api/me",
  "/api/account",
  "/api/logout",
  "/api/health",
  "/api/track",
  "/api/notify", // push self-test (routes/push.js)
  "/api/admin", // token-guarded analytics + operator-beta admin
  "/api/integrations", // signed server-to-server webhooks
];

function createRequireHub({ currentUser, family, userRole }) {
  function familyOf(req) {
    if (req.family) return req.family;
    const user = req.user || currentUser(req);
    if (!user) return null;
    if (userRole(user) === "kid") return family.familyForKidUser(user);
    return family.familiesForUser(user.id)[0] || null;
  }
  return function requireHub(req, res, next) {
    const fam = familyOf(req);
    if (!fam || family.isFull(fam)) return next();
    return res.status(403).json({ error: UPGRADE_MESSAGE, code: "upgrade_required" });
  };
}

module.exports = { createRequireHub, HUB_PREFIXES, OPEN_PREFIXES, UPGRADE_MESSAGE };
