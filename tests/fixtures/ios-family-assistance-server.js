"use strict";

// Synthetic, localhost-only API fixture for FamilyAssistanceUITests.
// Start with Node 24. It deliberately contains no production data or secrets.
const http = require("node:http");

const HOST = "127.0.0.1";
const PORT = Number(process.env.FAM_QA_PORT || 18247);
const now = new Date();
const dayKey = (date) => {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 10);
};
const today = dayKey(now);
const tomorrow = dayKey(new Date(now.getTime() + 86_400_000));
const isoNow = now.toISOString();

const kid = {
  id: "qa-kid-1", name: "Maya QA", grade: "6", color: "#6f43d6",
  createdAt: "2026-09-01T00:00:00.000Z",
};
const family = {
  id: "qa-family-1", name: "Synthetic QA Family", inviteCode: "QAONLY",
  parentIds: ["qa-parent-1"], parents: [{ id: "qa-parent-1", name: "QA Parent" }],
  kids: [kid], createdAt: "2026-09-01T00:00:00.000Z",
};
const homework = {
  id: "qa-homework-1", kidId: kid.id, title: "Synthetic volcano poster",
  subject: "Science", dueDate: today, dueTime: "18:00", status: "todo", effortMin: 25,
  notes: "Compare two volcano types and label one diagram.",
  checklist: [{ text: "Choose the two volcano types", done: false }],
};
const event = {
  id: "qa-event-1", title: "Synthetic family rehearsal", date: tomorrow, time: "17:30",
  endTime: null, endDate: null, notes: "Fixture-only calendar item.", category: "school",
  kidId: kid.id, repeat: "none", repeatUntil: null, seriesId: null, recurring: false,
  occurrenceDate: null, canEdit: true, sourceType: null, sourceId: null,
};
const action = {
  id: "qa-action-1", familyId: family.id, title: "Pack synthetic art supplies",
  notes: "Fixture-only family action.", status: "open", dueDate: today, dueTime: "19:00",
  assigneeType: "family", assigneeId: null, kidId: kid.id, sourceType: "manual",
  sourceId: null, createdBy: "qa-parent-1", createdAt: isoNow, updatedAt: isoNow,
  snoozedUntil: null,
};
const newsArticle = {
  id: "qa-news-1", cat: "science", headline: "Synthetic scientists map a coral nursery",
  summary: "Researchers observed how young coral settles and grows in a protected nursery.",
  url: "https://example.com/synthetic-coral", publishedAt: isoNow,
  source: "QA Science Desk", question: "What could help the coral nursery thrive?",
};

// A separate, opt-in visual fixture keeps the existing assistance scenarios
// stable while giving Today screenshots enough real-shaped data to exercise
// hierarchy, disclosure, privacy, and the complete Daily 5 news flow.
const visualKid = {
  id: "qa-visual-kid-1", name: "Maya Visual", grade: "6", color: "#6f43d6",
  createdAt: "2026-09-01T00:00:00.000Z",
};
const visualSibling = {
  id: "qa-visual-kid-2", name: "Leo Visual", grade: "8", color: "#f0704f",
  createdAt: "2026-09-01T00:00:00.000Z",
};
const visualFamily = {
  id: "qa-visual-family", name: "Synthetic Today Family", inviteCode: "QA-VISUAL",
  parentIds: ["qa-parent-1"], parents: [{ id: "qa-parent-1", name: "QA Parent" }],
  kids: [visualKid, visualSibling], createdAt: "2026-09-01T00:00:00.000Z",
};
const visualHomework = [
  {
    id: "qa-visual-homework-1", kidId: visualKid.id, title: "Visual coral field notes",
    subject: "Science", dueDate: today, dueTime: "18:00", status: "todo", effortMin: 20,
    notes: "Compare two coral habitats and label one observation.",
    checklist: [{ text: "Choose the two habitats", done: false }],
  },
  {
    id: "qa-visual-homework-2", kidId: visualSibling.id, title: "Visual robotics lab log",
    subject: "Design", dueDate: today, dueTime: "19:00", status: "todo", effortMin: 30,
    notes: "Record the test result and one change for the next run.",
    checklist: [{ text: "Write the test result", done: false }],
  },
];
const visualFamilyEvents = [
  {
    id: "qa-visual-family-event", title: "Visual family dinner", date: today, time: null,
    endTime: null, endDate: null, notes: "Fixture-only family event.", category: "family",
    kidId: null, repeat: "none", repeatUntil: null, seriesId: null, recurring: false,
    occurrenceDate: null, canEdit: true, sourceType: null, sourceId: null,
  },
  {
    id: "qa-visual-kid-event", title: "Visual swim practice", date: today, time: "23:30",
    endTime: "23:55", endDate: null, notes: "Fixture-only child event.", category: "activity",
    kidId: visualKid.id, repeat: "none", repeatUntil: null, seriesId: null, recurring: false,
    occurrenceDate: null, canEdit: true, sourceType: null, sourceId: null,
  },
  {
    id: "qa-visual-sibling-event", title: "Visual robotics lab", date: today, time: "23:45",
    endTime: "23:59", endDate: null, notes: "Fixture-only sibling event.", category: "activity",
    kidId: visualSibling.id, repeat: "none", repeatUntil: null, seriesId: null, recurring: false,
    occurrenceDate: null, canEdit: true, sourceType: null, sourceId: null,
  },
];
const visualSchoolEvents = [
  {
    uid: "qa-visual-school-1", feedId: "qa-visual-school", title: "Visual science lab",
    start: `${today}T09:00:00+07:00`, end: `${today}T10:00:00+07:00`, allDay: false,
    location: "Synthetic Lab", feedLabel: "QA School", kidId: visualKid.id,
    isDeadline: false, type: "event",
  },
];
const visualNews = [
  {
    id: "qa-visual-news-1", cat: "regional", headline: "Visual wetlands team restores a city pond",
    summary: "Students and local scientists measured how native plants can make a small pond healthier.",
    url: "https://example.com/visual-wetlands", publishedAt: isoNow,
    source: "QA Regional Desk", question: "Which observation would help the team plan its next step?",
  },
  {
    id: "qa-visual-news-2", cat: "science", headline: "Visual scientists map a coral nursery",
    summary: "Researchers observed how young coral settles and grows in a protected nursery.",
    url: "https://example.com/visual-coral", publishedAt: isoNow,
    source: "QA Science Desk", question: "What could help the coral nursery thrive?",
  },
  {
    id: "qa-visual-news-3", cat: "culture", headline: "Visual makers turn repair skills into a school festival",
    summary: "A student-led festival invited neighbors to share practical ways to repair and reuse everyday items.",
    url: "https://example.com/visual-makers", publishedAt: isoNow,
    source: "QA Culture Desk", question: "How could a family try this idea at home?",
  },
];
const visualNewsChoices = [
  { category: "regional", label: "Local / Regional", article: visualNews[0] },
  { category: "science", label: "Global Science & Discovery", article: visualNews[1] },
  { category: "culture", label: "Culture, Sports & Human Interest", article: visualNews[2] },
];
const visualAction = {
  id: "qa-visual-action", familyId: visualFamily.id, title: "Pack the visual activity bag",
  notes: "Fixture-only family action.", status: "open", dueDate: today, dueTime: "20:00",
  assigneeType: "family", assigneeId: null, kidId: null, sourceType: "manual",
  sourceId: null, createdBy: "qa-parent-1", createdAt: isoNow, updatedAt: isoNow,
  snoozedUntil: null,
};

const state = { eventPosts: [], chatPosts: [], notePosts: [], daily5Posts: [], notes: [], requests: [], answerPosts: [], failures: {} };

function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "").split(";").map((part) => {
    const at = part.indexOf("=");
    return at < 0 ? [part.trim(), ""] : [part.slice(0, at).trim(), part.slice(at + 1).trim()];
  }).filter(([key]) => key));
}

function readJSON(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
      catch (error) { reject(error); }
    });
    req.on("error", reject);
  });
}

function send(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function syntheticMessage(text) {
  return {
    id: `qa-message-${state.chatPosts.length}`, familyId: family.id, senderType: "kid",
    senderId: kid.id, postedByUserId: "qa-kid-user", text, card: null, media: null,
    createdAt: new Date().toISOString(), deleted: false, deletedBy: null,
    flagged: false, flagReason: null, flaggedBy: null, roomId: "family", senderName: kid.name,
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const jar = cookies(req);
  const role = jar.fam_sess === "kid" ? "kid" : "parent";
  const scenario = jar.fam_qa_scenario || "success";
  const learningScenario = scenario.startsWith("learning-polish");
  const failureScenario = scenario.endsWith("-failure");
  const visualScenario = scenario === "today-visual" || learningScenario;
  const sessionKid = visualScenario ? visualKid : kid;
  const sessionFamily = visualScenario ? visualFamily : family;
  state.requests.push({ method: req.method, path: url.pathname, role });

  if (url.pathname === "/__qa/state" && req.method === "GET") return send(res, 200, state);
  if (url.pathname === "/__qa/reset" && req.method === "POST") {
    state.eventPosts.length = 0; state.chatPosts.length = 0; state.notePosts.length = 0;
    state.daily5Posts.length = 0; state.notes.length = 0; state.requests.length = 0;
    state.answerPosts.length = 0; state.failures = {};
    return send(res, 200, { ok: true });
  }
  // Fail once, before applying writes, to exercise explicit native retry/draft
  // preservation. This hook only exists on this synthetic localhost fixture.
  const failedPath = ["/api/chat/messages", "/api/notes", "/api/wordbank/interact", "/api/brainteaser/answer"];
  if (learningScenario && failureScenario && req.method === "POST" && failedPath.includes(url.pathname)
      && !state.failures[url.pathname]) {
    state.failures[url.pathname] = true;
    await readJSON(req);
    return send(res, 503, { error: "Synthetic offline check — please retry." });
  }
  if (learningScenario && failureScenario && req.method === "GET"
      && ["/api/calendar/sync", "/api/calendar/events", "/api/meals", "/api/meals/shopping"].includes(url.pathname)
      && !state.failures[url.pathname]) {
    state.failures[url.pathname] = true;
    return send(res, 503, { error: "Synthetic connection check." });
  }
  if (url.pathname === "/api/track" && req.method === "POST") return send(res, 200, { ok: true });
  if (url.pathname === "/api/me") {
    return send(res, 200, { user: role === "kid"
      ? { id: "qa-kid-user", email: "", name: sessionKid.name, role: "kid", kidId: sessionKid.id }
      : { id: "qa-parent-1", email: "qa-parent@example.invalid", name: "QA Parent", role: "parent", kidId: null }
    });
  }
  if (url.pathname === "/api/family") {
    const visibleFamily = role === "kid"
      ? { id: sessionFamily.id, name: sessionFamily.name, parentIds: [], kids: [sessionKid], createdAt: sessionFamily.createdAt }
      : sessionFamily;
    return send(res, 200, { families: [visibleFamily] });
  }
  if (url.pathname === "/api/family/access-requests") return send(res, 200, { requests: [] });
  if (visualScenario && /^\/api\/children\/[^/]+\/insights$/.test(url.pathname)) {
    if (role === "kid") return send(res, 403, { error: "Parent only" });
    const childId = decodeURIComponent(url.pathname.split("/")[3]);
    if (!sessionFamily.kids.some(child => child.id === childId)) return send(res, 404, { error: "No child" });
    return send(res, 200, { kidId: childId, date: today, schoolStats: null, homePlan: null,
      daily5: { date: today, parts: { news: { status: "completed", updatedAt: isoNow } } } });
  }
  if (url.pathname === "/api/chat/rooms") return send(res, 200, [{ roomId: "family", tripId: null, title: sessionFamily.name, memberCount: 2 }]);
  if (url.pathname === "/api/chat/messages" && req.method === "GET") return send(res, 200, { messages: [] });
  if (url.pathname === "/api/chat/messages" && req.method === "POST") {
    const body = await readJSON(req);
    state.chatPosts.push(body);
    return send(res, 200, { message: syntheticMessage(body.text || "") });
  }
  if (url.pathname === "/api/calendar/sync") {
    return send(res, 200, {
      events: visualScenario ? visualSchoolEvents : [], lastSyncAt: isoNow, throttled: false,
    });
  }
  if (url.pathname === "/api/calendar/events" && req.method === "GET") {
    return send(res, 200, { events: visualScenario ? visualFamilyEvents : [event] });
  }
  if (url.pathname === "/api/calendar/events" && req.method === "POST") {
    const body = await readJSON(req);
    state.eventPosts.push(body);
    if (scenario === "event-error") return send(res, 422, { error: "Synthetic event validation failure." });
    if (scenario === "event-drop") return req.socket.destroy();
    return send(res, 201, { event: { ...event, id: "qa-reviewed-event", ...body }, existing: false });
  }
  if (url.pathname === "/api/homework") {
    const rows = visualScenario
      ? (role === "kid" ? visualHomework.filter((item) => item.kidId === sessionKid.id) : visualHomework)
      : [homework];
    return send(res, 200, { homework: rows });
  }
  if (url.pathname === "/api/family/actions") {
    return send(res, 200, { actions: visualScenario ? [visualAction] : [action] });
  }
  if (url.pathname === "/api/notes" && req.method === "GET") return send(res, 200, { notes: state.notes });
  if (url.pathname === "/api/notes" && req.method === "POST") {
    const body = await readJSON(req);
    const ref = body.ref && typeof body.ref === "object"
      ? { kind: String(body.ref.kind || ""), id: String(body.ref.id || ""), context: body.ref.context || null }
      : null;
    const note = {
      id: `qa-note-${state.notes.length + 1}`,
      authorType: role === "kid" ? "kid" : "parent",
      authorId: role === "kid" ? "qa-kid-user" : "qa-parent-1",
      date: body.date || today,
      body: String(body.body || ""), source: String(body.source || "manual"), ref,
    };
    state.notePosts.push(body); state.notes.unshift(note);
    return send(res, 201, { note });
  }
  if (url.pathname === "/api/meals") return send(res, 200, { pantry: [], menu: [], shopping: [], prefs: null });
  if (url.pathname === "/api/meals/shopping") return send(res, 200, { shopping: [] });
  if (url.pathname === "/api/enrichment/puzzle/today") return send(res, 200, learningScenario ? {
    date: today, available: true, type: "crossword", title: "Shared vocabulary crossword",
    instructions: "Connect this week's words. Choose a clue and type your answer.",
    crossword: { rows: 5, cols: 9, solution: ["PRAGMATIC", ".I.......", ".G.......", ".O.......", ".R......."], entries: [
      { number: 1, direction: "across", clue: "Practical and focused on what works", answer: "PRAGMATIC", row: 0, col: 0 },
      { number: 2, direction: "down", clue: "Careful attention and thoroughness", answer: "RIGOR", row: 0, col: 1 },
    ] },
  } : { date: today, available: false });
  if (learningScenario && url.pathname === "/api/enrichment/vocabulary/today") return send(res, 200, {
    date: today, weekStart: today,
    word: { word: "Pragmatic", pos: "adjective", def: "Practical and focused on what works.", example: "Repairing the old bicycle was a pragmatic choice." },
    weekWords: [
      { word: "Pragmatic", pos: "adjective", def: "Practical and focused on what works.", example: "We chose a pragmatic plan." },
      { word: "Rigor", pos: "noun", def: "Careful attention and thoroughness.", example: "The team tested with rigor." },
    ],
    challenge: { id: "qa-context", prompt: "Two sentences use pragmatic correctly. Can you spot the impostor?", answerIndex: 2, options: [
      { text: "A pragmatic team repaired the bridge with the tools it had.", explanation: "The team chose a practical way forward." },
      { text: "Her pragmatic plan used the bus when the bicycle broke.", explanation: "She adapted to a solution that worked." },
      { text: "He was pragmatic, refusing every new idea without listening.", explanation: "Refusing ideas regardless of evidence is dogmatic, not pragmatic." },
    ] },
  });
  if (url.pathname === "/api/enrichment/vocabulary/today") return send(res, 200, {
    date: today, weekStart: today,
    word: { word: "Observe", pos: "verb", def: "To watch carefully.", example: "We observe the coral." },
    weekWords: [], challenge: { id: "qa-vocab", prompt: "Choose the careful action.", options: [
      { text: "Look closely", explanation: "This is careful observation." },
      { text: "Ignore it", explanation: "This is not observation." },
    ], answerIndex: 0 },
  });
  if (url.pathname === "/api/news/recent") return send(res, 200, visualScenario
    ? { items: visualNews, maxAgeDays: 14, editionDate: today, choices: visualNewsChoices }
    : {
      items: [newsArticle], maxAgeDays: 14, editionDate: today,
      choices: [
        { category: "regional", label: "Local / Regional", article: null },
        { category: "science", label: "Global Science & Discovery", article: newsArticle },
        { category: "culture", label: "Culture, Sports & Human Interest", article: null },
      ],
    });
  if (url.pathname === "/api/brainteaser/today") return send(res, 200, learningScenario ? {
    date: today, count: 1, questions: [{ qid: "qa-reasoning", q: "Which number continues the pattern: 3, 6, 12, 24?",
      options: ["30", "48", "36"], answerIndex: 1, exp: "Each number doubles. Twice 24 is 48.", resurfaced: false }],
  } : { date: today, count: 0, questions: [] });
  if (learningScenario && url.pathname === "/api/brainteaser/answer") {
    state.answerPosts.push(await readJSON(req));
    return send(res, 200, { ok: true });
  }
  if (learningScenario && url.pathname === "/api/wordbank/interact") {
    const answer = await readJSON(req); state.answerPosts.push(answer);
    return send(res, 200, { entry: { word: answer.word, state: "learning", seenCount: 1, correctCount: answer.correct ? 1 : 0 } });
  }
  if (learningScenario && url.pathname === "/api/wordbank") return send(res, 200, {
    words: [], stats: { learning: 0, mastered: 0, known: 0 },
  });
  if (url.pathname.startsWith("/api/daily5/progress")) {
    if (req.method === "POST") state.daily5Posts.push(await readJSON(req));
    const parts = Object.fromEntries(state.daily5Posts.filter(item => item.date === today)
      .map(item => [item.part, { status: item.status, updatedAt: isoNow }]));
    return send(res, 200, { date: today, parts });
  }

  return send(res, 404, { error: `Synthetic fixture has no route for ${req.method} ${url.pathname}` });
});

server.on("error", (error) => {
  console.error(`[fam-assistance-fixture] ${error.code || "ERROR"}: ${error.message}`);
  process.exitCode = 1;
});
server.listen(PORT, HOST, () => {
  console.log(`[fam-assistance-fixture] synthetic API listening on http://${HOST}:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
