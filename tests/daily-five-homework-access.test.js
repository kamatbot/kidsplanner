const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('web Daily 5 activities are never gated by homework volume', () => {
  const source = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
  assert.doesNotMatch(source, /applyEnrichmentGating|homeworkDueTodayCount/);
  assert.doesNotMatch(source, /Finish your homework first/);
});

test('iOS Daily 5 activities are never gated by homework volume', () => {
  const widgets = fs.readFileSync(
    path.join(root, 'ios/FamETC/Features/Today/DashboardWidgets.swift'),
    'utf8',
  );
  const store = fs.readFileSync(path.join(root, 'ios/FamETC/Domain/AppStore.swift'), 'utf8');

  assert.match(widgets, /struct DailyFiveCard: View/);
  assert.doesNotMatch(widgets, /enrichmentGated|EnrichmentGateModifier|Finish your homework first/);
  assert.doesNotMatch(store, /enrichmentLocked|homeworkDueTodayCount/);
});
