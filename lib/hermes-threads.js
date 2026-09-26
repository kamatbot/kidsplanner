"use strict";
/**
 * Private Hermes threads and proactive nudges
 * (docs/HERMES-THREADS-CONTRACT.md).
 *
 * Every family member with their own login (parents, and kids signed in on
 * their own device) gets a one-to-one room with Hermes, stored in the chat
 * engine under the scope `hermes:<userId>`. Only the owner can read it, only
 * the owner is notified, and Hermes (the family's always-on Mac) answers it.
 *
 * A nudge is a Hermes chat message carrying a `hermes-nudge` card. This
 * module owns that card: which kinds exist, who may receive each, which
 * buttons each may carry, and what every button does. Button effects run
 * here, synchronously, under the pressing member's own authority, so a tap
 * never depends on the Mac being reachable. Kinds whose data drives a write
 * (dinner ideas, the week draft) are only ever built here, never accepted
 * from the Mac.
 */
const db = require("./db");
const family = require("./family");
const store = require("./store");
const chat = require("./chat");
const meals = require("./meals");
const recipes = require("./recipes");

const SCOPE_PREFIX = "hermes:";
const USER_ROOM_ID = "hermes";
const NUDGE_CARD_TYPE = "hermes-nudge";
const NUDGE_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9:+_.@~-]{2,159}$/;
const INDEX_RETENTION_MS = 14 * 86400000;
const MAX_TEXT = 600;
const MAX_LINES = 7; // a full week draft is seven rows
const MAX_LINE = 120;
const MAX_LABEL = 40;
const MAX_TITLE = 80;
const MAX_ACTIONS = 5;
const SNOOZE_MS = 30 * 60000;
const KID_REMINDER_GAP_MS = 60 * 60000;
const RECENT_DINNER_DAYS = 10;
const QUICK_MINUTES = 25;

// Who may receive each kind and which buttons it may carry. `name:*` allows
// any suffix (a kid id, a recipe id) that the handler re-validates.
const KINDS = {
  "day-end": { roles: ["parent"], actions: [] },
  "home-kid": { roles: ["kid"], actions: ["open-homework", "open-goals", "open-today", "later"] },
  "home-kid-later": { roles: ["kid"], actions: ["open-homework", "open-goals", "open-today"] },
  "home-kid-followup": { roles: ["kid"], actions: ["open-homework", "later"] },
  "home-parent": { roles: ["parent"], actions: ["nudge-kid:*", "dinner-ideas", "open-homework"] },
  "dinner-tonight": { roles: ["parent"], actions: ["dinner-ideas", "open-meals", "dismiss"] },
  "dinner-week": { roles: ["parent"], actions: ["dinner-draft-week", "open-meals", "dismiss"] },
  "kid-reminder": { roles: ["kid"], actions: ["open-homework"], internal: true },
  "dinner-ideas": { roles: ["parent"], actions: ["cook:*", "open-meals", "dismiss"], internal: true },
  "dinner-week-draft": { roles: ["parent"], actions: ["add-week", "open-meals", "dismiss"], internal: true },
  // Posted by the server when Hermes requests an Operator approval.
  "approval": { roles: ["parent"], actions: ["approve", "reject"], internal: true },
};
const OPEN_TARGETS = { "open-homework": "homework", "open-goals": "goals", "open-today": "today", "open-meals": "meals" };
const DISMISS_LABELS = {
  "dinner-tonight": "You've got dinner",
  "dinner-week": "Skipped this week",
  "dinner-ideas": "No problem",
  "dinner-week-draft": "Draft set aside",
};

class ThreadError extends Error {
  constructor(message, status = 400) { super(message); this.name = "ThreadError"; this.status = status; }
}

// Lazy: hermes-proactive requires this module at load.
function proactive() { return require("./hermes-proactive"); }

function cleanText(value, max) {
  return Array.from(String(value == null ? "" : value).replace(/\s+/g, " ").trim()).slice(0, max).join("");
}
function shorten(value, max) {
  const chars = Array.from(cleanText(value, 400));
  return chars.length > max ? chars.slice(0, max - 1).join("").trimEnd() + "…" : chars.join("");
}
function normTitle(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function firstName(value, fallback) { return String(value || "").trim().split(/\s+/)[0] || fallback; }
function profileName(user) { return (user && user.data && user.data.profile && user.data.profile.name) || ""; }

// ---------- thread ownership ----------
function scopeFor(userId) { return SCOPE_PREFIX + userId; }
function isHermesScope(scopeKey) {
  return typeof scopeKey === "string" && scopeKey.startsWith(SCOPE_PREFIX) && scopeKey.length > SCOPE_PREFIX.length;
}
function familyForUser(user) {
  if (!user) return null;
  if (user.data && user.data.kid) return family.familyForKidUser(user);
  return family.familiesForUser(user.id)[0] || null;
}
function memberFor(fam, userId) {
  if (!fam || typeof userId !== "string" || !userId) return null;
  const user = store.getUser(userId);
  if (!user) return null;
  if ((fam.parentIds || []).includes(userId)) {
    return { userId, role: "parent", name: firstName(profileName(user), "Parent") };
  }
  const link = user.data && user.data.kid;
  if (link && link.familyId === fam.id) {
    const kid = (fam.kids || []).find((k) => k.id === link.kidId);
    if (kid) return { userId, role: "kid", kidId: kid.id, name: firstName(kid.name || profileName(user), "Kid") };
  }
  return null;
}
function membersOf(fam) {
  if (!fam) return [];
  const ids = [...(fam.parentIds || []), ...store.listKidUserIdsForFamily(fam.id)];
  return [...new Set(ids)].map((id) => memberFor(fam, id)).filter(Boolean);
}
function ownerOfScope(scopeKey) {
  if (!isHermesScope(scopeKey)) return null;
  const userId = scopeKey.slice(SCOPE_PREFIX.length);
  const fam = familyForUser(store.getUser(userId));
  const member = memberFor(fam, userId);
  return member ? { fam, member } : null;
}

// ---------- card contract ----------
function allowedAction(kind, id) {
  return (KINDS[kind] ? KINDS[kind].actions : []).some((rule) => (rule.endsWith(":*")
    ? id.startsWith(rule.slice(0, -1)) && id.length > rule.length - 1
    : rule === id));
}
function normalizeActions(kind, actions, fam) {
  if (actions == null) return [];
  if (!Array.isArray(actions) || actions.length > MAX_ACTIONS) throw new ThreadError("A nudge carries at most five buttons.");
  const seen = new Set();
  return actions.map((raw) => {
    const id = raw && typeof raw.id === "string" ? raw.id.trim() : "";
    if (!id || id.length > 120 || seen.has(id) || !allowedAction(kind, id)) {
      throw new ThreadError(`The button "${cleanText(id, 40)}" isn't allowed on ${kind}.`);
    }
    if (id.startsWith("nudge-kid:") && !(fam.kids || []).some((k) => k.id === id.slice("nudge-kid:".length))) {
      throw new ThreadError("That child isn't in this family.");
    }
    const label = cleanText(raw.label, MAX_LABEL);
    if (!label) throw new ThreadError("Every button needs a label.");
    seen.add(id);
    return { id, label, style: raw.style === "primary" ? "primary" : "secondary", open: OPEN_TARGETS[id] || null, done: false, doneLabel: null };
  });
}
function normalizeCard(input, { member, fam, nudgeKey, internal }) {
  const kind = input && input.kind;
  const rule = Object.prototype.hasOwnProperty.call(KINDS, kind) ? KINDS[kind] : null;
  if (!rule || (rule.internal && !internal)) throw new ThreadError("Unknown nudge kind.");
  if (!rule.roles.includes(member.role)) throw new ThreadError(`A ${kind} nudge can't go to a ${member.role}.`, 403);
  const lines = Array.isArray(input.lines)
    ? input.lines.slice(0, MAX_LINES).map((line) => cleanText(line, MAX_LINE)).filter(Boolean)
    : [];
  const data = {};
  if (kind === "day-end" && input.data && Array.isArray(input.data.covers)) {
    data.covers = input.data.covers.slice(0, 12).map((c) => cleanText(c, 80)).filter(Boolean);
  }
  if (internal && input.data && typeof input.data === "object") Object.assign(data, input.data);
  return {
    type: NUDGE_CARD_TYPE,
    id: nudgeKey,
    kind,
    title: cleanText(input.title, MAX_TITLE) || null,
    lines,
    actions: normalizeActions(kind, input.actions, fam),
    state: { status: "open", label: null, at: null, by: null, until: null },
    data,
  };
}

// ---------- idempotent delivery ----------
// db root `hermesNudges[familyId]["<userId>|<nudgeKey>"] = { userId, nudgeKey,
// kind, messageId, postedAt }`: ids and times only. It makes posting
// idempotent across Mac restarts and is the parent-visible record of what
// Hermes sent.
function familyIndex(familyId) {
  const root = db.load();
  if (!root.hermesNudges) root.hermesNudges = {};
  if (!root.hermesNudges[familyId]) root.hermesNudges[familyId] = {};
  return root.hermesNudges[familyId];
}
function pruneIndex(index, nowMs) {
  for (const [key, entry] of Object.entries(index)) {
    if (!entry || !(nowMs - Date.parse(entry.postedAt) <= INDEX_RETENTION_MS)) delete index[key];
  }
}

let notifier = null;
function setNotifier(fn) { notifier = fn; }
function notifyOwner(fam, userId, message) {
  const send = notifier || ((payload) => require("./fam-notifications").notifyHermesThread(payload));
  Promise.resolve()
    .then(() => send({ userId, familyId: fam.id, text: message.text, messageId: message.id }))
    .catch(() => { /* a push failure never undoes a delivered message */ });
}

function postNudge(fam, { userId, nudgeKey, text, card }, { internal = false, silent = false, now = new Date() } = {}) {
  if (!fam) throw new ThreadError("Family not found.", 404);
  if (typeof nudgeKey !== "string" || !NUDGE_KEY_RE.test(nudgeKey)) throw new ThreadError("Invalid nudge key.");
  const member = memberFor(fam, userId);
  if (!member) throw new ThreadError("That person isn't in this family.", 404);
  const index = familyIndex(fam.id);
  const key = `${userId}|${nudgeKey}`;
  if (index[key]) {
    const existing = chat.getMessage(scopeFor(userId), index[key].messageId);
    if (existing && !existing.deleted) return { message: existing, created: false };
  }
  const body = cleanText(text, MAX_TEXT);
  if (!body) throw new ThreadError("A nudge needs text.");
  const normalized = normalizeCard(card, { member, fam, nudgeKey, internal });
  const result = chat.sendMessage(scopeFor(userId), { senderType: "agent", text: body, card: normalized });
  if (result.error) throw new ThreadError(result.error, result.status || 400);
  pruneIndex(index, now.getTime());
  index[key] = { userId, nudgeKey, kind: normalized.kind, messageId: result.message.id, postedAt: result.message.createdAt };
  db.persist();
  if (!silent) notifyOwner(fam, userId, result.message);
  return { message: result.message, created: true };
}

function postReply(fam, userId, text) {
  const member = memberFor(fam, userId);
  if (!member) throw new ThreadError("That person isn't in this family.", 404);
  const result = chat.sendMessage(scopeFor(userId), { senderType: "agent", text: cleanText(text, 4000) });
  if (result.error) throw new ThreadError(result.error, result.status || 400);
  notifyOwner(fam, userId, result.message);
  return result.message;
}

function sentFor(fam, since) {
  const sinceMs = since ? since.getTime() : 0;
  const out = [];
  for (const entry of Object.values(familyIndex(fam.id))) {
    if (!entry || !(Date.parse(entry.postedAt) >= sinceMs)) continue;
    const message = chat.getMessage(scopeFor(entry.userId), entry.messageId);
    const card = message && !message.deleted && message.card && message.card.type === NUDGE_CARD_TYPE ? message.card : null;
    out.push({
      userId: entry.userId,
      nudgeKey: entry.nudgeKey,
      kind: entry.kind,
      messageId: entry.messageId,
      postedAt: entry.postedAt,
      status: card ? card.state.status : "gone",
      until: card ? card.state.until || null : null,
      covers: card && card.data && Array.isArray(card.data.covers) ? card.data.covers : [],
    });
  }
  return out.sort((a, b) => a.postedAt.localeCompare(b.postedAt));
}

// ---------- buttons ----------
function applyAction({ fam, member, messageId, actionId, now = new Date() }) {
  const scopeKey = scopeFor(member.userId);
  const message = typeof messageId === "string" && messageId ? chat.getMessage(scopeKey, messageId) : null;
  if (!message || message.deleted || message.senderType !== "agent" || !message.card || message.card.type !== NUDGE_CARD_TYPE) {
    throw new ThreadError("That message isn't in your Hermes thread.", 404);
  }
  const card = JSON.parse(JSON.stringify(message.card));
  const action = (card.actions || []).find((a) => a.id === actionId);
  if (!action) throw new ThreadError("Unknown action.");
  if (action.open) throw new ThreadError("That button opens a screen in the app.");
  const rule = KINDS[card.kind];
  if (!rule || !rule.roles.includes(member.role)) throw new ThreadError("That action isn't available to you.", 403);
  if (card.state.status !== "open" || action.done) return { message, messages: [], alreadyDone: true };

  const ctx = { fam, member, message, card, action, now, followUps: [] };
  handlerFor(actionId)(ctx);
  const updated = chat.updateCard(scopeKey, message.id, ctx.card) || Object.assign({}, message, { card: ctx.card });
  return { message: updated, messages: ctx.followUps, alreadyDone: false };
}

function handlerFor(id) {
  if (id === "approve") return (ctx) => decideApprovalCard(ctx, "approve");
  if (id === "reject") return (ctx) => decideApprovalCard(ctx, "reject");
  if (id === "dismiss") return dismiss;
  if (id === "later") return later;
  if (id === "dinner-ideas") return dinnerIdeas;
  if (id === "dinner-draft-week") return draftWeek;
  if (id === "add-week") return addWeek;
  if (id.startsWith("nudge-kid:")) return nudgeKid;
  if (id.startsWith("cook:")) return cook;
  throw new ThreadError("Unknown action.");
}

function resolveCard(ctx, status, label, extra = {}) {
  ctx.card.state = Object.assign({ status, label: cleanText(label, 120), at: ctx.now.toISOString(), by: ctx.member.userId, until: null }, extra);
}
function markDone(ctx, doneLabel) {
  const action = ctx.card.actions.find((a) => a.id === ctx.action.id);
  action.done = true;
  action.doneLabel = shorten(doneLabel, MAX_LABEL);
  if (ctx.card.actions.every((a) => a.open || a.done)) resolveCard(ctx, "done", ctx.card.actions.filter((a) => a.done).map((a) => a.doneLabel).join(" · "));
}
// A button on the parent evening card finishes only itself; on single-purpose
// cards it finishes the card.
function finishSource(ctx, label) {
  if (ctx.card.kind === "home-parent") markDone(ctx, label);
  else resolveCard(ctx, "done", label);
}
function followUp(ctx, suffix, text, card) {
  const { message } = postNudge(ctx.fam, { userId: ctx.member.userId, nudgeKey: `${ctx.card.id}~${suffix}`.slice(0, 160), text, card },
    { internal: true, silent: true, now: ctx.now });
  ctx.followUps.push(message);
}
function requireParent(ctx) {
  if (ctx.member.role !== "parent") throw new ThreadError("Only a parent can do that.", 403);
}
function clock(ctx) {
  const p = proactive();
  const tz = p.familyTimezone(ctx.fam);
  return { p, tz, today: p.dateKey(ctx.now, tz) };
}

function dismiss(ctx) { resolveCard(ctx, "dismissed", DISMISS_LABELS[ctx.card.kind] || "Okay"); }

function later(ctx) {
  const { p, tz } = clock(ctx);
  const until = new Date(ctx.now.getTime() + SNOOZE_MS);
  resolveCard(ctx, "snoozed", `I'll remind you at ${p.formatClock(until, tz)}`, { until: until.toISOString() });
}

function nudgeKid(ctx) {
  requireParent(ctx);
  const kidId = ctx.action.id.slice("nudge-kid:".length);
  const kid = (ctx.fam.kids || []).find((k) => k.id === kidId);
  if (!kid) throw new ThreadError("That child isn't in this family.", 404);
  const kidName = firstName(kid.name, "your child");
  const devices = membersOf(ctx.fam).filter((m) => m.role === "kid" && m.kidId === kidId);
  if (!devices.length) { markDone(ctx, `${kidName} has no device yet`); return; }
  const recent = Object.values(familyIndex(ctx.fam.id)).some((e) => e && e.kind === "kid-reminder"
    && devices.some((m) => m.userId === e.userId) && ctx.now.getTime() - Date.parse(e.postedAt) < KID_REMINDER_GAP_MS);
  if (recent) { markDone(ctx, `Reminded ${kidName} recently`); return; }
  const { p, today } = clock(ctx);
  const first = p.kidTonight(ctx.fam, kidId, today).dueTomorrow[0];
  const text = first
    ? `${ctx.member.name} asked me to remind you: ${first.title} is due tomorrow.`
    : `${ctx.member.name} asked me to remind you to check tonight's homework.`;
  for (const device of devices) {
    postNudge(ctx.fam, {
      userId: device.userId,
      nudgeKey: `kid-reminder:${today}:${kidId}:${ctx.now.getTime()}`,
      text,
      card: { kind: "kid-reminder", actions: [{ id: "open-homework", label: "Open homework", style: "primary" }] },
    }, { internal: true, now: ctx.now });
  }
  markDone(ctx, `Reminded ${kidName}`);
}

// ---------- dinner ----------
// Mirrors lib/routes/meals.js: allergies of every household member plus the
// family's avoid-list are hard exclusions.
function household(fam) {
  const resolveParentProfile = (userId) => {
    const user = store.getUser(userId);
    if (!user) return null;
    const p = (user.data && user.data.profile) || {};
    return { name: p.name || null, portion: p.portion, allergies: p.allergies, proteinTargetG: p.proteinTargetG != null ? p.proteinTargetG : null };
  };
  return meals.buildHousehold(fam, resolveParentProfile);
}
function excludeTerms(fam, prefs) {
  const terms = new Set();
  for (const m of household(fam).members || []) for (const a of m.allergies || []) terms.add(String(a).toLowerCase().trim());
  for (const a of (prefs && prefs.avoid) || []) terms.add(String(a).toLowerCase().trim());
  return [...terms].filter(Boolean);
}
// `maxMinutes` keeps tonight's ideas cookable in the time left before dinner.
function suggestDinners(fam, { count, today, quick = false, maxMinutes = null }) {
  const p = proactive();
  const state = meals.getState(fam.id);
  const prefs = state.prefs || {};
  const targets = prefs.targets || {};
  const recentFrom = p.addDays(today, -RECENT_DINNER_DAYS);
  const recentTo = p.addDays(today, 14);
  const recent = new Set((state.menu || [])
    .filter((e) => e && e.date >= recentFrom && e.date <= recentTo)
    .map((e) => normTitle(e.title)));
  const pool = recipes.suggest(state.pantry, {
    count: Math.max(count * 6, 18),
    slots: ["dinner"],
    avoid: prefs.avoid || [],
    allergens: excludeTerms(fam, prefs),
    diets: prefs.diets || [],
    minProteinG: targets.proteinGPerMeal || undefined,
    minFiberG: targets.fiberGPerMeal || undefined,
  }).filter((r) => r && !recent.has(normTitle(r.title)));
  const isQuick = (r) => Number(r.timeMins) > 0 && Number(r.timeMins) <= QUICK_MINUTES;
  const fits = (r) => maxMinutes == null || !(Number(r.timeMins) > maxMinutes);
  const inTime = pool.filter(fits);
  // If nothing fits the time left, the quickest options are the honest answer.
  const usable = inTime.length ? inTime : [...pool].sort((a, b) => (Number(a.timeMins) || 999) - (Number(b.timeMins) || 999));
  const ordered = quick ? [...usable.filter(isQuick), ...usable.filter((r) => !isQuick(r))] : usable;
  const out = [];
  const seen = new Set();
  for (const recipe of ordered) {
    const key = normTitle(recipe.title);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ recipe, coverage: recipes.coverage(recipe, state.pantry) });
    if (out.length >= count) break;
  }
  return out;
}
function ideaLine({ recipe, coverage }) {
  const total = (recipe.ingredients || []).length;
  const bits = [shorten(recipe.title, 60)];
  if (Number(recipe.timeMins) > 0) bits.push(`${recipe.timeMins} min`);
  if (total) bits.push(`you have ${coverage.have.length} of ${total}`);
  return bits.join(" · ");
}
function addMissingToShopping(familyId, userId, recipeId, alreadyAdded) {
  const recipe = recipes.byId(recipeId);
  if (!recipe) return 0;
  const state = meals.getState(familyId);
  const onList = new Set((state.shopping || []).filter((s) => s && !s.done).map((s) => normTitle(s.text)));
  let added = 0;
  for (const name of recipes.coverage(recipe, state.pantry).coreMissing) {
    const key = normTitle(name);
    if (!key || onList.has(key) || alreadyAdded.has(key)) continue;
    const result = meals.addShoppingItem(familyId, userId, { text: name });
    if (!result.error) { onList.add(key); alreadyAdded.add(key); added += 1; }
  }
  return added;
}
function addDinner(ctx, day, recipeId, shopped) {
  const result = meals.addHermesMenuEntry(ctx.fam.id, ctx.member.userId, {
    date: day, slot: "dinner", recipeId, servesPortions: household(ctx.fam).totalPortions, sourceId: ctx.message.id,
  });
  if (result.error) throw new ThreadError(result.error);
  meals.stampPrepSchedule(ctx.fam.id, result.entry.id);
  return { title: result.entry.title, shopping: addMissingToShopping(ctx.fam.id, ctx.member.userId, recipeId, shopped) };
}
function shoppingPhrase(n) { return n ? `${n} to shopping` : "nothing to buy"; }
function dayWord(day, today) {
  if (day === today) return "tonight";
  const d = new Date(`${day}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

function dinnerIdeas(ctx) {
  requireParent(ctx);
  const { p, tz, today } = clock(ctx);
  const planned = p.dinnerOn(ctx.fam.id, today);
  if (planned) { finishSource(ctx, `Dinner's planned: ${shorten(planned.title, 40)}`); return; }
  const busy = p.busyEveningTitle(ctx.fam, today, tz, ctx.now);
  const minutesLeft = Math.floor((Date.parse(p.dinnerFacts(ctx.fam, today, tz).at) - ctx.now.getTime()) / 60000);
  const ideas = suggestDinners(ctx.fam, { count: 3, today, quick: !!busy, maxMinutes: Math.max(20, minutesLeft) });
  if (!ideas.length) {
    followUp(ctx, "ideas", "I couldn't find a good match in your recipes and pantry. Meals has the full library.", {
      kind: "dinner-ideas", actions: [{ id: "open-meals", label: "Open Meals", style: "primary" }], data: { date: today, ideas: [] },
    });
  } else {
    followUp(ctx, "ideas", busy
      ? `It's a ${busy.toLowerCase()} night, so here are ${ideas.length} quick ideas for tonight:`
      : `Here are ${ideas.length} ideas for tonight:`, {
      kind: "dinner-ideas",
      lines: ideas.map(ideaLine),
      actions: [
        ...ideas.map(({ recipe }) => ({ id: `cook:${recipe.id}`, label: `Cook ${shorten(recipe.title, MAX_LABEL - 5)}`, style: "secondary" })),
        { id: "dismiss", label: "None of these", style: "secondary" },
      ],
      data: { date: today, ideas: ideas.map(({ recipe }) => ({ recipeId: recipe.id, title: recipe.title })) },
    });
  }
  finishSource(ctx, "Ideas below");
}

function cook(ctx) {
  requireParent(ctx);
  const recipeId = ctx.action.id.slice("cook:".length);
  const idea = ((ctx.card.data && ctx.card.data.ideas) || []).find((i) => i.recipeId === recipeId);
  if (!idea) throw new ThreadError("That idea isn't on this card.");
  const { p, today } = clock(ctx);
  const day = ctx.card.data.date || today;
  const planned = p.dinnerOn(ctx.fam.id, day);
  if (planned) { resolveCard(ctx, "done", `Dinner's already planned: ${shorten(planned.title, 60)}`); return; }
  const added = addDinner(ctx, day, recipeId, new Set());
  resolveCard(ctx, "done", `Added ${shorten(added.title, 50)} for ${dayWord(day, today)} · ${shoppingPhrase(added.shopping)}`);
}

function draftWeek(ctx) {
  requireParent(ctx);
  const { p, today } = clock(ctx);
  const start = p.nextMonday(today);
  const open = Array.from({ length: 7 }, (_, i) => p.addDays(start, i)).filter((day) => !p.dinnerOn(ctx.fam.id, day));
  if (!open.length) { resolveCard(ctx, "done", "Next week's dinners are all planned"); return; }
  const ideas = suggestDinners(ctx.fam, { count: open.length, today });
  if (!ideas.length) {
    followUp(ctx, "draft", "I couldn't draft next week from your recipes and pantry. Meals has the full library.", {
      kind: "dinner-week-draft", actions: [{ id: "open-meals", label: "Open Meals", style: "primary" }], data: { plan: [] },
    });
    resolveCard(ctx, "done", "Nothing to draft");
    return;
  }
  const plan = open.slice(0, ideas.length).map((day, i) => ({ date: day, recipeId: ideas[i].recipe.id, title: ideas[i].recipe.title }));
  const n = plan.length;
  followUp(ctx, "draft", `Here's a draft for the ${n} open dinner${n === 1 ? "" : "s"} next week:`, {
    kind: "dinner-week-draft",
    lines: plan.map((item) => `${dayWord(item.date, null)} · ${shorten(item.title, 80)}`),
    actions: [
      { id: "add-week", label: `Add all ${n}`, style: "primary" },
      { id: "open-meals", label: "Edit in Meals", style: "secondary" },
      { id: "dismiss", label: "Not now", style: "secondary" },
    ],
    data: { plan },
  });
  resolveCard(ctx, "done", "Draft below");
}

function addWeek(ctx) {
  requireParent(ctx);
  const plan = Array.isArray(ctx.card.data && ctx.card.data.plan) ? ctx.card.data.plan : [];
  const { p } = clock(ctx);
  const shopped = new Set();
  let added = 0;
  let skipped = 0;
  let shopping = 0;
  for (const item of plan) {
    if (!item || p.dinnerOn(ctx.fam.id, item.date)) { skipped += 1; continue; }
    try {
      shopping += addDinner(ctx, item.date, item.recipeId, shopped).shopping;
      added += 1;
    } catch (_) { skipped += 1; }
  }
  if (!added) { resolveCard(ctx, "done", "Those nights are already planned"); return; }
  const extra = skipped ? ` · ${skipped} already planned` : "";
  resolveCard(ctx, "done", `Added ${added} dinner${added === 1 ? "" : "s"} · ${shoppingPhrase(shopping)}${extra}`);
}

// ---------- Operator approvals ----------
// When Hermes asks for a parent's OK, the approver (or every parent, if none
// is named) gets the exact proposal in their thread with Approve / Reject.
// The buttons run the same decideApproval → continueApproved path as the web
// Today case card, with the tapping parent as the actor and the action hash
// the card was built from, so a changed proposal can never be approved here.
const APPROVAL_VERBS = {
  "calendar.create": (title) => `add “${title}” to the calendar`,
  "calendar.update": (title) => `update “${title}” on the calendar`,
  "action.create": (title) => `add the reminder “${title}”`,
  "action.update": (title) => `update the reminder “${title}”`,
  "trip.itinerary.update": (title) => `update the trip plan with “${title}”`,
};
const APPROVAL_DONE = {
  "calendar.create": "Approved · added to the calendar",
  "calendar.update": "Approved · calendar updated",
  "action.create": "Approved · reminder added",
  "action.update": "Approved · reminder updated",
  "trip.itinerary.update": "Approved · trip plan updated",
};
const APPROVAL_ERRORS = {
  APPROVAL_NOT_PENDING: "Already decided",
  APPROVAL_EXPIRED: "This approval expired",
  APPROVAL_WRONG_APPROVER: "Assigned to another parent",
  APPROVAL_HASH_MISMATCH: "The proposal changed · see Today",
};
function describeApproval(fam, approval) {
  const action = approval.action && typeof approval.action === "object" ? approval.action : {};
  const title = shorten(action.title || action.name || "this", 80);
  const verb = APPROVAL_VERBS[approval.actionType];
  const text = verb ? `Hermes needs your OK to ${verb(title)}.` : `Hermes needs your OK for ${cleanText(approval.actionType, 60)}: “${title}”.`;
  const lines = [];
  const when = [
    typeof action.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(action.date) ? dayWord(action.date, null) : null,
    typeof action.time === "string" && action.time ? (action.endTime ? `${action.time}–${action.endTime}` : action.time) : null,
  ].filter(Boolean).join(" · ");
  if (when) lines.push(`When · ${when}`);
  const kid = action.kidId && (fam.kids || []).find((k) => k.id === action.kidId);
  if (kid) lines.push(`For · ${firstName(kid.name, "your child")}`);
  if (action.dueDate) lines.push(`Due · ${/^\d{4}-\d{2}-\d{2}$/.test(action.dueDate) ? dayWord(action.dueDate, null) : cleanText(action.dueDate, 30)}`);
  if (action.notes) lines.push(`Notes · ${shorten(action.notes, 100)}`);
  return { text, lines: lines.slice(0, 4) };
}
function notifyApprovalRequested(fam, approval) {
  if (!fam || !approval || !approval.id || !approval.actionHash) return [];
  const parents = membersOf(fam).filter((m) => m.role === "parent");
  const recipients = approval.approverUserId ? parents.filter((m) => m.userId === approval.approverUserId) : parents;
  const { text, lines } = describeApproval(fam, approval);
  return recipients.map((m) => postNudge(fam, {
    userId: m.userId,
    nudgeKey: `approval:${approval.id}`,
    text,
    card: {
      kind: "approval",
      lines,
      actions: [{ id: "approve", label: "Approve", style: "primary" }, { id: "reject", label: "Reject" }],
      data: { approvalId: approval.id, actionHash: approval.actionHash, actionType: approval.actionType, caseId: approval.caseId || null },
    },
  }, { internal: true }).message);
}
// Every other copy of an approval card (the other parent's, or all of them when
// the web Today card decided) shows the outcome instead of stale buttons.
function resolveApprovalCards(fam, approvalId, label, { exceptMessageId = null, by = null, now = new Date() } = {}) {
  if (!fam || !approvalId) return 0;
  let resolved = 0;
  for (const entry of Object.values(familyIndex(fam.id))) {
    if (!entry || entry.nudgeKey !== `approval:${approvalId}` || entry.messageId === exceptMessageId) continue;
    const scopeKey = scopeFor(entry.userId);
    const message = chat.getMessage(scopeKey, entry.messageId);
    if (!message || message.deleted || !message.card || message.card.state.status !== "open") continue;
    const card = JSON.parse(JSON.stringify(message.card));
    card.state = { status: "done", label: cleanText(label, 120), at: now.toISOString(), by, until: null };
    chat.updateCard(scopeKey, message.id, card);
    resolved += 1;
  }
  return resolved;
}
function decideApprovalCard(ctx, decision) {
  requireParent(ctx);
  const { approvalId, actionHash, actionType } = ctx.card.data || {};
  if (!approvalId || !actionHash) throw new ThreadError("This approval card is incomplete.");
  const operatorExecution = require("./operator-execution");
  const actor = { type: "parent", principalId: ctx.member.userId, userId: ctx.member.userId, name: ctx.member.name };
  let result;
  try {
    result = operatorExecution.decideApproval(ctx.fam.id, approvalId, { actor, decision, actionHash });
  } catch (error) {
    resolveCard(ctx, "dismissed", APPROVAL_ERRORS[error && error.code] || "Couldn't decide here · see Today");
    return;
  }
  if (!result) { resolveCard(ctx, "dismissed", "This approval is no longer available"); return; }
  const others = { exceptMessageId: ctx.message.id, by: ctx.member.userId, now: ctx.now };
  if (decision === "reject") {
    resolveCard(ctx, "done", "Rejected");
    resolveApprovalCards(ctx.fam, approvalId, `Rejected by ${ctx.member.name}`, others);
    return;
  }
  resolveApprovalCards(ctx.fam, approvalId, `Approved by ${ctx.member.name}`, others);
  let label = "Approved · Hermes will finish it";
  try {
    const continuation = require("./operator-live-execution").continueApproved(ctx.fam.id, approvalId, ctx.member.userId);
    if (continuation && continuation.state === "completed") label = APPROVAL_DONE[actionType] || "Approved · done";
    else if (continuation && continuation.state === "blocked") label = "Approved · couldn't run yet, see Today";
  } catch (_) { /* the approval stands; the Mac's recovery loop retries */ }
  resolveCard(ctx, "done", label);
}

module.exports = {
  SCOPE_PREFIX,
  USER_ROOM_ID,
  NUDGE_CARD_TYPE,
  KINDS,
  ThreadError,
  scopeFor,
  isHermesScope,
  familyForUser,
  memberFor,
  membersOf,
  ownerOfScope,
  normalizeCard,
  postNudge,
  postReply,
  sentFor,
  applyAction,
  suggestDinners,
  notifyApprovalRequested,
  resolveApprovalCards,
  setNotifier,
};
