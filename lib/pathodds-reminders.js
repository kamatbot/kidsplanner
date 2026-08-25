"use strict";

const db = require("./db");
const notifications = require("./fam-notifications");

function root() {
  const value = db.load();
  if (!value.pathOddsReminderState) value.pathOddsReminderState = {};
  return value;
}

function key(pairwiseSubject, localDate) {
  return `${pairwiseSubject}:${localDate}`;
}

function get(pairwiseSubject, localDate) {
  return root().pathOddsReminderState[key(pairwiseSubject, localDate)] || null;
}

function mark(pairwiseSubject, localDate, result) {
  const value = root();
  value.pathOddsReminderState[key(pairwiseSubject, localDate)] = {
    pairwiseSubject,
    localDate,
    sentAt: new Date().toISOString(),
    sent: result.sent || 0,
    pruned: result.pruned || 0,
  };
  db.persist();
}

async function send({ pairwiseSubject, subject, snapshot }) {
  if (!subject || subject.kind !== "kid" || !subject.userId) return { sent: 0, pruned: 0, reason: "no-kid-device" };
  const state = snapshot && snapshot.state;
  if (!state || !["ready", "in-progress"].includes(state.readiness)) {
    return { sent: 0, pruned: 0, reason: state && state.readiness === "completed" ? "already-complete" : "not-ready" };
  }
  const localDate = state.localDate;
  if (!localDate) return { sent: 0, pruned: 0, reason: "missing-date" };
  if (get(pairwiseSubject, localDate)) return { sent: 0, pruned: 0, reason: "already-reminded" };

  const answered = Number(state.answered) || 0;
  const total = Number(state.total) || 11;
  const title = "🎯 PathOdds SAT";
  const body = state.readiness === "in-progress"
    ? `${answered}/${total} done — your SAT Quest is ready to finish.`
    : `Your ${Number(state.estimatedMinutes) || 15}-minute SAT Quest is ready.`;
  const collapseId = `pathodds-${pairwiseSubject.slice(-24)}-${localDate}`;
  const iosPayload = {
    aps: { alert: { title, body }, sound: "default", "thread-id": "pathodds-sat" },
    famType: "pathodds_quest_reminder",
    familyId: subject.familyId,
  };
  const webPayload = {
    title,
    body,
    data: { url: "/?tab=today", famType: "pathodds_quest_reminder", familyId: subject.familyId },
  };
  const [ios, web] = await Promise.all([
    notifications.sendToUser(subject.userId, iosPayload, { kind: "ios", pushType: "alert", collapseId }),
    notifications.sendWebToUser(subject.userId, webPayload, { urgency: "normal" }),
  ]);
  const result = { sent: (ios.sent || 0) + (web.sent || 0), pruned: (ios.pruned || 0) + (web.pruned || 0) };
  if (result.sent > 0) mark(pairwiseSubject, localDate, result);
  return result.sent > 0 ? result : { ...result, reason: "no-push-subscription" };
}

module.exports = { get, send };
