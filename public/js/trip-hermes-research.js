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
      .trip-hermes-kind{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-2);font-weight:700}.trip-hermes-option-title{font-size:14px;font-weight:700;margin:2px 0 0}.trip-hermes-option-sub{font-size:12px;color:var(--text-2);margin-top:2px}
      .trip-hermes-option-price{font-size:12px;font-weight:700;white-space:nowrap}.trip-hermes-details{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}.trip-hermes-detail{font-size:11px;padding:4px 7px;border-radius:999px;background:var(--bg);border:1px solid var(--border)}
      .trip-hermes-source{font-size:11px;color:var(--text-2);margin-top:7px}.trip-hermes-actions{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}.trip-hermes-actions a,.trip-hermes-actions button{min-height:44px;display:inline-flex;align-items:center;justify-content:center;text-decoration:none}
      .trip-hermes-research-note{padding:8px 13px;border-top:1px solid var(--border);font-size:11px;color:var(--text-2);background:var(--bg)}
      @media(max-width:640px){.trip-hermes-option-top{flex-wrap:wrap}.trip-hermes-option-price{width:100%;padding-left:28px}.trip-hermes-actions>*{flex:1}}
    `;
    document.head.appendChild(style);
  }

  function inlineArg(value) {
    return encodeURIComponent(String(value == null ? '' : value)).replace(/[!'()*]/g, (char) => '%' + char.charCodeAt(0).toString(16).toUpperCase());
  }

  function domId(value) {
    return String(value == null ? '' : value).replace(/[^A-Za-z0-9_-]/g, '-');
  }

  function resultHost(result) {
    if (result && result.sourceHost) return String(result.sourceHost);
    try { return new URL(String(result && result.url || '')).hostname; } catch (_) { return ''; }
  }

  function ideaPayload(result) {
    const suggestion = result.itinerary || {};
    const defaultCategory = result.kind === 'flight' ? 'transit' : result.kind === 'hotel' ? 'stay' : 'activity';
    const noteParts = [suggestion.note, result.subtitle, result.price, `Source: ${result.sourceName}`, result.url].filter(Boolean);
    return {
      date: suggestion.date || null,
      time: suggestion.time || '',
      title: suggestion.title || result.title,
      category: suggestion.category || defaultCategory,
      note: noteParts.join(' · ').slice(0, 1000),
    };
  }

  function alreadySaved(result) {
    const payload = ideaPayload(result);
    return !!(currentTrip && Array.isArray(currentTrip.itinerary) && currentTrip.itinerary.some((item) => (
      String(item.title || '').trim() === String(payload.title || '').trim() &&
      String(item.note || '').includes(String(result.url || ''))
    )));
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
      const saved = savedKeys.has(saveKey) || alreadySaved(result);
      const titleId = `trip-hermes-option-${domId(message.id)}-${index}`;
      const host = resultHost(result);
      return `<article class="trip-hermes-option" aria-labelledby="${titleId}">
        <div class="trip-hermes-option-top">
          <span class="trip-hermes-option-icon" aria-hidden="true">${kindIcon(result.kind)}</span>
          <div class="trip-hermes-option-main">
            <div class="trip-hermes-kind">${esc(kindLabel(result.kind))}</div>
            <h3 class="trip-hermes-option-title" id="${titleId}">${esc(result.title)}</h3>
            ${result.subtitle ? `<div class="trip-hermes-option-sub">${esc(result.subtitle)}</div>` : ''}
          </div>
          ${result.price ? `<div class="trip-hermes-option-price">${esc(result.price)}</div>` : ''}
        </div>
        ${details ? `<div class="trip-hermes-details">${details}</div>` : ''}
        <div class="trip-hermes-source">${result.rating ? `${esc(result.rating)} · ` : ''}Source: ${esc(result.sourceName)}${host ? ` · ${esc(host)}` : ''}</div>
        <div class="trip-hermes-actions">
          <a class="btn-secondary" href="${esc(result.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(result.title)} on ${esc(host || result.sourceName)} in a new tab">Open option ↗</a>
          ${canSave ? `<button type="button" class="btn-primary" ${saved ? 'disabled' : ''} onclick="tripSaveHermesResearchIdea(decodeURIComponent('${messageId}'),${index},this)" aria-label="Save ${esc(result.title)} as a trip idea">${saved ? 'Saved to trip' : 'Save as trip idea'}</button>` : ''}
        </div>
      </article>`;
    }).join('');
    return `<section class="trip-hermes-research" aria-label="Hermes travel research">
      <div class="trip-hermes-research-head"><div><div class="trip-hermes-research-title">${esc(card.title || 'Trip options')}</div>${card.query ? `<div class="trip-hermes-option-sub">${esc(card.query)}</div>` : ''}</div><time class="trip-hermes-research-time" datetime="${esc(card.searchedAt || '')}">researched ${esc(searched)}</time></div>
      <div class="trip-hermes-options">${rows}</div>
      <div class="trip-hermes-research-note">Research only · prices and availability can change. Opening an option does not book it.</div>
    </section>`;
  }

  window.tripSaveHermesResearchIdea = async function (messageId, resultIndex, button) {
    const message = tripChatMessages.find((item) => item && String(item.id) === String(messageId));
    const card = researchCard(message);
    const result = card && card.results[Number(resultIndex)];
    if (!result || !currentTripId || !window.auth || typeof window.auth.addTripItineraryItem !== 'function') return;
    if (alreadySaved(result)) {
      savedKeys.add(String(messageId) + ':' + Number(resultIndex));
      if (button) { button.disabled = true; button.textContent = 'Saved to trip'; }
      toast('This option is already in the trip.');
      return;
    }
    const payload = ideaPayload(result);
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

  window.renderTripHermesTravelResearchAction = renderHermesTravelResearchAction;
})();
