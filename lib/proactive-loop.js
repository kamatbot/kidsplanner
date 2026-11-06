"use strict";

/**
 * Hermes' proactive reminders, run inside the FamETC server.
 *
 * This is a straight port of the planner that used to run on the family's
 * always-on Mac (integrations/hermes/fametc/proactive.py), so the rules and
 * wording are unchanged. Once a minute, for every full-hub family, it reads
 * the facts from hermes-proactive.buildState(), decides who should hear what
 * right now, and posts each nudge with hermesThreads.postNudge(). postNudge
 * is idempotent per (person, nudge key), records what went out, sends the push
 * notification, and applies the family's topic switches and kid safety rules.
 *
 * plan() is pure: facts + a clock in, nudges out. FAM_PROACTIVE=off stops the loop.
 */

const MIN = 60 * 1000;
const QUIET = { parent: ["21:30", "07:00"], kid: ["20:30", "07:00"] };
const DAILY_CAP = { parent: 8, kid: 4 };
const UNCAPPED_KINDS = new Set(["day-end", "kid-reminder"]);
const SOON = 30 * MIN;
const NOW_GRACE = 20 * MIN;
const HOME_AFTER_DAY_END = 60 * MIN;
const HOME_WINDOW = 90 * MIN;
const LATER_WINDOW = 60 * MIN;
const QUIET_GAP = 60 * MIN;
const PARENT_EVENING = ["17:30", "19:30"];
const KID_FOLLOWUP = ["19:30", "20:30"];
const DINNER_OFFER_LEAD = 180 * MIN;
const DINNER_OFFER_WINDOW = 90 * MIN;
const BUSY_BEFORE_DINNER = 90 * MIN;
const WEEK_PLAN = ["sun", "17:00", "20:00"];
const WEEK_PLAN_MIN_PLANNED = 4;
const MAX_NUDGES_PER_TICK = 20;
const HELP_DEFAULTS = { schoolDay: true, homework: true, dinner: false };
const TOPIC_OF_KIND = {
  "day-end": "schoolDay",
  "home-kid": "homework", "home-kid-later": "homework", "home-kid-followup": "homework",
  "kid-reminder": "homework", "home-parent": "homework",
  "dinner-tonight": "dinner", "dinner-week": "dinner",
};
const TICK_MS = 60 * 1000;

function parse(value) {
  if (typeof value !== "string" || !value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
function inSpan(hhmm, [start, end]) {
  return start <= end ? start <= hhmm && hhmm < end : hhmm >= start || hhmm < end;
}
function plural(n, word) { return n === 1 ? `${n} ${word}` : `${n} ${word}s`; }
function action(id, label, style = "secondary") { return { id, label, style }; }
function int(value) { const n = parseInt(value, 10); return Number.isFinite(n) ? n : 0; }
function localParts(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, clock: `${p.hour}:${p.minute}`, weekday: String(p.weekday).toLowerCase().slice(0, 3) };
}

function facts(state, nowMs) {
  const tz = state.timezone || "Asia/Bangkok";
  const local = localParts(nowMs, tz);
  const people = (state.people || []).filter((p) => p && p.userId);
  const helps = state.helpsWith && typeof state.helpsWith === "object" ? state.helpsWith : {};
  const sent = (state.sent || []).filter((s) => s && typeof s === "object");
  const f = {
    now: nowMs, tz,
    today: state.today || local.date,
    weekday: state.weekday || local.weekday,
    clock: local.clock,
    roleOf: new Map(people.map((p) => [p.userId, p.role])),
    parents: people.filter((p) => p.role === "parent"),
    kids: (state.kids || []).filter((k) => k && k.kidId),
    dinner: state.dinner || {},
    helps: Object.fromEntries(Object.entries(HELP_DEFAULTS).map(([k, v]) => [k, typeof helps[k] === "boolean" ? helps[k] : v])),
    sent,
    sentKeys: new Set(sent.map((s) => `${s.userId}|${s.nudgeKey}`)),
  };
  f.sentToday = (uid) => sent.filter((e) => e.userId === uid && parse(e.postedAt) != null && localParts(parse(e.postedAt), tz).date === f.today);
  f.quiet = (uid) => inSpan(f.clock, QUIET[f.roleOf.get(uid)] || QUIET.parent);
  f.recent = (uid, kinds, within) => sent.some((e) => e.userId === uid && kinds.has(e.kind) && parse(e.postedAt) != null && nowMs - parse(e.postedAt) < within);
  return f;
}

// ---------------------------------------------------------------- moments
function dayEnd(f) {
  const moments = [];
  for (const kid of f.kids) {
    const end = kid.dayEnd || {};
    const at = parse(end.at);
    if (at == null) continue;
    if (at - SOON <= f.now && f.now < at) moments.push({ kid, end, at, stage: "soon" });
    else if (at <= f.now && f.now <= at + NOW_GRACE) moments.push({ kid, end, at, stage: "now" });
  }
  if (!moments.length) return [];
  const what = (end) => (end.kind === "school" ? "school" : end.title || "the day");
  const where = (end) => (end.location && end.kind !== "school" ? ` (${end.location})` : "");
  const sentence = (m) => {
    const name = m.kid.name || "Your child";
    if (m.stage === "now") return `${name}'s ${what(m.end)} ended now${where(m.end)}.`;
    const minutes = Math.max(1, Math.ceil((m.at - f.now) / MIN));
    return `${name} finishes ${what(m.end)} in ${minutes} min${where(m.end)}.`;
  };
  const nudges = [];
  for (const parent of f.parents) {
    const uid = parent.userId;
    const covered = new Set();
    for (const entry of f.sentToday(uid)) if (entry.kind === "day-end") for (const c of entry.covers || []) covered.add(c);
    const fresh = moments.filter((m) => !covered.has(`${m.kid.kidId}:${m.stage}`));
    if (!fresh.length || f.quiet(uid)) continue;
    const freshIds = new Set(fresh.map((m) => m.kid.kidId));
    const context = fresh.some((m) => m.stage === "now") ? moments.filter((m) => m.stage === "soon" && !freshIds.has(m.kid.kidId)) : [];
    const ordered = fresh.concat(context).sort((a, b) => ((a.stage !== "now") - (b.stage !== "now")) || a.at - b.at);
    const covers = fresh.map((m) => `${m.kid.kidId}:${m.stage}`).sort();
    nudges.push({
      userId: uid,
      nudgeKey: `day-end:${f.today}:${covers.join("+")}`,
      text: ordered.map(sentence).join(" "),
      card: { kind: "day-end", data: { covers } },
    });
  }
  return nudges;
}

function tonightSummary(kid) {
  const t = kid.tonight || {};
  const due = (t.dueTomorrow || []).filter((d) => d && typeof d === "object");
  const overdue = int(t.overdue), habits = int(t.habitsLeft), daily3 = int(t.daily3Left);
  const bits = [];
  if (due.length) bits.push(`${due[0].title || "Homework"} (due tomorrow)${due.length > 1 ? ` and ${due.length - 1} more` : ""}`);
  else if (overdue) bits.push(`${plural(overdue, "overdue piece")} of homework to catch up on`);
  if (habits) bits.push(`${plural(habits, "habit")} to check off`);
  if (daily3) bits.push(daily3 >= 3 ? "Daily 3 is ready" : `${daily3} left in Daily 3`);
  const lines = due.length > 1 ? due.slice(0, 4).map((d) => d.title || "Homework") : [];
  return [bits.join(" · "), lines, !!(due.length || overdue)];
}

function homeKid(f) {
  const nudges = [];
  for (const kid of f.kids) {
    const userIds = (kid.userIds || []).filter((u) => typeof u === "string");
    if (!userIds.length) continue;
    const end = parse((kid.dayEnd || {}).at);
    const fire = parse(kid.homeAt) ?? (end != null ? end + HOME_AFTER_DAY_END : null);
    if (fire == null || !(fire <= f.now && f.now <= fire + HOME_WINDOW)) continue;
    const [summary, lines, homework] = tonightSummary(kid);
    if (!summary) continue;
    const actions = [homework ? action("open-homework", "Open homework", "primary") : action("open-today", "Open Today", "primary"), action("later", "In 30 min")];
    for (const uid of userIds) {
      nudges.push({
        userId: uid,
        nudgeKey: `home-kid:${f.today}:${kid.kidId}`,
        text: `Welcome home, ${kid.name || "there"}! Tonight: ${summary}.`,
        card: { kind: "home-kid", lines, actions },
      });
    }
  }
  return nudges;
}

function snoozedReminders(f) {
  const kidByUser = new Map();
  for (const k of f.kids) for (const u of k.userIds || []) kidByUser.set(u, k);
  const nudges = [];
  for (const entry of f.sent) {
    if (entry.status !== "snoozed" || !["home-kid", "home-kid-followup"].includes(entry.kind)) continue;
    const until = parse(entry.until);
    const kid = kidByUser.get(entry.userId);
    if (until == null || !kid || !(until <= f.now && f.now <= until + LATER_WINDOW)) continue;
    const t = kid.tonight || {};
    const due = (t.dueTomorrow || []).filter((d) => d && typeof d === "object");
    let text;
    if (due.length) text = `Reminder: ${due[0].title || "your homework"} is due tomorrow.`;
    else if (int(t.overdue) || int(t.habitsLeft) || int(t.daily3Left)) text = "Reminder: tonight's list is still waiting.";
    else continue;
    nudges.push({
      userId: entry.userId,
      nudgeKey: `${entry.nudgeKey}~later`,
      text,
      card: { kind: "home-kid-later", actions: [action("open-homework", "Open homework", "primary")] },
    });
  }
  return nudges;
}

function kidFollowup(f) {
  if (!inSpan(f.clock, KID_FOLLOWUP)) return [];
  const nudges = [];
  for (const kid of f.kids) {
    const due = ((kid.tonight || {}).dueTomorrow || []).filter((d) => d && typeof d === "object");
    if (!due.length) continue;
    const first = due[0].title || "Your homework";
    const more = due.length > 1 ? ` (${due.length} things are due tomorrow.)` : "";
    for (const uid of kid.userIds || []) {
      if (f.recent(uid, new Set(["home-kid-later", "kid-reminder"]), QUIET_GAP)) continue;
      nudges.push({
        userId: uid,
        nudgeKey: `home-kid-followup:${f.today}:${kid.kidId}`,
        text: `${first} is due tomorrow. Want to finish it now?${more}`,
        card: { kind: "home-kid-followup", actions: [action("open-homework", "Open homework", "primary"), action("later", "In 30 min")] },
      });
    }
  }
  return nudges;
}

function dinnerPlanned(f) { return !!((f.dinner.tonight || {}).planned); }

function homeParent(f) {
  if (!inSpan(f.clock, PARENT_EVENING)) return [];
  const sentences = [], nudgeKids = [];
  const busy = f.kids.filter((k) => ((k.tonight || {}).dueTomorrow || []).length || int((k.tonight || {}).overdue));
  for (const kid of f.kids) {
    const t = kid.tonight || {};
    const due = (t.dueTomorrow || []).filter((d) => d && typeof d === "object");
    const overdue = int(t.overdue);
    const name = kid.name || "Your child";
    if (due.length) {
      const started = due.some((d) => d.status === "in_progress");
      sentences.push(`${name} has ${due.length} due tomorrow (${started ? "in progress" : "not started"}).`);
    } else if (overdue) sentences.push(`${name} has ${overdue} overdue.`);
    else if (busy.length) sentences.push(`${name} is all set.`);
    if ((due.length || overdue) && (kid.userIds || []).length) nudgeKids.push(kid);
  }
  const dinnerOpen = f.helps.dinner && !dinnerPlanned(f);
  if (dinnerOpen) sentences.push("Dinner isn't planned yet.");
  if (!busy.length && !dinnerOpen) return [];
  const actions = nudgeKids.slice(0, 2).map((k) => action(`nudge-kid:${k.kidId}`, `Nudge ${k.name || "them"}`));
  if (dinnerOpen) actions.unshift(action("dinner-ideas", "Dinner ideas", "primary"));
  return f.parents.map((p) => ({
    userId: p.userId,
    nudgeKey: `home-parent:${f.today}`,
    text: `Tonight: ${sentences.join(" ")}`,
    card: { kind: "home-parent", actions },
  }));
}

function busyTitle(f, dinnerAt) {
  for (const kid of f.kids) {
    const end = kid.dayEnd || {};
    const at = parse(end.at);
    if (at != null && end.kind !== "school" && dinnerAt - at >= 0 && dinnerAt - at <= BUSY_BEFORE_DINNER) return end.title;
  }
  return null;
}

function dinnerTonight(f) {
  const dinnerAt = parse(f.dinner.at);
  if (dinnerAt == null || dinnerPlanned(f)) return [];
  const offer = dinnerAt - DINNER_OFFER_LEAD;
  if (!(offer <= f.now && f.now <= offer + DINNER_OFFER_WINDOW)) return [];
  const busy = busyTitle(f, dinnerAt);
  let text = "Dinner tonight isn't planned yet. Want 3 ideas from your pantry?";
  if (busy) text += ` It's a ${String(busy).toLowerCase()} night, so I'll keep them quick.`;
  return f.parents.map((p) => ({
    userId: p.userId,
    nudgeKey: `dinner-tonight:${f.today}`,
    text,
    card: { kind: "dinner-tonight", actions: [action("dinner-ideas", "Show 3 ideas", "primary"), action("dismiss", "I've got it")] },
  }));
}

function dinnerWeek(f) {
  const [day, start, end] = WEEK_PLAN;
  const week = f.dinner.nextWeek || {};
  const planned = int(week.planned);
  if (f.weekday !== day || !inSpan(f.clock, [start, end]) || !week.start || planned >= WEEK_PLAN_MIN_PLANNED) return [];
  const days = int(week.days) || 7;
  return f.parents.map((p) => ({
    userId: p.userId,
    nudgeKey: `dinner-week:${week.start}`,
    text: `Next week has ${planned} of ${days} dinners planned. Want me to draft the rest?`,
    card: { kind: "dinner-week", actions: [action("dinner-draft-week", "Draft the week", "primary"), action("dismiss", "Not this week")] },
  }));
}

// Most time-critical first, so a daily cap drops the least urgent.
const MOMENTS = [dayEnd, snoozedReminders, homeKid, kidFollowup, dinnerTonight, homeParent, dinnerWeek];

/** Every nudge that should go out at `now`, given hermes-proactive.buildState() facts. */
function plan(state, now = new Date()) {
  const f = facts(state || {}, now instanceof Date ? now.getTime() : Number(now));
  const used = new Map([...f.roleOf.keys()].map((uid) => [uid, f.sentToday(uid).filter((e) => !UNCAPPED_KINDS.has(e.kind)).length]));
  const out = [];
  for (const moment of MOMENTS) {
    for (const nudge of moment(f)) {
      const uid = nudge.userId, kind = nudge.card.kind;
      if (f.sentKeys.has(`${uid}|${nudge.nudgeKey}`) || !f.roleOf.has(uid)) continue;
      const topic = TOPIC_OF_KIND[kind];
      if (topic && f.helps[topic] === false) continue;
      if (kind !== "day-end" && f.quiet(uid)) continue;
      if (!UNCAPPED_KINDS.has(kind)) {
        if ((used.get(uid) || 0) >= (DAILY_CAP[f.roleOf.get(uid)] || 4)) continue;
        used.set(uid, (used.get(uid) || 0) + 1);
      }
      out.push(nudge);
    }
  }
  return out.slice(0, MAX_NUDGES_PER_TICK);
}

function enabled() {
  return !["0", "off", "false", "no"].includes(String(process.env.FAM_PROACTIVE || "on").trim().toLowerCase());
}

/** One pass over every full-hub family. Returns the number of nudges created. */
function tick(now = new Date()) {
  if (!enabled()) return 0;
  const family = require("./family");
  const db = require("./db");
  const hermesProactive = require("./hermes-proactive");
  const hermesThreads = require("./hermes-threads");
  let created = 0;
  for (const fam of Object.values(db.load().families || {})) {
    if (!fam || !fam.id || !family.isFull(fam)) continue;
    let nudges;
    try { nudges = plan(hermesProactive.buildState(fam, now), now); } catch (error) { console.warn(`[proactive] plan failed: ${error.message}`); continue; }
    for (const nudge of nudges) {
      try {
        const out = hermesThreads.postNudge(fam, nudge, { now });
        if (out && out.created) created += 1;
      } catch (error) {
        if (!(error instanceof hermesThreads.ThreadError)) console.warn(`[proactive] nudge failed: ${error.message}`);
      }
    }
  }
  return created;
}

let timer = null;
function start() {
  if (timer || !enabled()) return timer;
  timer = setInterval(() => { try { tick(); } catch (error) { console.warn(`[proactive] tick failed: ${error.message}`); } }, TICK_MS);
  if (timer.unref) timer.unref();
  return timer;
}
function stop() { if (timer) clearInterval(timer); timer = null; }

module.exports = { plan, tick, start, stop, enabled };
