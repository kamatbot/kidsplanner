/* One optional, static companion. Only a non-sensitive per-account UI toggle
   is stored; it never reads homework, rewards, or another child's profile. */
window.FamStudyPal = (() => {
  const sessionChoices = new Map();
  const identities = new WeakMap();
  function render(host, user) {
    if (!host) return;
    const identity = user?.role === 'kid' && user.id ? user.id : null;
    if (identities.has(host) && identities.get(host) === identity) return;
    identities.set(host, identity);
    host.replaceChildren();
    host.hidden = !identity;
    if (host.hidden) return;
    const key = `fam_study_pal_hidden:${encodeURIComponent(user.id)}`;
    let hidden = sessionChoices.get(key) || false;
    if (!sessionChoices.has(key)) {
      try { hidden = localStorage.getItem(key) === 'true'; } catch (_) { /* Session-only fallback. */ }
    }
    const heading = document.createElement('h2');
    heading.textContent = 'Your study pal';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn-link study-pal-toggle';
    button.setAttribute('aria-controls', 'study-pal-companion');
    const header = document.createElement('div');
    header.className = 'study-pal-header';
    header.append(heading, button);
    const body = document.createElement('div');
    body.id = 'study-pal-companion';
    body.className = 'study-pal-body';
    const art = document.createElement('img');
    art.src = '/img/study-pal/koko.png';
    art.alt = 'Koko, a small-clawed otter with round glasses, beside an open book';
    art.width = 104; art.height = 104;
    const copy = document.createElement('div');
    const name = document.createElement('h3');
    name.textContent = 'Welcome back. Koko’s here.';
    const message = document.createElement('p');
    message.textContent = 'Take things at your own pace. One small step is enough.';
    copy.append(name, message);
    body.append(art, copy);
    function update() {
      body.hidden = hidden;
      button.textContent = hidden ? 'Show Koko' : 'Hide Koko';
      button.setAttribute('aria-expanded', String(!hidden));
    }
    button.addEventListener('click', () => {
      if (user.role !== 'kid' || user.id !== identity || !host.isConnected || identities.get(host) !== identity) return;
      hidden = !hidden;
      sessionChoices.set(key, hidden);
      try { localStorage.setItem(key, String(hidden)); } catch (_) { /* Keep the control usable. */ }
      update();
    });
    update();
    host.append(header, body);
  }
  return { render };
})();
