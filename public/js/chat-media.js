/* Shared Family/Trip attachment composer. Upload only the locally processed File. */
(function (root) {
  'use strict';
  const byId = id => document.getElementById(id);
  const size = value => value < 1024 * 1024 ? `${Math.round(value / 1024)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`;
  const receipt = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  function open({roomId, isCurrent, onSent}) {
    if (byId('chat-media-dialog')) return;
    if (roomId !== 'family' && !/^trip:[a-zA-Z0-9_-]+$/.test(roomId)) throw new Error('Unknown chat room.');
    const previousFocus = document.activeElement;
    const dialog = document.createElement('dialog'); dialog.id = 'chat-media-dialog'; dialog.className = 'chat-media-dialog';
    dialog.setAttribute('aria-labelledby', 'chat-media-title');
    dialog.innerHTML = `<header><div><span class="chat-media-room"></span><h2 id="chat-media-title">Share a moment</h2></div><button type="button" class="chat-media-close" aria-label="Close attachment">×</button></header>
      <div class="chat-media-preview"><span>Photos, little wins, and family moments.</span></div>
      <p class="chat-media-savings"></p><label class="chat-media-caption">Add a message<textarea maxlength="4000" rows="2" placeholder="Say something about this moment…"></textarea></label>
      <progress class="chat-media-progress" max="100" value="0" hidden aria-label="Attachment progress"></progress><p class="chat-media-status" role="status" aria-live="polite">Compressed on this device. Shared only when you press Send.</p>
      <p class="chat-media-error" role="alert" hidden></p><footer><button class="btn-secondary chat-media-choose" type="button">Choose photo or video</button><button class="btn-primary chat-media-send" type="button" disabled>Send</button></footer>
      <input class="chat-media-file" type="file" accept="image/*,video/*" hidden>`;
    const el = selector => dialog.querySelector(selector);
    const picker = el('.chat-media-file'), choose = el('.chat-media-choose'), send = el('.chat-media-send'), close = el('.chat-media-close');
    const status = el('.chat-media-status'), error = el('.chat-media-error'), bar = el('progress'), caption = el('textarea'), preview = el('.chat-media-preview');
    el('.chat-media-room').textContent = roomId === 'family' ? 'FAMILY CHAT' : 'TRIP CHAT';
    let original = null, prepared = null, media = null, command = null, controller = null, xhr = null, url = null;
    let phase = 'idle', generation = 0, closed = false;
    function current() { return !closed && isCurrent(); }
    function message(text) { status.textContent = text; }
    function fail(err) { error.textContent = err.message || 'Something went wrong. Please try again.'; error.hidden = false; }
    function setPhase(value) {
      phase = value; const busy = value === 'preparing' || value === 'uploading' || value === 'sending';
      choose.disabled = busy || !!command; caption.disabled = value === 'sending' || !!command;
      send.disabled = busy || (!prepared && !original); send.textContent = value === 'error' ? 'Retry' : value === 'sending' ? 'Sending…' : 'Send';
      close.disabled = value === 'sending'; bar.hidden = !busy;
    }
    function releasePreview() { if (url) URL.revokeObjectURL(url); url = null; preview.replaceChildren(); }
    function dismiss() {
      if (phase === 'sending') return;
      if (command && !root.confirm('Your message may already have been sent. Close without checking again?')) return;
      closed = true; generation++; if (controller) controller.abort(); if (xhr) xhr.abort();
      releasePreview(); dialog.close(); dialog.remove();
      if (previousFocus && previousFocus.isConnected) previousFocus.focus();
    }
    async function begin(file) {
      if (!file || closed || command) return;
      const token = ++generation; if (controller) controller.abort(); controller = new AbortController();
      original = file; prepared = null; media = null; error.hidden = true; releasePreview();
      el('.chat-media-savings').textContent = ''; setPhase('preparing');
      message(file.type.startsWith('video/') ? 'Compressing video with sound. Keep this tab open…' : 'Making your photo easier to share…');
      bar.value = 0;
      try {
        const result = await root.FamMediaCompression.prepare(file, {signal:controller.signal, progress:p => { if (token === generation) bar.value = Math.round(p * 100); }});
        if (token !== generation || closed) return;
        prepared = result; url = URL.createObjectURL(result);
        const node = document.createElement(result.type.startsWith('video/') ? 'video' : 'img');
        if (node.tagName === 'VIDEO') { node.controls = true; node.playsInline = true; node.preload = 'metadata'; } else node.alt = 'Photo ready to share';
        node.src = url; preview.append(node);
        const saved = Math.round((1 - result.size / file.size) * 100);
        el('.chat-media-savings').textContent = `${size(result.size)} ready to send${saved > 0 ? ` · ${saved}% smaller` : ' · optimized for chat'}`;
        message('Ready to share. Only this compressed version will be uploaded.'); setPhase('ready');
      } catch (err) { if (token !== generation || closed) return; if (err.name !== 'AbortError') fail(err); setPhase('error'); }
    }
    function upload(file) {
      return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest(); xhr = request;
        request.open('POST', '/api/chat/attachments'); request.timeout = 120000; request.withCredentials = true;
        request.upload.onprogress = event => { if (event.lengthComputable) bar.value = Math.round(event.loaded / event.total * 100); };
        request.onload = () => {
          xhr = null; let data; try { data = JSON.parse(request.responseText); } catch (_) {}
          if (request.status < 200 || request.status >= 300 || !data || !data.attachment) return reject(new Error((data && data.error) || 'Upload failed. Please try again.'));
          resolve(data.attachment);
        };
        request.onerror = () => { xhr = null; reject(new Error('Connection lost during upload. Please try again.')); };
        request.ontimeout = () => { xhr = null; reject(new Error('Upload timed out. Please try again.')); };
        request.onabort = () => { xhr = null; reject(new DOMException('Cancelled', 'AbortError')); };
        const data = new FormData(); data.append('roomId', roomId); data.append('file', file, file.name); request.send(data);
      });
    }
    async function submit() {
      if (['preparing', 'uploading', 'sending'].includes(phase) || closed) return;
      if (!current()) { fail(new Error('This chat has changed. Close this preview and open the current chat.')); return; }
      if (!prepared) { await begin(original); return; }
      error.hidden = true; setPhase('uploading'); message('Uploading your compressed attachment…'); bar.value = 0;
      try {
        if (!media) media = await upload(prepared);
        if (!current()) throw new Error('This chat has changed. Close this preview and choose the current chat.');
        // Freeze once before the first POST: a lost response must retry the same receipt and content.
        if (!command) command = {text:caption.value.trim(), media, clientMessageId:receipt()};
        setPhase('sending'); message('Sending to your chat…');
        controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 20000);
        try {
          const endpoint = roomId === 'family' ? '/api/chat/messages' : `/api/trips/${encodeURIComponent(roomId.slice(5))}/chat/messages`;
          const response = await fetch(endpoint, {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify(command), signal:controller.signal});
          const data = await response.json();
          if (!response.ok || !data.message) throw new Error(data.error || 'Could not confirm delivery. Retry checks the same message without duplicating it.');
          if (current()) onSent(data.message);
          command = null; setPhase('sent'); dismiss();
        } finally { clearTimeout(timeout); }
      } catch (err) {
        if (closed) return;
        fail(err.name === 'AbortError' ? new Error('Could not confirm delivery. Retry safely checks the same message.') : err);
        message(media ? 'Your upload is saved. Retry will not upload it again.' : 'Nothing was sent to chat.'); setPhase('error');
      }
    }
    choose.onclick = () => picker.click(); picker.onchange = () => { const file = picker.files[0]; picker.value = ''; begin(file); };
    send.onclick = submit; close.onclick = dismiss;
    dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
    document.body.append(dialog); dialog.showModal(); picker.click();
    return {dialog, close:dismiss};
  }
  root.FamChatMedia = {open};
})(window);
