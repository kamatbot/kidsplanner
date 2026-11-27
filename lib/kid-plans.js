"use strict";

/**
 * Kids add their own plans by voice.
 *
 * A kid says (Siri on the watch, the watch app's "Add plans" button, or the
 * iPad) something like "soccer Saturday at 10, dentist Tuesday at 4 and remind
 * me to pack my recorder tomorrow morning". The words arrive as text: watchOS
 * dictation and Siri do the speech-to-text on Apple's side. One Claude call
 * splits the note into events and reminders, and this module writes them.
 *
 * Boundaries:
 *   - everything is created for the kid who spoke, never a sibling or the
 *     family calendar, and never with a driver or repeat;
 *   - reminders are to-dos assigned to that kid (createdByKidId), so they buzz
 *     on the kid's watch like any chore and the kid may edit or delete them;
 *   - each request has a client id: a retry returns the first result instead
 *     of adding everything twice, and "Undo" removes that request's items.
 */

const crypto = require("crypto");
const db = require("./db");
const events = require("./events");
const actions = require("./actions");
const hermesProactive = require("./hermes-proactive");

const API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-haiku-5-5";
const REQUEST_TIMEOUT_MS = 25000;
const MAX_TEXT = 1000;
const MAX_ITEMS = 8;
const KEEP_MS = 14 * 86400000;
const KEEP_PER_FAMILY = 200;
const UNDO_WINDOW_MS = 24 * 3600000;
const CATEGORIES = ["school", "sports", "arts", "social", "other"];
const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529]);

const obj = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const TOOLS = [
  {
    name: "add_event",
    description: "Put something the kid will DO or attend on their calendar: a game, practice, lesson, party, appointment, test, trip.",
    input_schema: obj({
      title: { type: "string", maxLength: 120, description: "Short title, e.g. 'Soccer practice'" },
      date: { type: "string", description: "YYYY-MM-DD" },
      time: { type: "string", description: "HH:MM 24-hour start time. Omit if no time was said." },
      endTime: { type: "string", description: "HH:MM 24-hour, only if said" },
      category: { type: "string", enum: CATEGORIES },
      notes: { type: "string", maxLength: 300, description: "Extra detail the kid said (place, what to bring). Optional." },
    }, ["title", "date"]),
  },
  {
    name: "add_reminder",
    description: "A reminder that buzzes the kid's watch: 'remind me to...', something to bring, pack, finish or do by a time.",
    input_schema: obj({
      title: { type: "string", maxLength: 120, description: "What to do, as a short command, e.g. 'Pack recorder'" },
      date: { type: "string", description: "YYYY-MM-DD" },
      time: { type: "string", description: "HH:MM 24-hour when the watch should buzz" },
      notes: { type: "string", maxLength: 300 },
    }, ["title", "date", "time"]),
  },
  {
    name: "nothing_to_add",
    description: "Use only when the note contains no plan, event or reminder at all.",
    input_schema: obj({ message: { type: "string", maxLength: 160, description: "One short, friendly sentence for the kid" } }, ["message"]),
  },
];

function disabledReason() {
  if (String(process.env.FAM_KID_PLANS || "on").toLowerCase() === "off") return "Adding plans by voice is turned off on the server (FAM_KID_PLANS=off).";
  if (!process.env.ANTHROPIC_API_KEY) return "Adding plans by voice isn't set up: the server has no ANTHROPIC_API_KEY.";
  return null;
}

// ------------------------------------------------------------------ dates
function nowIn(tz, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday, time: `${parts.hour}:${parts.minute}` };
}

function addDays(ymd, days) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekdayOf(ymd) {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function cleanTime(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

/** "Sat 29 Nov" style label in the family's calendar. */
function shortDay(ymd, today) {
  if (ymd === today) return "today";
  if (ymd === addDays(today, 1)) return "tomorrow";
  const d = new Date(`${ymd}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

function clock12(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}

// ------------------------------------------------------------------ prompt
function systemPrompt(kidName, now, tz) {
  const days = [];
  for (let i = 0; i < 14; i += 1) {
    const ymd = addDays(now.date, i);
    days.push(`${weekdayOf(ymd)} ${ymd}${i === 0 ? " (today)" : i === 1 ? " (tomorrow)" : ""}`);
  }
  return [
    `You turn a kid's spoken note into calendar events and watch reminders for ${kidName}. The note was dictated, so expect missing punctuation and small speech-to-text mistakes.`,
    `Now: ${now.weekday} ${now.date} ${now.time} (${tz}). Next 14 days: ${days.join("; ")}.`,
    "Call one tool per plan, all in this single reply (several plans means several tool calls). Never ask questions.",
    "Rules: dates are never in the past; a weekday name means its next occurrence (today if it is still ahead). 'Tonight' is today; 'this weekend' is the coming Saturday.",
    "Times: '4' or 'four' for an after-school plan means 16:00; school-morning plans before 07:00 are unlikely. 'Morning' with no time is 07:30 for a reminder; 'after school' is 15:30; 'evening' is 18:00.",
    "A reminder always needs a time. If the kid said 'remind me' about an event with a time, add the event and a reminder 30 minutes before it only if they asked to be reminded.",
    "Keep titles short and in the kid's words, capitalised. Skip anything that is not a plan (greetings, feelings). Use nothing_to_add only when there is no plan at all.",
  ].join("\n");
}

// ------------------------------------------------------------------ claude
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function callOnce(body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(API_URL, {
      method: "POST", redirect: "error", signal: controller.signal,
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const error = new Error(`Claude API ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function callClaude(body) {
  try {
    return await callOnce(body);
  } catch (error) {
    const retryable = error.status ? RETRY_STATUSES.has(error.status) : error.name !== "AbortError";
    if (!retryable) throw error;
    await sleep(Number(process.env.FAM_KID_PLANS_RETRY_MS || 1200));
    return callOnce(body);
  }
}

// ------------------------------------------------------------------ storage
function famRecords(familyId) {
  const r = db.load();
  if (!r.kidPlans || typeof r.kidPlans !== "object") r.kidPlans = {};
  if (!Array.isArray(r.kidPlans[familyId])) r.kidPlans[familyId] = [];
  return r.kidPlans[familyId];
}

function prune(list, now) {
  const keep = list.filter((rec) => now - Date.parse(rec.at) < KEEP_MS).slice(-KEEP_PER_FAMILY);
  list.splice(0, list.length, ...keep);
}

function cleanRequestId(value) {
  const id = String(value || "").trim();
  return /^[A-Za-z0-9_-]{8,80}$/.test(id) ? id : null;
}

function findRecord(familyId, kidId, requestId) {
  return famRecords(familyId).find((rec) => rec.requestId === requestId && rec.kidId === kidId) || null;
}

function publicResult(rec) {
  return {
    requestId: rec.requestId,
    reply: rec.reply,
    items: rec.items.map((it) => ({ type: it.type, id: it.id, title: it.title, date: it.date, time: it.time || null, label: it.label })),
    undone: !!rec.undone,
    skipped: rec.skipped || [],
  };
}

// ------------------------------------------------------------------ main
function summarize(items, today) {
  const label = (it) => {
    const when = `${shortDay(it.date, today)}${it.time ? ` ${clock12(it.time)}` : ""}`;
    return it.type === "reminder" ? `⏰ ${it.title}, ${when}` : `📅 ${it.title}, ${when}`;
  };
  for (const it of items) it.label = label(it);
  if (!items.length) return "";
  if (items.length === 1) return `Added ${items[0].label}`;
  return `Added ${items.length}: ${items.map((it) => it.label).join(" · ")}`;
}

/**
 * Turns the kid's words into events and reminders.
 * Returns { result } on success or { error, status } (status is an HTTP code).
 */
async function addFromText({ fam, kidId, userId, text, requestId, source = "watch", now = new Date() }) {
  const kid = fam && (fam.kids || []).find((k) => k.id === kidId);
  if (!kid) return { status: 403, error: "No kid profile linked to this account." };
  const id = cleanRequestId(requestId) || crypto.randomUUID();
  const existing = findRecord(fam.id, kidId, id);
  if (existing) return { result: publicResult(existing), existing: true };

  const words = String(text || "").replace(/\s+/g, " ").trim();
  if (!words) return { status: 400, error: "Say what to add, like \"soccer Saturday at 10\"." };
  if (words.length > MAX_TEXT) return { status: 400, error: `That note is too long (over ${MAX_TEXT} letters). Try a shorter one.` };
  const off = disabledReason();
  if (off) return { status: 503, error: off };

  const tz = hermesProactive.familyTimezone(fam);
  const local = nowIn(tz, now);
  let data;
  try {
    data = await callClaude({
      model: process.env.FAM_KID_PLANS_MODEL || DEFAULT_MODEL,
      max_tokens: 1024,
      system: systemPrompt(kid.name || "the kid", local, tz),
      tools: TOOLS,
      tool_choice: { type: "any" },
      messages: [{ role: "user", content: words }],
    });
  } catch (error) {
    const why = error.name === "AbortError" ? "it took too long" : (error.message || "unknown error");
    return { status: 502, error: `Couldn't read that note (${why}). Try again.` };
  }

  const calls = (data && Array.isArray(data.content) ? data.content : []).filter((b) => b && b.type === "tool_use");
  const items = [];
  const skipped = [];
  let nothingMessage = null;
  for (const call of calls) {
    const input = call.input || {};
    if (call.name === "nothing_to_add") { nothingMessage = String(input.message || "").slice(0, 160); continue; }
    if (items.length >= MAX_ITEMS) { skipped.push({ title: String(input.title || ""), reason: `Only ${MAX_ITEMS} at a time.` }); continue; }
    const title = String(input.title || "").trim().slice(0, 120);
    const date = validDate(input.date) ? input.date : null;
    if (!title || !date) { skipped.push({ title, reason: "No clear date." }); continue; }
    if (date < local.date || date > addDays(local.date, 366)) { skipped.push({ title, reason: "That date is in the past or too far ahead." }); continue; }
    const notes = String(input.notes || "").trim().slice(0, 300);
    if (call.name === "add_event") {
      const time = cleanTime(input.time);
      const out = events.addEvent(fam.id, {
        title, date, time, endTime: cleanTime(input.endTime), notes,
        category: CATEGORIES.includes(input.category) ? input.category : "other",
        kidId, createdBy: userId,
      });
      if (out.error) { skipped.push({ title, reason: out.error }); continue; }
      items.push({ type: "event", id: out.event.id, title: out.event.title, date: out.event.date, time: out.event.time || null });
    } else if (call.name === "add_reminder") {
      const time = cleanTime(input.time);
      if (!time) { skipped.push({ title, reason: "No time to buzz." }); continue; }
      const out = actions.createAction(fam.id, {
        title, notes, dueDate: date, dueTime: time,
        assigneeType: "kid", assigneeId: kidId, kidId, createdByKidId: kidId,
      });
      if (out.error) { skipped.push({ title, reason: out.error }); continue; }
      items.push({ type: "reminder", id: out.action.id, title: out.action.title, date, time, action: out.action });
    }
  }

  let reply = summarize(items, local.date);
  if (!items.length) {
    reply = skipped.length
      ? `I couldn't add that: ${skipped[0].reason} Try saying the day and time.`
      : (nothingMessage || "I didn't hear a plan. Try \"soccer Saturday at 10\".");
  } else if (skipped.length) {
    reply += ` (skipped ${skipped.length}: ${skipped.map((s) => s.title || "one").join(", ")})`;
  }

  const record = {
    requestId: id, kidId, userId, source, at: now.toISOString(), text: words.slice(0, MAX_TEXT),
    items: items.map(({ action, ...rest }) => rest), skipped, reply, undone: false,
  };
  const list = famRecords(fam.id);
  list.push(record);
  prune(list, now.getTime());
  db.persist();
  return { result: publicResult(record), created: items };
}

/** Removes what one request added. Only the kid who made it, within a day. */
function undo({ fam, kidId, requestId, now = new Date() }) {
  const id = cleanRequestId(requestId);
  const rec = id && findRecord(fam.id, kidId, id);
  if (!rec) return { status: 404, error: "Nothing to undo." };
  if (rec.undone) return { result: publicResult(rec) };
  if (now.getTime() - Date.parse(rec.at) > UNDO_WINDOW_MS) return { status: 409, error: "That was over a day ago. Delete it from your list instead." };
  for (const it of rec.items) {
    if (it.type === "event") {
      const ev = events.getById(fam.id, it.id);
      if (ev && ev.kidId === kidId) events.removeEvent(fam.id, it.id);
    } else if (it.type === "reminder") {
      const a = actions.getAction(fam.id, it.id);
      if (a && actions.canKidEdit(a, kidId)) actions.deleteAction(fam.id, it.id);
    }
  }
  rec.undone = true;
  rec.reply = rec.items.length === 1 ? `Removed ${rec.items[0].title}.` : `Removed ${rec.items.length} things.`;
  db.persist();
  return { result: publicResult(rec) };
}

module.exports = {
  TOOLS, MAX_ITEMS, MAX_TEXT, disabledReason, addFromText, undo,
  _internal: { systemPrompt, summarize, nowIn, cleanTime, shortDay },
};
