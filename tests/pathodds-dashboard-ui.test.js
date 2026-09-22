'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'../public/js/sat.js'),'utf8');
test('the word activity no longer mounts or requests PathOdds', () => {
 assert.doesNotMatch(source,/loadPathOddsQuestWidget|ensurePathOddsCard|pathOddsFetch|fam-pathodds-frame|\/api\/pathodds/);
 assert.match(source,/getDailyVocabulary/);
 assert.match(source,/wordBankInteract/);
});
test('native Today removes both PathOdds surfaces while retaining family tools',()=>{
 const native=fs.readFileSync(path.join(__dirname,'../ios/FamETC/Features/Today/TodayVisualComponents.swift'),'utf8');
 assert.doesNotMatch(native,/PathOddsFamilySummaryCard\(|PathOddsQuestCard\(|rewards and PathOdds/);
 assert.match(native,/ActionCard\(\)/);
 assert.match(native,/FamsHomeCard\(\)/);
});
