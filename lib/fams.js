"use strict";
const crypto = require("node:crypto");
const db = require("./db");
const rates = Object.freeze({ daily5: 6, homework: 5, homeworkDailyLimit: 10, newsComment: 4, lesson: 2, schoolPoint: 50 });
const parts = new Set(["news", "word", "puzzle", "bt", "quote"]);
const own = (o, k) => o && Object.hasOwn(o, k) ? o[k] : undefined;
function dict(o, k, value = {}) {
  if (!Object.hasOwn(o, k)) Object.defineProperty(o, k, { value, enumerable: true, writable: true, configurable: true });
  return o[k];
}
function today() { return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10); }
function weekStart(date = today()) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  return d.toISOString().slice(0, 10);
}
function account(familyId, kidId) {
  return dict(dict(dict(db.load(), "fams"), familyId), kidId, {
    transactions: [], events: {}, chores: [], goal: null, schoolPoints: { current: null, highWater: 0, resetPending: false, epoch: 0 },
  });
}
function credit(a, event, amount, category, { regular = false, dailyLimit = Infinity, title = category } = {}) {
  if (Object.hasOwn(a.events, event)) return { awarded: 0 };
  const date = today();
  let units = Math.round(amount * 100);
  if (!Number.isSafeInteger(units) || units < 0) return { error: "Invalid reward amount." };
  if (regular) {
    const weekly = a.transactions.filter(t => t.regular && t.weekStart === weekStart()).reduce((n, t) => n + t.units, 0);
    const daily = a.transactions.filter(t => t.category === category && t.date === date).reduce((n, t) => n + t.units, 0);
    units = Math.max(0, Math.min(units, 30000 - weekly, dailyLimit * 100 - daily));
  }
  // Persist consumed events even at the cap: retries cannot mint in a later week.
  dict(a.events, event, true);
  if (units) a.transactions.push({ id: crypto.randomUUID(), event, units, category, title, date, weekStart: weekStart(date), regular, createdAt: new Date().toISOString() });
  db.persist();
  return { awarded: units / 100 };
}
function awardDaily5(familyId, kidId, body = {}) {
  if (body.status !== "completed") return { awarded: 0 };
  if (body.date !== today() || !parts.has(body.part)) return { error: "Only today's Daily 5 can earn Fams." };
  return credit(account(familyId, kidId), `daily5:${body.date}:${body.part}`, rates.daily5, "daily5", { regular: true, title: `Daily 5: ${body.part}` });
}
function awardHomework(familyId, item) {
  if (!item || !item.kidId || item.status !== "done") return { awarded: 0 };
  const identity = item.sourceUid || (item.moodleIdentity?.taskId ? `sta-api:${item.kidId}:${item.moodleIdentity.taskId}` : item.id);
  if (!identity) return { error: "Homework identity required." };
  return credit(account(familyId, item.kidId), `homework:${identity}`, rates.homework, "homework", { regular: true, dailyLimit: rates.homeworkDailyLimit, title: "Homework completed" });
}
function awardNewsComment(familyId, note) {
  if (!note || note.authorType !== "kid" || !note.authorId || note.source !== "news" || typeof note.body !== "string" || note.body.trim().length < 20 || note.date !== today()) return { awarded: 0 };
  return credit(account(familyId, note.authorId), `news-comment:${today()}`, rates.newsComment, "newsComment", { regular: true, dailyLimit: rates.newsComment, title: "News reflection" });
}
function syncHousePoints(familyId, kidId, total) {
  if (total === null) return { awarded: 0 };
  if (typeof total !== "number" || !Number.isFinite(total) || total < 0 || total > 1e7 || Math.round(total * 100) / 100 !== total) return { error: "House points must have at most two decimal places." };
  const a = account(familyId, kidId), s = a.schoolPoints;
  s.current = total;
  s.resetPending = total < s.highWater;
  let result = { awarded: 0 };
  if (total > s.highWater) {
    result = credit(a, `school:${s.epoch}:${total}`, (Math.round(total * 100) - Math.round(s.highWater * 100)) * rates.schoolPoint / 100, "school", { title: "School house points" });
    s.highWater = total;
  }
  db.persist();
  return result;
}
function confirmSchoolReset(familyId, kidId) {
  const a = account(familyId, kidId), s = a.schoolPoints;
  if (s.current === null || s.current >= s.highWater) return { error: "No school points reset to confirm." };
  s.epoch += 1;
  s.highWater = s.current;
  s.resetPending = false;
  credit(a, `school:${s.epoch}:${s.current}`, Math.round(s.current * 100) * rates.schoolPoint / 100, "school", { title: "School points after confirmed reset" });
  db.persist();
  return { schoolPoints: { current: s.current, highWater: s.highWater, resetPending: s.resetPending } };
}
function createChore(familyId, kidId, body = {}) {
  if (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 200 || !Number.isInteger(body.amount) || body.amount <= 0 || body.amount > 10000) return { error: "Use a chore title and a whole Fams amount from 1 to 10,000." };
  const chore = { id: crypto.randomUUID(), title: body.title.trim(), amount: body.amount, status: "pending", createdAt: new Date().toISOString() };
  account(familyId, kidId).chores.push(chore); db.persist();
  return { chore: { ...chore } };
}
function submitChore(familyId, kidId, id) {
  const chore = account(familyId, kidId).chores.find(c => c.id === id);
  if (!chore) return { error: "Chore not found." };
  if (chore.status === "approved") return { error: "Chore already approved." };
  if (chore.status === "pending") { chore.status = "submitted"; chore.submittedAt = new Date().toISOString(); db.persist(); }
  return { chore: { ...chore } };
}
function approveChore(familyId, kidId, id) {
  const a = account(familyId, kidId), chore = a.chores.find(c => c.id === id);
  if (!chore) return { error: "Chore not found." };
  if (chore.status === "approved") return { chore: { ...chore } };
  if (chore.status !== "submitted") return { error: "The child must submit this chore first." };
  credit(a, `chore:${id}`, chore.amount, "chore", { title: chore.title });
  chore.status = "approved"; chore.approvedAt = new Date().toISOString(); db.persist();
  return { chore: { ...chore } };
}
function setGoal(familyId, kidId, body = {}) {
  if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 100 || !Number.isInteger(body.target) || body.target <= 0 || body.target > 1e9) return { error: "Use a goal name and a positive whole Fams target." };
  const goal = { name: body.name.trim(), target: body.target };
  account(familyId, kidId).goal = goal; db.persist(); return { goal: { ...goal } };
}
function awardLesson(familyId, kidId, lessonId) {
  if (typeof lessonId !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(lessonId)) return { error: "Invalid lesson." };
  return credit(account(familyId, kidId), `lesson:${lessonId}`, rates.lesson, "lesson", { regular: true, dailyLimit: rates.lesson, title: "Finance lesson" });
}
function summary(familyId, kidId) {
  const a = account(familyId, kidId);
  const stats = own(own(own(db.load().childInsights, familyId), kidId), "schoolStats");
  if (stats && stats.housePoints !== null && a.schoolPoints.current === null) syncHousePoints(familyId, kidId, stats.housePoints);
  const total = a.transactions.reduce((n, t) => n + t.units, 0);
  const earned = a.transactions.filter(t => t.regular && t.weekStart === weekStart()).reduce((n, t) => n + t.units, 0);
  return { balance: total / 100, totalEarned: total / 100, weekly: { earned: earned / 100, limit: 300, weekStart: weekStart() }, rates: { ...rates },
    completedLessons: Object.keys(a.events).filter(key => key.startsWith("lesson:")).map(key => key.slice(7)),
    transactions: a.transactions.slice().reverse().map(({ units, ...t }) => ({ ...t, amount: units / 100, reason: t.title })), chores: a.chores.map(c => ({ ...c })), goal: a.goal ? { ...a.goal } : null,
    schoolPoints: { current: a.schoolPoints.current, highWater: a.schoolPoints.highWater, resetPending: a.schoolPoints.resetPending } };
}
module.exports = { summary, awardDaily5, awardHomework, awardNewsComment, syncHousePoints, confirmSchoolReset, createChore, submitChore, approveChore, setGoal, awardLesson };
