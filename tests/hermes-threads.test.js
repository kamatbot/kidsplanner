"use strict";

// Private Hermes threads + proactive nudges (docs/HERMES-THREADS-CONTRACT.md).
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-hermes-threads-"));
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");

const store = require("../lib/store");
const db = require("../lib/db");
const family = require("../lib/family");
const chat = require("../lib/chat");
const hermes = require("../lib/hermes");
const homework = require("../lib/homework");
const goals = require("../lib/goals");
const events = require("../lib/events");
const activities = require("../lib/activities");
const meals = require("../lib/meals");
const childInsights = require("../lib/child-insights");
const hermesThreads = require("../lib/hermes-threads");
const hermesProactive = require("../lib/hermes-proactive");
const hermesRoutes = require("../lib/routes/hermes");
const threadRoutes = require("../lib/routes/hermes-threads");
const chatRoutes = require("../lib/routes/chat");

const pushes = [];
hermesThreads.setNotifier(async (payload) => { pushes.push(payload); });

// Friday 25 Sep 2026, 15:00 in Bangkok.
const NOW = new Date("2026-09-25T08:00:00.000Z");
const TODAY = "2026-09-25";
const TOMORROW = "2026-09-26";

let counter = 0;
function freshUser(label) {
  counter += 1;
  return store.createUser(`${label}${counter}@example.com`, `${label} Person`);
}
function userRole(user) {
  if (user && user.data && user.data.kid) return "kid";
  return (user && user.data && user.data.profile && user.data.profile.role) || "parent";
}
function setup(label = "Rings") {
  const parent = freshUser(`${label}Parent`);
  const fam = family.createFamily(parent.id, `${label} Family`);
  const ryshi = family.addKid(fam.id, parent.id, { name: "Ryshi" }).kid;
  const arya = family.addKid(fam.id, parent.id, { name: "Arya" }).kid;
  const ryshiUser = store.findOrCreateKidUser(fam.id, ryshi.id, "Ryshi");
  const aryaUser = store.findOrCreateKidUser(fam.id, arya.id, "Arya");
  return { parent, fam: family.getFamily(fam.id), ryshi, arya, ryshiUser, aryaUser };
}

function harness() {
  const routes = {};
  const register = (method) => (pattern, ...handlers) => { routes[`${method} ${pattern}`] = { method, handlers }; };
  const app = { get: register("GET"), post: register("POST"), delete: register("DELETE"), patch: register("PATCH") };
  const deps = {
    hermes, family, chat, store, events, homework, meals, userRole,
    notifications: {
      notifyChatMessage: async (...args) => pushes.push({ kind: "family", args }),
      notifyTripChatMessage: async () => {},
      notifyHermesThread: async (payload) => pushes.push(Object.assign({ kind: "hermes-reply" }, payload)),
    },
    requireAuth: (req, res, next) => (req.user ? next() : res.status(401).json({ error: "Not authenticated" })),
    requireParent: (req, res, next) => (userRole(req.user) === "kid" ? res.status(403).json({ error: "Parents only." }) : next()),
    requireFamily: (req, res, next) => next(),
    gifLimiter: (req, res, next) => next(),
    gifs: {},
    trips: require("../lib/trips"),
  };
  hermesRoutes(app, deps);
  threadRoutes(app, deps);
  chatRoutes(app, deps);
  return routes;
}

function invoke(route, { user = null, body, params, query, headers } = {}) {
  assert.ok(route, "route exists");
  return new Promise((resolve, reject) => {
    let settled = false;
    const res = {
      statusCode: 200, body: null, headers: {},
      set(name, value) { this.headers[String(name).toLowerCase()] = value; return this; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { if (settled) return this; settled = true; this.body = payload; resolve(this); return this; },
      once() {},
    };
    const normalized = Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    const req = {
      method: route.method, body: body || {}, params: params || {}, query: query || {}, user, protocol: "https",
      headers: normalized, get(name) { return normalized[String(name).toLowerCase()]; }, on() {},
    };
    let index = 0;
    const run = () => (index < route.handlers.length ? route.handlers[index++](req, res, run) : undefined);
    Promise.resolve().then(run).catch((error) => { if (!settled) reject(error); });
  });
}

function connect(fam) {
  const { token } = hermes.connectFamily(fam.id);
  return { authorization: `Bearer ${token}` };
}

test("every family login gets a private Hermes room; nobody else can read it", async () => {
  const { parent, fam, ryshiUser, aryaUser } = setup("Rooms");
  const routes = harness();

  const parentRooms = await invoke(routes["GET /api/chat/rooms"], { user: parent });
  assert.deepEqual(parentRooms.body.find((r) => r.roomId === "hermes"), { roomId: "hermes", title: "Hermes", kind: "assistant" });
  const kidRooms = await invoke(routes["GET /api/chat/rooms"], { user: ryshiUser });
  assert.ok(kidRooms.body.some((r) => r.roomId === "hermes"));

  const sent = await invoke(routes["POST /api/hermes/thread/messages"], { user: ryshiUser, body: { text: "Is maths due tomorrow?" } });
  assert.equal(sent.statusCode, 200);
  assert.equal(sent.body.message.senderType, "kid");
  assert.equal(sent.body.message.roomId, "hermes");

  const own = await invoke(routes["GET /api/hermes/thread/messages"], { user: ryshiUser });
  assert.deepEqual(own.body.messages.map((m) => m.text), ["Is maths due tomorrow?"]);
  const sibling = await invoke(routes["GET /api/hermes/thread/messages"], { user: aryaUser });
  assert.deepEqual(sibling.body.messages, []);
  const parentView = await invoke(routes["GET /api/hermes/thread/messages"], { user: parent });
  assert.deepEqual(parentView.body.messages, []);
  // Family chat never shows thread messages.
  assert.ok(!chat.listMessages(fam.id).some((m) => m.text === "Is maths due tomorrow?"));

  const withCard = await invoke(routes["POST /api/hermes/thread/messages"], { user: parent, body: { text: "hi", card: { type: "hermes-nudge" } } });
  assert.equal(withCard.statusCode, 400);
  const outsider = await invoke(routes["GET /api/hermes/thread/messages"], { user: freshUser("Outsider") });
  assert.equal(outsider.statusCode, 404);
});

test("the Mac bridge hears every private-thread message, scoped to its owner", async () => {
  const { parent, fam, ryshi, arya, ryshiUser } = setup("Bridge");
  homework.addHomework(fam.id, { kidId: ryshi.id, title: "Ryshi maths", dueDate: TOMORROW });
  homework.addHomework(fam.id, { kidId: arya.id, title: "Arya secret project", dueDate: TOMORROW });
  const routes = harness();
  const auth = connect(fam);
  const roomId = `hermes:${ryshiUser.id}`;

  const rooms = await invoke(routes["GET /api/hermes/rooms"], { headers: auth });
  assert.ok(rooms.body.rooms.some((r) => r.roomId === roomId && r.kind === "assistant" && r.title === "Hermes · Ryshi"));
  assert.ok(rooms.body.rooms.some((r) => r.roomId === `hermes:${parent.id}`));

  const first = await invoke(routes["GET /api/hermes/rooms/:roomId/messages"], { headers: auth, params: { roomId } });
  await invoke(routes["POST /api/hermes/thread/messages"], { user: ryshiUser, body: { text: "what's due tomorrow" } });
  const inbound = await invoke(routes["GET /api/hermes/rooms/:roomId/messages"], { headers: auth, params: { roomId }, query: { afterId: first.body.cursor || "__hermes_empty__" } });
  const message = inbound.body.messages.find((m) => m.text === "what's due tomorrow");
  assert.ok(message, "no @Hermes mention needed in a private thread");
  assert.equal(message.actor.type, "kid");
  assert.match(message.actorToken, /^opact1\./);
  assert.ok(Array.isArray(message.recentHermes));

  const context = await invoke(routes["GET /api/hermes/rooms/:roomId/context"], { headers: auth, params: { roomId } });
  assert.equal(context.statusCode, 200);
  assert.ok(!context.body.sections.preferences, "kid ceiling applies");
  const titles = context.body.sections.homework.items.map((h) => h.title);
  assert.ok(titles.includes("Ryshi maths"));
  assert.ok(!titles.includes("Arya secret project"), "siblings' rows are removed");

  pushes.length = 0;
  const reply = await invoke(routes["POST /api/hermes/rooms/:roomId/messages"], { headers: auth, params: { roomId }, body: { text: "Maths is due tomorrow." } });
  assert.equal(reply.statusCode, 200);
  assert.deepEqual(pushes.map((p) => [p.kind, p.userId]), [["hermes-reply", ryshiUser.id]], "only the owner is notified");

  const foreign = await invoke(routes["GET /api/hermes/rooms/:roomId/messages"], { headers: auth, params: { roomId: `hermes:${freshUser("Stranger").id}` } });
  assert.equal(foreign.statusCode, 403);
});

test("nudges are validated, idempotent and notify only their recipient", async () => {
  const { parent, fam, ryshi, ryshiUser } = setup("Nudges");
  const routes = harness();
  const auth = connect(fam);
  const post = (nudges) => invoke(routes["POST /api/hermes/proactive/nudges"], { headers: auth, body: { nudges } });
  pushes.length = 0;

  const dayEnd = { userId: parent.id, nudgeKey: `day-end:${TODAY}:${ryshi.id}:now`, text: "Ryshi's school ended now.", card: { kind: "day-end", data: { covers: [`${ryshi.id}:now`] } } };
  const first = await post([dayEnd]);
  assert.equal(first.body.results[0].created, true);
  const again = await post([dayEnd]);
  assert.equal(again.body.results[0].created, false);
  assert.equal(again.body.results[0].messageId, first.body.results[0].messageId);
  assert.equal(pushes.filter((p) => p.userId === parent.id).length, 1);

  const bad = await post([
    { userId: ryshiUser.id, nudgeKey: "x-dinner-kid", text: "Dinner?", card: { kind: "dinner-tonight", actions: [] } },
    { userId: parent.id, nudgeKey: "x-internal", text: "Cook", card: { kind: "dinner-ideas", actions: [] } },
    { userId: parent.id, nudgeKey: "x-action", text: "Hi", card: { kind: "dinner-tonight", actions: [{ id: "delete-family", label: "Boom" }] } },
    { userId: parent.id, nudgeKey: "x-kid", text: "Hi", card: { kind: "home-parent", actions: [{ id: "nudge-kid:not-a-kid", label: "Nudge" }] } },
    { userId: freshUser("Nope").id, nudgeKey: "x-stranger", text: "Hi", card: { kind: "day-end" } },
  ]);
  assert.deepEqual(bad.body.results.map((r) => r.status), [403, 400, 400, 400, 404]);

  const state = await invoke(routes["GET /api/hermes/proactive/state"], { headers: auth });
  const entry = state.body.sent.find((s) => s.nudgeKey === dayEnd.nudgeKey);
  assert.deepEqual([entry.status, entry.covers], ["open", [`${ryshi.id}:now`]]);
  const unauth = await invoke(routes["GET /api/hermes/proactive/state"], { headers: { authorization: "Bearer nope" } });
  assert.equal(unauth.statusCode, 401);
});

test("buttons: later snoozes, dismiss resolves, open-* stays client-side, kids can't press parent buttons", async () => {
  const { parent, fam, ryshi, ryshiUser } = setup("Buttons");
  homework.addHomework(fam.id, { kidId: ryshi.id, title: "Maths worksheet", dueDate: TOMORROW });
  const routes = harness();
  const act = (user, messageId, action) => invoke(routes["POST /api/hermes/thread/messages/:messageId/actions"], { user, params: { messageId }, body: { action } });

  const kidNudge = hermesThreads.postNudge(fam, {
    userId: ryshiUser.id, nudgeKey: `home-kid:${TODAY}:${ryshi.id}`, text: "Welcome home, Ryshi!",
    card: { kind: "home-kid", actions: [{ id: "open-homework", label: "Open homework", style: "primary" }, { id: "later", label: "In 30 min" }] },
  }).message;
  assert.equal(kidNudge.card.actions[0].open, "homework");
  assert.equal((await act(ryshiUser, kidNudge.id, "open-homework")).statusCode, 400);
  const snoozed = await act(ryshiUser, kidNudge.id, "later");
  assert.equal(snoozed.body.message.card.state.status, "snoozed");
  assert.ok(Date.parse(snoozed.body.message.card.state.until) > Date.now());
  assert.match(snoozed.body.message.card.state.label, /^I'll remind you at \d{1,2}:\d{2} [ap]m$/);
  const repeat = await act(ryshiUser, kidNudge.id, "later");
  assert.equal(repeat.body.alreadyDone, true);
  assert.equal((await act(parent, kidNudge.id, "later")).statusCode, 404, "another member's thread is invisible");

  const offer = hermesThreads.postNudge(fam, {
    userId: parent.id, nudgeKey: `dinner-tonight:${TODAY}`, text: "Dinner tonight isn't planned yet.",
    card: { kind: "dinner-tonight", actions: [{ id: "dinner-ideas", label: "Show 3 ideas", style: "primary" }, { id: "dismiss", label: "I've got it" }] },
  }).message;
  const dismissed = await act(parent, offer.id, "dismiss");
  assert.deepEqual([dismissed.body.message.card.state.status, dismissed.body.message.card.state.label], ["dismissed", "You've got dinner"]);
  assert.equal((await act(parent, offer.id, "unknown")).statusCode, 400);
});

test("a parent's nudge reaches the kid once an hour, naming what's due", async () => {
  const { parent, fam, ryshi, arya, ryshiUser } = setup("NudgeKid");
  homework.addHomework(fam.id, { kidId: ryshi.id, title: "Maths worksheet", dueDate: hermesProactive.addDays(hermesProactive.dateKey(new Date(), "Asia/Bangkok"), 1) });
  const routes = harness();
  const card = hermesThreads.postNudge(fam, {
    userId: parent.id, nudgeKey: "home-parent:test", text: "Tonight: Ryshi has 1 due tomorrow.",
    card: { kind: "home-parent", actions: [{ id: `nudge-kid:${ryshi.id}`, label: "Nudge Ryshi" }, { id: `nudge-kid:${arya.id}`, label: "Nudge Arya" }, { id: "dinner-ideas", label: "Dinner ideas", style: "primary" }] },
  }).message;
  const act = (action) => invoke(routes["POST /api/hermes/thread/messages/:messageId/actions"], { user: parent, params: { messageId: card.id }, body: { action } });

  const first = await act(`nudge-kid:${ryshi.id}`);
  const nudged = first.body.message.card.actions.find((a) => a.id === `nudge-kid:${ryshi.id}`);
  assert.deepEqual([nudged.done, nudged.doneLabel], [true, "Reminded Ryshi"]);
  assert.equal(first.body.message.card.state.status, "open", "the other buttons stay live");
  const kidThread = chat.listMessages(hermesThreads.scopeFor(ryshiUser.id));
  assert.equal(kidThread.length, 1);
  assert.match(kidThread[0].text, /asked me to remind you: Maths worksheet is due tomorrow\./);
  assert.equal(kidThread[0].card.kind, "kid-reminder");

  // A second evening card within the hour doesn't re-send.
  const second = hermesThreads.postNudge(fam, {
    userId: parent.id, nudgeKey: "home-parent:test-2", text: "Tonight again.",
    card: { kind: "home-parent", actions: [{ id: `nudge-kid:${ryshi.id}`, label: "Nudge Ryshi" }] },
  }).message;
  const again = await invoke(routes["POST /api/hermes/thread/messages/:messageId/actions"], { user: parent, params: { messageId: second.id }, body: { action: `nudge-kid:${ryshi.id}` } });
  assert.equal(again.body.message.card.state.label, "Reminded Ryshi recently");
  assert.equal(chat.listMessages(hermesThreads.scopeFor(ryshiUser.id)).length, 1);

  // Arya has no device yet.
  const noDevice = setup("NoDevice");
  const lonelyKid = family.addKid(noDevice.fam.id, noDevice.parent.id, { name: "Mia" }).kid;
  const lonelyCard = hermesThreads.postNudge(family.getFamily(noDevice.fam.id), {
    userId: noDevice.parent.id, nudgeKey: "home-parent:lonely", text: "Tonight.",
    card: { kind: "home-parent", actions: [{ id: `nudge-kid:${lonelyKid.id}`, label: "Nudge Mia" }] },
  }).message;
  const lonely = await invoke(routes["POST /api/hermes/thread/messages/:messageId/actions"], { user: noDevice.parent, params: { messageId: lonelyCard.id }, body: { action: `nudge-kid:${lonelyKid.id}` } });
  assert.equal(lonely.body.message.card.state.label, "Mia has no device yet");
});

test("dinner: 3 ideas, cook one, draft the rest of next week", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-25T03:00:00.000Z") }); // 10:00 in Bangkok: every recipe fits before dinner
  const { parent, fam, ryshiUser } = setup("Dinner");
  const routes = harness();
  const act = (messageId, action, user = parent) => invoke(routes["POST /api/hermes/thread/messages/:messageId/actions"], { user, params: { messageId }, body: { action } });
  const offer = hermesThreads.postNudge(fam, {
    userId: parent.id, nudgeKey: "dinner-tonight:test", text: "Dinner tonight isn't planned yet.",
    card: { kind: "dinner-tonight", actions: [{ id: "dinner-ideas", label: "Show 3 ideas", style: "primary" }, { id: "dismiss", label: "I've got it" }] },
  }).message;

  const ideas = await act(offer.id, "dinner-ideas");
  assert.equal(ideas.body.message.card.state.label, "Ideas below");
  assert.equal(ideas.body.messages.length, 1);
  const ideaCard = ideas.body.messages[0].card;
  assert.equal(ideaCard.kind, "dinner-ideas");
  const cookActions = ideaCard.actions.filter((a) => a.id.startsWith("cook:"));
  assert.equal(cookActions.length, 3);
  assert.equal(ideaCard.lines.length, 3);

  const cooked = await act(ideas.body.messages[0].id, cookActions[0].id);
  assert.equal(cooked.body.message.card.state.status, "done");
  assert.match(cooked.body.message.card.state.label, /^Added .+ for tonight · /);
  const today = hermesProactive.dateKey(new Date(), "Asia/Bangkok");
  const menu = meals.getState(fam.id).menu.filter((e) => e.slot === "dinner" && e.date === today);
  assert.equal(menu.length, 1);
  assert.equal(menu[0].source, "hermes");
  // Pressing a second idea is a no-op: the card is finished.
  assert.equal((await act(ideas.body.messages[0].id, cookActions[1].id)).body.alreadyDone, true);
  assert.equal((await act(ideas.body.messages[0].id, cookActions[1].id, ryshiUser)).statusCode, 404);

  const week = hermesThreads.postNudge(fam, {
    userId: parent.id, nudgeKey: "dinner-week:test", text: "Next week has 0 of 7 dinners planned.",
    card: { kind: "dinner-week", actions: [{ id: "dinner-draft-week", label: "Draft the week", style: "primary" }, { id: "dismiss", label: "Not this week" }] },
  }).message;
  const monday = hermesProactive.nextMonday(today);
  meals.addMenuEntry(fam.id, parent.id, { date: monday, slot: "dinner", title: "Already planned" });
  const draft = await act(week.id, "dinner-draft-week");
  const draftCard = draft.body.messages[0].card;
  assert.equal(draftCard.kind, "dinner-week-draft");
  assert.equal(draftCard.data.plan.length, 6, "Monday is already planned");
  assert.ok(!draftCard.data.plan.some((p) => p.date === monday));
  const added = await act(draft.body.messages[0].id, "add-week");
  assert.match(added.body.message.card.state.label, /^Added 6 dinners · /);
  const weekDinners = meals.getState(fam.id).menu.filter((e) => e.slot === "dinner" && e.date >= monday && e.date <= hermesProactive.addDays(monday, 6));
  assert.equal(weekDinners.length, 7);
  assert.equal(new Set(weekDinners.map((e) => e.title)).size, 7, "no repeats");
});

test("dinner late in the day: only ideas that fit the time left, in plain English", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-25T11:19:00.000Z") }); // 18:19 in Bangkok, dinner at 18:30
  const { parent, fam } = setup("LateDinner");
  const routes = harness();
  const offer = hermesThreads.postNudge(fam, {
    userId: parent.id, nudgeKey: "dinner-tonight:late", text: "Dinner tonight isn't planned yet.",
    card: { kind: "dinner-tonight", actions: [{ id: "dinner-ideas", label: "Show 3 ideas", style: "primary" }] },
  }).message;
  const ideas = await invoke(routes["POST /api/hermes/thread/messages/:messageId/actions"], { user: parent, params: { messageId: offer.id }, body: { action: "dinner-ideas" } });
  const reply = ideas.body.messages[0];
  assert.match(reply.text, /^Here (is one idea|are [23] ideas) for tonight:$/);
  for (const line of reply.card.lines) assert.ok(Number((line.match(/ · (\d+) min/) || [])[1]) <= 20, line);
});

test("facts: day ends per kid in family time, tonight's list and dinner", async () => {
  const { parent, fam, ryshi, arya, ryshiUser } = setup("Facts");
  // Ryshi: explicit school finish at 15:10 today.
  assert.ok(childInsights.saveHomePlan(fam.id, ryshi.id, { date: TODAY, schoolEnd: "15:10", pickupTime: null, homeTime: null, pickupLabel: "" }).homePlan);
  // Arya: Chess on Fridays until 15:40, plus a family dinner that must not count.
  assert.ok(activities.addActivity(fam.id, { kidId: arya.id, name: "Chess", category: "other", schedule: [{ day: "fri", start: "14:30", end: "15:40" }], location: "Room 3" }).activity);
  assert.ok(events.addEvent(fam.id, { title: "Dinner out", date: TODAY, time: "18:00", endTime: "20:00", kidId: null, createdBy: parent.id }).event);
  homework.addHomework(fam.id, { kidId: ryshi.id, title: "Maths worksheet", dueDate: TOMORROW });
  homework.addHomework(fam.id, { kidId: ryshi.id, title: "Old essay", dueDate: "2026-09-20" });
  const done = homework.addHomework(fam.id, { kidId: ryshi.id, title: "Done already", dueDate: TOMORROW }).homework;
  homework.updateHomework(fam.id, done.id, { status: "done" });
  assert.ok(goals.addGoal(fam.id, { kidId: ryshi.id, title: "Read 20 min", type: "habit", target: 5 }).goal);
  meals.addMenuEntry(fam.id, parent.id, { date: "2026-09-28", slot: "dinner", title: "Monday curry" });
  meals.addMenuEntry(fam.id, parent.id, { date: "2026-09-30", slot: "dinner", title: "Wednesday pasta" });

  const state = hermesProactive.buildState(family.getFamily(fam.id), NOW);
  assert.equal(state.timezone, "Asia/Bangkok");
  assert.deepEqual([state.today, state.weekday, state.nowLocal], [TODAY, "fri", "15:00"]);
  const r = state.kids.find((k) => k.kidId === ryshi.id);
  const a = state.kids.find((k) => k.kidId === arya.id);
  assert.deepEqual(r.dayEnd, { at: "2026-09-25T08:10:00.000Z", local: "15:10", title: "School", kind: "school", location: null });
  assert.deepEqual(a.dayEnd, { at: "2026-09-25T08:40:00.000Z", local: "15:40", title: "Chess", kind: "activity", location: "Room 3" });
  assert.deepEqual(r.userIds, [ryshiUser.id]);
  assert.deepEqual(r.tonight.dueTomorrow.map((d) => d.title), ["Maths worksheet"]);
  assert.deepEqual([r.tonight.overdue, r.tonight.habitsLeft, r.tonight.habitsTotal, r.tonight.daily3Left], [1, 1, 1, 3]);
  assert.deepEqual(state.dinner.tonight, { planned: false, title: null });
  assert.deepEqual(state.dinner.nextWeek, { start: "2026-09-28", planned: 2, days: 7 });
  assert.equal(state.dinner.at, "2026-09-25T11:30:00.000Z");
  assert.ok(state.people.some((p) => p.userId === parent.id && p.role === "parent"));

  // A kid's own timed event after chess becomes Arya's day end; a morning one never does.
  events.addEvent(fam.id, { title: "Dentist", date: TODAY, time: "08:00", endTime: "09:00", kidId: arya.id, createdBy: parent.id });
  events.addEvent(fam.id, { title: "Swimming", date: TODAY, time: "16:00", endTime: "17:00", kidId: arya.id, createdBy: parent.id });
  const later = hermesProactive.buildState(family.getFamily(fam.id), NOW).kids.find((k) => k.kidId === arya.id);
  assert.deepEqual([later.dayEnd.title, later.dayEnd.local, later.dayEnd.kind], ["Swimming", "17:00", "event"]);
});

test("family clock converts wall time in the family zone regardless of server TZ", () => {
  assert.equal(hermesProactive.atLocal("2026-09-25", "15:10", "Asia/Bangkok").toISOString(), "2026-09-25T08:10:00.000Z");
  assert.equal(hermesProactive.atLocal("2026-03-29", "09:00", "Europe/London").toISOString(), "2026-03-29T08:00:00.000Z");
  assert.equal(hermesProactive.dateKey(new Date("2026-09-25T18:30:00Z"), "Asia/Bangkok"), "2026-09-26");
  assert.equal(hermesProactive.nextMonday("2026-09-27"), "2026-09-28");
  assert.equal(hermesProactive.nextMonday("2026-09-28"), "2026-10-05");
  assert.equal(hermesProactive.formatClock(new Date("2026-09-25T09:20:00Z"), "Asia/Bangkok"), "4:20 pm");
});

test("tonight's ideas fit the time left before dinner", () => {
  const { fam } = setup("TimeLeft");
  const dinnerAt = Date.parse(hermesProactive.dinnerFacts(fam, hermesProactive.dateKey(new Date(), "Asia/Bangkok"), "Asia/Bangkok").at);
  const today = hermesProactive.dateKey(new Date(), "Asia/Bangkok");
  const tight = hermesThreads.suggestDinners(fam, { count: 3, today, maxMinutes: 30 });
  assert.equal(tight.length, 3);
  assert.ok(tight.every(({ recipe }) => !(Number(recipe.timeMins) > 30)), tight.map((i) => `${i.recipe.title} ${i.recipe.timeMins}`).join(", "));
  const none = hermesThreads.suggestDinners(fam, { count: 2, today, maxMinutes: 1 });
  assert.equal(none.length, 2, "falls back to the quickest when nothing fits");
  assert.ok(Number.isFinite(dinnerAt));
});
