"use strict";
// vm harness for the Goals UI's kid-self-serve split in public/js/app.js
// (renderGoalCard delete-button/sub-line, renderGoalsHub empty state,
// openAddGoalModal's Kid picker) — same extract-and-run-in-vm pattern as
// tests/chat-actions-ui.test.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");

const appSource = fs.readFileSync(path.join(__dirname, "..", "public/js/app.js"), "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected ${name}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") depth--;
    if (depth === 0) return source.slice(start, i + 1);
  }
  assert.fail(`could not extract ${name}`);
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fakeEl() {
  return { value: "", style: {}, textContent: "", innerHTML: "", checked: false };
}

// ---------- renderGoalCard ----------
function goalCardSandbox({ kid, kidId }) {
  const sandbox = {
    isKidSession: () => kid,
    sessionUser: kid ? { kidId } : null,
    kidNameFor: (id) => ({ k_me: "Arya", k_sib: "Leo" }[id] || ""),
    esc,
    goalCurrentStreak: () => 0,
    goalRingSvg: () => "<svg class=\"goal-ring\"></svg>",
    todayIcon: () => "<svg class=\"trash-icon\"></svg>",
  };
  vm.runInNewContext(`${extractFunction(appSource, "renderGoalCard")}\nthis.renderGoalCard = renderGoalCard;`, sandbox);
  return sandbox;
}

test("renderGoalCard: a kid session may delete their own kid-created goal but not a parent-set goal of their own", () => {
  const sandbox = goalCardSandbox({ kid: true, kidId: "k_me" });
  const ownKidCreated = { id: "g1", kidId: "k_me", title: "Read", type: "habit", target: 7, checks: [], createdByRole: "kid" };
  const ownParentSet = { id: "g2", kidId: "k_me", title: "Piano", type: "habit", target: 7, checks: [] };
  assert.match(sandbox.renderGoalCard(ownKidCreated), /goal-card-delete/);
  assert.doesNotMatch(sandbox.renderGoalCard(ownParentSet), /goal-card-delete/);
});

test("renderGoalCard: a kid session may never delete a sibling's goal, even one the sibling created", () => {
  const sandbox = goalCardSandbox({ kid: true, kidId: "k_me" });
  const siblingKidCreated = { id: "g3", kidId: "k_sib", title: "Guitar", type: "habit", target: 7, checks: [], createdByRole: "kid" };
  assert.doesNotMatch(sandbox.renderGoalCard(siblingKidCreated), /goal-card-delete/);
});

test("renderGoalCard: a parent may delete any goal, and sees \"set by <Kid>\" only on goals a kid created for themselves", () => {
  const sandbox = goalCardSandbox({ kid: false });
  const kidCreated = { id: "g1", kidId: "k_me", title: "Read", type: "habit", target: 7, checks: [], createdByRole: "kid" };
  const parentSet = { id: "g2", kidId: "k_me", title: "Piano", type: "milestone", target: 10, progress: 2 };
  const kidHtml = sandbox.renderGoalCard(kidCreated);
  const parentHtml = sandbox.renderGoalCard(parentSet);
  assert.match(kidHtml, /goal-card-delete/);
  assert.match(parentHtml, /goal-card-delete/);
  assert.match(kidHtml, /Arya · habit · set by Arya/);
  assert.doesNotMatch(parentHtml, /set by/);
});

// ---------- renderGoalsHub empty state ----------
function goalsHubSandbox({ kid }) {
  const listEl = fakeEl();
  const sandbox = {
    document: { getElementById: (id) => (id === "goals-list" ? listEl : fakeEl()) },
    goalsItems: [],
    isKidSession: () => kid,
    sessionUser: kid ? { kidId: "k_me" } : null,
    renderGoalCard: () => "",
    renderGoalsRecap: () => {},
  };
  vm.runInNewContext(`${extractFunction(appSource, "renderGoalsHub")}\nthis.renderGoalsHub = renderGoalsHub;`, sandbox);
  return { sandbox, listEl };
}

test("renderGoalsHub: the empty-state '+ New goal' link now shows for kids too, with kid-specific copy", () => {
  const { sandbox, listEl } = goalsHubSandbox({ kid: true });
  sandbox.renderGoalsHub();
  assert.match(listEl.innerHTML, /\+ New goal/);
  assert.match(listEl.innerHTML, /Set your first goal — reading, practice, anything worth a streak\./);
});

test("renderGoalsHub: the parent empty-state copy and link are unchanged", () => {
  const { sandbox, listEl } = goalsHubSandbox({ kid: false });
  sandbox.renderGoalsHub();
  assert.match(listEl.innerHTML, /\+ New goal/);
  assert.match(listEl.innerHTML, /Set a first goal — reading, practice, anything worth a streak\./);
});

// ---------- openAddGoalModal Kid picker ----------
function openAddGoalModalSandbox(kid) {
  const els = {
    "goal-title": fakeEl(),
    "goal-target": fakeEl(),
    "goal-form-error": fakeEl(),
    "goal-kid-group": fakeEl(),
    "goal-kid": fakeEl(),
  };
  const radio = { checked: false };
  const sandbox = {
    document: {
      getElementById: (id) => els[id],
      querySelector: () => radio,
    },
    isKidSession: () => kid,
    sessionUser: kid ? { kidId: "k_me" } : null,
    currentFamily: { kids: [{ id: "k_me", name: "Arya" }, { id: "k_sib", name: "Leo" }] },
    activeKidId: "k_sib",
    esc,
    updateGoalTargetLabel: () => {},
    openModal: () => {},
  };
  vm.runInNewContext(`${extractFunction(appSource, "openAddGoalModal")}\nthis.openAddGoalModal = openAddGoalModal;`, sandbox);
  return { sandbox, els };
}

test("openAddGoalModal: hides #goal-kid-group for a kid session and locks the kid to themselves", () => {
  const { sandbox, els } = openAddGoalModalSandbox(true);
  sandbox.openAddGoalModal();
  assert.equal(els["goal-kid-group"].style.display, "none");
  assert.equal(els["goal-kid"].value, "k_me");
});

test("openAddGoalModal: shows #goal-kid-group for a parent, defaulting to the active kid", () => {
  const { sandbox, els } = openAddGoalModalSandbox(false);
  sandbox.openAddGoalModal();
  assert.equal(els["goal-kid-group"].style.display, "");
  assert.equal(els["goal-kid"].value, "k_sib");
});
