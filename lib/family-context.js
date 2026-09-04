"use strict";

/**
 * Canonical Family Context v1 for Hermes Family Operator.
 *
 * FamETC remains authoritative for family-operations facts. Odds Core may map
 * FamETC's immutable subj_* identities and legacy family id into its shared
 * identity graph, but this module never exposes or invents an Odds Core
 * canonical person id. That keeps the Operator compatible with the
 * feature/oddscore-m2-identity-foundation migration contract.
 */
const family = require("./family");
const store = require("./store");
const identitySubjects = require("./identity-subjects");
const events = require("./events");
const schoolFeeds = require("./school-feeds");
const schoolApi = require("./school-api");
const homework = require("./homework");
const actions = require("./actions");
const trips = require("./trips");
const meals = require("./meals");

const SCHEMA_VERSION = "fametc.family-context.v1";
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PAST_DAYS = 14;
const DEFAULT_FUTURE_DAYS = 92;
const MAX_WINDOW_DAYS = 120;

const SECTION_TTL_MS = Object.freeze({
  identities: 24 * 60 * 60 * 1000,
  preferences: 24 * 60 * 60 * 1000,
  calendar: 15 * 60 * 1000,
  homework: 15 * 60 * 1000,
  actions: 15 * 60 * 1000,
  meals: 30 * 60 * 1000,
  trips: 30 * 60 * 1000,
  room: 15 * 60 * 1000,
});

const SECTION_SENSITIVITY = Object.freeze({
  identities: "identity",
  preferences: "personal-preferences",
  calendar: "family-operations-summary",
  homework: "family-operations-summary",
  actions: "family-operations-summary",
  meals: "family-operations-summary",
  trips: "family-operations-summary",
  room: "conversation-metadata",
});

const SECTION_ALIASES = Object.freeze({ members: "identities" });
const ALL_SECTIONS = Object.freeze(["identities", "preferences", "calendar", "homework", "actions", "meals", "trips", "room"]);
const ALL_SECTION_SET = new Set(ALL_SECTIONS);

const PURPOSE_POLICIES = Object.freeze({
  "family-assistance": Object.freeze({
    defaultSections: ["identities", "preferences", "calendar", "homework", "actions", "meals", "trips", "room"],
    allowedSections: ["identities", "preferences", "calendar", "homework", "actions", "meals", "trips", "room"],
  }),
  "operator-case": Object.freeze({
    defaultSections: ["identities", "preferences", "calendar", "homework", "actions", "meals", "trips", "room"],
    allowedSections: ["identities", "preferences", "calendar", "homework", "actions", "meals", "trips", "room"],
  }),
  "trip-planning": Object.freeze({
    defaultSections: ["identities", "calendar", "trips", "room"],
    allowedSections: ["identities", "preferences", "calendar", "trips", "room"],
  }),
  "calendar-management": Object.freeze({
    defaultSections: ["identities", "calendar", "room"],
    allowedSections: ["identities", "calendar", "room"],
  }),
  "action-management": Object.freeze({
    defaultSections: ["identities", "actions", "room"],
    allowedSections: ["identities", "actions", "room"],
  }),
  "research-only": Object.freeze({
    defaultSections: ["identities", "preferences", "room"],
    allowedSections: ["identities", "preferences", "calendar", "homework", "actions", "meals", "trips", "room"],
  }),
  "meal-planning": Object.freeze({
    defaultSections: ["identities", "preferences", "calendar", "meals", "room"],
    allowedSections: ["identities", "preferences", "calendar", "meals", "room"],
  }),
  benchmark: Object.freeze({
    defaultSections: ["identities", "preferences", "calendar", "homework", "actions", "meals", "trips", "room"],
    allowedSections: ["identities", "preferences", "calendar", "homework", "actions", "meals", "trips", "room"],
  }),
});

class FamilyContextError extends Error {
  constructor(message, code = "FAMILY_CONTEXT_INVALID") {
    super(message);
    this.name = "FamilyContextError";
    this.code = code;
  }
}

function cleanText(value, max = 300) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function isoAt(ms) {
  return new Date(ms).toISOString();
}

function parseYmd(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const d = new Date(0);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (d.getUTCFullYear() !== Number(match[1]) || d.getUTCMonth() !== Number(match[2]) - 1 || d.getUTCDate() !== Number(match[3])) return null;
  return d;
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function rangeFor(options = {}) {
  const today = parseYmd(ymd(new Date()));
  const from = options.from ? parseYmd(options.from) : new Date(today.getTime() - DEFAULT_PAST_DAYS * DAY_MS);
  const to = options.to ? parseYmd(options.to) : new Date(today.getTime() + DEFAULT_FUTURE_DAYS * DAY_MS);
  if (!from || !to || from > to || (to.getTime() - from.getTime()) / DAY_MS > MAX_WINDOW_DAYS) {
    throw new FamilyContextError(`Context range must be valid YYYY-MM-DD dates spanning no more than ${MAX_WINDOW_DAYS} days.`);
  }
  return { from: ymd(from), to: ymd(to) };
}

function normalizePurpose(value) {
  const purpose = cleanText(value || "family-assistance", 160) || "family-assistance";
  return { purpose, policy: PURPOSE_POLICIES[purpose] || { defaultSections: ["identities", "room"], allowedSections: ["identities", "room"] } };
}

function normalizeSection(raw) {
  const value = cleanText(raw, 40);
  const section = SECTION_ALIASES[value] || value;
  if (!ALL_SECTION_SET.has(section)) throw new FamilyContextError(`Unsupported context section: ${value || "(empty)"}.`);
  return section;
}

function disclosureFor(purposeValue, requestedSections, actor) {
  const { purpose, policy } = normalizePurpose(purposeValue);
  const requested = requestedSections == null
    ? policy.defaultSections.slice()
    : Array.isArray(requestedSections)
      ? requestedSections.map(normalizeSection)
      : (() => { throw new FamilyContextError("Context sections must be an array."); })();
  const uniqueRequested = [...new Set(requested)];
  const actorCeiling = actor && actor.type === "kid"
    ? new Set(["identities", "calendar", "homework", "actions", "meals", "trips", "room"])
    : new Set(ALL_SECTIONS);
  const policyAllowed = new Set(policy.allowedSections);
  const granted = uniqueRequested.filter((section) => policyAllowed.has(section) && actorCeiling.has(section));
  const denied = uniqueRequested.filter((section) => !granted.includes(section));
  return { purpose, requested: uniqueRequested, granted, denied };
}

function profileName(userId) {
  const user = userId ? store.getUser(userId) : null;
  return cleanText(user && user.data && user.data.profile && user.data.profile.name, 80) || null;
}

function subjectRecordForParent(fam, userId) {
  const subject = identitySubjects.ensureParentSubject(userId, fam.id);
  return {
    role: "parent",
    subject: subject.id,
    displayName: profileName(userId),
    lifecycle: subject.status || "active",
  };
}

function subjectRecordForKid(fam, kid) {
  const subject = identitySubjects.ensureKidSubject(fam.id, kid.id, undefined);
  return {
    role: "kid",
    subject: subject.id,
    kidId: kid.id,
    displayName: cleanText(kid.name, 80) || null,
    grade: cleanText(kid.grade, 20) || null,
    lifecycle: subject.status || "active",
  };
}

function actorIdentity(fam, actor, parentRecords, kidRecords) {
  if (!actor) return null;
  if (actor.type === "kid") {
    return kidRecords.find((entry) => entry.kidId === actor.kidId || entry.kidId === actor.principalId) || null;
  }
  if (actor.type === "parent") {
    const subject = identitySubjects.ensureParentSubject(actor.userId || actor.principalId, fam.id);
    return parentRecords.find((entry) => entry.subject === subject.id) || null;
  }
  return null;
}

function sectionMeta(section, generatedMs, source, confidence = 1) {
  const ttlMs = SECTION_TTL_MS[section];
  return {
    provenance: {
      productId: "fametc",
      source,
      authority: "fametc",
      observedAt: isoAt(generatedMs),
    },
    confidence,
    sensitivity: SECTION_SENSITIVITY[section],
    ttlMs,
    expiresAt: isoAt(generatedMs + ttlMs),
  };
}

function itemMeta(section, generatedMs, source, sourceRef, confidence = 1) {
  const base = sectionMeta(section, generatedMs, source, confidence);
  base.provenance.sourceRef = sourceRef || null;
  return base;
}

function identityIndex(parentRecords, kidRecords) {
  const byKidId = new Map(kidRecords.map((entry) => [entry.kidId, entry.subject]));
  return { byKidId };
}

function dateIntersects(startDate, endDate, range) {
  return !!startDate && startDate <= range.to && (endDate || startDate) >= range.from;
}

function calendarSection(fam, range, generatedMs, ids) {
  const manual = events.listEvents(fam.id, range).map((event) => ({
    id: event.id,
    title: cleanText(event.title),
    date: event.date,
    endDate: event.endDate || null,
    time: event.time || null,
    endTime: event.endTime || null,
    category: event.category || "other",
    kidId: event.kidId || null,
    kidSubject: event.kidId ? (ids.byKidId.get(event.kidId) || null) : null,
    sourceType: event.sourceType || event.source || "manual",
    ...itemMeta("calendar", generatedMs, "fametc.calendar", event.id),
  }));
  const feedStore = schoolFeeds.famStore(fam.id);
  const school = schoolFeeds.collectFromCache(feedStore, generatedMs)
    .filter((event) => {
      const start = cleanText(event.start, 30).slice(0, 10);
      const end = cleanText(event.end, 30).slice(0, 10);
      return dateIntersects(start, end, range);
    })
    .map((event) => ({
      id: `${event.subscriptionId || "school"}:${event.uid || "event"}`,
      title: cleanText(event.title),
      date: cleanText(event.start, 30).slice(0, 10),
      endDate: cleanText(event.end, 30).slice(0, 10) || null,
      time: event.allDay ? null : (cleanText(event.start, 30).slice(11, 16) || null),
      endTime: event.allDay ? null : (cleanText(event.end, 30).slice(11, 16) || null),
      category: event.type === "deadline" ? "school-deadline" : "school",
      kidId: event.kidId || null,
      kidSubject: event.kidId ? (ids.byKidId.get(event.kidId) || null) : null,
      location: cleanText(event.location, 200) || null,
      sourceType: "school",
      ...itemMeta("calendar", generatedMs, "fametc.school-calendar", `${event.subscriptionId || "school"}:${event.uid || "event"}`, 0.95),
    }));
  const childTimetable = schoolApi.listTimetableEvents(fam.id)
    .filter((event) => dateIntersects(cleanText(event.start, 30).slice(0, 10), cleanText(event.end, 30).slice(0, 10), range))
    .map((event) => ({
      id: `${event.subscriptionId || "school-api"}:${event.uid || "lesson"}`,
      title: cleanText(event.title),
      date: cleanText(event.start, 30).slice(0, 10),
      endDate: cleanText(event.end, 30).slice(0, 10) || null,
      time: cleanText(event.start, 30).slice(11, 16) || null,
      endTime: cleanText(event.end, 30).slice(11, 16) || null,
      category: "school",
      kidId: event.kidId || null,
      kidSubject: event.kidId ? (ids.byKidId.get(event.kidId) || null) : null,
      location: cleanText(event.location, 200) || null,
      sourceType: "school-api",
      ...itemMeta("calendar", generatedMs, "fametc.school-api", `${event.subscriptionId || "school-api"}:${event.uid || "lesson"}`, 0.98),
    }));
  const items = manual.concat(school, childTimetable)
    .sort((a, b) => `${a.date || ""} ${a.time || ""}`.localeCompare(`${b.date || ""} ${b.time || ""}`))
    .slice(0, 250);
  return { ...sectionMeta("calendar", generatedMs, "fametc.calendar+school"), range, items };
}

function homeworkSection(fam, range, generatedMs, ids) {
  const items = homework.listForFamily(fam.id)
    .filter((item) => item.status !== "done" ? (!item.dueDate || item.dueDate <= range.to) : dateIntersects(item.dueDate, item.dueDate, range))
    .slice(0, 200)
    .map((item) => ({
      id: item.id,
      kidId: item.kidId || null,
      kidSubject: item.kidId ? (ids.byKidId.get(item.kidId) || null) : null,
      title: cleanText(item.title),
      subject: cleanText(item.subject, 100) || null,
      dueDate: item.dueDate || null,
      dueTime: item.dueTime || null,
      status: item.status || null,
      effortMin: item.effortMin || null,
      sourceType: item.source || "manual",
      ...itemMeta("homework", generatedMs, "fametc.homework", item.id),
    }));
  return { ...sectionMeta("homework", generatedMs, "fametc.homework"), range, items };
}
function actionSection(fam, range, generatedMs, ids) {
  const items = actions.listForFamily(fam.id, { statuses: ["open", "snoozed"] })
    .filter((action) => !action.dueDate || action.dueDate <= range.to)
    .slice(0, 200)
    .map((action) => ({
      id: action.id,
      title: cleanText(action.title),
      status: action.status,
      dueDate: action.dueDate || null,
      dueTime: action.dueTime || null,
      assigneeType: action.assigneeType,
      kidId: action.kidId || null,
      kidSubject: action.kidId ? (ids.byKidId.get(action.kidId) || null) : null,
      sourceType: action.sourceType || "manual",
      ...itemMeta("actions", generatedMs, "fametc.actions", action.id),
    }));
  return { ...sectionMeta("actions", generatedMs, "fametc.actions"), range, items };
}

function mealSection(fam, range, generatedMs) {
  const state = meals.getState(fam.id);
  const items = (state.menu || [])
    .filter((entry) => dateIntersects(entry.date, entry.date, range))
    .slice(0, 100)
    .map((entry) => ({
      id: entry.id,
      date: entry.date,
      slot: entry.slot,
      title: cleanText(entry.title, 120),
      ...itemMeta("meals", generatedMs, "fametc.meals.menu", entry.id),
    }));
  return { ...sectionMeta("meals", generatedMs, "fametc.meals.menu"), range, items };
}

function tripVisibleToActor(fam, actor, trip) {
  if (!trip) return false;
  if (trip.familyId === fam.id) return true;
  if (actor && actor.type === "kid") return false;
  return (trip.members || []).some((member) => (fam.parentIds || []).includes(member.userId));
}

function tripSection(fam, actor, generatedMs) {
  const items = trips.allTrips()
    .filter((trip) => tripVisibleToActor(fam, actor, trip))
    .slice(0, 50)
    .map((trip) => ({
      id: trip.id,
      name: cleanText(trip.name, 100),
      destination: cleanText(trip.destination, 160) || null,
      startDate: trip.startDate || null,
      endDate: trip.endDate || null,
      itinerary: (trip.itinerary || []).slice(0, 100).map((item) => ({
        id: item.id,
        date: item.date || null,
        time: item.time || null,
        title: cleanText(item.title),
        category: item.category || null,
      })),
      ...itemMeta("trips", generatedMs, "fametc.trips", trip.id),
    }));
  return { ...sectionMeta("trips", generatedMs, "fametc.trips"), items };
}

function preferenceSection(fam, generatedMs) {
  const state = meals.getState(fam.id);
  const prefs = state && state.prefs || {};
  return {
    ...sectionMeta("preferences", generatedMs, "fametc.meals.preferences"),
    values: {
      familyDisplayName: cleanText(fam.name, 80) || "Family",
      dinnerTime: cleanText(prefs.dinnerTime, 8) || null,
      cuisines: Array.isArray(prefs.cuisines) ? prefs.cuisines.slice(0, 20).map((v) => cleanText(v, 60)).filter(Boolean) : [],
    },
    exclusions: ["allergies", "health-targets", "private-notes", "credentials"],
  };
}

function buildFamilyContext(familyId, options = {}) {
  const fam = family.getFamily(familyId);
  if (!fam) throw new FamilyContextError("Family not found.", "FAMILY_CONTEXT_NOT_FOUND");
  const actor = options.actor || null;
  const generatedMs = Date.now();
  const disclosure = disclosureFor(options.purpose, options.sections, actor);
  const range = rangeFor(options);
  const parentRecords = (fam.parentIds || []).map((userId) => subjectRecordForParent(fam, userId));
  const kidRecords = (fam.kids || []).map((kid) => subjectRecordForKid(fam, kid));
  const ids = identityIndex(parentRecords, kidRecords);
  const sections = {};

  if (disclosure.granted.includes("identities")) {
    sections.identities = {
      ...sectionMeta("identities", generatedMs, "fametc.identity-subjects"),
      members: [...parentRecords, ...kidRecords],
    };
  }
  if (disclosure.granted.includes("preferences")) sections.preferences = preferenceSection(fam, generatedMs);
  if (disclosure.granted.includes("calendar")) sections.calendar = calendarSection(fam, range, generatedMs, ids);
  if (disclosure.granted.includes("homework")) sections.homework = homeworkSection(fam, range, generatedMs, ids);
  if (disclosure.granted.includes("actions")) sections.actions = actionSection(fam, range, generatedMs, ids);
  if (disclosure.granted.includes("meals")) sections.meals = mealSection(fam, range, generatedMs);
  if (disclosure.granted.includes("trips")) sections.trips = tripSection(fam, actor, generatedMs);
  if (disclosure.granted.includes("room")) {
    sections.room = {
      ...sectionMeta("room", generatedMs, "fametc.hermes.room"),
      id: options.roomId ? cleanText(options.roomId, 160) : null,
    };
  }

  const expiresAt = Object.values(sections)
    .map((section) => section.expiresAt)
    .filter(Boolean)
    .sort()[0] || isoAt(generatedMs + 15 * 60 * 1000);

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: isoAt(generatedMs),
    expiresAt,
    purpose: disclosure.purpose,
    disclosure: {
      requestedSections: disclosure.requested,
      grantedSections: disclosure.granted,
      deniedSections: disclosure.denied,
      mode: "purpose-scoped-read-only",
    },
    authority: {
      sourceOfTruth: "fametc",
      writesAllowedByContext: false,
      externalContentMayGrantAuthority: false,
    },
    identityInterop: {
      familyAuthority: "fametc",
      legacyHouseholdId: fam.id,
      personSubjectNamespace: "fametc-subject-v1",
      oddsCoreCanonicalPersonIdExposed: false,
      oddsCoreContract: "feature/oddscore-m2-identity-foundation",
    },
    household: {
      localFamilyId: fam.id,
      displayName: cleanText(fam.name, 80) || "Family",
    },
    actor: actorIdentity(fam, actor, parentRecords, kidRecords),
    sections,
  };
}

module.exports = {
  SCHEMA_VERSION,
  ALL_SECTIONS,
  PURPOSE_POLICIES,
  SECTION_TTL_MS,
  SECTION_SENSITIVITY,
  FamilyContextError,
  disclosureFor,
  rangeFor,
  buildFamilyContext,
};
