"use strict";
/**
 * Apple App Store Review Test Account.
 *
 * App Store Review Guideline 2.1 requires a fully-functional demo account with
 * valid credentials so Apple reviewers and automated testers can inspect all
 * user-facing surfaces.
 *
 * This module seeds and maintains a dedicated test family account:
 *   - Parent User: Alex Morgan (apple-review@fametc.com)
 *   - Grandfathered billing (unlocked access, no paywalls)
 *   - Family: The Morgan Family
 *   - 2 Kids: Leo (Grade 7) and Maya (Grade 4)
 *   - Calendar events: Upcoming school, sports, arts, and family events
 *   - Chat: Active family thread with messages between parent and kids
 *   - Homework: Science and Reading assignments
 *   - Backup codes: Primary code "FAMET-REV24" (reusable, not consumed upon login)
 */
const db = require("./db");
const store = require("./store");
const family = require("./family");
const events = require("./events");
const chat = require("./chat");
const backupCodes = require("./backup-codes");
const identities = require("./identity-subjects");
const homework = require("./homework");

const REVIEWER_USER_ID = "u_apple_review";
const REVIEWER_EMAIL = "apple-review@fametc.com";
const REVIEWER_NAME = "Alex Morgan";
const REVIEWER_SALT = Buffer.from("fametc-apple-reviewer-salt-2026", "utf8").toString("hex");

const REVIEWER_CODES = [
  "FAMET-REV24",
  "REV24-FAMET",
  "HAPPY-FAM24",
  "STARS-FAM24",
  "GREAT-FAM24",
  "SHARP-FAM24",
  "READY-FAM24",
  "SUPER-FAM24",
  "BRAVE-FAM24",
  "SUNNY-FAM24",
];

function ensureReviewerAccount() {
  const root = db.load();
  if (!root.users) root.users = {};

  // 1. Ensure User
  let user = store.getUser(REVIEWER_USER_ID);
  if (!user) {
    user = store.createUser(REVIEWER_EMAIL, REVIEWER_NAME, {
      id: REVIEWER_USER_ID,
      grandfathered: true,
    });
  }

  user.email = REVIEWER_EMAIL;
  user.isAppReviewer = true;
  user.billing = {
    status: "grandfathered",
    since: "2026-01-01T00:00:00.000Z",
    source: "app-review",
  };
  if (!user.data) user.data = {};
  if (!user.data.profile) user.data.profile = {};
  user.data.profile.name = REVIEWER_NAME;
  user.data.profile.email = REVIEWER_EMAIL;
  user.data.profile.role = "parent";

  // 2. Ensure Backup Codes (FAMET-REV24 is primary)
  const hashedCodes = REVIEWER_CODES.map((c) => ({
    hash: backupCodes.hashCode(c, REVIEWER_SALT),
    used: false,
  }));

  user.backupCodes = {
    salt: REVIEWER_SALT,
    codes: hashedCodes,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  store.saveUser(user);

  // 3. Ensure Family
  let fams = family.familiesForUser(user.id);
  let fam = fams[0];
  if (!fam) {
    fam = family.createFamily(user.id, "The Morgan Family");
  } else if (!fam.parentIds.includes(user.id)) {
    fam.parentIds.push(user.id);
  }
  user.data.familyId = fam.id;
  store.saveUser(user);
  identities.ensureParentSubject(user.id, fam.id);

  // 4. Ensure 2 Kids
  if (!fam.kids) fam.kids = [];
  if (fam.kids.length < 2) {
    fam.kids = [];
    const k1 = family.addKid(fam.id, user.id, {
      name: "Leo",
      grade: "7",
      color: "#6C63FF",
    });
    const k2 = family.addKid(fam.id, user.id, {
      name: "Maya",
      grade: "4",
      color: "#4ECDC4",
    });
    if (k1.kid) identities.ensureKidSubject(fam.id, k1.kid.id);
    if (k2.kid) identities.ensureKidSubject(fam.id, k2.kid.id);
  }
  fam = family.getFamily(fam.id);
  const [kid1, kid2] = fam.kids;

  // 5. Ensure Calendar Events
  const existingEvents = events.listEvents(fam.id, {});
  if (!existingEvents || existingEvents.length === 0) {
    events.addEvent(fam.id, {
      title: "Soccer Practice",
      date: "2026-09-09",
      time: "16:30",
      endTime: "17:45",
      category: "sports",
      notes: "Field 3 — bring cleats and water bottle",
      kidId: kid1.id,
      createdBy: user.id,
    });
    events.addEvent(fam.id, {
      title: "Piano Lesson",
      date: "2026-09-10",
      time: "15:30",
      endTime: "16:30",
      category: "arts",
      notes: "Review recital pieces 2 & 3",
      kidId: kid2.id,
      createdBy: user.id,
    });
    events.addEvent(fam.id, {
      title: "Science Museum Field Trip",
      date: "2026-09-11",
      time: "09:00",
      endTime: "14:00",
      category: "school",
      notes: "Pack bagged lunch and wear school hoodie",
      kidId: kid1.id,
      createdBy: user.id,
    });
    events.addEvent(fam.id, {
      title: "Family Farmers Market & Picnic",
      date: "2026-09-12",
      time: "11:00",
      endTime: "13:00",
      category: "social",
      notes: "Meeting grandparents at Central Park picnic tables",
      kidId: null,
      createdBy: user.id,
    });
    events.addEvent(fam.id, {
      title: "Math Olympiad Prep",
      date: "2026-09-14",
      time: "16:00",
      endTime: "17:00",
      category: "school",
      notes: "Bring calculator and notebook",
      kidId: kid2.id,
      createdBy: user.id,
    });
  }

  // 6. Ensure Chat Messages
  const existingMsgs = chat.listMessages(fam.id, { limit: 10 });
  if (!existingMsgs || existingMsgs.length === 0) {
    chat.sendMessage(fam.id, {
      senderType: "parent",
      senderId: user.id,
      text: "Good morning! Remember Leo has soccer practice at 4:30 PM today ⚽️",
    });
    chat.sendMessage(fam.id, {
      senderType: "kid",
      senderId: kid1.id,
      postedByUserId: user.id,
      text: "Got my cleats packed! Can we get fruit smoothies after practice?",
    });
    chat.sendMessage(fam.id, {
      senderType: "parent",
      senderId: user.id,
      text: "Sounds great! Maya, don't forget your music sheet for piano tomorrow 🎵",
    });
    chat.sendMessage(fam.id, {
      senderType: "kid",
      senderId: kid2.id,
      postedByUserId: user.id,
      text: "Already inside my backpack! 👍",
    });
    chat.sendMessage(fam.id, {
      senderType: "parent",
      senderId: user.id,
      text: "Awesome teamwork everyone. See you this afternoon!",
    });
  }

  // 7. Ensure Homework items
  try {
    const existingHw = homework.list(fam.id, {});
    if (!existingHw || existingHw.length === 0) {
      homework.add(fam.id, {
        kidId: kid1.id,
        title: "Science: Solar System Diagram",
        subject: "Science",
        dueDate: "2026-09-11",
        status: "in_progress",
        effortMin: 45,
        source: "manual",
      });
      homework.add(fam.id, {
        kidId: kid2.id,
        title: "Reading: Chapters 3-5 of Charlotte's Web",
        subject: "English",
        dueDate: "2026-09-10",
        status: "todo",
        effortMin: 30,
        source: "manual",
      });
    }
  } catch (e) {
    /* non-fatal */
  }

  db.flushSync();

  return {
    userId: user.id,
    email: user.email,
    familyId: fam.id,
    familyName: fam.name,
    kids: fam.kids.map((k) => ({ id: k.id, name: k.name, grade: k.grade, color: k.color })),
    primaryBackupCode: REVIEWER_CODES[0],
    backupCodes: REVIEWER_CODES,
  };
}

module.exports = {
  REVIEWER_USER_ID,
  REVIEWER_EMAIL,
  REVIEWER_NAME,
  REVIEWER_CODES,
  ensureReviewerAccount,
};
