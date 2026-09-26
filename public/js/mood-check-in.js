/* Optional energy check-in. Unsent content exists only in this view's memory. */
(function (root) {
  'use strict';
  function createMoodCheckIn({ identity, verifyIdentity, send, changed = () => {}, newId = () => crypto.randomUUID() }) {
    let owner = identity(), generation = 0;
    let state = { energy: '', draft: '', preview: false, busy: false, attempted: false, messageId: '', status: '' };
    function clear() {
      generation++;
      owner = identity();
      state = { energy: '', draft: '', preview: false, busy: false, attempted: false, messageId: '', status: '' };
      changed(state);
    }
    function valid() {
      if (!owner || owner !== identity()) { clear(); return false; }
      return true;
    }
    return {
      get state() { return state; }, clear, reconcile: valid,
      select(energy) {
        if (!valid() || state.busy || state.attempted || !['Low', 'Okay', 'Full'].includes(energy)) return;
        state.energy = energy; state.draft = ''; state.preview = false; state.status = ''; changed(state);
      },
      preview(help = false) {
        if (!valid() || state.busy || state.attempted || !state.energy) return;
        state.draft = `My energy is ${state.energy.toLowerCase()} today.${help ? ' Could someone help me with my next step?' : ''}`;
        state.preview = true; state.messageId = newId(); changed(state);
      },
      edit(text) {
        if (!valid() || state.busy || state.attempted) return;
        state.draft = text.slice(0, 2000); changed(state);
      },
      async confirm() {
        if (!valid() || !state.preview || !state.draft.trim() || state.busy) return false;
        const token = generation;
        state.busy = true; state.status = ''; changed(state);
        try {
          const verified = await verifyIdentity();
          if (token !== generation) return false;
          if (!valid() || verified !== owner) { clear(); return false; }
          state.attempted = true;
          const result = await send(state.draft.trim(), state.messageId);
          if (token !== generation || !valid()) return false;
          if (!result?.message?.id) throw new Error('Unconfirmed');
          clear(); state.status = 'Sent to family chat.'; changed(state); return true;
        } catch (_) {
          if (token !== generation || !valid()) return false;
          state.status = 'Send not confirmed. Retry sends the same message once. You can also check family chat.';
          return false;
        } finally {
          if (token === generation) { state.busy = false; changed(state); }
        }
      },
    };
  }
  if (typeof module !== 'undefined') module.exports = { createMoodCheckIn };
  if (!root.document) return;
  let model;
  root.famMoodCheckIn = {
    clear() { model?.clear(); },
    mount(identity) {
      const host = document.getElementById('mood-check-in');
      if (!host) return;
      host.hidden = !identity();
      if (model) { model.reconcile(); return; }
      host.innerHTML = `<h2>How’s your energy?</h2><p>Optional. Your choice isn’t saved. Only Send to family shares a message.</p>
        <div class="mood-options" role="group" aria-label="Energy"><button type="button" data-energy="Low">Low</button><button type="button" data-energy="Okay">Okay</button><button type="button" data-energy="Full">Full</button></div>
        <div class="mood-actions"><button type="button" data-action="share">Preview sharing</button><button type="button" data-action="help">Ask for help…</button><button type="button" data-action="cancel">Cancel</button></div>
        <div data-preview hidden><p id="mood-visibility">Family chat members can see the message you send. It stays in chat.</p><label for="mood-draft">Message preview — edit before sending</label><textarea id="mood-draft" rows="3" maxlength="2000" autocomplete="off" aria-describedby="mood-visibility"></textarea><button type="button" data-action="send">Send to family</button></div><p role="status" aria-live="polite" data-status></p>`;
      const draft = host.querySelector('textarea');
      model = createMoodCheckIn({ identity,
        verifyIdentity: async () => { const me = await root.auth.getMe(); return ['kid', 'parent'].includes(me?.user?.role) && identity().split(':')[0] === me.user.id && identity().split(':')[2] === me.user.role ? identity() : ''; },
        send: (text, id) => { const [userId, familyId, role] = identity().split(':'); return root.auth.sendChatMessage(text, undefined, id, { userId, familyId, role }); },
        changed(state) {
          host.querySelector('[data-preview]').hidden = !state.preview;
          if (draft.value !== state.draft) draft.value = state.draft;
          draft.disabled = state.busy || state.attempted;
          host.querySelector('[data-status]').textContent = state.status;
          host.querySelectorAll('[data-energy]').forEach(button => {
            button.setAttribute('aria-pressed', String(button.dataset.energy === state.energy));
            button.disabled = state.busy || state.attempted;
          });
          for (const action of ['share', 'help']) host.querySelector(`[data-action="${action}"]`).disabled = !state.energy || state.busy || state.attempted;
          host.querySelector('[data-action="cancel"]').disabled = state.busy;
          host.querySelector('[data-action="send"]').disabled = state.busy || !state.draft.trim();
          host.querySelector('[data-action="send"]').textContent = state.busy ? 'Sending…' : state.attempted ? 'Retry send to family' : 'Send to family';
        }
      });
      host.addEventListener('click', event => {
        const button = event.target.closest('button');
        if (!button) return;
        if (button.dataset.energy) model.select(button.dataset.energy);
        switch (button.dataset.action) {
          case 'share': model.preview(); draft.focus(); break;
          case 'help': model.preview(true); draft.focus(); break;
          case 'cancel': model.clear(); host.querySelector('[data-energy]').focus(); break;
          case 'send': void model.confirm(); break;
        }
      });
      draft.addEventListener('input', () => model.edit(draft.value));
      model.clear();
      // Discard unsent content on page departure / restored history and cross-tab use.
      root.addEventListener('pagehide', () => model.clear());
      root.addEventListener('pageshow', () => model.clear());
      root.addEventListener('blur', () => { if (!model.state.busy) model.clear(); });
    }
  };
})(typeof window === 'undefined' ? globalThis : window);
