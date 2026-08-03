/* ============================================================
   MEALS.JS — Fam ETC Meals (see docs/MEALS-PLAN.md — the contract)
   Drives public/meals.html: pantry, weekly dinner menu, one family
   shopping list, and the Indian/Thai-heavy recipe library. Ports the
   Trips (public/js/trips.js) page-shell pattern: sticky brand header +
   tab nav rendered entirely by JS, template-literal innerHTML with esc()
   on every user/recipe string, inline onclick handlers, top-level
   functions, no bundler.

   Loaded alongside util.js (isoDate/parseIso/formatShort/fmt12/mondayOf/
   uid/...) and auth.js — every top-level name here is `meal`/`meals`
   prefixed (except esc()/toast(), which mirror trips.js's own local
   per-page copies verbatim — util.js/auth.js never declare those two
   names, so there's nothing to clash with) so nothing here can ever
   redeclare one of util.js's bindings. See tests/meals-bundle.test.js.

   ---- Contract gaps this file had to resolve (built in parallel with the
   backend + recipe library against the same docs/MEALS-PLAN.md — see the
   task brief "do NOT wait") ----
   1. §5 lists no GET route for the recipe library, but §8b "Recipes" tab
      needs to browse/search/filter it and see per-recipe pantry coverage.
      Assumed: `GET /api/meals/recipes?cuisine=&veg=&slot=&kidFriendly=&
      maxTimeMins=&query=&canCookNow=` -> `{recipes:[{...recipe,coverage}]}`
      and `GET /api/meals/recipes/:id` -> `{recipe, coverage}`, coverage
      shaped like §8b's `coverage()` helper: `{have, missing, coreMissing,
      ratio}`. Coded defensively (`missing` may be strings or objects).
   2. §5 has no per-member "set portion/allergies" route — turned out there
      isn't a generic one server-side either (lib/routes/meals.js landed
      mid-task): a parent can only PATCH /api/meals/profile for THEIR OWN
      portion/allergies (self, no id param); a kid's are just fields on the
      kid record, set via the existing PATCH /api/family/kids/:id. So the
      household strip only lets a parent edit themself or any kid — a
      co-parent's chip is view-only (no route exists to change it).
   3. Confirmed against the landed lib/meals.js + lib/routes/meals.js: PATCH
      /api/meals/pantry/:id really does return `{item}` only, and
      GET /api/meals never surfaces pantryEvents — so no eventId EVER
      reaches this client to undo. `mealSetPantryLevel` still checks for an
      `event` field defensively (never crashes either way), but the Undo
      affordance is effectively unreachable until the backend exposes an
      eventId somewhere (e.g. include `event` in the PATCH response, or a
      `GET /api/meals/pantry/events` route) — flagged for the backend agent,
      not something this file can fix (lib/ is out of scope here).
   4. "✨ Plan my week" / "Suggest from my pantry" are described as the
      SAME route (`/menu/plan`) with a "non-AI response" fallback — read as
      one endpoint accepting an optional `ai:false` override, rather than a
      second endpoint. Both paths render whatever `{menu}` comes back.
   5. `restockPantry()`'s exact `{items, pantry}` shape (which array counts
      "restocked" items) isn't pinned down, so the client refetches
      `GET /api/meals` after a restock instead of guessing a merge.
============================================================ */

/* ============================================================
   STATE
============================================================ */
let mealsData = null;            // {pantry, menu, shopping, prefs, household}
let mealsLoadError = null;
let mealsTab = 'tonight';        // tonight | menu | pantry | shopping | recipes
let mealCurrentUser = null;
let mealCurrentUserId = null;
let mealIsKid = false;

let mealMenuFormOpen = null;     // {date, entryId|null}
let mealPlanning = false;
let mealMenuAiUnavailable = false;

let mealPantryAddOpen = false;
let mealPantryUndo = null;       // {eventId, label}

let mealShoppingCatFilter = 'all';

let mealsRecipes = null;         // null = not yet loaded
let mealRecipesLoading = false;
let mealRecipeFilter = 'all';    // all|indian|thai|other|veg|kid|quick
let mealRecipeQuery = '';
let mealRecipeCanCookNow = false;
let mealRecipeSearchTimer = null;
let mealRecipeDetailId = null;
let mealRecipeDetail = null;     // {recipe, coverage}
let mealRecipeDetailLoading = false;
let mealRecipeDayPicker = false;

let mealMemberEditId = null;

const MEAL_TABS = [
  ['tonight', 'Tonight'],
  ['menu', 'Menu'],
  ['pantry', 'Pantry'],
  ['shopping', 'Shopping'],
  ['recipes', 'Recipes'],
];

const MEAL_PANTRY_CATS = ['produce', 'protein', 'dairy', 'grain', 'pantry', 'frozen', 'spice', 'other'];
const MEAL_CAT_LABEL = {
  produce: 'Produce', protein: 'Protein', dairy: 'Dairy', grain: 'Grain',
  pantry: 'Pantry', frozen: 'Frozen', spice: 'Spice', other: 'Other',
};
const MEAL_LEVELS = ['plenty', 'some', 'low', 'out'];
const MEAL_LEVEL_LABEL = { plenty: 'Plenty', some: 'Some', low: 'Low', out: 'Out' };
const MEAL_RECIPE_FILTERS = [
  ['all', 'All'], ['indian', 'Indian'], ['thai', 'Thai'], ['other', 'Other'],
  ['veg', 'Veg'], ['kid', 'Kid-friendly'], ['quick', 'Quick <30min'],
];

// GET /api/meals's household.members (lib/meals.js buildHousehold) is
// {userId|kidId, name, kind, portion, allergies} — no color/initial (that
// lives on the kid record for kids and nowhere for parents), so this page
// assigns a stable rotating token-based color locally rather than inventing
// a hex value. Colors stay theme-correct in both modes since they're vars.
const MEAL_MEMBER_PALETTE = ['var(--accent)', 'var(--c-teal)', 'var(--c-amber)', 'var(--c-blue)', 'var(--coral)', 'var(--c-violet)', 'var(--c-orange)'];

const ICON_MEAL_BOWL = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13h16a1 1 0 0 1 1 1 7 7 0 0 1-7 7h-4a7 7 0 0 1-7-7 1 1 0 0 1 1-1Z"></path><path d="M4.5 13a1 1 0 0 1-1-1v-1a1 1 0 0 1 1-1h.5"></path><path d="M19.5 13a1 1 0 0 0 1-1v-1a1 1 0 0 0-1-1h-.5"></path><path d="M9 8c0-1 1-1.5 1-2.5S9 4 9 3"></path><path d="M14 8c0-1 1-1.5 1-2.5S14 4 14 3"></path></svg>';
const ICON_MEAL_EDIT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>';
const ICON_MEAL_X = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

/* ============================================================
   HELPERS — esc()/toast() mirror trips.js's own local copies (this page
   doesn't load app.js or trips.js, so it owns them same as trips.html does)
============================================================ */
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 2800);
}

function renderMealSpinner() {
  return '<span class="meal-spinner" aria-hidden="true"></span>';
}

function mealRound1(n) {
  return Math.round((n || 0) * 10) / 10;
}

function mealNextDays(n) {
  const out = [];
  const start = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    out.push(isoDate(d));
  }
  return out;
}

function mealWeekDays() {
  const mon = mondayOf(new Date());
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon);
    d.setDate(d.getDate() + i);
    out.push(isoDate(d));
  }
  return out;
}

function mealShortDayLabel(dateIso) {
  const todayIso = isoDate(new Date());
  const tomorrowIso = isoDate(new Date(Date.now() + 86400000));
  if (dateIso === todayIso) return 'Today';
  if (dateIso === tomorrowIso) return 'Tomorrow';
  return parseIso(dateIso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function mealCuisineLabel(c) {
  return c === 'indian' ? 'Indian' : c === 'thai' ? 'Thai' : 'Other';
}

function mealExpiringSoon(expiresOn) {
  if (!expiresOn) return false;
  const days = Math.round((parseIso(expiresOn) - parseIso(isoDate(new Date()))) / 86400000);
  return days <= 5;
}

function mealFormatExpiry(expiresOn) {
  const days = Math.round((parseIso(expiresOn) - parseIso(isoDate(new Date()))) / 86400000);
  if (days < 0) return 'expired';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days}d`;
}

function mealSpiceDots(n) {
  const lvl = Math.max(0, Math.min(3, n || 0));
  let out = '';
  for (let i = 0; i < 3; i++) out += `<span class="meal-spice-dot${i < lvl ? ' filled' : ''}"></span>`;
  return out;
}

function mealMemberFor(id) {
  const members = (mealsData && mealsData.household && mealsData.household.members) || [];
  const m = members.find((x) => x.id === id);
  if (m) return m;
  return { id, name: 'Someone', initial: '?', color: 'var(--muted)', portion: 'regular', allergies: [] };
}

function mealAvatarHtml(m, size) {
  const s = size || 26;
  return `<span class="meal-avatar" style="width:${s}px;height:${s}px;font-size:${Math.round(s * 0.42)}px;background:${esc(m.color || 'var(--accent)')}" title="${esc(m.name || '?')}">${esc(m.initial || (m.name || '?')[0].toUpperCase())}</span>`;
}

// Merge one or more menu entries into local state by id, else by
// date+slot (keeps a re-plan or a recipe-attach from duplicating a day).
function mealMergeMenu(entries) {
  if (!entries || !entries.length) return;
  mealsData.menu = mealsData.menu || [];
  entries.forEach((e) => {
    const idx = mealsData.menu.findIndex((x) => x.id === e.id || (x.date === e.date && x.slot === e.slot));
    if (idx !== -1) mealsData.menu[idx] = e;
    else mealsData.menu.push(e);
  });
}

/* ============================================================
   BOOT + LOAD
============================================================ */
async function mealsBoot() {
  let me = null;
  try { me = await window.auth.getMe(); } catch (e) { me = null; }
  if (!me || !me.user) {
    window.location.href = '/login?next=' + encodeURIComponent(location.pathname);
    return;
  }
  mealCurrentUser = me.user;
  mealCurrentUserId = me.user.id;
  mealIsKid = me.user.role === 'kid';
  await mealsLoadAll();
}

async function mealsLoadAll() {
  const root = document.getElementById('meals-root');
  if (root && !mealsData) root.innerHTML = '<div class="meal-main"><p class="text-muted">Loading meals…</p></div>';
  try {
    const res = await window.auth.getMeals();
    const household = (res && res.household) || { members: [], totalPortions: 0 };
    // Normalize member id/initial/color — see the MEAL_MEMBER_PALETTE note above.
    household.members = (household.members || []).map((m, i) => Object.assign({}, m, {
      id: m.id || m.userId || m.kidId,
      initial: m.initial || ((m.name || '?').trim()[0] || '?').toUpperCase(),
      color: m.color || MEAL_MEMBER_PALETTE[i % MEAL_MEMBER_PALETTE.length],
    }));
    mealsData = {
      pantry: (res && res.pantry) || [],
      menu: (res && res.menu) || [],
      shopping: (res && res.shopping) || [],
      prefs: (res && res.prefs) || { dinnerTime: '18:30', cuisines: [], avoid: [] },
      household,
    };
    mealsLoadError = null;
    mealsRender();
  } catch (err) {
    mealsLoadError = err.message || 'Could not load Meals.';
    mealsRender();
  }
}

/* ============================================================
   ROOT RENDER / TABS
============================================================ */
function mealsRender() {
  const root = document.getElementById('meals-root');
  if (!root) return;
  if (mealsLoadError) {
    root.innerHTML = `<div class="meal-main"><p class="error-msg">${esc(mealsLoadError)}</p></div>`;
    return;
  }
  root.innerHTML = `
    ${mealsHeaderHtml()}
    <div class="meal-main" id="meal-tab-content"></div>
  `;
  mealsRerenderTab();
}

function mealsRerenderTab() {
  const el = document.getElementById('meal-tab-content');
  if (!el) return;
  if (!mealsData) { el.innerHTML = '<p class="text-muted">Loading meals…</p>'; return; }
  if (mealsTab === 'tonight') el.innerHTML = renderMealsTonightTab();
  else if (mealsTab === 'menu') el.innerHTML = renderMealsMenuTab();
  else if (mealsTab === 'pantry') el.innerHTML = renderMealsPantryTab();
  else if (mealsTab === 'shopping') el.innerHTML = renderMealsShoppingTab();
  else if (mealsTab === 'recipes') el.innerHTML = renderMealsRecipesTab();
}

function mealsGoTab(tab) {
  mealsTab = tab;
  mealMenuFormOpen = null;
  mealPantryAddOpen = false;
  mealsRender();
  if (tab === 'recipes' && mealsRecipes === null && !mealRecipesLoading) mealLoadRecipes();
}

function mealBrandHtml() {
  return `
    <a class="meal-brand" href="/" title="Back to Fam ETC" aria-label="Back to Fam ETC">
      <span class="meal-brand-tile">${ICON_MEAL_BOWL}</span>
      <span class="meal-brand-name">Fam ETC</span>
    </a>
    <div class="meal-brand-divider"></div>`;
}

function mealHouseholdStripHtml() {
  const h = (mealsData && mealsData.household) || { members: [], totalPortions: 0 };
  const members = h.members || [];
  const total = h.totalPortions != null ? h.totalPortions : members.reduce((s, m) => s + (m.portionFactor || 1), 0);
  return `
    <div class="meal-household-strip">
      ${members.map(mealMemberChipHtml).join('')}
      <span class="meal-total-portions micro-label" title="Summed portion factor across the household">cooking for ${esc(String(mealRound1(total)))}</span>
    </div>
  `;
}

// A parent may edit any kid (their portion/allergies live on the kid record,
// PATCH /api/family/kids/:id) or themself (PATCH /api/meals/profile, which
// is self-only server-side) — never a co-parent, since no route sets
// someone else's parent profile. See file-header note #2.
function mealMemberEditable(m) {
  if (mealIsKid || !m) return false;
  if (m.kind === 'kid') return true;
  return m.userId === mealCurrentUserId || m.id === mealCurrentUserId;
}

function mealMemberChipHtml(m) {
  const portionLabel = { small: 'S', regular: 'R', big: 'B' }[m.portion] || 'R';
  const editable = mealMemberEditable(m);
  return `
    <button type="button" class="meal-member-chip" ${editable ? `onclick="mealOpenMemberEditor('${esc(m.id)}')"` : 'disabled'} title="${esc(m.name || 'Member')} · ${esc(m.portion || 'regular')} portion${editable ? '' : ' (view only)'}">
      ${mealAvatarHtml(m, 26)}
      <span class="meal-member-portion-badge">${portionLabel}</span>
    </button>
  `;
}

function mealsHeaderHtml() {
  return `
    <div class="meal-hub-header">
      <div class="meal-hub-inner">
        ${mealBrandHtml()}
        <div class="meal-hub-title">
          <div class="meal-hub-name">Meals</div>
        </div>
        <div class="meal-hub-header-right">
          ${mealHouseholdStripHtml()}
        </div>
      </div>
    </div>
    <nav class="meal-tabs">
      <div class="meal-tabs-inner">
        ${MEAL_TABS.map(([id, label]) => `<button type="button" class="meal-tab-btn${mealsTab === id ? ' active' : ''}" onclick="mealsGoTab('${id}')">${esc(label)}</button>`).join('')}
      </div>
    </nav>
    ${!mealIsKid && mealMemberEditId ? `<div class="meal-main" style="padding-bottom:0">${mealMemberEditFormHtml()}</div>` : ''}
  `;
}

/* ---------- household member editor (portion + allergies, parents only) ---------- */
function mealOpenMemberEditor(id) {
  if (!mealMemberEditable(mealMemberFor(id))) return;
  mealMemberEditId = mealMemberEditId === id ? null : id;
  mealsRender();
}
function mealCloseMemberEditor() {
  mealMemberEditId = null;
  mealsRender();
}

function mealMemberEditFormHtml() {
  const m = mealMemberFor(mealMemberEditId);
  const portion = m.portion || 'regular';
  return `
    <form class="card meal-inline-form" onsubmit="mealSubmitMemberEdit(event)" style="margin-bottom:16px">
      <div class="micro-label meal-panel-title">${esc(m.name || 'Member')} — portion &amp; allergies</div>
      <div class="meal-portion-radio">
        ${['small', 'regular', 'big'].map((p) => `
          <label class="meal-portion-opt">
            <input type="radio" name="portion" value="${p}" ${portion === p ? 'checked' : ''}>
            <span>${p === 'small' ? 'Small (0.6×)' : p === 'big' ? 'Big (1.4×)' : 'Regular (1×)'}</span>
          </label>
        `).join('')}
      </div>
      <input class="meal-input" name="allergies" value="${esc((m.allergies || []).join(', '))}" placeholder="Allergies, comma separated — e.g. peanut, sesame" autocomplete="off" maxlength="200">
      <div class="meal-form-actions">
        <button type="submit" class="btn-primary">Save</button>
        <button type="button" class="btn-secondary" onclick="mealCloseMemberEditor()">Cancel</button>
      </div>
    </form>
  `;
}

async function mealSubmitMemberEdit(e) {
  e.preventDefault();
  const f = e.target;
  const portion = f.portion.value;
  const allergies = f.allergies.value.split(',').map((s) => s.trim()).filter(Boolean);
  const m = mealMemberFor(mealMemberEditId);
  try {
    let updated = null;
    if (m.kind === 'kid') {
      const res = await window.auth.updateKid(m.kidId || m.id, { portion, allergies });
      if (res && res.kid) updated = { portion: res.kid.portion, allergies: res.kid.allergies };
    } else {
      const res = await window.auth.updateMyMealProfile({ portion, allergies });
      if (res && res.profile) updated = { portion: res.profile.portion, allergies: res.profile.allergies };
    }
    if (updated) {
      const idx = (mealsData.household.members || []).findIndex((x) => x.id === m.id);
      if (idx !== -1) Object.assign(mealsData.household.members[idx], updated);
    }
    mealMemberEditId = null;
    toast('Saved.');
    mealsRender();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

/* ============================================================
   TONIGHT TAB
============================================================ */
// prep[].leadHours counts back from that day's dinnerTime — anything that
// lands today (soak/marinate/ferment) belongs on the Tonight tab, not
// buried in a future day's card.
function mealPrepDueToday(menu, prefs, todayIso) {
  const parts = ((prefs && prefs.dinnerTime) || '18:30').split(':').map(Number);
  const hh = parts[0] || 18, mm = parts[1] || 0;
  const out = [];
  (menu || []).forEach((entry) => {
    if (!entry.date || !(entry.prep || []).length) return;
    const dt = parseIso(entry.date);
    dt.setHours(hh, mm, 0, 0);
    entry.prep.forEach((p) => {
      const prepAt = new Date(dt.getTime() - (p.leadHours || 0) * 3600000);
      if (isoDate(prepAt) === todayIso) out.push({ entry, prep: p, prepAt });
    });
  });
  return out.sort((a, b) => a.prepAt - b.prepAt);
}

function renderMealsTonightTab() {
  const d = mealsData;
  const todayIso = isoDate(new Date());
  const tomorrowIso = isoDate(new Date(Date.now() + 86400000));
  const tonight = (d.menu || []).find((e) => e.date === todayIso && e.slot === 'dinner');
  const tomorrow = (d.menu || []).find((e) => e.date === tomorrowIso && e.slot === 'dinner');
  const prepToday = mealPrepDueToday(d.menu, d.prefs, todayIso);

  if (!tonight && !tomorrow && !prepToday.length && !(d.menu || []).length) {
    return `
      <div class="card meal-empty-card">
        <div class="meal-empty-icon">🍽️</div>
        <div class="meal-empty-title">Nothing planned yet</div>
        <p class="text-muted">Plan this week's dinners and Tonight will show what's cooking.</p>
        ${!mealIsKid ? `<button type="button" class="btn-primary" onclick="mealsGoTab('menu')">Plan the week →</button>` : ''}
      </div>
    `;
  }

  return `
    <div class="card meal-tonight-card">
      <div class="micro-label meal-panel-title">Tonight's dinner</div>
      ${tonight ? mealTonightEntryHtml(tonight) : `
        <p class="text-muted">Nothing planned for tonight.</p>
        ${!mealIsKid ? `<button type="button" class="btn-secondary" onclick="mealOpenMenuFormAndGo('${todayIso}')">+ Add tonight's dinner</button>` : ''}
      `}
    </div>
    ${prepToday.length ? `
    <div class="card meal-prep-card">
      <div class="micro-label meal-panel-title">Prep due today</div>
      <div class="meal-prep-list">
        ${prepToday.map((x) => `
          <div class="meal-prep-row">
            <span class="meal-prep-dot"></span>
            <div>
              <div class="meal-prep-label">${esc(x.prep.label)}</div>
              <div class="meal-prep-sub text-muted">for ${esc(x.entry.title)} · ${esc(String(x.prep.leadHours))}h before dinner</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>` : ''}
    <div class="card meal-tomorrow-card">
      <div class="micro-label meal-panel-title">Tomorrow</div>
      ${tomorrow ? `<div class="meal-tomorrow-title">${esc(tomorrow.title)}</div>` : `<p class="text-muted" style="margin:0">Nothing planned yet.</p>`}
    </div>
  `;
}

function mealTonightEntryHtml(entry) {
  return `
    <div class="meal-tonight-title">${esc(entry.title)}</div>
    ${entry.note ? `<div class="meal-tonight-note">${esc(entry.note)}</div>` : ''}
    ${entry.servesPortions != null ? `<div class="micro-label meal-tonight-meta">Serves ${esc(String(entry.servesPortions))} portions${entry.source === 'ai' ? ' · ✨ AI planned' : ''}</div>` : ''}
    <div class="meal-tonight-actions">
      ${!mealIsKid ? `<button type="button" class="btn-primary" onclick="mealMarkCooked('${esc(entry.id)}')">Cooked it ✅</button>` : ''}
      <a href="#" class="btn-link" onclick="event.preventDefault();mealsGoTab('menu')">View menu →</a>
    </div>
  `;
}

function mealOpenMenuFormAndGo(dateIso) {
  mealsTab = 'menu';
  mealOpenMenuForm(dateIso);
}

async function mealMarkCooked(entryId) {
  try {
    const res = await window.auth.markMenuCooked(entryId);
    if (res && res.entry) mealMergeMenu([res.entry]);
    if (res && res.pantry) mealsData.pantry = res.pantry;
    toast('🍽️ Nice! Pantry updated.');
    mealsRerenderTab();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

/* ============================================================
   MENU TAB
============================================================ */
function renderMealsMenuTab() {
  const d = mealsData;
  const days = mealWeekDays();
  return `
    <div class="meal-section-header">
      <div>
        <div class="meal-section-title">This week's dinners</div>
        <div class="meal-section-sub">Dinner around ${esc(fmt12((d.prefs && d.prefs.dinnerTime) || '18:30'))}</div>
      </div>
      ${!mealIsKid ? `
        <div class="meal-section-header-actions">
          <button type="button" class="btn-secondary" onclick="mealSuggestFromPantry()" ${mealPlanning ? 'disabled' : ''}>🥫 Suggest from my pantry</button>
          <button type="button" class="btn-primary" onclick="mealPlanWeek()" ${mealPlanning ? 'disabled' : ''}>${mealPlanning ? renderMealSpinner() + 'Planning…' : '✨ Plan my week'}</button>
        </div>
      ` : ''}
    </div>
    ${!mealIsKid && mealMenuAiUnavailable ? `
      <div class="card meal-ai-note">
        <p style="margin:0">AI planning isn't set up on this server yet — <button type="button" class="btn-link" onclick="mealSuggestFromPantry()">Suggest from my pantry</button> instead, no AI needed.</p>
      </div>
    ` : ''}
    <div class="meal-week-grid">
      ${days.map((dt) => renderMealDayCol(dt, d)).join('')}
    </div>
  `;
}

function renderMealDayCol(dateIso, d) {
  const day = parseIso(dateIso);
  const dow = day.toLocaleDateString('en-US', { weekday: 'short' });
  const isToday = dateIso === isoDate(new Date());
  const entry = (d.menu || []).find((e) => e.date === dateIso && e.slot === 'dinner');
  const addFormHere = !mealIsKid && mealMenuFormOpen && mealMenuFormOpen.date === dateIso && !mealMenuFormOpen.entryId;
  const editFormHere = !mealIsKid && entry && mealMenuFormOpen && mealMenuFormOpen.entryId === entry.id;
  return `
    <div class="meal-day-col${isToday ? ' today' : ''}">
      <div class="meal-day-head">
        <span class="micro-label meal-day-dow">${esc(dow)}</span>
        <span class="meal-day-num">${day.getDate()}</span>
      </div>
      ${editFormHere ? mealMenuFormHtml(dateIso, entry) : (entry ? renderMealMenuEntry(entry) : '')}
      ${addFormHere ? mealMenuFormHtml(dateIso, null) : ''}
      ${!entry && !addFormHere ? (!mealIsKid ? `<button type="button" class="meal-add-day-btn" onclick="mealOpenMenuForm('${dateIso}')">+ Add</button>` : `<p class="text-muted meal-day-empty">Not planned</p>`) : ''}
    </div>
  `;
}

function renderMealMenuEntry(entry) {
  return `
    <div class="meal-entry-card">
      <div class="meal-entry-title">${esc(entry.title)}</div>
      ${(entry.prep && entry.prep.length) ? `<div class="meal-entry-prep micro-label">${entry.prep.map((p) => esc(p.label) + ' · ' + esc(String(p.leadHours)) + 'h').join(', ')}</div>` : ''}
      ${!mealIsKid ? `
        <div class="meal-entry-actions">
          <button type="button" class="meal-icon-btn" title="Edit" onclick="mealOpenMenuForm('${esc(entry.date)}','${esc(entry.id)}')">${ICON_MEAL_EDIT}</button>
          <button type="button" class="meal-icon-btn danger" title="Remove" onclick="mealDeleteMenuEntry('${esc(entry.id)}')">${ICON_MEAL_X}</button>
        </div>
      ` : ''}
    </div>
  `;
}

function mealMenuFormHtml(dateIso, entry) {
  const v = entry || {};
  return `
    <form class="meal-inline-form" onsubmit="mealSubmitMenuForm(event,'${esc(dateIso)}'${entry ? `,'${esc(entry.id)}'` : ''})">
      <input class="meal-input" name="title" value="${esc(v.title || '')}" placeholder="What's for dinner?" autocomplete="off" maxlength="120" required autofocus>
      <input class="meal-input" name="note" value="${esc(v.note || '')}" placeholder="Notes (optional)" autocomplete="off" maxlength="1000">
      <div class="meal-form-actions">
        <button type="submit" class="btn-primary">${entry ? 'Save' : 'Add'}</button>
        <button type="button" class="btn-secondary" onclick="mealCancelMenuForm()">Cancel</button>
      </div>
    </form>
  `;
}

function mealOpenMenuForm(dateIso, entryId) {
  mealMenuFormOpen = { date: dateIso, entryId: entryId || null };
  mealsRerenderTab();
}
function mealCancelMenuForm() {
  mealMenuFormOpen = null;
  mealsRerenderTab();
}

async function mealSubmitMenuForm(e, dateIso, entryId) {
  e.preventDefault();
  const f = e.target;
  const title = f.title.value.trim();
  if (!title) { toast('Give it a title first.'); return; }
  const payload = { title, note: f.note.value.trim() };
  try {
    let res;
    if (entryId) res = await window.auth.updateMenuEntry(entryId, payload);
    else res = await window.auth.addMenuEntry(Object.assign({ date: dateIso, slot: 'dinner' }, payload));
    if (res && res.entry) mealMergeMenu([res.entry]);
    mealMenuFormOpen = null;
    mealsRerenderTab();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

async function mealDeleteMenuEntry(id) {
  if (!confirm('Remove this dinner plan?')) return;
  try {
    await window.auth.deleteMenuEntry(id);
    mealsData.menu = (mealsData.menu || []).filter((e) => e.id !== id);
    mealsRerenderTab();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

async function mealPlanWeek(forceDeterministic) {
  mealPlanning = true;
  mealsRerenderTab();
  try {
    const payload = { days: 7, slots: ['dinner'] };
    if (forceDeterministic) payload.ai = false;
    const res = await window.auth.planMenu(payload);
    const menu = (res && res.menu) || [];
    mealMergeMenu(menu);
    mealMenuAiUnavailable = false;
    toast(forceDeterministic ? '🥫 Suggested a week from your pantry' : '✨ Week planned!');
  } catch (err) {
    if (err.status === 503) {
      mealMenuAiUnavailable = true;
      toast("❌ AI planning isn't set up on this server yet.");
    } else if (err.status === 422) {
      toast('❌ ' + (err.message || "Couldn't plan a menu from what's on hand."));
    } else {
      toast('❌ ' + err.message); // 429 or anything else — server's own message
    }
  } finally {
    mealPlanning = false;
    mealsRerenderTab();
  }
}
function mealSuggestFromPantry() { mealPlanWeek(true); }

/* ============================================================
   PANTRY TAB
============================================================ */
function renderMealsPantryTab() {
  const d = mealsData;
  const items = d.pantry || [];
  const byCat = {};
  items.forEach((it) => { (byCat[it.category] = byCat[it.category] || []).push(it); });
  const cats = Object.keys(byCat).sort((a, b) => MEAL_PANTRY_CATS.indexOf(a) - MEAL_PANTRY_CATS.indexOf(b));
  const lowCount = items.filter((it) => it.level === 'low' || it.level === 'out').length;
  return `
    <div class="meal-section-header">
      <div>
        <div class="meal-section-title">Pantry</div>
        <div class="meal-section-sub">${items.length} item${items.length === 1 ? '' : 's'} tracked</div>
      </div>
      ${!mealIsKid ? `
        <div class="meal-section-header-actions">
          ${lowCount ? `<button type="button" class="btn-secondary" onclick="mealAddLowToShopping()">Add low items to shopping</button>` : ''}
          <button type="button" class="btn-primary" onclick="mealTogglePantryAdd()">+ Add item</button>
        </div>
      ` : ''}
    </div>
    ${!mealIsKid && mealPantryUndo ? `
      <div class="card meal-undo-card">
        <span>${esc(mealPantryUndo.label)}</span>
        <button type="button" class="btn-link" onclick="mealUndoPantry()">Undo</button>
      </div>
    ` : ''}
    ${!mealIsKid && mealPantryAddOpen ? renderMealPantryAddForm() : ''}
    ${items.length ? cats.map((cat) => renderMealPantryCatSection(cat, byCat[cat])).join('') : `<p class="text-muted">No pantry items yet — add what's in your kitchen.</p>`}
  `;
}

function renderMealPantryCatSection(cat, items) {
  return `
    <section class="meal-pantry-section">
      <div class="micro-label meal-pantry-cat-label">${esc(MEAL_CAT_LABEL[cat] || cat)}</div>
      <div class="meal-pantry-rows">
        ${items.map(renderMealPantryRow).join('')}
      </div>
    </section>
  `;
}

function renderMealPantryRow(it) {
  const expSoon = mealExpiringSoon(it.expiresOn);
  return `
    <div class="meal-pantry-row">
      <div class="meal-pantry-row-main">
        <div class="meal-pantry-name">${esc(it.name)}${it.unitHint ? ` <span class="meal-pantry-unit text-muted">· ${esc(it.unitHint)}</span>` : ''}</div>
        ${expSoon ? `<span class="meal-expiry-badge">expires ${esc(mealFormatExpiry(it.expiresOn))}</span>` : ''}
      </div>
      <div class="meal-pantry-row-controls">
        ${mealIsKid ? `<span class="meal-level-chip meal-level-${esc(it.level)}">${esc(MEAL_LEVEL_LABEL[it.level] || it.level)}</span>` : `
          <div class="meal-level-seg">
            ${MEAL_LEVELS.map((lv) => `<button type="button" class="meal-level-seg-btn meal-level-${lv}${it.level === lv ? ' active' : ''}" onclick="mealSetPantryLevel('${esc(it.id)}','${lv}')">${MEAL_LEVEL_LABEL[lv]}</button>`).join('')}
          </div>
          <button type="button" class="meal-icon-btn danger" title="Remove" onclick="mealDeletePantryItem('${esc(it.id)}')">${ICON_MEAL_X}</button>
        `}
      </div>
    </div>
  `;
}

function renderMealPantryAddForm() {
  return `
    <form class="meal-inline-form" onsubmit="mealSubmitPantryAdd(event)" style="margin-bottom:14px">
      <div class="meal-form-row">
        <input class="meal-input meal-input-grow" name="name" placeholder="Item — e.g. Basmati rice" autocomplete="off" maxlength="80" required autofocus>
        <select class="meal-select" name="category">
          ${MEAL_PANTRY_CATS.map((c) => `<option value="${c}">${esc(MEAL_CAT_LABEL[c])}</option>`).join('')}
        </select>
        <select class="meal-select" name="level">
          ${MEAL_LEVELS.map((lv) => `<option value="${lv}"${lv === 'plenty' ? ' selected' : ''}>${MEAL_LEVEL_LABEL[lv]}</option>`).join('')}
        </select>
      </div>
      <div class="meal-form-row">
        <input class="meal-input" name="unitHint" placeholder="Unit hint — e.g. 1kg bag (optional)" autocomplete="off" maxlength="40">
        <input class="meal-input" type="date" name="expiresOn">
      </div>
      <div class="meal-form-actions">
        <button type="submit" class="btn-primary">Add</button>
        <button type="button" class="btn-secondary" onclick="mealTogglePantryAdd()">Cancel</button>
      </div>
    </form>
  `;
}

function mealTogglePantryAdd() {
  mealPantryAddOpen = !mealPantryAddOpen;
  mealsRerenderTab();
}

async function mealSubmitPantryAdd(e) {
  e.preventDefault();
  const f = e.target;
  const name = f.name.value.trim();
  if (!name) { toast('Give it a name first.'); return; }
  const payload = { name, category: f.category.value, level: f.level.value, unitHint: f.unitHint.value.trim() };
  if (f.expiresOn.value) payload.expiresOn = f.expiresOn.value;
  try {
    const res = await window.auth.addPantryItem(payload);
    if (res && res.item) { mealsData.pantry = mealsData.pantry || []; mealsData.pantry.push(res.item); }
    mealPantryAddOpen = false;
    mealsRerenderTab();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

async function mealSetPantryLevel(id, level) {
  try {
    const res = await window.auth.updatePantryItem(id, { level });
    if (res && res.item) {
      const idx = (mealsData.pantry || []).findIndex((it) => it.id === id);
      if (idx !== -1) mealsData.pantry[idx] = res.item;
    }
    // See file-header note #3 — undo only appears if the server hands back
    // the PantryEvent alongside the item.
    if (res && res.event && res.event.id) {
      mealPantryUndo = { eventId: res.event.id, label: `${(res.item && res.item.name) || 'Item'} → ${MEAL_LEVEL_LABEL[level] || level}` };
    }
    mealsRerenderTab();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

async function mealUndoPantry() {
  if (!mealPantryUndo) return;
  try {
    const res = await window.auth.undoPantry(mealPantryUndo.eventId);
    if (res && res.item) {
      const idx = (mealsData.pantry || []).findIndex((it) => it.id === res.item.id);
      if (idx !== -1) mealsData.pantry[idx] = res.item;
      else mealsData.pantry.push(res.item);
    }
    mealPantryUndo = null;
    toast('↩️ Undone');
    mealsRerenderTab();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

async function mealAddLowToShopping() {
  try {
    const res = await window.auth.shoppingFromPantry();
    const items = (res && res.items) || [];
    items.forEach((it) => {
      mealsData.shopping = mealsData.shopping || [];
      if (!mealsData.shopping.some((x) => x.id === it.id)) mealsData.shopping.push(it);
    });
    toast(items.length ? `🛒 Added ${items.length} item${items.length === 1 ? '' : 's'} to the shopping list` : 'Nothing low right now.');
    mealsRerenderTab();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

async function mealDeletePantryItem(id) {
  if (!confirm('Remove this pantry item?')) return;
  try {
    await window.auth.deletePantryItem(id);
    mealsData.pantry = (mealsData.pantry || []).filter((it) => it.id !== id);
    mealsRerenderTab();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

/* ============================================================
   SHOPPING TAB
============================================================ */
function renderMealsShoppingTab() {
  const d = mealsData;
  const items = d.shopping || [];
  const filtered = mealShoppingCatFilter === 'all' ? items : items.filter((it) => it.category === mealShoppingCatFilter);
  const doneCount = items.filter((it) => it.done).length;
  return `
    <div class="meal-section-header">
      <div>
        <div class="meal-section-title">Shopping list</div>
        <div class="meal-section-sub">${doneCount}/${items.length} done</div>
      </div>
      ${!mealIsKid && doneCount ? `<button type="button" class="btn-secondary" onclick="mealRestockPantry()">🎉 Restock pantry</button>` : ''}
    </div>
    <div class="meal-cat-chips">
      <button type="button" class="meal-chip${mealShoppingCatFilter === 'all' ? ' active' : ''}" onclick="mealSetShoppingCatFilter('all')">All</button>
      ${MEAL_PANTRY_CATS.map((c) => `<button type="button" class="meal-chip${mealShoppingCatFilter === c ? ' active' : ''}" onclick="mealSetShoppingCatFilter('${c}')">${esc(MEAL_CAT_LABEL[c])}</button>`).join('')}
    </div>
    <form class="meal-shopping-add-form" onsubmit="mealSubmitShoppingAdd(event)">
      <input class="meal-input meal-input-grow" name="text" placeholder="Add an item…" autocomplete="off" maxlength="200" required>
      ${!mealIsKid ? `
        <select class="meal-select" name="category">
          <option value="">Category</option>
          ${MEAL_PANTRY_CATS.map((c) => `<option value="${c}">${esc(MEAL_CAT_LABEL[c])}</option>`).join('')}
        </select>
      ` : ''}
      <button type="submit" class="btn-primary">Add</button>
    </form>
    <div class="meal-shopping-rows">
      ${filtered.length ? filtered.map(renderMealShoppingRow).join('') : `<p class="text-muted">Nothing on the list.</p>`}
    </div>
  `;
}

function renderMealShoppingRow(it) {
  const doneByFace = it.doneBy ? mealMemberFor(it.doneBy) : null;
  const assigneeFace = it.assigneeUserId ? mealMemberFor(it.assigneeUserId) : null;
  return `
    <div class="meal-shopping-row${it.done ? ' done' : ''}">
      <label class="meal-shopping-check">
        <input type="checkbox" ${it.done ? 'checked' : ''} onchange="mealToggleShoppingDone('${esc(it.id)}',this.checked)">
        <span class="meal-shopping-text">${esc(it.text)}</span>
      </label>
      <div class="meal-shopping-row-meta">
        ${it.category ? `<span class="meal-chip small">${esc(MEAL_CAT_LABEL[it.category] || it.category)}</span>` : ''}
        ${!mealIsKid ? mealAssigneePickerHtml(it) : (assigneeFace ? mealAvatarHtml(assigneeFace, 20) : '')}
        ${it.done && doneByFace ? mealAvatarHtml(doneByFace, 20) : ''}
        ${!mealIsKid ? `<button type="button" class="meal-icon-btn small" title="Remove" onclick="mealDeleteShoppingItem('${esc(it.id)}')">${ICON_MEAL_X}</button>` : ''}
      </div>
    </div>
  `;
}

function mealAssigneePickerHtml(it) {
  const members = (mealsData.household && mealsData.household.members) || [];
  if (!members.length) return '';
  return `<div class="meal-assignee-picker">
    ${members.map((m) => {
      const active = it.assigneeUserId === m.id;
      return `<button type="button" class="meal-assignee-btn${active ? ' active' : ''}" title="${active ? 'Unassign' : 'Assign to '}${esc(m.name)}" onclick="mealSetAssignee('${esc(it.id)}','${esc(m.id)}')">${mealAvatarHtml(m, 18)}</button>`;
    }).join('')}
  </div>`;
}

function mealSetShoppingCatFilter(cat) {
  mealShoppingCatFilter = cat;
  mealsRerenderTab();
}

async function mealSubmitShoppingAdd(e) {
  e.preventDefault();
  const f = e.target;
  const text = f.text.value.trim();
  if (!text) return;
  const payload = { text };
  if (f.category && f.category.value) payload.category = f.category.value;
  try {
    const res = await window.auth.addShoppingItem(payload);
    if (res && res.item) { mealsData.shopping = mealsData.shopping || []; mealsData.shopping.push(res.item); }
    f.reset();
    mealsRerenderTab();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

async function mealToggleShoppingDone(id, checked) {
  try {
    const res = await window.auth.updateShoppingItem(id, { done: checked });
    if (res && res.item) {
      const idx = (mealsData.shopping || []).findIndex((it) => it.id === id);
      if (idx !== -1) mealsData.shopping[idx] = res.item;
    }
    mealsRerenderTab();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

async function mealSetAssignee(itemId, memberId) {
  const item = (mealsData.shopping || []).find((it) => it.id === itemId);
  const next = item && item.assigneeUserId === memberId ? null : memberId;
  try {
    const res = await window.auth.updateShoppingItem(itemId, { assigneeUserId: next });
    if (res && res.item) {
      const idx = (mealsData.shopping || []).findIndex((it) => it.id === itemId);
      if (idx !== -1) mealsData.shopping[idx] = res.item;
    }
    mealsRerenderTab();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

async function mealDeleteShoppingItem(id) {
  if (!confirm('Remove this item?')) return;
  try {
    await window.auth.deleteShoppingItem(id);
    mealsData.shopping = (mealsData.shopping || []).filter((it) => it.id !== id);
    mealsRerenderTab();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

async function mealRestockPantry() {
  try {
    const res = await window.auth.restockPantry();
    const count = (res && res.items && res.items.length) || 0;
    toast(count ? `🎉 Pantry restocked — ${count} item${count === 1 ? '' : 's'} back to plenty` : 'Nothing to restock yet.');
    // See file-header note #5 — refetch rather than guess the merge shape.
    await mealsLoadAll();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

/* ============================================================
   RECIPES TAB
============================================================ */
async function mealLoadRecipes() {
  const params = {};
  if (mealRecipeFilter === 'indian' || mealRecipeFilter === 'thai' || mealRecipeFilter === 'other') params.cuisine = mealRecipeFilter;
  if (mealRecipeFilter === 'veg') params.veg = '1';
  if (mealRecipeFilter === 'kid') params.kidFriendly = '1';
  if (mealRecipeFilter === 'quick') params.maxTimeMins = '30';
  if (mealRecipeQuery) params.query = mealRecipeQuery;
  if (mealRecipeCanCookNow) params.canCookNow = '1';
  mealRecipesLoading = true;
  mealsRerenderTab();
  try {
    const res = await window.auth.getMealsRecipes(params);
    mealsRecipes = (res && res.recipes) || [];
  } catch (err) {
    mealsRecipes = [];
    toast('❌ ' + err.message);
  } finally {
    mealRecipesLoading = false;
    mealsRerenderTab();
  }
}

function mealSetRecipeFilter(id) {
  mealRecipeFilter = id;
  mealLoadRecipes();
}
function mealOnRecipeSearch(v) {
  mealRecipeQuery = v;
  clearTimeout(mealRecipeSearchTimer);
  mealRecipeSearchTimer = setTimeout(mealLoadRecipes, 300);
}
function mealToggleCanCookNow(v) {
  mealRecipeCanCookNow = v;
  mealLoadRecipes();
}

function renderMealsRecipesTab() {
  const recipes = mealsRecipes || [];
  return `
    <div class="meal-section-header">
      <div>
        <div class="meal-section-title">Recipes</div>
        <div class="meal-section-sub">Indian + Thai leaning, built for what's in your pantry.</div>
      </div>
    </div>
    <div class="meal-recipe-controls">
      <div class="meal-cat-chips">
        ${MEAL_RECIPE_FILTERS.map(([id, label]) => `<button type="button" class="meal-chip${mealRecipeFilter === id ? ' active' : ''}" onclick="mealSetRecipeFilter('${id}')">${esc(label)}</button>`).join('')}
      </div>
      <div class="meal-recipe-search-row">
        <input class="meal-input meal-input-grow" type="search" placeholder="Search recipes…" value="${esc(mealRecipeQuery)}" oninput="mealOnRecipeSearch(this.value)">
        <label class="meal-cancook-toggle">
          <input type="checkbox" ${mealRecipeCanCookNow ? 'checked' : ''} onchange="mealToggleCanCookNow(this.checked)">
          <span>Can cook now</span>
        </label>
      </div>
    </div>
    <div class="meal-recipe-grid">
      ${mealRecipesLoading ? '<p class="text-muted">Loading recipes…</p>' :
        (recipes.length ? recipes.map(renderMealRecipeCard).join('') : '<p class="text-muted">No recipes match those filters.</p>')}
    </div>
    ${mealRecipeDetailId ? mealRecipeDetailHtml() : ''}
  `;
}

function renderMealRecipeCard(r) {
  const cov = r.coverage || null;
  const total = cov ? (cov.have || 0) + ((cov.missing && cov.missing.length) || 0) : 0;
  return `
    <div class="card meal-recipe-card" onclick="mealOpenRecipeDetail('${esc(r.id)}')">
      <div class="meal-recipe-card-top">
        <div class="meal-recipe-title">${esc(r.title)}</div>
        <div class="meal-spice-dots">${mealSpiceDots(r.spice)}</div>
      </div>
      <div class="micro-label meal-recipe-meta">${esc(mealCuisineLabel(r.cuisine))} · ${esc(String(r.timeMins || 0))}min · ${r.veg ? 'veg' : 'non-veg'}</div>
      ${(r.allergens && r.allergens.length) ? `<div class="meal-allergen-chips">${r.allergens.map((a) => `<span class="meal-chip small warn">${esc(a)}</span>`).join('')}</div>` : ''}
      ${cov ? `
        <div class="meal-coverage-row">
          <div class="meal-coverage-track"><div class="meal-coverage-fill" style="width:${Math.round((cov.ratio || 0) * 100)}%"></div></div>
          <span class="micro-label">you have ${cov.have != null ? cov.have : '?'} of ${total}</span>
        </div>
      ` : ''}
    </div>
  `;
}

async function mealOpenRecipeDetail(id) {
  mealRecipeDetailId = id;
  mealRecipeDetail = null;
  mealRecipeDetailLoading = true;
  mealRecipeDayPicker = false;
  mealsRerenderTab();
  try {
    const res = await window.auth.getMealsRecipe(id);
    mealRecipeDetail = res || null;
  } catch (err) {
    toast('❌ ' + err.message);
    mealRecipeDetailId = null;
  } finally {
    mealRecipeDetailLoading = false;
    mealsRerenderTab();
  }
}
function mealCloseRecipeDetail() {
  mealRecipeDetailId = null;
  mealRecipeDetail = null;
  mealRecipeDayPicker = false;
  mealsRerenderTab();
}
function mealToggleDayPicker() {
  mealRecipeDayPicker = !mealRecipeDayPicker;
  mealsRerenderTab();
}

function mealRecipeDetailHtml() {
  if (mealRecipeDetailLoading || !mealRecipeDetail) {
    return `<div class="meal-sheet-backdrop" onclick="mealCloseRecipeDetail()"><div class="meal-sheet" onclick="event.stopPropagation()"><p class="text-muted">Loading…</p></div></div>`;
  }
  const r = mealRecipeDetail.recipe || {};
  const cov = mealRecipeDetail.coverage || { have: 0, missing: [], coreMissing: [], ratio: 0 };
  const missingNames = new Set((cov.missing || []).map((x) => (typeof x === 'string' ? x : x.name)));
  return `
    <div class="meal-sheet-backdrop" onclick="mealCloseRecipeDetail()">
      <div class="meal-sheet" onclick="event.stopPropagation()">
        <div class="meal-sheet-head">
          <div>
            <div class="meal-sheet-title">${esc(r.title)}</div>
            <div class="micro-label">${esc(mealCuisineLabel(r.cuisine))} · ${esc(String(r.timeMins || 0))}min · ${mealSpiceDots(r.spice)}</div>
          </div>
          <button type="button" class="meal-icon-btn" onclick="mealCloseRecipeDetail()">${ICON_MEAL_X}</button>
        </div>
        ${(r.allergens && r.allergens.length) ? `<div class="meal-allergen-chips">${r.allergens.map((a) => `<span class="meal-chip small warn">${esc(a)}</span>`).join('')}</div>` : ''}
        <p class="meal-sheet-safety-note text-muted">Suggestions only — always check labels for allergens.</p>
        <div class="meal-sheet-section">
          <div class="micro-label">Ingredients — you have ${cov.have != null ? cov.have : '?'} of ${(r.ingredients || []).length}</div>
          <ul class="meal-ingredient-list">
            ${(r.ingredients || []).map((ing) => `<li class="${missingNames.has(ing.name) ? 'missing' : ''}">${esc(ing.name)}${ing.qtyHint ? ` <span class="text-muted">(${esc(ing.qtyHint)})</span>` : ''}</li>`).join('')}
          </ul>
          ${(cov.missing && cov.missing.length) ? `<button type="button" class="btn-secondary" onclick="mealAddMissingToShopping()">+ Add missing to shopping list</button>` : ''}
        </div>
        <div class="meal-sheet-section">
          <div class="micro-label">Steps</div>
          <ol class="meal-steps-list">${(r.steps || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
        </div>
        ${!mealIsKid ? `
          <div class="meal-sheet-section">
            ${mealRecipeDayPicker ? mealDayPickerHtml(r) : `<button type="button" class="btn-primary" onclick="mealToggleDayPicker()">+ Add to a day</button>`}
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

function mealDayPickerHtml(r) {
  const days = mealNextDays(14);
  return `
    <div class="meal-day-picker">
      <div class="micro-label" style="margin-bottom:8px">Add "${esc(r.title)}" to…</div>
      <div class="meal-day-picker-grid">
        ${days.map((dt) => `<button type="button" class="meal-day-picker-btn" onclick="mealAddRecipeToDay('${esc(r.id)}','${dt}')">${esc(mealShortDayLabel(dt))}</button>`).join('')}
      </div>
      <button type="button" class="btn-secondary" onclick="mealToggleDayPicker()" style="margin-top:8px">Cancel</button>
    </div>
  `;
}

async function mealAddRecipeToDay(recipeId, dateIso) {
  try {
    const res = await window.auth.addMenuEntry({ date: dateIso, slot: 'dinner', recipeId });
    if (res && res.entry) mealMergeMenu([res.entry]);
    toast('✅ Added to ' + mealShortDayLabel(dateIso));
    mealCloseRecipeDetail();
    mealsGoTab('menu');
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

async function mealAddMissingToShopping() {
  const cov = mealRecipeDetail && mealRecipeDetail.coverage;
  if (!cov || !cov.missing || !cov.missing.length) return;
  let added = 0;
  for (const m of cov.missing) {
    const name = typeof m === 'string' ? m : m.name;
    const category = (typeof m === 'object' && m.category) || 'other';
    if (!name) continue;
    try {
      const res = await window.auth.addShoppingItem({ text: name, category });
      if (res && res.item) { mealsData.shopping = mealsData.shopping || []; mealsData.shopping.push(res.item); added++; }
    } catch (err) { /* best-effort — keep adding the rest */ }
  }
  toast(added ? `🛒 Added ${added} item${added === 1 ? '' : 's'} to the shopping list` : '❌ Could not add items.');
  mealsRerenderTab();
}

/* ============================================================
   BOOT
============================================================ */
mealsBoot();
