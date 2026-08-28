/* Hermes Trip research cards — layered onto the existing Trip chat renderer. */
(function () {
  'use strict';

  const CARD_TYPE = 'hermes-travel-results';
  const CARD_ID = 'hermes-travel-results-v1';
  const savedKeys = new Set();

  function researchCard(message) {
    const card = message && message.card;
    return card && card.type === CARD_TYPE && card.id === CARD_ID && card.schemaVersion === 1 && Array.isArray(card.results)
      ? card : null;
  }

  function kindLabel(kind) {
    return kind === 'flight' ? 'Flight' : kind === 'hotel' ? 'Hotel' : 'Activity';
  }

  function kindIcon(kind) {
    return kind === 'flight' ? '✈️' : kind === 'hotel' ? '🏨' : '✨';
  }

  function ensureResearchStyles() {
    if (document.getElementById('hermes-trip-research-style')) return;
    const style = document.createElement('style');
    style.id = 'hermes-trip-research-style';
    style.textContent = `
      .trip-hermes-research{margin-top:10px;border:1px solid var(--border);border-radius:14px;overflow:hidden;background:var(--surface)}
      .trip-hermes-research-head{padding:12px 13px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
      .trip-hermes-research-title{font-weight:700;font-size:13px}.trip-hermes-research-time{font-size:11px;color:var(--text-2);white-space:nowrap}
      .trip-hermes-options{display:grid;gap:0}.trip-hermes-option{padding:13px;border-bottom:1px solid var(--border)}.trip-hermes-option:last-child{border-bottom:0}
      .trip-hermes-option-top{display:flex;gap:10px;align-items:flex-start}.trip-hermes-option-icon{font-size:18px;line-height:1.2}.trip-hermes-option-main{min-width:0;flex:1}
      .trip-hermes-kind{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-2);font-weight:700}.trip-hermes-option-title{font-weight:700;margin-top:2px}.trip-hermes-option-sub{font-size:12px;color:var(--text-2);margin-top:2px}
      .trip-hermes-option-price{font-size:12px;font-weight:700;white-space:nowrap}.trip-hermes-details{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}.trip-hermes-detail{font-size:11px;padding:4px 7px;border-radius:999px;background:var(--bg);border:1px solid var(--border)}
      .trip-hermes-source{font-size:11px;color:var(--text-2);margin-top:7px}.trip-hermes-actions{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}.trip-hermes-actions a,.trip-hermes-actions button{min-height:40px;display:inline-flex;align-items:center;justify-content:center;text-decoration:none}
      .trip-hermes-research-note{padding:8px 13px;border-top:1px solid var(--border);font-size:11px;color:var(--text-2);background:var(--bg)}
      @media(max-width:640px){.trip-hermes-option-top{flex-wrap:wrap}.trip-hermes-option-price{width:100%;padding-left:28px}.trip-hermes-actions>*{flex:1}}
    `;
    document.head.appendChild(style);
  }

  function inlineArg(value) {
    return encodeURIComponent(String(value == null ? '' : value)).replace(/[!'()*]/g, (char) => '%' + char.charCodeAt(0).toString(16).toUpperCase());
  }

  function renderHermesTravelResearchAction(message) {
    const card = researchCard(message);
    if (!card) return '';
    ensureResearchStyles();
    const canSave = !!(currentTrip && (currentTrip.myRole === 'owner' || currentTrip.myRole === 'editor'));
    const messageId = inlineArg(message.id);
    const searched = card.searchedAt ? timeAgo(card.searchedAt) + ' ago' : 'just now';
    const rows = card.results.map((result, index) => {
      const details = (result.details || []).map((detail) => `<span class="trip-hermes-detail">${esc(detail)}</span>`).join('');
      const saveKey = String(message.id) + ':' + index;
      const saved = savedKeys.has(saveKey);
      return `<article class="trip-hermes-option">
        <div class="trip-hermes-option-top">
          <span class="trip-hermes-option-icon" aria-hidden="true">${kindIcon(result.kind)}</span>
          <div class="trip-hermes-option-main">
            <div class="trip-hermes-kind">${esc(kindLabel(result.kind))}</div>
            <div class="trip-hermes-option-title">${esc(result.title)}</div>
            ${result.subtitle ? `<div class="trip-hermes-option-sub">${esc(result.subtitle)}</div>` : ''}
          </div>
          ${result.price ? `<div class="trip-hermes-option-price">${esc(result.price)}</div>` : ''}
        </div>
        ${details ? `<div class="trip-hermes-details">${details}</div>` : ''}
        <div class="trip-hermes-source">${result.rating ? `${esc(result.rating)} · ` : ''}Source: ${esc(result.sourceName)}</div>
        <div class="trip-hermes-actions">
          <a class="btn-secondary" href="${esc(result.url)}" target="_blank" rel="noopener noreferrer">Open option ↗</a>
          ${canSave ? `<button type="button" class="btn-primary" ${saved ? 'disabled' : ''} onclick="tripSaveHermesResearchIdea(decodeURIComponent('${messageId}'),${index},this)">${saved ? 'Saved to trip' : 'Save as trip idea'}</button>` : ''}
        </div>
      </article>`;
    }).join('');
    return `<section class="trip-hermes-research" aria-label="Hermes travel research">
      <div class="trip-hermes-research-head"><div><div class="trip-hermes-research-title">${esc(card.title || 'Trip options')}</div>${card.query ? `<div class="trip-hermes-option-sub">${esc(card.query)}</div>` : ''}</div><div class="trip-hermes-research-time">researched ${esc(searched)}</div></div>
      <div class="trip-hermes-options">${rows}</div>
      <div class="trip-hermes-research-note">Research only · prices and availability can change. Opening an option does not book it.</div>
    </section>`;
  }

  window.tripSaveHermesResearchIdea = async function (messageId, resultIndex, button) {
    const message = tripChatMessages.find((item) => item && String(item.id) === String(messageId));
    const card = researchCard(message);
    const result = card && card.results[Number(resultIndex)];
    if (!result || !currentTripId || !window.auth || typeof window.auth.addTripItineraryItem !== 'function') return;
    const suggestion = result.itinerary || {};
    const defaultCategory = result.kind === 'flight' ? 'transit' : result.kind === 'hotel' ? 'stay' : 'activity';
    const noteParts = [suggestion.note, result.subtitle, result.price, `Source: ${result.sourceName}`, result.url].filter(Boolean);
    const payload = {
      date: suggestion.date || null,
      time: suggestion.time || '',
      title: suggestion.title || result.title,
      category: suggestion.category || defaultCategory,
      note: noteParts.join(' · ').slice(0, 1000),
    };
    if (button) { button.disabled = true; button.textContent = 'Saving…'; }
    try {
      const response = await window.auth.addTripItineraryItem(currentTripId, payload);
      if (response && response.item) {
        currentTrip.itinerary = currentTrip.itinerary || [];
        if (!currentTrip.itinerary.some((item) => item.id === response.item.id)) currentTrip.itinerary.push(response.item);
      }
      savedKeys.add(String(messageId) + ':' + Number(resultIndex));
      if (button) button.textContent = 'Saved to trip';
      toast('Saved as a trip idea.');
    } catch (error) {
      if (button) { button.disabled = false; button.textContent = 'Save as trip idea'; }
      toast('❌ ' + ((error && error.message) || 'Could not save this option.'));
    }
  };

  // Replace the renderer, preserving all existing update/itinerary behavior and
  // adding one typed research card inside Hermes chat bubbles.
  renderTripChatMessages = function () {
    const el = document.getElementById('trip-chat-messages');
    if (!el) return;
    const wasAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    el.innerHTML = tripChatMessages.map((m) => {
      if (m.deleted) return `<div class="chat-msg chat-msg-deleted"><span class="chat-msg-deleted-text">Message deleted</span></div>`;
      const own = m.senderId === currentUserId;
      const face = tripChatAvatarFor(m.senderId);
      const senderName = m.senderName || face.name;
      const time = m.createdAt ? new Date(m.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
      const canDelete = own || isOwnerRole();
      const controls = `<div class="chat-msg-controls">${canDelete ? `<button type="button" class="chat-msg-ctrl" onclick="tripDeleteChatMsg('${esc(m.id)}')" title="Delete">🗑️</button>` : ''}<button type="button" class="chat-msg-ctrl" onclick="tripFlagChatMsg('${esc(m.id)}')" title="Report / flag message">🚩</button></div>`;
      const updateCard = renderTripChatUpdate(m, senderName, time, controls);
      if (updateCard) return updateCard;
      return `<div class="chat-msg ${own ? 'chat-msg-own' : 'chat-msg-other'}">
        ${!own ? `<div class="chat-msg-avatar-row">${avatarHtml(face.initial, face.color, 16, false)}<span class="chat-msg-sender">${esc(senderName)}</span></div>` : ''}
        <div class="chat-msg-bubble">${m.text ? `<div class="chat-msg-text">${linkifyChatText(m.text)}</div>` : ''}${renderTripItineraryReviewAction(m)}${renderHermesTravelResearchAction(m)}</div>
        <div class="chat-msg-meta"><span class="chat-msg-time">${time}</span>${controls}</div>
      </div>`;
    }).join('') || '<p class="text-muted chat-empty">No messages yet. Say hi! 👋</p>';
    if (wasAtBottom) el.scrollTop = el.scrollHeight;
  };
})();
