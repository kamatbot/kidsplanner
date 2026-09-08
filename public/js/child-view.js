/* Parent child overview: approved Help & Progress composition (f65d002f).
   Horizon identity; equal support/progress columns and a wide parent-plan journey.
   Facts remain scoped to the selected child; missing observations stay unknown. */
(function () {
  'use strict';
  let generation = 0;
  let selected = null;
  const parts = [['news', 'News'], ['word', 'Word'], ['quote', 'Quote'], ['puzzle', 'Puzzle'], ['bt', 'Brain teaser']];
  const paths = {
    book: '<path d="M12 5v15M3 4h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v15h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3z"/>',
    news: '<path d="M5 3h16v18H5zM5 7H2v12a2 2 0 0 0 3 2M9 7h8M9 11h8M9 15h3M15 15h2"/>',
    word: '<path d="m3 19 6-14 6 14M5 14h8M21 10v9M21 12a4 4 0 1 0 0 5"/>',
    quote: '<path d="M10 6H4v7h6v5H3M21 6h-6v7h6v5h-7"/>',
    puzzle: '<path d="M4 4h6a3 3 0 1 1 5 0h5v6a3 3 0 1 0 0 5v5h-6a3 3 0 1 0-5 0H4v-6a3 3 0 1 1 0-5z"/>',
    bt: '<path d="M12 4v16M12 5C6 0 3 7 5 10c-5 4 0 10 4 8 0 4 3 3 3 2M12 5c6-5 9 2 7 5 5 4 0 10-4 8 0 4-3 3-3 2M8 9l4 3 4-3M8 15l4-3 4 3"/>',
    school: '<path d="m3 9 9-6 9 6v12H3zM9 21v-7h6v7M7 10h1M16 10h1"/>',
    activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    car: '<path d="m3 11 3-6h12l3 6v7H3zM3 11h18M6 18v3M18 18v3M6 14h2M16 14h2"/>',
    home: '<path d="m2 11 10-9 10 9M5 9v12h5v-7h4v7h5V9"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.book}</svg>`;
  const e = (value) => esc(String(value == null ? '' : value));
  const button = (action, text, extra = '') => `<button type="button" class="${action === 'homework' ? 'cv-primary' : 'cv-link'}" data-cv-action="${action}" ${extra}>${text}</button>`;
  function allowed() { return !!sessionUser && !isKidSession() && !!currentFamily; }
  function child(id) { return allowed() && (currentFamily.kids || []).find(k => k.id === id); }
  function datesEnding(date) {
    const d = new Date(`${date}T12:00:00`);
    return Array.from({ length: 7 }, (_, i) => { const x = new Date(d); x.setDate(x.getDate() - 6 + i); return isoDate(x); });
  }
  function dateLabel(date, options = { month: 'short', day: 'numeric' }) {
    return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, options);
  }
  function timestamp(value) {
    const d = new Date(value);
    return value && Number.isFinite(+d) ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
  }
  function renderNavigation() {
    const nav = document.getElementById('child-nav');
    if (!nav) return;
    const kids = allowed() ? currentFamily.kids || [] : [];
    nav.hidden = !kids.length;
    const active = typeof activeChildViewId !== 'undefined' ? activeChildViewId : selected;
    nav.innerHTML = kids.length ? `<div class="cv-nav-label">Children</div>${kids.map(k => `<button type="button" class="cv-child-link${active === k.id ? ' is-active' : ''}" data-child-id="${e(k.id)}" title="${e(k.name)}" aria-label="${e(k.name)}" aria-current="${active === k.id ? 'page' : 'false'}">${kidAvatarMarkup(k.id)}<span>${e(k.name)}</span></button>`).join('')}` : '';
    nav.onclick = event => { const target = event.target.closest('[data-child-id]'); if (target && child(target.dataset.childId)) openChildView(target.dataset.childId); };
  }
  function clear() {
    generation++; selected = null;
    for (const id of ['tab-child', 'child-nav']) {
      const el = document.getElementById(id);
      if (el) { el.innerHTML = ''; el.hidden = true; el.onclick = null; }
    }
  }
  function activitiesFor(id, date, items) {
    const day = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(`${date}T12:00:00`).getDay()];
    return items.filter(a => a.kidId === id).flatMap(a => (a.schedule || []).filter(s => s.day === day).map(slot => ({ activity: a, slot }))).sort((a, b) => String(a.slot.start).localeCompare(String(b.slot.start)));
  }
  function support(id, date, sources) {
    const work = sources.homework.filter(h => h.kidId === id && h.status !== 'done').sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')));
    const h = work[0];
    const activity = activitiesFor(id, date, sources.activities).find(a => (a.activity.gear || []).length);
    return `<section class="cv-panel cv-support" aria-labelledby="cv-help-title"><h2 id="cv-help-title">Where you can help</h2>
      ${h ? `<article class="cv-homework"><div class="cv-assignment"><span class="cv-symbol">${icon('book')}</span><div><h3>${e(h.subject ? `${h.subject} · ${h.title}` : h.title)}</h3><p>${e(h.schoolDescription || h.description || h.notes || 'Open the assignment to review the brief together.')}</p></div></div>
      <dl class="cv-homework-meta"><div><dt>Due date</dt><dd>${h.dueDate ? e(dateLabel(h.dueDate)) : 'Not provided'}${h.dueDate && h.dueDate < date ? ' · overdue' : ''}</dd></div><div><dt>Estimated time</dt><dd>${Number.isFinite(h.effortMin) && h.effortMin > 0 ? `${e(h.effortMin)} min` : 'Not provided'}</dd></div></dl>
      ${button('homework', 'Review homework', `data-id="${e(h.id)}"`)}</article>` : `<p class="cv-empty">${sources.loading ? 'Loading assignments…' : sources.errors.includes('Homework') ? 'Homework could not be loaded.' : 'No open assignments. Review homework or connect a school feed in Settings.'}</p>`}
      ${activity ? `<div class="cv-preparation"><span class="cv-symbol">${icon('activity')}</span><div><h3>Prepare for ${e(activity.activity.name)}</h3><p>${e(activity.activity.gear.join(', '))}</p>${button('activities', 'View activities')}</div></div>` : `<div class="cv-preparation"><span class="cv-symbol">${icon('activity')}</span><div><h3>After-school preparation</h3><p>${sources.loading ? 'Loading activities…' : sources.errors.includes('Activities') ? 'Activities could not be loaded.' : 'No gear reminders recorded for today.'}</p>${button('activities', 'Review activities')}</div></div>`}
      ${sources.errors.length ? `<p role="status">${e(sources.errors.join(', '))} unavailable. ${button('retry', 'Try again')}</p>` : sources.loading ? '<p role="status">Loading homework, habits and activities…</p>' : ''}
      <div class="cv-footer">${button('all-homework', `View all homework ${icon('arrow')}`)}${button('settings', 'School settings')}</div></section>`;
  }
  function progress(id, date, data, state, sources) {
    // Existing extension imports are already keyed to this family's child ID.
    // Read them in place; do not upload or reattribute legacy device records.
    const local = window.famGetSchoolStats?.()?.[id];
    const imported = local && Number.isFinite(local.housePoints) && timestamp(local.updatedAt) ? { ...local, importedAt: local.updatedAt } : null;
    const shared = data && data.schoolStats;
    const stats = imported && (!shared || !timestamp(shared.importedAt) || new Date(imported.importedAt) > new Date(shared.importedAt)) ? imported : shared;
    const stamp = stats && timestamp(stats.importedAt);
    const habits = sources.goals.filter(g => g.kidId === id && g.type === 'habit');
    const days = datesEnding(date);
    const observed = data && data.daily5 && data.daily5.date === date ? data.daily5.parts || {} : {};
    const validPart = key => observed[key] && ['started', 'completed'].includes(observed[key].status) && timestamp(observed[key].updatedAt) ? observed[key] : null;
    const complete = parts.filter(([key]) => validPart(key)?.status === 'completed').length;
    const latest = parts.map(([key]) => validPart(key)?.updatedAt).filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0];
    return `<section class="cv-panel cv-progress" aria-labelledby="cv-progress-title"><h2 id="cv-progress-title">Making progress</h2>
      <div class="cv-points"><h3>House points</h3>${stats && Number.isFinite(stats.housePoints) && stamp ? `<strong class="cv-point-value">${e(stats.housePoints)}</strong><p>Latest import · ${e(stamp)}</p>` : `<p>${state === 'loading' ? 'Loading school snapshot…' : 'No child-specific school snapshot available.'}</p>${button('settings', 'Connect school data')}`}</div>
      <div class="cv-habits"><h3>Habits <span>(past 7 days: ${e(dateLabel(days[0]))}–${e(dateLabel(date))})</span></h3>${habits.length ? habits.map(g => {
        const known = Array.isArray(g.checks); const checks = new Set(known ? g.checks : []);
        return `<div class="cv-habit"><div><strong>${e(g.title)}</strong><span>${known ? `${days.filter(d => checks.has(d)).length} of 7 days recorded` : 'Check-ins unavailable'}</span></div><div class="cv-days">${days.map(d => `<span class="cv-day" title="${e(dateLabel(d))}: ${known ? checks.has(d) ? 'checked in' : 'no check-in recorded' : 'unknown'}"><span>${e(dateLabel(d, { weekday: 'narrow' }))}</span><i class="${checks.has(d) ? 'is-done' : ''}" aria-label="${e(d)}: ${known ? checks.has(d) ? 'checked in' : 'no check-in recorded' : 'unknown'}"></i></span>`).join('')}</div></div>`;
      }).join('') : `<p>${sources.loading ? 'Loading habits…' : sources.errors.includes('Habits') ? 'Habit check-ins could not be loaded.' : 'No habits recorded for this child.'} ${button('goals', 'Review goals')}</p>`}</div>
      <div class="cv-daily"><h3>Daily 5 <span>${state === 'ready' ? `${complete} of 5 done` : state === 'loading' ? 'Loading…' : 'Couldn’t sync progress'}</span></h3><div class="cv-parts">${parts.map(([key, label]) => { const part = validPart(key); const status = state !== 'ready' ? '—' : part?.status === 'completed' ? 'Done' : 'Not done'; return `<div class="cv-part"><span class="cv-symbol${part?.status === 'completed' ? ' is-complete' : ''}">${icon(key)}</span><strong>${label}</strong><span>${status}</span></div>`; }).join('')}</div><p class="cv-freshness">${state === 'ready' ? `Today’s synced activity${latest ? ` · Updated ${e(timestamp(latest))}` : ' · No completions recorded yet'}` : 'Refresh to try again.'}</p></div>
      <div class="cv-footer">${button('goals', `View all goals ${icon('arrow')}`)}${button('retry', 'Refresh progress')}</div></section>`;
  }
  function journey(id, date, data, sources) {
    const plan = data && data.homePlan && data.homePlan.date === date ? data.homePlan : {};
    const stops = [{ name: 'School ends', time: plan.schoolEnd, note: 'Parent plan', icon: 'school' }, ...activitiesFor(id, date, sources.activities).map(({ activity, slot }) => ({ name: activity.name, time: slot.start ? `${slot.start}${slot.end ? `–${slot.end}` : ''}` : null, note: activity.location || 'Weekly activity', icon: 'activity' })), { name: 'Pickup', time: plan.pickupTime, note: plan.pickupLabel || 'Parent plan', icon: 'car' }, { name: 'Home', time: plan.homeTime, note: 'Expected · parent plan', icon: 'home' }];
    return `<section class="cv-panel cv-journey" aria-labelledby="cv-journey-title"><div class="cv-section-heading"><div><h2 id="cv-journey-title">Today, after school</h2><p>Your plan for ${e(dateLabel(date))} · not live tracking</p></div>${button('edit-plan', data && data.homePlan ? 'Edit plan' : 'Set home plan', !data ? 'disabled title="Load the current plan before editing"' : '')}</div><ol class="cv-stops">${stops.map(s => `<li><span class="cv-symbol">${icon(s.icon)}</span><h3>${e(s.name)}</h3><strong>${e(s.time || (data ? 'Not set' : 'Unavailable'))}</strong><p>${e(s.note)}</p></li>`).join('')}</ol><div id="cv-plan-editor" hidden></div></section>`;
  }
  async function render(id) {
    const kid = child(id); const root = document.getElementById('tab-child');
    if (!kid || !root) { clear(); return; }
    selected = id; const token = ++generation; const account = sessionUser; const familyId = currentFamily.id; const date = isoDate(new Date());
    const current = () => token === generation && sessionUser === account && currentFamily?.id === familyId && !!child(id) && isoDate(new Date()) === date;
    let data = null;
    const sources = { homework: [], goals: [], activities: [], errors: [], loading: true };
    function draw(state) {
      root.innerHTML = `<div class="cv-page"><header class="cv-header"><div class="cv-identity">${kidAvatarMarkup(id)}<div><h1>${e(kid.name)}</h1><p>Parent view</p></div></div><time datetime="${date}">${e(dateLabel(date, { weekday: 'long', month: 'long', day: 'numeric' }))}</time></header>${state === 'error' ? `<div class="cv-error" role="alert">School and Daily 5 updates couldn’t be loaded. ${button('retry', 'Try again')}</div>` : ''}<div class="cv-columns">${support(id, date, sources)}${progress(id, date, data, state, sources)}</div>${journey(id, date, data, sources)}</div>`;
      root.setAttribute('aria-busy', String(state === 'loading'));
    }
    root.onclick = event => {
      const b = event.target.closest('[data-cv-action]'); if (!b || !current()) return;
      const action = b.dataset.cvAction;
      if (action === 'retry') { render(id); return; }
      if (action === 'homework') { window.openChildHomeworkReview(b.dataset.id); return; }
      if (action === 'edit-plan') { if (data) editPlan(); return; }
      if (action === 'cancel-plan') { document.getElementById('cv-plan-editor').hidden = true; root.querySelector('[data-cv-action="edit-plan"]').focus(); return; }
      if (action === 'all-homework') { activeKidId = id; renderKidSwitcher(); switchNavTab('homework'); return; }
      if (['activities', 'goals', 'settings'].includes(action)) switchNavTab(action);
    };
    function editPlan() {
      const editor = document.getElementById('cv-plan-editor'); const plan = data?.homePlan || {};
      editor.hidden = false;
      editor.innerHTML = `<form class="cv-plan-form"><p>Expected times for ${e(dateLabel(date))}. Leave a time blank when unknown.</p><div class="cv-plan-fields">${[['schoolEnd', 'School ends'], ['pickupTime', 'Pickup'], ['homeTime', 'Expected home']].map(([key, label]) => `<label>${label}<input type="time" name="${key}" value="${e(plan[key])}"></label>`).join('')}<label>Pickup details<input name="pickupLabel" maxlength="80" value="${e(plan.pickupLabel)}" placeholder="Meeting place or person"></label></div><p class="cv-form-error" role="alert"></p><button type="submit" class="cv-primary">Save home plan</button>${button('cancel-plan', 'Cancel')}</form>`;
      const form = editor.querySelector('form'); form.querySelector('input').focus();
      form.onsubmit = async event => {
        event.preventDefault(); if (!current()) return;
        const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
        const payload = { date }; for (const key of ['schoolEnd', 'pickupTime', 'homeTime', 'pickupLabel']) payload[key] = form.elements[key].value || (key === 'pickupLabel' ? '' : null);
        try { await window.auth.saveChildHomePlan(id, payload); if (current()) { await render(id); root.querySelector('[data-cv-action="edit-plan"]')?.focus(); } }
        catch (_) { if (current()) { form.querySelector('.cv-form-error').textContent = 'Your plan couldn’t be saved. Please try again.'; submit.disabled = false; } }
      };
    }
    renderNavigation(); draw('loading');
    try {
      const results = await Promise.allSettled([window.auth.getChildInsights(id, date), window.auth.getHomework({ kidId: id }), window.auth.getGoals({ kidId: id }), window.auth.getActivities({ kidId: id })]);
      if (!current()) return;
      sources.loading = false;
      ['homework', 'goals', 'activities'].forEach((name, index) => {
        const result = results[index + 1];
        if (result.status === 'fulfilled' && Array.isArray(result.value)) sources[name] = result.value;
        else sources.errors.push(name === 'goals' ? 'Habits' : name === 'homework' ? 'Homework' : 'Activities');
      });
      const result = results[0].status === 'fulfilled' ? results[0].value : null;
      if (!result || result.kidId !== id || result.date !== date) throw new Error('Wrong insight scope');
      data = result; draw('ready');
    } catch (_) { if (current()) draw('error'); }
  }
  window.famChildView = { renderNavigation, render, clear, cancel() { generation++; selected = null; } };
})();
