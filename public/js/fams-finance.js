(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const number = value => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(Number(value) || 0);
  let kidId = new URLSearchParams(location.search).get('kidId') || '';
  let data;
  let loadVersion = 0;
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const status = message => { $('fams-status').textContent = message; };
  async function api(path, body) {
    const response = await fetch('/api/fams' + path, {
      credentials: 'same-origin',
      ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    });
    if (response.status === 401) throw new Error('Your session ended. Return to Today to sign in again.');
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'That didn’t work. Please try again.');
    return result;
  }
  async function action(button, work) {
    button.disabled = true;
    try { await work(); } catch (error) { status(error.message); }
    finally { button.disabled = false; }
  }
  function row(title, detail) {
    const li = element('li');
    const copy = element('div');
    copy.append(element('strong', title), element('p', detail));
    li.append(copy);
    return li;
  }
  function render() {
    $('fams-content').hidden = !data.kidId;
    $('fams-kid-label').hidden = !data.isParent || !data.kids.length;
    $('fams-kid').replaceChildren(...data.kids.map(kid => {
      const option = element('option', kid.name); option.value = kid.id; return option;
    }));
    $('fams-kid').value = kidId;
    if (!data.kidId) { status('Add a child in Settings to start earning Fams.'); return; }
    $('fams-balance').textContent = number(data.balance);
    $('fams-rates').textContent = `Daily 5: ${number(data.rates.daily5)} fams per activity · Homework: ${number(data.rates.homework)} (up to ${number(data.rates.homeworkDailyLimit)} per day) · News reflection: ${number(data.rates.newsComment)} · Finance lesson: ${number(data.rates.lesson)} · School house point: ${number(data.rates.schoolPoint)} extra.`;
    $('fams-week-text').textContent = `${number(data.weekly.earned)} / ${number(data.weekly.limit)} fams`;
    $('fams-week-progress').max = data.weekly.limit;
    $('fams-week-progress').value = data.weekly.earned;
    $('fams-week-progress').setAttribute('aria-label', 'Regular earnings this week');
    const goal = data.goal;
    $('fams-goal-summary').textContent = goal ? `${goal.name}: ${number(data.balance)} of ${number(goal.target)} fams. ${data.balance >= goal.target ? 'You’ve reached your target!' : `${number(goal.target - data.balance)} to go.`}` : 'Pick a goal to make every fam count.';
    $('fams-goal-progress').hidden = !goal;
    if (goal) {
      $('fams-goal-progress').max = goal.target; $('fams-goal-progress').value = Math.min(data.balance, goal.target);
      $('fams-goal-progress').setAttribute('aria-label', `Progress toward ${goal.name}`);
    }
    $('fams-goal-form').elements.name.value = goal?.name || '';
    $('fams-goal-form').elements.target.value = goal?.target || '';
    $('fams-chore-form').hidden = !data.isParent;
    $('fams-school-reset').hidden = !data.isParent || !data.schoolPoints.resetPending;
    const chores = data.chores.map(chore => {
      const li = row(chore.title, `${number(chore.amount)} fams · ${chore.status === 'submitted' ? 'Waiting for parent approval' : chore.status}`);
      const canSubmit = !data.isParent && chore.status === 'pending';
      const canApprove = data.isParent && chore.status === 'submitted';
      if (canSubmit || canApprove) {
        const button = element('button', canApprove ? 'Approve reward' : 'I’ve done it');
        button.type = 'button';
        button.addEventListener('click', () => action(button, async () => {
          await api(`/chores/${encodeURIComponent(chore.id)}/${canApprove ? 'approve' : 'submit'}`, { kidId });
          await load(); status(canApprove ? 'Reward approved.' : 'Sent to your parent for approval.');
        }));
        li.append(button);
      }
      return li;
    });
    $('fams-chores').replaceChildren(...(chores.length ? chores : [row('No chores yet', data.isParent ? 'Assign a small job and agree on its reward.' : 'Ask a parent for a job you can help with.')]));
    $('fams-earned').textContent = `${number(data.totalEarned)} fams earned altogether.`;
    const transactions = data.transactions.map(transaction => {
      const date = new Date(transaction.createdAt);
      const li = row(transaction.reason, Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }));
      li.append(element('span', `${transaction.amount > 0 ? '+' : ''}${number(transaction.amount)} fams`, 'fams-amount'));
      return li;
    });
    $('fams-transactions').replaceChildren(...(transactions.length ? transactions : [row('A fresh start', 'Your first reward will appear here.')]));
  }
  async function loadLessons(version) {
    const result = await api(`/lessons?kidId=${encodeURIComponent(kidId)}`);
    if (version !== loadVersion) return;
    $('fams-lessons').replaceChildren(...result.lessons.map(lesson => {
      const details = element('details', undefined, 'fams-lesson');
      details.append(element('summary', `${lesson.title}${lesson.completed ? ' · Completed' : ''}`), element('p', lesson.body));
      const form = element('form');
      const fieldset = element('fieldset'); fieldset.append(element('legend', lesson.question));
      lesson.options.forEach(option => {
        const label = element('label', undefined, 'fams-answer');
        const input = element('input'); input.type = 'radio'; input.name = 'answerId'; input.value = option.id; input.required = true;
        label.append(input, element('span', option.text)); fieldset.append(label);
      });
      const button = element('button', lesson.completed ? 'Try again' : 'Check my answer');
      if (data.isParent) { button.hidden = true; fieldset.disabled = true; form.append(element('p', 'Your child can answer this lesson from their own account.')); }
      const feedback = element('p'); feedback.setAttribute('role', 'status');
      form.append(fieldset, button, feedback);
      form.addEventListener('submit', event => {
        event.preventDefault();
        action(button, async () => {
          const result = await api(`/lessons/${encodeURIComponent(lesson.id)}/complete`, { kidId, answerId: new FormData(form).get('answerId') });
          feedback.textContent = `${result.correct ? 'That’s right!' : 'Have another think.'} ${result.explanation || ''}`;
          if (result.correct) {
            details.querySelector('summary').textContent = `${lesson.title} · Completed`;
            const refreshed = await api(`?kidId=${encodeURIComponent(kidId)}`);
            if (version === loadVersion) { data = refreshed; render(); }
          }
        });
      });
      details.append(form); return details;
    }));
    if (!result.lessons.length) $('fams-lessons').textContent = 'More lessons are on the way.';
  }
  async function load() {
    const version = ++loadVersion;
    $('fams-retry').hidden = true;
    $('fams-content').hidden = true;
    $('fams-lessons').replaceChildren();
    status('Opening your Fams…');
    try {
      const result = await api(`?kidId=${encodeURIComponent(kidId)}`);
      if (version !== loadVersion) return;
      data = result; kidId = data.kidId || ''; render();
      if (!kidId) return;
      status('');
      loadLessons(version).catch(error => { if (version === loadVersion) { $('fams-lessons').textContent = error.message; $('fams-retry').hidden = false; } });
    } catch (error) {
      if (version !== loadVersion) return;
      status(error.message); $('fams-retry').hidden = false;
    }
  }
  $('fams-retry').addEventListener('click', load);
  $('fams-kid').addEventListener('change', event => {
    kidId = event.target.value;
    const url = new URL(location.href); url.searchParams.set('kidId', kidId); history.replaceState(null, '', url);
    load();
  });
  for (const [id, path] of [['fams-goal-form', '/goals'], ['fams-chore-form', '/chores']]) {
    $(id).addEventListener('submit', event => {
      event.preventDefault(); const form = event.currentTarget;
      const payload = Object.fromEntries(new FormData(form));
      if ('target' in payload) payload.target = Number(payload.target);
      if ('amount' in payload) payload.amount = Number(payload.amount);
      action(form.querySelector('button'), async () => {
        await api(path, { ...payload, kidId });
        if (path === '/chores') form.reset();
        await load(); status(path === '/goals' ? 'Your goal is saved.' : 'Chore assigned.');
      });
    });
  }
  $('fams-reset-button').addEventListener('click', event => action(event.currentTarget, async () => {
    await api('/school-reset', { kidId }); await load(); status('New school points period confirmed.');
  }));
  $('fams-projection-form').addEventListener('submit', event => {
    event.preventDefault(); const form = event.currentTarget;
    action(form.querySelector('button'), async () => {
      const payload = Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, Number(value)]));
      const result = await api('/projection', payload);
      const summary = element('p', `After ${payload.years} years: ฿${number(result.total)} in this hypothetical example. You put in ฿${number(result.contributions)}; modeled growth is ฿${number(result.growth)}.`, 'fams-projection-summary');
      const chart = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      chart.setAttribute('viewBox', '0 0 600 180'); chart.setAttribute('role', 'img');
      chart.setAttribute('aria-label', 'Hypothetical savings over time. Exact values are in the year-by-year table.');
      chart.classList.add('fams-chart');
      const maximum = Math.max(1, ...result.series.flatMap(point => [point.total, point.contributions]));
      for (const [key, className] of [['contributions', 'fams-chart-added'], ['total', 'fams-chart-total']]) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        line.setAttribute('points', result.series.map(point => `${10 + point.year / payload.years * 580},${170 - point[key] / maximum * 160}`).join(' '));
        line.setAttribute('fill', 'none'); line.setAttribute('stroke-width', '3'); line.classList.add(className); chart.append(line);
      }
      const key = element('p', 'Violet: modeled total · Dashed: money you add. From today (left) to your chosen year (right).', 'fams-chart-key');
      const details = element('details'); details.append(element('summary', 'See the year-by-year numbers'));
      const table = element('table'); const caption = element('caption', 'Hypothetical savings in Thai baht'); table.append(caption);
      const head = element('thead'); const headings = element('tr');
      ['Year', 'Money added', 'Modeled total'].forEach(text => { const th = element('th', text); th.scope = 'col'; headings.append(th); }); head.append(headings); table.append(head);
      const body = element('tbody');
      result.series.forEach(point => { const tr = element('tr'); [point.year, number(point.contributions), number(point.total)].forEach(value => tr.append(element('td', String(value)))); body.append(tr); });
      table.append(body); details.append(table); $('fams-projection').replaceChildren(summary, chart, key, details);
    });
  });
  load();
})();
