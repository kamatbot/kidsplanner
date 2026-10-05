'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const testRoot = path.resolve(__dirname, '../.dev-data');
fs.mkdirSync(testRoot, { recursive: true });
process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(testRoot, 'fam-support-'));
const db = require('../lib/db');
const school = require('../lib/school-api');
const homework = require('../lib/homework');
const support = require('../lib/student-support');
let events = [], sources = [], assignments = [];
school.listTimetableEvents = () => events;
school.listStatus = () => sources;
homework.listForFamily = () => assignments;
homework.getById = (f, id) => assignments.find(x => x.id === id);
const now = new Date('2026-10-05T06:00:00Z');
const actor = {
  userId: 'parent',
  parent: true
};

function reset() {
  db.load().fam_studentSupport = {};
  events = [];
  sources = [];
  assignments = [];
}

function get() {
  return support.getSnapshot('f', 'k', now);
}
let seq = 0;

function send(type, payload, revision = get().revision, who = actor, commandId = 'c' + (++ seq)) {
  return support.command('f', 'k', who, {
    kidId: 'k',
    commandId,
    expectedRevision: revision,
    type,
    payload
  }, now);
}
const rule = {
  id: 'math',
  title: 'Math book',
  matchKind: 'subject',
  matchValue: 'Math',
  phase: 'evening',
  location: 'home'
};

function source() {
  events = [ {
    familyId: 'f',
    kidId: 'k',
    title: 'Math',
    start: '2026-10-06T09:00:00+07:00'
  }];
  sources = [ {
    kidId: 'k',
    connected: true,
    lastSyncAt: now.toISOString()
  }];
}
test('packing honors actual future coverage, freshness, deduplication and explicit date state', () => {
  reset();
  source();
  send('configure', {
    enabled: true,
    materialRules: [rule, {
      ...rule,
      id: 'other',
      title: ' math book '
    }]
  });
  let s = get();
  assert.equal(s.packing.coverage, 'verified');
  assert.equal(s.packing.items.length, 1);
  assert.equal(s.packing.complete, false);
  send('packing_item', {
    date: s.packing.date,
    itemId: s.packing.items[0].id,
    status: 'missing'
  });
  assert.equal(get().packing.complete, false);
  send('packing_item', {
    date: s.packing.date,
    itemId: s.packing.items[0].id,
    status: 'packed'
  });
  assert.equal(get().packing.complete, true);
  const prior = get().revision;
  events[0].start = '2026-10-07T09:00:00+07:00';
  assert.equal(get().packing.items[0].status, 'needed');
  assert.throws(() => send('packing_item', {
    date: '2026-10-06',
    itemId: s.packing.items[0].id,
    status: 'packed'
  }, prior), {
    status: 409
  });
  events = [];
  assert.equal(get().packing.coverage, 'missing');
  assert.equal(get().packing.requirementsConfirmed, false);
  assert.equal(get().packing.complete, false);
  source();
  sources[0].lastSyncAt = null;
  assert.equal(get().packing.coverage, 'stale');
});
test('a fresh changed lesson cannot leave checked everyday essentials falsely ready', () => {
  reset();
  source();
  const everyday = { ...rule, id: 'water', title: 'Water bottle', matchKind: 'everyday', matchValue: '' };
  send('configure', { enabled: true, materialRules: [rule, everyday] });
  for (const item of get().packing.items) {
    send('packing_item', { date: get().packing.date, itemId: item.id, status: 'packed' });
  }
  assert.equal(get().packing.complete, true);
  events[0].title = 'Science';
  const changed = get();
  assert.equal(changed.packing.coverage, 'verified');
  assert.equal(changed.packing.items.length, 1);
  assert.equal(changed.packing.items[0].status, 'packed');
  assert.equal(changed.packing.complete, false);
  assert.equal(changed.packing.requirementsConfirmed, false);
  assert.match(changed.packing.message, /Science/);
  const unknownRevision = changed.revision;
  events[0].title = 'History';
  assert.ok(get().revision > unknownRevision);
  assert.match(get().packing.message, /History/);
  send('configure', { materialRules: [rule, everyday, { ...rule, id: 'history', title: 'History folder', matchValue: 'History' }] });
  assert.equal(get().packing.requirementsConfirmed, true);
  assert.equal(get().packing.complete, false);
  const added = get().packing.items.find(item => item.title === 'History folder');
  send('packing_item', { date: get().packing.date, itemId: added.id, status: 'packed' });
  assert.equal(get().packing.complete, true);
});
test('weekend/rotating feed dates never repeat into uncovered week; manual rules label uncertainty', () => {
  reset();
  events = school.normalizeTimetable({
    ok: true,
    version: 1,
    timezone: "Asia/Bangkok",
    week: 2,
    lessons: [ {
      day: 1,
      periodnum: 1,
      classid: 1,
      start: '09:00',
      end: '10:00',
      subject: 'Math'
    }]
  }, 'f', 'k', Date.parse('2026-10-02T06:00:00Z')).events;
  send('configure', {
    enabled: true,
    materialRules: [rule]
  });
  assert.equal(get().packing.coverage, 'missing');
  assert.equal(get().packing.requirementsConfirmed, false);
  send('configure', {
    materialRules: [ {
      ...rule,
      matchKind: 'date',
      matchValue: '2026-10-06'
    }]
  });
  assert.equal(get().packing.coverage, 'manual');
  assert.equal(get().packing.requirementsConfirmed, true);
});
test('revision conflicts and retry do not reapply; invalid configuration is atomic', () => {
  reset();
  const commandId = 'stable';
  const result = send('configure', {
    enabled: true
  }, 0, actor, commandId);
  assert.equal(send('configure', {
    enabled: true
  }, 0, actor, commandId).revision, result.revision);
  assert.throws(() => send('configure', {
    enabled: false
  }, 0, actor, commandId), {
    status: 409
  });
  assert.throws(() => send('configure', {
    enabled: false,
    materialRules: [ {
      ...rule,
      id: '__proto__'
    }]
  }), {
    status: 400
  });
  assert.equal(get().enabled, true);
  assert.throws(() => send('configure', {
    enabled: false
  }, get().revision, {
    userId: 'kid',
    parent: false
  }), {
    status: 403
  });
});
test('routine explicit outcomes survive template edits and skip is never done', () => {
  reset();
  send('configure', {
    enabled: true,
    routines: [ {
      id: 'dog',
      title: 'Walk dog',
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      time: '17:00',
      active: true,
      steps: [ {
        id: 'lead',
        title: 'Get lead'
      }]
    }]
  });
  const occurrence = get().occurrences[0];
  send('routine_step', {
    occurrenceId: occurrence.id,
    stepId: 'lead',
    done: true
  });
  send('routine_status', {
    occurrenceId: occurrence.id,
    status: 'skipped'
  });
  send('configure', {
    routines: []
  });
  assert.equal(get().occurrences[0].title, 'Walk dog');
  assert.equal(get().occurrences[0].status, 'skipped');
  assert.equal(get().occurrences[0].steps[0].done, true);
  assert.throws(() => send('routine_status', {
    occurrenceId: occurrence.id,
    status: 'snoozed',
    snoozedUntil: '2026-10-09T00:00:00Z'
  }), {
    status: 400
  });
});
test('homework support cannot mutate canonical completion or sibling records; packed hand-in remains independent', () => {
  reset();
  source();
  assignments = [ {
    id: 'own',
    kidId: 'k',
    title: 'Math sheet',
    dueDate: '2026-10-06',
    status: 'todo'
  }, {
    id: 'sibling',
    kidId: 'other',
    title: 'Private',
    dueDate: '2026-10-06'
  }];
  const original = structuredClone(assignments);
  send('configure', {
    enabled: true
  });
  send('homework_plan', {
    homeworkId: 'own',
    nextStep: 'First question',
    workFinished: true,
    handInMethod: 'pack'
  });
  assert.equal(get().packing.items[0].title, 'Math sheet');
  assert.deepEqual(assignments, original);
  assert.throws(() => send('homework_plan', {
    homeworkId: 'sibling',
    workFinished: true
  }), {
    status: 404
  });
  send('homework_plan', {
    homeworkId: 'own',
    submission: 'reported'
  });
  assert.equal(get().packing.items.length, 0);
  assert.equal(get().homeworkPlans[0].submittedAt, now.toISOString());
});
test.after(() => {
  db.flushSync();
  fs.rmSync(process.env.FAM_DATA_DIR, {
    recursive: true,
    force: true
  });
});
