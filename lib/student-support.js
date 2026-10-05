"use strict";
const crypto = require('crypto');
const db = require('./db');
const schoolApi = require('./school-api');
const homework = require('./homework');
// ponytail: this school pilot uses Bangkok time; add validated family zones before expansion.
const TZ = 'Asia/Bangkok';
const defaults = {
  quietStart: '21:00',
  quietEnd: '07:00',
  homeworkTime: '16:30',
  packingTime: '19:30',
  morningTime: '07:00',
  focusMinutes: 10
};
const statuses = ['needed', 'packed', 'morning', 'at_school', 'missing'];

function fail(message, status = 400) {
  throw Object.assign(new Error(message), {
    status
  });
}

function text(v, max = 200) {
  if (typeof v !== 'string' || v.length > max || !v.trim()) fail('Invalid text.');
  return v.trim();
}

function id(v) {
  if (typeof v !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(v) || ['__proto__', 'constructor', 'prototype'].includes(v)) fail('Invalid identifier.');
  return v;
}

function date(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v) fail('Invalid date.');
  return v;
}

function time(v) {
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) fail('Invalid time.');
  return v;
}

function choice(v, choices) {
  if (!choices.includes(v)) fail('Invalid choice.');
  return v;
}

function bool(v) {
  if (typeof v !== 'boolean') fail('Invalid boolean.');
  return v;
}

function object(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail('Invalid payload.');
  return v;
}

function keys(v, allowed) {
  object(v);
  if (Object.keys(v).some(k => !allowed.includes(k))) fail('Unknown field.');
}

function list(v, max, parse) {
  if (!Array.isArray(v) || v.length > max) fail('Too many items.');
  const out = v.map(parse);
  if (new Set(out.map(x => x.id)).size !== out.length) fail('Duplicate identifier.');
  return out;
}

function day(now) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

function add(d, n) {
  return new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
}

function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
  return v;
}

function hash(v) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
}

function state(familyId, kidId) {
  const root = db.load();
  const key = JSON.stringify([familyId, kidId]);
  return root.fam_studentSupport?.[key] || {
    enabled: false,
    revision: 0,
    preferences: {
      ...defaults
    },
    materialRules: [],
    routines: [],
    packingChecks: {},
    outcomes: {},
    homeworkPlans: {},
    commands: {}
  };
}

function save(familyId, kidId, s) {
  const root = db.load();
  if (!root.fam_studentSupport) root.fam_studentSupport = {};
  root.fam_studentSupport[JSON.stringify([familyId, kidId])] = s;
  db.persist();
}

function packing(s, familyId, kidId, now, ownHomework) {
  const today = day(now), hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    hour12: false
  }).format(now));
  const first = hour < 12 ? today : add(today, 1), last = add(today, 14);
  const events = schoolApi.listTimetableEvents(familyId).filter(e => e.kidId === kidId && e.familyId === familyId && Number.isFinite(Date.parse(e.start))).map(e => ({
    ...e,
    date: day(new Date(e.start))
  })).filter(e => e.date >= first && e.date <= last);
  const source = schoolApi.listStatus(familyId, now.getTime()).find(x => x.kidId === kidId);
  const sourceUpdatedAt = source?.lastSyncAt || undefined;
  const dates = events.map(e => e.date).sort();
  const manual = s.materialRules.filter(r => r.matchKind === 'date' && r.matchValue >= first && r.matchValue <= last).map(r => r.matchValue).sort();
  const target = [dates[0], manual[0]].filter(Boolean).sort()[0];
  if (!target) return {
    coverage: 'missing',
    requirementsConfirmed: false,
    message: 'No dated school coverage. Confirm the next school day.',
    items: [],
    complete: false
  };
  const lessons = events.filter(e => e.date === target);
  const fresh = source?.connected
    && !source.paused
    && !source.lastError
    && Number.isFinite(Date.parse(sourceUpdatedAt))
    && now - Date.parse(sourceUpdatedAt) >= 0
    && now - Date.parse(sourceUpdatedAt) <= 48 * 3600000;
  const coverage = lessons.length ? (fresh ? 'verified' : 'stale') : 'manual';
  const unmappedSubjects = [...new Set(lessons
    .filter(lesson => !s.materialRules.some(rule =>
      ['subject', 'activity'].includes(rule.matchKind)
      && lesson.title.trim().toLowerCase() === rule.matchValue.trim().toLowerCase()))
    .map(lesson => lesson.title.trim()))].sort();
  const requirementsConfirmed = unmappedSubjects.length === 0;
  const warnings = [];
  if (coverage === 'manual') warnings.push('Parent-confirmed date; school coverage unavailable.');
  if (coverage === 'stale') warnings.push('School source is stale or unavailable; confirm requirements.');
  if (!requirementsConfirmed) warnings.push(`Confirm materials for: ${unmappedSubjects.join(', ')}.`);
  const items = new Map();
  function item(title, reason, phase, stable) {
    const normalized = title.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
    const itemId = stable || 'material_' + hash(normalized).slice(0, 24);
    const previous = items.get(itemId);
    if (previous) {
      if (!previous.reasons.includes(reason)) previous.reasons.push(reason);
      if (phase === 'morning') previous.phase = 'morning';
      return;
    }
    items.set(itemId, {
      id: itemId,
      title,
      reasons: [reason],
      phase,
      status: s.packingChecks[target]?.[itemId] || 'needed'
    });
  }
  for (const r of s.materialRules) {
    const matches = r.matchKind === 'everyday'
      || (r.matchKind === 'date'
      && r.matchValue === target)
      || (['subject', 'activity'].includes(r.matchKind)
      && lessons.some(e => e.title.trim().toLowerCase() === r.matchValue.trim().toLowerCase()));
    if (matches) item(r.title, r.matchKind === 'everyday' ? 'Every school day' : r.matchValue, r.phase);
  }
  for (const h of ownHomework) {
    const p = s.homeworkPlans[h.id];
    if (p?.handInMethod === 'pack'
      && p.submission !== 'reported'
      && /^\d{4}-\d{2}-\d{2}$/.test(h.dueDate
      || '')
      && h.dueDate <= target) item(h.title, 'Hand in homework', 'evening', 'homework_' + h.id);
  }
  const result = [...items.values()].sort((a, b) => a.id.localeCompare(b.id));
  return {
    date: target,
    coverage,
    requirementsConfirmed,
    ...(sourceUpdatedAt ? {
      sourceUpdatedAt
    }: {}),
    ...(warnings.length ? { message: warnings.join(' ') } : {}),
    items: result,
    complete: requirementsConfirmed && coverage !== 'stale' && result.length > 0 && result.every(i => ['packed', 'at_school'].includes(i.status))
  };
}

function projection(s, familyId, kidId, now) {
  const today = day(now), own = homework.listForFamily(familyId, {
    kidId
  }).filter(h => h.kidId === kidId);
  const occurrences = [];
  // ponytail: seven-day projection and 30-day explicit history; expand only for an agreed longer planning journey.
  for (let offset = 0; offset < 7; offset++) {
    const d = add(today, offset), weekday = new Date(d).getUTCDay() || 7;
    for (const r of s.routines.filter(r => r.active && r.weekdays.includes(weekday))) {
      const occurrenceId = r.id + '_' + d;
      occurrences.push(s.outcomes[occurrenceId] || {
        id: occurrenceId,
        routineId: r.id,
        date: d,
        title: r.title,
        time: r.time,
        steps: r.steps.map(x => ({
          ...x,
          done: false
        })),
        status: 'open'
      });
    }
  }
  // Preserve recorded outcomes even when their template is edited/deactivated.
  for (const o of Object.values(s.outcomes)) if (o.date >= today && o.date <= add(today, 6) && !occurrences.some(x => x.id === o.id)) occurrences.push(o);
  return {
    schemaVersion: 1,
    familyId,
    kidId,
    enabled: s.enabled,
    revision: s.revision,
    timezone: TZ,
    today,
    refreshedAt: now.toISOString(),
    preferences: s.preferences,
    materialRules: s.materialRules,
    routines: s.routines,
    packing: packing(s, familyId, kidId, now, own),
    occurrences,
    homeworkPlans: Object.values(s.homeworkPlans).filter(p => own.some(h => h.id === p.homeworkId))
  };
}

function sourceSignature(s, familyId, kidId, now) {
  const snapshot = projection(s, familyId, kidId, now);
  return hash({
    date: snapshot.packing.date,
    coverage: snapshot.packing.coverage,
    requirementsConfirmed: snapshot.packing.requirementsConfirmed,
    message: snapshot.packing.message,
    sourceUpdatedAt: snapshot.packing.sourceUpdatedAt,
    items: snapshot.packing.items.map(({
      status,
      ...item
    }) => item),
    today: snapshot.today,
    homework: homework.listForFamily(familyId, {
      kidId
    }).filter(h => h.kidId === kidId).map(h => [h.id, h.dueDate, h.title])
  });
}

function prune(s, now) {
  const cutoff = add(day(now), - 30);
  let changed = false;
  for (const d of Object.keys(s.packingChecks)) if (d < cutoff) {
    delete s.packingChecks[d];
    changed = true;
  }
  for (const[k, o] of Object.entries(s.outcomes)) if (o.date < cutoff) {
    delete s.outcomes[k];
    changed = true;
  }
  // ponytail: receipts expire after 30 days; old revisions still reject replay, and this subsystem never credits currency.
  for (const[k, c] of Object.entries(s.commands)) if (c.at < cutoff) {
    delete s.commands[k];
    changed = true;
  }
  return changed;
}

function refreshedState(familyId, kidId, now, persist = true) {
  const s = structuredClone(state(familyId, kidId));
  const pruned = prune(s, now);
  const snapshot = projection(s, familyId, kidId, now);
  const signature = sourceSignature(s, familyId, kidId, now);
  if (s.sourceSignature && s.sourceSignature !== signature) {
    s.revision++;
    const checks = s.packingChecks[snapshot.packing.date];
    if (checks) for (const key of Object.keys(checks)) if (!snapshot.packing.items.some(i => i.id === key)) delete checks[key];
  }
  if (pruned || s.sourceSignature !== signature) {
    s.sourceSignature = signature;
    if (persist) save(familyId, kidId, s);
  }
  return s;
}

function getSnapshot(familyId, kidId, now = new Date()) {
  return projection(refreshedState(familyId, kidId, now), familyId, kidId, now);
}

function configure(s, p) {
  keys(p, ['enabled', 'preferences', 'materialRules', 'routines']);
  if ('enabled' in p) s.enabled = bool(p.enabled);
  if ('preferences' in p) {
    keys(p.preferences, Object.keys(defaults));
    const pref = {};
    for (const k of Object.keys(defaults)) pref[k] = k === 'focusMinutes' ? choice(p.preferences[k], [0, 5, 10, 15, 20]) : time(p.preferences[k]);
    s.preferences = pref;
  }
  if ('materialRules' in p) s.materialRules = list(p.materialRules, 60, r => {
    keys(r, ['id', 'title', 'matchKind', 'matchValue', 'phase', 'location']);
    const kind = choice(r.matchKind, ['everyday', 'subject', 'activity', 'date']);
    return {
      id: id(r.id),
      title: text(r.title),
      matchKind: kind,
      matchValue: kind === 'everyday' ? '' : kind === 'date' ? date(r.matchValue) : text(r.matchValue),
      phase: choice(r.phase, ['evening', 'morning']),
      location: choice(r.location, ['home', 'school'])
    };
  });
  if ('routines' in p) s.routines = list(p.routines, 20, r => {
    keys(r, ['id', 'title', 'weekdays', 'time', 'steps', 'active']);
    if (!Array.isArray(r.weekdays)
      || !r.weekdays.length
      || r.weekdays.length > 7
      || r.weekdays.some(x => !Number.isInteger(x)
      || x < 1
      || x > 7)
      || new Set(r.weekdays).size !== r.weekdays.length) fail('Invalid weekdays.');
    return {
      id: id(r.id),
      title: text(r.title),
      weekdays: r.weekdays,
      time: time(r.time),
      active: bool(r.active),
      steps: list(r.steps, 15, x => {
        keys(x, ['id', 'title']);
        return {
          id: id(x.id),
          title: text(x.title)
        };
      })
    };
  });
}

function command(familyId, kidId, actor, input, now = new Date()) {
  keys(input, ['kidId', 'commandId', 'expectedRevision', 'type', 'payload']);
  id(input.commandId);
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail('Invalid revision.');
  const p = object(input.payload), s = structuredClone(refreshedState(familyId, kidId, now, false));
  const digest = hash({
    actor: actor.userId,
    type: input.type,
    payload: p,
    expectedRevision: input.expectedRevision
  });
  if (s.commands[input.commandId]) {
    if (s.commands[input.commandId].digest !== digest) fail('Command identifier already used.', 409);
    return projection(s, familyId, kidId, now);
  }
  if (input.expectedRevision !== s.revision) fail('Plan changed. Refresh and review.', 409);
  const before = projection(s, familyId, kidId, now);
  if (input.type === 'configure') {
    if (!actor.parent || actor.watch) fail('Parent app session required.', 403);
    configure(s, p);
  } else {
    if (!s.enabled) fail('Student support is disabled.', 403);
    if (input.type === 'packing_item') {
      keys(p, ['date', 'itemId', 'status']);
      if (date(p.date) !== before.packing.date || !before.packing.items.some(i => i.id === p.itemId)) fail('Packing requirement changed. Refresh and review.', 409);
      const status = choice(p.status, statuses);
      if (!s.packingChecks[p.date]) s.packingChecks[p.date] = {};
      s.packingChecks[p.date][p.itemId] = status;
    } else if (['routine_status', 'routine_step'].includes(input.type)) {
      const o = structuredClone(before.occurrences.find(o => o.id === p.occurrenceId));
      if (!o) fail('Routine occurrence no longer available.', 409);
      if (input.type === 'routine_step') {
        keys(p, ['occurrenceId', 'stepId', 'done']);
        const step = o.steps.find(x => x.id === p.stepId);
        if (!step) fail('Step no longer available.', 409);
        step.done = bool(p.done);
      } else {
        keys(p, ['occurrenceId', 'status', 'snoozedUntil']);
        o.status = choice(p.status, ['open', 'done', 'skipped', 'handed_off', 'snoozed', 'help']);
        delete o.snoozedUntil;
        if (o.status === 'snoozed') {
          const ms = Date.parse(p.snoozedUntil);
          if (typeof p.snoozedUntil !== 'string'
            || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(p.snoozedUntil)
            || !Number.isFinite(ms)
            || ms <= now.getTime()
            || ms > now.getTime() + 86400000) fail('Snooze must be within 24 hours.');
          o.snoozedUntil = new Date(ms).toISOString();
        }
      }
      s.outcomes[o.id] = o;
    } else if (input.type === 'homework_plan') {
      keys(p, ['homeworkId', 'nextStep', 'plannedDate', 'workFinished', 'handInMethod', 'submission']);
      const h = homework.getById(familyId, p.homeworkId);
      if (!h || h.kidId !== kidId) fail('Homework not found.', 404);
      const plan = s.homeworkPlans[h.id] || {
        homeworkId: h.id,
        nextStep: '',
        workFinished: false,
        handInMethod: 'unknown',
        submission: 'unknown'
      };
      if ('nextStep' in p) plan.nextStep = p.nextStep === '' ? '' : text(p.nextStep, 500);
      if ('plannedDate' in p) {
        if (p.plannedDate === null) delete plan.plannedDate;
        else plan.plannedDate = date(p.plannedDate);
      }
      if ('workFinished' in p) plan.workFinished = bool(p.workFinished);
      if ('handInMethod' in p) plan.handInMethod = choice(p.handInMethod, ['unknown', 'portal', 'teacher', 'pack', 'none']);
      if ('submission' in p) {
        plan.submission = choice(p.submission, ['unknown', 'pending', 'reported']);
        if (plan.submission === 'reported') plan.submittedAt = now.toISOString();
        else delete plan.submittedAt;
      }
      s.homeworkPlans[h.id] = plan;
    } else fail('Unknown command.');
  }
  prune(s, now);
  s.sourceSignature = sourceSignature(s, familyId, kidId, now);
  s.revision++;
  s.commands[input.commandId] = {
    digest,
    at: day(now)
  };
  save(familyId, kidId, s);
  return projection(s, familyId, kidId, now);
}

function cleanupKid(familyId, kidId) {
  const root = db.load(), key = JSON.stringify([familyId, kidId]);
  if (root.fam_studentSupport && Object.hasOwn(root.fam_studentSupport, key)) {
    delete root.fam_studentSupport[key];
    db.persist();
  }
}

module.exports = {
  getSnapshot,
  command,
  cleanupKid
};
