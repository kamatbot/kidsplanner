/* Private drafts live only in this closure, never localStorage or family notes. */
(() => {
  const choices = ['tuk-tuk', 'mango-sticky-rice', 'boba', 'monsoon-cloud', 'leaf-umbrella', 'small-star', 'sleepy-cat', 'happy-capybara', 'space-rocket', 'tiny-planet', 'rainbow', 'lucky-frog', 'bookworm', 'clever-fox', 'headphones', 'game-controller', 'roller-skate', 'sunshine', 'strawberry', 'ice-cream', 'pizza-slice', 'ocean-turtle', 'mountain', 'paper-plane', 'joyful-panda', 'brave-lion', 'calm-koala', 'worried-hedgehog', 'sad-penguin', 'angry-dragon', 'proud-peacock', 'curious-owl', 'shy-bunny', 'silly-monkey', 'tired-sloth', 'grateful-otter', 'focused-robot', 'study-pencil', 'reading-bear', 'painting-palette', 'dancing-dino', 'music-guitar', 'soccer-ball', 'basketball-hoop', 'swimming-dolphin', 'cycling-bunny', 'cooking-chef', 'gardening-sprout'];
  const stickerPath = id => `/img/my-corner/${id}.${choices.indexOf(id) < 6 ? 'svg' : 'png'}`;
  const moods = new Set(['joyful-panda', 'brave-lion', 'calm-koala', 'worried-hedgehog', 'sad-penguin', 'angry-dragon', 'proud-peacock', 'curious-owl', 'shy-bunny', 'silly-monkey', 'tired-sloth', 'grateful-otter', 'focused-robot']);
  const activities = new Set(['study-pencil', 'reading-bear', 'painting-palette', 'dancing-dino', 'music-guitar', 'soccer-ball', 'basketball-hoop', 'swimming-dolphin', 'cycling-bunny', 'cooking-chef', 'gardening-sprout', 'bookworm', 'headphones', 'game-controller', 'roller-skate', 'paper-plane']);
  const label = id => id.replaceAll('-', ' ');
  let owner = null, ownerFamily = null, ownerRole = null, category = 'All', draft = null, latest = null, selected = null, dirty = false, busy = false, generation = 0;
  let dialog, body, status, saveButton, opener, drawer;
  function el(tag, text, className) { const e = document.createElement(tag); if (text) e.textContent = text; if (className) e.className = className; return e; }
  function button(text, action) { const b = el('button', text); b.type = 'button'; b.addEventListener('click', action); return b; }
  function say(message) { status.textContent = message; }
  function clear() {
    generation++; draft = latest = null; selected = null; dirty = busy = false;
    drawer?.remove(); dialog?.remove(); dialog = drawer = null;
  }
  function setUser(user, familyId = null) {
    const next = ['kid', 'parent'].includes(user?.role) && familyId ? user.id : null;
    if (next !== owner || familyId !== ownerFamily || user?.role !== ownerRole) { clear(); owner = next; ownerFamily = familyId; ownerRole = user?.role; category = 'All'; }
    const host = document.getElementById('fam-my-corner-entry');
    if (!host) return;
    host.hidden = !owner;
    if (!host.childNodes.length) host.append(button('My Corner · stickers & a note', open));
  }
  async function request(method, value) {
    const response = await fetch('/api/my-corner', { method, credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Fam-Corner-Account': owner, 'X-Fam-Corner-Family': ownerFamily, 'X-Fam-Corner-Role': ownerRole }, body: value ? JSON.stringify(value) : undefined });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || 'Please retry.'), { status: response.status });
    return data;
  }
  function close() {
    if (busy) return;
    if (dirty && !window.confirm('Discard your unsaved corner changes?')) return;
    clear(); opener?.focus();
  }
  async function open() {
    if (!owner || dialog) return;
    const token = ++generation, expectedOwner = owner, expectedRole = ownerRole;
    try {
      const response = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
      const data = response.ok ? await response.json() : null;
      if (token !== generation || document.hidden) return;
      if (!['kid', 'parent'].includes(data?.user?.role) || data.user.id !== expectedOwner || data.user.role !== expectedRole) {
        setUser(null);
        window.toast?.('Your account changed. Refresh before opening My Corner.');
        return;
      }
    } catch {
      if (token === generation) window.toast?.('Could not confirm your account. Please retry.');
      return;
    }
    opener = document.activeElement;
    dialog = el('dialog', '', 'fam-corner'); dialog.setAttribute('aria-labelledby', 'fam-corner-title');
    const title = el('h2', 'My Corner'); title.id = 'fam-corner-title';
    const header = el('header'); header.append(title, button('Close', close));
    status = el('p', 'Loading your corner…'); status.setAttribute('role', 'status');
    body = el('div');
    saveButton = button('Save changes', save); saveButton.disabled = true;
    dialog.append(header, el('p', 'Only you can open this corner. Nothing here is shared with family. Save before switching tabs; unsaved edits are cleared when this tab is hidden.'), status, body, saveButton);
    dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
    document.body.append(dialog); dialog.showModal(); load();
  }
  async function load() {
    const token = ++generation; busy = true;
    try { const data = await request('GET'); if (token !== generation) return; draft = data; dirty = false; render(); say('Add a sticker, then tap the canvas or use the placement controls.'); }
    catch (error) { if (token !== generation) return; say(error.message); body.replaceChildren(button('Retry loading', load)); }
    finally { if (token === generation) { busy = false; if (draft) render(); saveButton.disabled = !draft; } }
  }
  function changed() { dirty = true; say('Unsaved changes'); }
  function canvas(value, editable) {
    const board = el('div', '', 'fam-corner-canvas'); board.setAttribute('aria-label', editable ? 'My Corner canvas' : 'Latest saved canvas');
    const note = el('div', value.note || 'A small space for your ideas.', 'fam-corner-note'); board.append(note);
    value.stickers.forEach(s => {
      const item = editable ? button('', () => { selected = s.id; render(); body.querySelector('.fam-corner-sticker[aria-pressed="true"]')?.focus(); }) : el('span');
      item.className = 'fam-corner-sticker'; item.style.left = `calc(48px + (100% - 96px) * ${s.x})`; item.style.top = `calc(48px + (100% - 96px) * ${s.y})`;
      item.style.transform = `translate(-50%, -50%) rotate(${s.rotation}deg)`;
      const img = el('img'); img.src = stickerPath(s.stickerId); img.alt = label(s.stickerId); item.append(img);
      if (editable) { item.setAttribute('aria-pressed', String(selected === s.id)); item.setAttribute('aria-label', `Select ${label(s.stickerId)}`); }
      board.append(item);
    });
    if (editable) board.addEventListener('click', e => {
      if (e.target.closest('button') || busy) return;
      const s = draft.stickers.find(s => s.id === selected); if (!s) return;
      const rect = board.getBoundingClientRect();
      s.x = Math.max(0, Math.min(1, (e.clientX - rect.left - 48) / (rect.width - 96)));
      s.y = Math.max(0, Math.min(1, (e.clientY - rect.top - 48) / (rect.height - 96)));
      render(); changed();
    });
    return board;
  }
  function add(id) {
    if (busy || draft.stickers.length >= 18) return;
    const item = { id: crypto.randomUUID(), stickerId: id, x: 0.5, y: 0.65, rotation: 0 };
    draft.stickers.push(item); selected = item.id; drawer?.close(); drawer?.remove(); drawer = null; render(); changed(); body.querySelector('.fam-corner-sticker[aria-pressed="true"]')?.focus();
  }
  function collection() {
    const wrapper = el('div');
    const picker = el('select'); picker.setAttribute('aria-label', 'Sticker category');
    for (const name of ['All', 'Moods', 'Activities', 'Little things']) {
      const option = el('option', name); option.value = name; picker.append(option);
    }
    picker.value = category;
    const box = el('div', '', 'fam-corner-collection');
    function paint() {
      box.replaceChildren();
      const visible = choices.filter(id => category === 'All' || (category === 'Moods' ? moods.has(id) : category === 'Activities' ? activities.has(id) : !moods.has(id) && !activities.has(id)));
      for (const id of visible) {
        const b = button(label(id), () => add(id));
        const img = el('img'); img.src = stickerPath(id); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
        b.prepend(img); b.disabled = draft.stickers.length >= 18; box.append(b);
      }
    }
    picker.addEventListener('change', () => { category = picker.value; paint(); });
    paint(); wrapper.append(picker, box); return wrapper;
  }
  function showDrawer() {
    drawer = el('dialog', '', 'fam-corner-drawer'); drawer.setAttribute('aria-label', 'Sticker collection');
    drawer.append(el('h3', 'Stickers'), collection(), button('Done', () => { drawer.close(); drawer.remove(); drawer = null; }));
    document.body.append(drawer); drawer.showModal();
  }
  function render() {
    body.replaceChildren();
    const field = el('fieldset'); field.disabled = busy;
    const layout = el('div', '', 'fam-corner-layout'); const main = el('div'); main.append(canvas(draft, true));
    const tools = el('div', '', 'fam-corner-tools');
    const addButton = button('Add sticker', showDrawer); addButton.disabled = draft.stickers.length >= 18; tools.append(addButton);
    const s = draft.stickers.find(s => s.id === selected);
    if (s) {
      const controls = el('div', '', 'fam-corner-controls'); controls.setAttribute('aria-label', `Placement for ${label(s.stickerId)}`);
      const move = (dx, dy) => { s.x = Math.max(0, Math.min(1, s.x + dx)); s.y = Math.max(0, Math.min(1, s.y + dy)); updateBoard(); changed(); };
      function updateBoard() { main.firstChild.replaceWith(canvas(draft, true)); }
      controls.append(el('p', `Selected: ${label(s.stickerId)}`));
      for (const [name, dx, dy] of [['Left', -.05, 0], ['Right', .05, 0], ['Up', 0, -.05], ['Down', 0, .05]]) controls.append(button(name, () => move(dx, dy)));
      controls.append(button('Rotate 15°', () => { s.rotation = s.rotation >= 180 ? -165 : s.rotation + 15; updateBoard(); changed(); }), button('Remove sticker', () => { draft.stickers = draft.stickers.filter(item => item.id !== s.id); selected = null; render(); changed(); }));
      tools.append(controls);
    }
    main.append(tools);
    const noteLabel = el('label', 'Sticky note (240 characters maximum)'); const input = el('textarea'); input.maxLength = 240; input.rows = 3; input.value = draft.note;
    input.addEventListener('input', () => { draft.note = input.value; main.querySelector('.fam-corner-note').textContent = input.value || 'A small space for your ideas.'; changed(); }); noteLabel.append(input); main.append(noteLabel);
    const aside = el('aside', '', 'fam-corner-desktop-drawer'); aside.append(el('h3', 'Stickers'), collection()); layout.append(main, aside); field.append(layout); body.append(field);
    if (latest) {
      const conflict = el('section', '', 'fam-corner-conflict'); conflict.append(el('h3', 'Latest saved corner'), el('p', 'Your unsaved draft remains above. Compare both before choosing.'), canvas(latest, false));
      conflict.append(button('Use latest (discard my draft)', () => { draft = latest; latest = null; dirty = false; render(); say('Latest saved corner loaded.'); }), button('Keep my draft for next save', () => { draft.revision = latest.revision; latest = null; render(); say('Your draft is ready. Save changes will replace the latest version you reviewed.'); })); body.append(conflict);
    }
    saveButton.disabled = busy || !!latest;
  }
  async function save() {
    if (busy || !draft || latest) return;
    busy = true; render(); say('Saving…'); const token = generation;
    try { const data = await request('PUT', draft); if (token !== generation) return; draft = data; dirty = false; say('Saved.'); }
    catch (error) {
      if (token !== generation) return;
      say(error.message + ' Your draft is preserved.');
      if (error.status === 409) {
        try { const data = await request('GET'); if (token !== generation) return; latest = data; }
        catch { if (token === generation) say('Could not load the other version. Your draft is preserved; retry Save changes.'); }
      }
    } finally { if (token === generation) { busy = false; render(); } }
  }
  window.addEventListener('pagehide', clear);
  // ponytail: hidden tabs discard drafts for privacy; encrypted recoverable drafts
  // need a separate design before preserving unsaved work across account changes.
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
  window.famMyCorner = { setUser, clear: () => { clear(); owner = ownerFamily = ownerRole = null; } };
})();
