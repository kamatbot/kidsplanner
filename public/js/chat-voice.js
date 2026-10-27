/* Voice messages for family chat (contract: docs/VOICE-MESSAGES.md).
   Recording: MediaRecorder AAC-in-MP4 where the browser can make it, otherwise
   Web Audio PCM encoded here as a 16 kHz mono 16-bit WAV. WebM/Ogg are never
   uploaded because the watch and iPhone cannot play them.
   Playback: one shared <audio> element, so only one voice plays at a time and
   a chat re-render never interrupts it. */
(function (root) {
  'use strict';
  const MAX_MS = 60000;
  const MIN_MS = 500;
  const WAV_RATE = 16000;
  const PLAYED_KEY = 'fam_voice_played';
  const PLAYED_CAP = 500;
  const VALID_ID = /^a_[0-9a-f]{36}$/;
  const MIC_COPY = 'Fam ETC uses the microphone to record voice messages for your family chat.';

  /* ---------- Pure helpers (unit-tested in tests/web-voice-*.test.js) ---------- */

  function clock(ms) {
    const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  function spoken(ms) {
    const total = Math.max(1, Math.round((Number(ms) || 0) / 1000));
    const minutes = Math.floor(total / 60), seconds = total % 60;
    const parts = [];
    if (minutes) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
    if (seconds || !minutes) parts.push(`${seconds} second${seconds === 1 ? '' : 's'}`);
    return parts.join(' ');
  }

  // Resample mono float PCM. Downsampling averages each output sample's exact
  // (fractional) input window — a box low-pass that removes most content above
  // the new Nyquist instead of aliasing it the way plain decimation would.
  function resample(input, fromRate, toRate) {
    if (!input || !input.length || !(fromRate > 0) || !(toRate > 0)) return new Float32Array(0);
    if (fromRate === toRate) return Float32Array.from(input);
    const ratio = fromRate / toRate;
    const outLength = Math.floor(input.length / ratio);
    const out = new Float32Array(outLength);
    if (ratio < 1) {
      for (let i = 0; i < outLength; i++) {
        const pos = i * ratio, j = Math.floor(pos), f = pos - j;
        const a = input[j], b = j + 1 < input.length ? input[j + 1] : a;
        out[i] = a + (b - a) * f;
      }
      return out;
    }
    for (let i = 0; i < outLength; i++) {
      const start = i * ratio, end = start + ratio;
      let sum = 0;
      for (let j = Math.floor(start); j < end && j < input.length; j++) {
        const weight = Math.min(end, j + 1) - Math.max(start, j);
        if (weight > 0) sum += input[j] * weight;
      }
      out[i] = sum / ratio;
    }
    return out;
  }

  function encodeWav(samples, sampleRate) {
    const bytes = samples.length * 2;
    const buffer = new ArrayBuffer(44 + bytes);
    const view = new DataView(buffer);
    const text = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
    text(0, 'RIFF'); view.setUint32(4, 36 + bytes, true); text(8, 'WAVE');
    text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); // mono
    view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, 'data'); view.setUint32(40, bytes, true);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i] || 0));
      view.setInt16(44 + i * 2, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
    }
    return buffer;
  }

  // Only AAC-in-MP4 is acceptable from MediaRecorder. A bare "audio/mp4" is
  // trusted only where the browser does not also offer Opus-in-MP4 (Safari),
  // because Chrome's default MP4 audio codec may be Opus.
  function pickMp4Type(MR) {
    if (!MR || typeof MR.isTypeSupported !== 'function') return '';
    const ok = type => { try { return MR.isTypeSupported(type); } catch (_) { return false; } };
    for (const type of ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4; codecs="mp4a.40.2"', 'audio/mp4;codecs=mp4a', 'audio/x-m4a;codecs=mp4a.40.2']) {
      if (ok(type)) return type;
    }
    if (ok('audio/mp4') && !ok('audio/mp4;codecs=opus')) return 'audio/mp4';
    return '';
  }

  function isMp4(bytes) {
    return bytes.length >= 8 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70; // ftyp
  }

  function clampDuration(ms) { return Math.max(MIN_MS, Math.min(MAX_MS, Math.round(ms))); }

  /* ---------- Played state (client-local only) ---------- */

  function playedIds() {
    try { const list = JSON.parse(root.localStorage.getItem(PLAYED_KEY)); return Array.isArray(list) ? list : []; }
    catch (_) { return []; }
  }
  function isPlayed(id) { return playedIds().includes(id); }
  function markPlayed(id) {
    try {
      const list = playedIds().filter(x => x !== id);
      list.push(id);
      root.localStorage.setItem(PLAYED_KEY, JSON.stringify(list.slice(-PLAYED_CAP)));
    } catch (_) { /* private mode: the dot simply clears for this page view */ }
  }

  /* ---------- Playback ---------- */

  let audio = null;
  let currentId = null;
  let failedId = null;
  const sessionPlayed = new Set();

  function bubbles(id) {
    if (!VALID_ID.test(id || '') || typeof document === 'undefined') return [];
    return Array.from(document.querySelectorAll(`.chat-voice[data-voice-id="${id}"]`));
  }

  function player() {
    if (audio) return audio;
    audio = new Audio();
    audio.preload = 'none';
    const sync = () => { if (currentId) refreshId(currentId); };
    ['play', 'playing', 'pause', 'timeupdate', 'loadedmetadata', 'waiting'].forEach(name => audio.addEventListener(name, sync));
    audio.addEventListener('ended', () => {
      const id = currentId;
      audio.currentTime = 0;
      currentId = null;
      if (id) refreshId(id);
    });
    audio.addEventListener('error', () => {
      if (!currentId || !audio.getAttribute('src')) return;
      failedId = currentId;
      const id = currentId;
      currentId = null;
      refreshId(id);
    });
    return audio;
  }

  function durationOf(bubble) {
    const listed = Number(bubble.dataset.voiceDuration) || 0;
    if (listed > 0) return listed;
    return audio && Number.isFinite(audio.duration) ? audio.duration * 1000 : 0;
  }

  function refresh(bubble) {
    const id = bubble.dataset.voiceId;
    const active = currentId === id && audio;
    const playing = !!(active && !audio.paused);
    const totalMs = durationOf(bubble);
    const elapsedMs = active ? audio.currentTime * 1000 : 0;
    const failed = failedId === id;
    bubble.classList.toggle('is-playing', playing);
    bubble.classList.toggle('is-active', !!active);
    bubble.classList.toggle('is-error', failed);
    const unplayed = bubble.dataset.voiceOwn !== '1' && !sessionPlayed.has(id) && !isPlayed(id);
    const dot = bubble.querySelector('.chat-voice-dot');
    if (dot) dot.hidden = !unplayed;
    bubble.classList.toggle('is-unplayed', unplayed);
    const elapsed = bubble.querySelector('.chat-voice-elapsed');
    const elapsedText = active && (playing || elapsedMs > 0) ? `${clock(elapsedMs)} / ` : '';
    if (elapsed && elapsed.textContent !== elapsedText) elapsed.textContent = elapsedText;
    const total = bubble.querySelector('.chat-voice-total');
    const totalText = failed ? 'Couldn’t play' : clock(totalMs);
    if (total && total.textContent !== totalText) total.textContent = totalText;
    const fraction = active && totalMs > 0 ? Math.min(1, elapsedMs / totalMs) : 0;
    const bars = bubble.querySelectorAll('.chat-voice-wave i');
    bars.forEach((bar, index) => bar.classList.toggle('on', (index + 0.5) / bars.length <= fraction));
    const button = bubble.querySelector('[data-voice-play]');
    if (button) {
      const from = bubble.dataset.voiceOwn === '1' ? 'your voice message' : `voice message${bubble.dataset.voiceFrom ? ` from ${bubble.dataset.voiceFrom}` : ''}`;
      let label = `${playing ? 'Pause' : 'Play'} ${from}, ${spoken(totalMs)}`;
      if (unplayed) label += ', not played yet';
      if (failed) label += ', could not play. Try again';
      if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
    }
  }

  function refreshId(id) { bubbles(id).forEach(refresh); }

  function hydrate(bubble) {
    const id = bubble.dataset.voiceId;
    if (!VALID_ID.test(id || '') || bubble.dataset.voiceSrc !== `/api/chat/attachments/${id}`) return;
    const row = bubble.closest('.chat-msg');
    const own = !!(row && row.classList.contains('chat-msg-own'));
    bubble.dataset.voiceOwn = own ? '1' : '0';
    if (!own && row) {
      const sender = row.querySelector('.chat-msg-sender');
      const name = sender ? (sender.firstChild && sender.firstChild.nodeType === 3 ? sender.firstChild.textContent : sender.textContent) : '';
      if (name && name.trim()) bubble.dataset.voiceFrom = name.trim().slice(0, 60);
    }
    bubble.dataset.voiceReady = '1';
    refresh(bubble);
  }

  function hydrateAll(scope) {
    if (typeof document === 'undefined') return;
    (scope || document).querySelectorAll('.chat-voice:not([data-voice-ready])').forEach(hydrate);
  }

  function toggle(bubble) {
    const id = bubble.dataset.voiceId, src = bubble.dataset.voiceSrc;
    if (!VALID_ID.test(id || '') || src !== `/api/chat/attachments/${id}`) return;
    const a = player();
    if (currentId === id && !a.paused) { a.pause(); return; }
    if (currentId !== id) {
      const previous = currentId;
      a.pause();
      currentId = id;
      if (failedId === id) failedId = null;
      a.src = src; // same-origin: the session cookie authenticates the request
      if (previous) refreshId(previous);
    }
    sessionPlayed.add(id);
    if (bubble.dataset.voiceOwn !== '1') markPlayed(id);
    const attempt = a.play();
    if (attempt && typeof attempt.catch === 'function') {
      attempt.catch(err => {
        if (err && err.name === 'AbortError') return;
        if (currentId === id) { failedId = id; currentId = null; a.pause(); }
        refreshId(id);
      });
    }
    refreshId(id);
  }

  function seek(bubble, deltaSeconds) {
    if (!audio || currentId !== bubble.dataset.voiceId) return false;
    const limit = Number.isFinite(audio.duration) ? audio.duration : durationOf(bubble) / 1000;
    audio.currentTime = Math.max(0, Math.min(limit || 0, audio.currentTime + deltaSeconds));
    refresh(bubble);
    return true;
  }

  function stopPlayback() {
    if (!audio) return;
    const id = currentId;
    audio.pause();
    currentId = null;
    if (id) refreshId(id);
  }

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('click', event => {
      const button = event.target.closest && event.target.closest('[data-voice-play]');
      const bubble = button && button.closest('.chat-voice');
      if (!bubble) return;
      event.preventDefault();
      if (!bubble.dataset.voiceReady) hydrate(bubble);
      toggle(bubble);
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const button = event.target.closest && event.target.closest('[data-voice-play]');
      const bubble = button && button.closest('.chat-voice');
      if (bubble && seek(bubble, event.key === 'ArrowLeft' ? -5 : 5)) event.preventDefault();
    });
    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      (root.requestAnimationFrame || setTimeout)(() => {
        scheduled = false;
        hydrateAll();
        // A re-render may have replaced the playing row: carry its state over.
        if (currentId) refreshId(currentId);
      });
    };
    if (typeof MutationObserver === 'function') {
      const start = () => new MutationObserver(schedule).observe(document.body, {childList: true, subtree: true});
      if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
    }
  }

  /* ---------- Recording ---------- */

  let forceWav = false; // set if a browser claimed AAC but produced something else

  function micError(err) {
    const name = err && err.name;
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
      return 'Microphone access is off. Allow the microphone for Fam ETC in your browser’s site settings, then tap the mic again.';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'No microphone was found on this device.';
    if (name === 'NotReadableError' || name === 'TrackStartError') return 'Another app is using the microphone. Close it and try again.';
    return (err && err.voiceMessage) || 'Couldn’t start the microphone. Please try again.';
  }

  async function mp4Recorder(stream, mimeType) {
    const recorder = new root.MediaRecorder(stream, {mimeType, audioBitsPerSecond: 48000});
    const chunks = [];
    recorder.ondataavailable = event => { if (event.data && event.data.size) chunks.push(event.data); };
    recorder.start();
    if (/webm|ogg|opus/i.test(recorder.mimeType || '')) {
      try { recorder.stop(); } catch (_) {}
      const err = new Error('unsupported recorder format'); err.code = 'format'; throw err;
    }
    const startedAt = performance.now();
    return {
      elapsed: () => performance.now() - startedAt,
      async stop() {
        const durationMs = performance.now() - startedAt;
        await new Promise(resolve => {
          recorder.onstop = resolve;
          if (recorder.state === 'inactive') resolve(); else recorder.stop();
        });
        const blob = new Blob(chunks, {type: 'audio/mp4'});
        const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
        if (!isMp4(head)) { forceWav = true; const err = new Error('format'); err.voiceMessage = 'This browser made a recording other devices can’t play. Please record it again.'; throw err; }
        return {blob, durationMs, mimeType: 'audio/mp4', filename: 'voice.m4a'};
      },
      cancel() { try { if (recorder.state !== 'inactive') recorder.stop(); } catch (_) {} },
    };
  }

  async function wavRecorder(stream) {
    const Ctx = root.AudioContext || root.webkitAudioContext;
    if (!Ctx) { const err = new Error('no audio'); err.voiceMessage = 'Voice messages need a newer browser.'; throw err; }
    const context = new Ctx();
    if (context.state === 'suspended' && context.resume) await context.resume();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const mute = context.createGain();
    mute.gain.value = 0; // keep the graph pulling audio without echoing it
    const chunks = [];
    let length = 0, active = true;
    const maxSamples = Math.ceil(context.sampleRate * MAX_MS / 1000);
    processor.onaudioprocess = event => {
      if (!active || length >= maxSamples) return;
      const data = event.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(data));
      length += data.length;
    };
    source.connect(processor); processor.connect(mute); mute.connect(context.destination);
    const teardown = () => {
      active = false;
      try { source.disconnect(); processor.disconnect(); mute.disconnect(); } catch (_) {}
      try { context.close(); } catch (_) {}
    };
    return {
      elapsed: () => length / context.sampleRate * 1000,
      async stop() {
        const rate = context.sampleRate;
        teardown();
        const samples = new Float32Array(Math.min(length, maxSamples));
        let offset = 0;
        for (const chunk of chunks) {
          if (offset >= samples.length) break;
          const part = chunk.subarray(0, samples.length - offset);
          samples.set(part, offset); offset += part.length;
        }
        const pcm = resample(samples, rate, WAV_RATE);
        const blob = new Blob([encodeWav(pcm, WAV_RATE)], {type: 'audio/wav'});
        return {blob, durationMs: pcm.length / WAV_RATE * 1000, mimeType: 'audio/wav', filename: 'voice.wav'};
      },
      cancel: teardown,
    };
  }

  async function startRecorder() {
    const devices = root.navigator && root.navigator.mediaDevices;
    if (!devices || typeof devices.getUserMedia !== 'function') {
      const err = new Error('no mic'); err.voiceMessage = 'Voice messages need a secure, up-to-date browser with a microphone.'; throw err;
    }
    const stream = await devices.getUserMedia({audio: {channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true}});
    const release = () => stream.getTracks().forEach(track => track.stop());
    try {
      const type = !forceWav && root.MediaRecorder ? pickMp4Type(root.MediaRecorder) : '';
      let engine = null;
      if (type) {
        try { engine = await mp4Recorder(stream, type); } catch (err) { if (err.code !== 'format') throw err; forceWav = true; }
      }
      if (!engine) engine = await wavRecorder(stream);
      return {
        elapsed: engine.elapsed,
        async stop() { try { return await engine.stop(); } finally { release(); } },
        cancel() { engine.cancel(); release(); },
      };
    } catch (err) { release(); throw err; }
  }

  async function upload({roomId, recording, durationMs, signal}) {
    const data = new FormData();
    data.append('roomId', roomId);
    data.append('durationMs', String(durationMs));
    // A fresh File drops codec parameters from the part's Content-Type.
    data.append('file', new File([recording.blob], recording.filename, {type: recording.mimeType}), recording.filename);
    const response = await fetch('/api/chat/attachments', {method: 'POST', credentials: 'same-origin', body: data, signal});
    let body = null;
    try { body = await response.json(); } catch (_) {}
    if (!response.ok || !body || !body.attachment) throw new Error((body && body.error) || 'Couldn’t upload your voice message. Please try again.');
    return body.attachment;
  }

  /* ---------- Composer recording bar ---------- */

  let session = null;

  function record({button, bar, roomId, isCurrent, send}) {
    if (session) { session.finish(); return session; }
    if (!button || !bar) return null;
    const el = selector => bar.querySelector(selector);
    const status = el('.chat-voice-rec-status'), time = el('.chat-voice-rec-time');
    const sendBtn = el('.chat-voice-send'), cancelBtn = el('.chat-voice-cancel');
    const form = bar.closest('form');
    let phase = 'starting', recorder = null, recording = null, durationMs = 0, media = null;
    let ticker = null, controller = null, done = false;

    function show(text, kind) {
      status.textContent = text;
      bar.dataset.phase = phase;
      bar.classList.toggle('is-error', kind === 'error');
      const live = phase === 'recording';
      sendBtn.hidden = !(live || phase === 'retry');
      sendBtn.disabled = !(live || phase === 'retry');
      sendBtn.setAttribute('aria-label', phase === 'retry' ? 'Retry sending voice message' : 'Stop and send voice message');
      sendBtn.classList.toggle('is-retry', phase === 'retry');
      cancelBtn.disabled = phase === 'sending';
      cancelBtn.setAttribute('aria-label', phase === 'error' ? 'Dismiss' : 'Cancel voice message');
      time.hidden = !(live || phase === 'uploading' || phase === 'sending' || phase === 'retry');
    }
    function tick() {
      if (!recorder || phase !== 'recording') return;
      const ms = recorder.elapsed();
      time.textContent = clock(Math.min(ms, MAX_MS));
      bar.classList.toggle('is-ending', ms >= MAX_MS - 10000);
      if (ms >= MAX_MS) finish();
    }
    function close(restoreFocus) {
      if (done) return;
      done = true;
      clearInterval(ticker);
      if (controller) controller.abort();
      if (recorder && phase === 'recording') recorder.cancel();
      session = null;
      bar.hidden = true;
      bar.classList.remove('is-error', 'is-ending');
      if (form) form.classList.remove('chat-voice-active');
      button.setAttribute('aria-pressed', 'false');
      root.removeEventListener('pagehide', onHide);
      if (restoreFocus && button.isConnected && !button.hidden) button.focus();
    }
    function fail(text) { phase = 'error'; show(text, 'error'); clearInterval(ticker); cancelBtn.focus(); }
    function onHide() { close(false); }

    async function deliver() {
      if (done) return;
      if (!isCurrent()) { fail('This chat changed before your voice message was sent.'); return; }
      phase = 'uploading'; show('Sending voice message…');
      time.textContent = clock(durationMs);
      try {
        if (!media) {
          controller = new AbortController();
          media = await upload({roomId, recording, durationMs, signal: controller.signal});
          controller = null;
        }
        if (done) return;
        phase = 'sending'; show('Sending voice message…');
        await send(media);
        if (done) return;
        close(true);
      } catch (err) {
        if (done || (err && err.name === 'AbortError')) return;
        phase = 'retry';
        show((err && err.message) || 'Couldn’t send your voice message.', 'error');
        sendBtn.focus();
      }
    }

    async function finish() {
      if (phase === 'retry') { deliver(); return; }
      if (phase !== 'recording') return;
      phase = 'processing'; clearInterval(ticker); show('Getting your voice message ready…');
      try {
        recording = await recorder.stop();
      } catch (err) { if (!done) fail((err && err.voiceMessage) || 'Couldn’t finish the recording. Please try again.'); return; }
      if (done) return;
      if (recording.durationMs < MIN_MS) { fail('That was too short to send. Tap the mic and try again.'); return; }
      durationMs = clampDuration(recording.durationMs);
      deliver();
    }

    sendBtn.onclick = () => finish();
    cancelBtn.onclick = () => close(true);
    bar.onkeydown = event => { if (event.key === 'Escape' && phase !== 'sending') { event.preventDefault(); close(true); } };
    root.addEventListener('pagehide', onHide);

    if (form) form.classList.add('chat-voice-active');
    button.setAttribute('aria-pressed', 'true');
    bar.hidden = false;
    time.textContent = '0:00';
    show(MIC_COPY);
    stopPlayback();
    session = {finish, cancel: () => close(false)};
    startRecorder().then(engine => {
      if (done) { engine.cancel(); return; }
      recorder = engine; phase = 'recording';
      show('Recording… tap send when you’re done.');
      sendBtn.focus();
      ticker = setInterval(tick, 200);
    }, err => { if (!done) fail(micError(err)); });
    return session;
  }

  function cancel() { if (session) session.cancel(); }

  const api = {record, cancel, stopPlayback, hydrateAll, resample, encodeWav, pickMp4Type, isMp4, clock, spoken, micError, MIC_COPY, MAX_MS, WAV_RATE};
  root.FamChatVoice = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
