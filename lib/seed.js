"use strict";
/**
 * Default per-user data shape for a brand-new Fam ETC account, and the demo
 * seed used to illustrate a fully-populated family on web signup.
 *
 * Fam ETC is a PARENTS' app (see APP-BRIEF.md "Kids' privacy & compliance").
 * There is no direct kid signup: every login-bearing `user` record here is a
 * parent, created via passkey signup. Kid PROFILES are lightweight records
 * (name, grade, color — no email, no login by default) that live under a
 * family, created only by a parent (see lib/family.js). The trial/subscription
 * relationship belongs to the parent account, never a kid profile.
 */

function newUserData(name, email) {
  return {
    _v: 1,
    profile: {
      name: name || "",
      email: email || "",
      role: "parent", // every signed-up `user` is a parent; kids are profiles, not users
      color: null,
    },
    familyId: null, // set once the parent creates or joins a family
    settings: {
      theme: "system", // "system" | "light" | "dark"
      calendarFeeds: [], // subscribed iCal feed ids (see FEATURE_PLAN.md Phase 2)
    },
    referralSeen: 0,
  };
}

// Illustrative sample family shown to brand-new WEB signups (not iOS — native
// onboarding is the first-run flow there). Exit via POST /api/demo/exit wipes
// this and starts real onboarding, mirroring the RetireOdds demo-mode pattern.
function demoUserData(name, email) {
  const base = newUserData(name, email);
  base.demo = true;
  return base;
}

module.exports = { newUserData, demoUserData };
