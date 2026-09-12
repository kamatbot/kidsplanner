"use strict";
const db = require("./db");
const own = (object, key) => object && Object.hasOwn(object, key) ? object[key] : undefined;
const dict = (object, key) => {
  if (!own(object, key)) Object.defineProperty(object, key, { value: Object.create(null), enumerable: true, writable: true, configurable: true });
  return object[key];
};
const PARTS = new Set(["news", "word", "puzzle", "bt", "quote"]);

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function recentDate(value, now = Date.now()) {
  if (!validDate(value)) return false;
  const today = Math.floor(now / 86400000) * 86400000;
  return Date.parse(value) >= today - 35 * 86400000 && Date.parse(value) <= today + 86400000;
}
function exactKeys(body, keys) {
  return body && typeof body === "object" && !Array.isArray(body) &&
    Object.keys(body).length === keys.length && keys.every(key => Object.hasOwn(body, key));
}
function record(familyId, kidId, create = false) {
  const root = db.load();
  if (create) return dict(dict(dict(root, "childInsights"), familyId), kidId);
  return own(own(own(root, "childInsights"), familyId), kidId);
}
function progress(familyId, kidId, date) {
  const saved = own(record(familyId, kidId)?.daily5, date);
  return { date, parts: saved ? JSON.parse(JSON.stringify(saved)) : {} };
}
function insights(familyId, kidId, date) {
  const saved = record(familyId, kidId);
  return { kidId, date, schoolStats: saved?.schoolStats || null,
    homePlan: own(saved?.homePlans, date) || null, daily5: progress(familyId, kidId, date) };
}
function saveHomePlan(familyId, kidId, body) {
  if (!exactKeys(body, ["date", "schoolEnd", "pickupTime", "homeTime", "pickupLabel"]) || !validDate(body.date) ||
      ![body.schoolEnd, body.pickupTime, body.homeTime].every(value => value === null || typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) ||
      typeof body.pickupLabel !== "string" || body.pickupLabel.length > 80) return { error: "Invalid home plan." };
  const homePlan = { ...body, updatedAt: new Date().toISOString() };
  dict(record(familyId, kidId, true), "homePlans")[body.date] = homePlan;
  db.persist();
  return { homePlan };
}
function saveSchoolStats(familyId, kidId, body) {
  const bounds = { housePoints: [0, 1e7], attendance: [0, 100], punctual: [0, 100], canteenBalance: [-1e6, 1e6] };
  if (!exactKeys(body, [...Object.keys(bounds), "importedAt"]) ||
      typeof body.importedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(body.importedAt) ||
      !validDate(body.importedAt.slice(0, 10)) || !Number.isFinite(Date.parse(body.importedAt)) ||
      Number(body.importedAt.slice(11, 13)) > 23 ||
      !Object.entries(bounds).every(([key, [min, max]]) => body[key] === null || typeof body[key] === "number" && Number.isFinite(body[key]) && body[key] >= min && body[key] <= max)) {
    return { error: "Invalid school stats." };
  }
  const saved = record(familyId, kidId, true);
  if (saved.schoolStats && Date.parse(saved.schoolStats.importedAt) >= Date.parse(body.importedAt)) return { schoolStats: saved.schoolStats };
  if (body.housePoints !== null && Math.round(body.housePoints * 100) / 100 !== body.housePoints) return { error: "House points must have at most two decimal places." };
  require("./fams").summary(familyId, kidId);
  saved.schoolStats = { ...body, updatedAt: new Date().toISOString() };
  require("./fams").syncHousePoints(familyId, kidId, body.housePoints);
  db.persist();
  return { schoolStats: saved.schoolStats };
}
function reportProgress(familyId, kidId, body) {
  if (!exactKeys(body, ["date", "part", "status"]) || !recentDate(body.date) || !PARTS.has(body.part) || !["started", "completed"].includes(body.status)) return { error: "Invalid progress." };
  const days = dict(record(familyId, kidId, true), "daily5");
  dict(days, body.date)[body.part] = { status: body.status, updatedAt: new Date().toISOString() };
  for (const date of Object.keys(days)) if (!recentDate(date)) delete days[date];
  for (const date of Object.keys(days).sort().reverse().slice(35)) delete days[date];
  require("./fams").awardDaily5(familyId, kidId, body);
  db.persist();
  return progress(familyId, kidId, body.date);
}
module.exports = { validDate, recentDate, insights, progress, saveHomePlan, saveSchoolStats, reportProgress };
