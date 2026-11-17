'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calmToday } = require('../public/js/today-calm.js');

function dateAt(hours, minutes = 0) {
  const d = new Date(2026, 10, 17, hours, minutes, 0, 0);
  return d;
}

test('greeting time boundaries: 11:59 is morning, 12:00 is afternoon', () => {
  const morning = calmToday({ now: dateAt(11, 59), needsYouCount: 1 });
  assert.equal(morning.greeting, 'Good morning');

  const afternoon = calmToday({ now: dateAt(12, 0), needsYouCount: 1 });
  assert.equal(afternoon.greeting, 'Good afternoon');
});

test('afternoon and evening time boundaries: 16:59 is afternoon, 17:00 is evening', () => {
  const afternoon = calmToday({ now: dateAt(16, 59), needsYouCount: 1 });
  assert.equal(afternoon.greeting, 'Good afternoon');

  const evening = calmToday({ now: dateAt(17, 0), needsYouCount: 1 });
  assert.equal(evening.greeting, 'Good evening');
});

test('early morning hours (< 12) return Good morning', () => {
  const early = calmToday({ now: dateAt(2, 30), needsYouCount: 1 });
  assert.equal(early.greeting, 'Good morning');

  const dawn = calmToday({ now: dateAt(6, 0), needsYouCount: 1 });
  assert.equal(dawn.greeting, 'Good morning');
});

test('needsYouCount === 0 produces calmLine based on 17:00 boundary', () => {
  // Before 17:00
  const before17 = calmToday({ now: dateAt(16, 59), needsYouCount: 0 });
  assert.equal(before17.calmLine, 'Nothing needs you right now.');

  // At 17:00
  const at17 = calmToday({ now: dateAt(17, 0), needsYouCount: 0 });
  assert.equal(at17.calmLine, 'Nothing needs you. Enjoy dinner.');

  // Later in evening
  const late = calmToday({ now: dateAt(21, 30), needsYouCount: 0 });
  assert.equal(late.calmLine, 'Nothing needs you. Enjoy dinner.');
});

test('non-empty needsYouCount (> 0) returns null calmLine', () => {
  const withOne = calmToday({ now: dateAt(10, 0), needsYouCount: 1 });
  assert.equal(withOne.calmLine, null);

  const withMany = calmToday({ now: dateAt(18, 0), needsYouCount: 4 });
  assert.equal(withMany.calmLine, null);
});

test('tomorrowLine boundary: 19:59 is null, 20:00 shows tomorrowLine', () => {
  const items = [{ title: 'Swimming' }, { title: 'Math homework' }];

  const before20 = calmToday({ now: dateAt(19, 59), needsYouCount: 0, tomorrowItems: items });
  assert.equal(before20.tomorrowLine, null);

  const at20 = calmToday({ now: dateAt(20, 0), needsYouCount: 0, tomorrowItems: items });
  assert.equal(at20.tomorrowLine, 'Tomorrow: Swimming · Math homework');
});

test('tomorrow preview capping at 2 and ordering by time', () => {
  const items = [
    { title: 'Dinner party', time: '18:30' },
    { title: 'School drop-off', time: '08:15' },
    { title: 'Piano lesson', time: '15:00' },
  ];

  // At 20:30, earliest two should be School drop-off (08:15) and Piano lesson (15:00)
  const result = calmToday({ now: dateAt(20, 30), needsYouCount: 0, tomorrowItems: items });
  assert.equal(result.tomorrowLine, 'Tomorrow: School drop-off · Piano lesson');
});

test('tomorrowLine handles single item and empty items correctly', () => {
  const single = calmToday({ now: dateAt(20, 15), needsYouCount: 0, tomorrowItems: [{ title: 'Pack swim bag' }] });
  assert.equal(single.tomorrowLine, 'Tomorrow: Pack swim bag');

  const empty = calmToday({ now: dateAt(20, 15), needsYouCount: 0, tomorrowItems: [] });
  assert.equal(empty.tomorrowLine, null);

  const missing = calmToday({ now: dateAt(20, 15), needsYouCount: 0 });
  assert.equal(missing.tomorrowLine, null);
});
