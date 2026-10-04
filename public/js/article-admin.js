'use strict';
(() => {
  const el = id => document.getElementById(id);
  const fields = ['date', 'url', 'headline', 'summary', 'question'];
  let session = null;
  let editingId = null;
  let busy = false;
  let listGeneration = 0;
  const status = (id, message = '', type = '') => {
    const node = el(id);
    node.textContent = message;
    node.className = `notice ${type}`;
    node.hidden = !message;
  };
  function showSession() {
    const authenticated = Boolean(session?.authenticated);
    el('workspace').hidden = !authenticated;
    el('sign-out').hidden = !authenticated;
    el('login-panel').hidden = authenticated || session?.configured === false;
    el('unavailable-panel').hidden = session?.configured !== false;
    if (session?.today && !el('article-date').value) el('article-date').value = session.today;
    el('date-help').textContent = session?.timeZone ? `Starts at midnight in ${session.timeZone}. One article per day.` : '';
  }
  async function api(path, method = 'GET', body) {
    const headers = {};
    if (method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      if (body === undefined) body = {};
    }
    if (method !== 'GET' && path !== '/login') headers['x-csrf-token'] = session?.csrfToken || '';
    let response;
    try {
      response = await fetch(`/api/article-admin${path}`, { method, headers, credentials: 'same-origin', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch { throw new Error('Couldn’t connect. Check your connection and try again.'); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if ((response.status === 401 || response.status === 403) && path !== '/login') {
        session = { ...session, authenticated: false, csrfToken: undefined };
        listGeneration++;
        showSession();
        status('global-status', 'Your session ended. Sign in again to continue; your draft is still here.', 'error');
        el('password').focus();
      }
      throw new Error(data.error || (response.status === 429 ? 'Please wait a moment before trying again.' : 'Something went wrong. Please try again.'));
    }
    return data;
  }
  function setBusy(value) {
    busy = value;
    document.querySelectorAll('#workspace button, #workspace input, #workspace textarea, #sign-out').forEach(node => { node.disabled = value; });
  }
  function resetEditor() {
    editingId = null;
    el('article-form').reset();
    el('article-date').value = session?.today || '';
    el('editor-heading').textContent = 'Schedule an article';
    el('save-button').textContent = 'Schedule article';
    el('cancel-edit').hidden = true;
    el('source-note').hidden = true;
  }
  function safeURL(value) {
    try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch { return null; }
  }
  function node(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined) item.textContent = text;
    return item;
  }
  function edit(article) {
    editingId = article.id;
    fields.forEach(name => { el(`article-${name}`).value = article[name] || ''; });
    el('editor-heading').textContent = 'Edit article';
    el('save-button').textContent = 'Save changes';
    el('cancel-edit').hidden = false;
    el('source-note').textContent = article.source ? `Source: ${article.source}` : '';
    el('source-note').hidden = !article.source;
    status('form-status');
    el('editor-heading').scrollIntoView({ behavior: 'smooth', block: 'start' });
    el('article-date').focus({ preventScroll: true });
  }
  function renderArticles(articles) {
    const list = el('article-list');
    list.replaceChildren();
    if (!articles.length) {
      const empty = node('div', 'empty-state');
      empty.append(node('strong', '', 'Your next good read goes here.'), node('span', '', 'Schedule your first article and give families something to talk about.'));
      list.append(empty);
      return;
    }
    articles.slice().sort((a, b) => b.date.localeCompare(a.date)).forEach(article => {
      const card = node('article', 'article-card');
      const dateRow = node('div', 'article-date');
      const date = new Date(`${article.date}T12:00:00Z`);
      dateRow.append(node('span', '', Number.isNaN(date.getTime()) ? article.date : date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })), node('span', 'badge', article.date === session.today ? 'Today' : article.date < session.today ? 'Past' : 'Scheduled'));
      const heading = node('h3');
      const url = safeURL(article.url);
      if (url) {
        const link = node('a', '', article.headline);
        link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        heading.append(link);
      } else heading.textContent = article.headline;
      card.append(dateRow, heading);
      if (article.source) card.append(node('p', '', article.source));
      if (article.summary) card.append(node('p', '', article.summary));
      if (article.question) card.append(node('p', '', `Conversation starter: ${article.question}`));
      if (article.fetchError) card.append(node('p', '', `Article fetch needs attention: ${article.fetchError}`));
      else if (article.lastFetchedAt) {
        const fetched = new Date(article.lastFetchedAt);
        if (!Number.isNaN(fetched.getTime())) card.append(node('p', '', `Last fetched ${fetched.toLocaleDateString(undefined, { timeZone: session.timeZone || 'UTC' })}`));
      }
      const actions = node('div', 'article-actions');
      const editButton = node('button', 'quiet', 'Edit article');
      editButton.addEventListener('click', () => edit(article));
      const deleteButton = node('button', 'quiet delete', 'Remove');
      deleteButton.setAttribute('aria-label', `Remove ${article.headline}`);
      deleteButton.addEventListener('click', async () => {
        if (busy || !window.confirm(`Remove “${article.headline}” from ${article.date}? This cannot be undone.`)) return;
        setBusy(true);
        try {
          await api(`/articles/${encodeURIComponent(article.id)}`, 'DELETE');
          if (editingId === article.id) resetEditor();
          status('global-status', 'Article removed.', 'success');
          await loadArticles();
        } catch (error) { status('global-status', error.message, 'error'); }
        finally { setBusy(false); }
      });
      actions.append(editButton, deleteButton); card.append(actions); list.append(card);
    });
  }
  async function loadArticles() {
    const generation = ++listGeneration;
    status('list-status', 'Loading your articles…');
    try {
      const data = await api('/articles');
      if (generation !== listGeneration || !session?.authenticated) return;
      session.today = data.today || session.today;
      session.timeZone = data.timeZone || session.timeZone;
      showSession(); renderArticles(data.articles); status('list-status');
    } catch (error) { if (generation === listGeneration) status('list-status', `${error.message} Use Refresh to try again.`, 'error'); }
  }
  async function loadSession() {
    status('global-status', 'Opening the editor…');
    try {
      session = await api('/session'); showSession(); status('global-status');
      if (session.authenticated) await loadArticles();
    } catch (error) { status('global-status', error.message, 'error'); el('unavailable-panel').hidden = false; }
  }
  el('login-form').addEventListener('submit', async event => {
    event.preventDefault(); el('login-button').disabled = true;
    try {
      session = await api('/login', 'POST', { password: el('password').value });
      el('password').value = ''; showSession(); status('global-status'); await loadArticles();
    } catch (error) { status('global-status', error.message, 'error'); }
    finally { el('password').value = ''; el('login-button').disabled = false; }
  });
  el('sign-out').addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api('/logout', 'POST'); session = { ...session, authenticated: false, csrfToken: undefined };
      listGeneration++; resetEditor(); el('article-list').replaceChildren(); showSession();
      status('global-status', 'You’re signed out.'); el('password').focus();
    } catch (error) { status('global-status', error.message, 'error'); }
    finally { setBusy(false); }
  });
  el('preview-button').addEventListener('click', async () => {
    const url = safeURL(el('article-url').value.trim());
    if (!url) { status('form-status', 'Enter a complete HTTPS article link first.', 'error'); el('article-url').focus(); return; }
    if (busy) return;
    setBusy(true); status('form-status', 'Fetching article details…');
    try {
      const data = await api('/preview', 'POST', { url });
      if (data.headline) el('article-headline').value = data.headline;
      if (data.summary) el('article-summary').value = data.summary;
      el('source-note').textContent = data.source ? `Source: ${data.source}` : '';
      el('source-note').hidden = !data.source;
      status('form-status', 'Details fetched. Make any edits before scheduling.', 'success');
    } catch (error) { status('form-status', error.message, 'error'); }
    finally { setBusy(false); }
  });
  el('article-form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    const body = Object.fromEntries(fields.map(name => [name, el(`article-${name}`).value.trim()]));
    if (!safeURL(body.url) || !body.headline || !body.date) { status('form-status', 'Add a publish date, HTTPS link and headline.', 'error'); return; }
    const updating = Boolean(editingId);
    setBusy(true); status('form-status', 'Saving your article…');
    try {
      await api(editingId ? `/articles/${encodeURIComponent(editingId)}` : '/articles', editingId ? 'PUT' : 'POST', body);
      resetEditor(); status('form-status', updating ? 'Changes saved.' : 'Article scheduled. A good conversation starts here.', 'success');
      await loadArticles();
    } catch (error) { status('form-status', error.message, 'error'); }
    finally { setBusy(false); }
  });
  el('cancel-edit').addEventListener('click', () => { resetEditor(); status('form-status'); });
  el('refresh-list').addEventListener('click', loadArticles);
  el('retry-session').addEventListener('click', loadSession);
  loadSession();
})();
