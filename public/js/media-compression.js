/* Local-only media processing. No remote service, microphone permission, or original-file fallback. */
(function (root) {
  'use strict';
  const MAX_INPUT = 100 * 1024 * 1024, MAX_OUTPUT = 20 * 1024 * 1024, MAX_SECONDS = 120;
  const abortError = () => new DOMException('Cancelled', 'AbortError');
  function check(signal) { if (signal && signal.aborted) throw abortError(); }
  function fit(width, height, edge) {
    if (!(width > 0 && height > 0)) throw new Error('This file has no readable dimensions.');
    const scale = Math.min(1, edge / Math.max(width, height));
    return {width: Math.max(2, Math.floor(width * scale / 2) * 2), height: Math.max(2, Math.floor(height * scale / 2) * 2)};
  }
  function validate(file) {
    if (!file || !file.size) throw new Error('Choose a photo or video first.');
    if (!/^(image|video)\//.test(file.type)) throw new Error('Please choose a photo or video.');
    if (file.size > MAX_INPUT) throw new Error('Choose a file under 100 MB, or trim the video first.');
    return file.type.startsWith('video/') ? 'video' : 'photo';
  }
  function videoMime() {
    if (!root.MediaRecorder) return null;
    // Never select bare video/mp4: some browsers would silently put VP9/Opus in that container.
    return ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp8,opus']
      .find(type => root.MediaRecorder.isTypeSupported(type)) || null;
  }
  function fileName(name, ext) { return (String(name || 'family-moment').replace(/\.[^.]*$/, '') || 'family-moment') + ext; }
  async function photo(file, signal, progress) {
    check(signal);
    let image, url;
    try {
      if (root.createImageBitmap) image = await createImageBitmap(file, {imageOrientation: 'from-image'});
      else {
        url = URL.createObjectURL(file);
        image = await new Promise((resolve, reject) => {
          const img = new Image(); img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('This image format cannot be opened here. Try JPEG or PNG.')); img.src = url;
        });
      }
      check(signal);
      let edge = 1600, quality = .82, blob;
      const canvas = document.createElement('canvas');
      for (let attempt = 0; attempt < 4; attempt++) {
        Object.assign(canvas, fit(image.width, image.height, edge));
        const context = canvas.getContext('2d');
        context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
        check(signal);
        if (blob && blob.size <= 4 * 1024 * 1024) break;
        quality -= .08; edge = Math.floor(edge * .8);
      }
      if (!blob || blob.size > 4 * 1024 * 1024) throw new Error('This photo could not be reduced enough. Choose a smaller image.');
      progress(1);
      return new File([blob], fileName(file.name, '.jpg'), {type: 'image/jpeg'});
    } finally {
      if (image && image.close) image.close();
      if (url) URL.revokeObjectURL(url);
    }
  }
  function waitFor(video, signal) {
    return new Promise((resolve, reject) => {
      const finish = (error) => {
        clearTimeout(timer); video.removeEventListener('loadedmetadata', loaded); video.removeEventListener('error', failed);
        if (signal) signal.removeEventListener('abort', aborted);
        error ? reject(error) : resolve();
      };
      const loaded = () => finish(), failed = () => finish(new Error('This video cannot be decoded here. Try an MP4 clip.'));
      const aborted = () => finish(abortError());
      const timer = setTimeout(() => finish(new Error('The video took too long to open.')), 15000);
      video.addEventListener('loadedmetadata', loaded, {once:true}); video.addEventListener('error', failed, {once:true});
      if (signal) { signal.addEventListener('abort', aborted, {once:true}); if (signal.aborted) aborted(); }
    });
  }
  // Called synchronously in the file-picker gesture, before any async decoding.
  function audioSession() {
    const Audio = root.AudioContext || root.webkitAudioContext;
    if (!Audio) throw new Error('Video compression with sound is unavailable in this browser. Try a current Chrome or Safari.');
    const context = new Audio();
    const ready = context.resume();
    // Awaited below, but attach now to avoid a temporary unhandled rejection.
    ready.catch(() => {});
    return {context, ready};
  }
  async function video(file, signal, progress, audio) {
    const mime = videoMime();
    const canvas = document.createElement('canvas');
    if (!mime || !canvas.captureStream) throw new Error('Video compression is unavailable in this browser. The original will not be uploaded.');
    check(signal);
    audio = audio || audioSession();
    let stream, recorder, frame, source, destination;
    const element = document.createElement('video'); element.playsInline = true; element.preload = 'auto';
    const url = URL.createObjectURL(file);
    try {
      await audio.ready; check(signal);
      if (audio.context.state !== 'running') throw new Error('Tap Choose photo or video again to enable compression with sound.');
      const loaded = waitFor(element, signal); element.src = url; await loaded; check(signal);
      if (!Number.isFinite(element.duration) || element.duration <= 0 || element.duration > MAX_SECONDS) {
        throw new Error('Please trim this video to two minutes or less.');
      }
      Object.assign(canvas, fit(element.videoWidth, element.videoHeight, 1280));
      const context = canvas.getContext('2d');
      source = audio.context.createMediaElementSource(element); destination = audio.context.createMediaStreamDestination();
      source.connect(destination); // Do not connect to speakers; no microphone is ever requested.
      stream = canvas.captureStream(24);
      for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
      recorder = new MediaRecorder(stream, {mimeType:mime, videoBitsPerSecond:1200000, audioBitsPerSecond:96000});
      const blob = await new Promise((resolve, reject) => {
        let settled = false, size = 0; const chunks = [];
        const finish = (error) => {
          if (settled) return; settled = true;
          clearTimeout(timer); cancelAnimationFrame(frame);
          document.removeEventListener('visibilitychange', hidden);
          if (signal) signal.removeEventListener('abort', aborted);
          element.pause();
          if (recorder.state !== 'inactive') recorder.stop();
          error ? reject(error) : resolve(new Blob(chunks, {type: mime.split(';')[0]}));
        };
        const aborted = () => finish(abortError());
        const hidden = () => { if (document.hidden) finish(new Error('Keep this tab visible while compressing. Tap Retry to start again.')); };
        const timer = setTimeout(() => finish(new Error('Compression timed out. Try a shorter clip.')), (element.duration + 20) * 1000);
        recorder.ondataavailable = event => {
          if (event.data.size) { chunks.push(event.data); size += event.data.size; }
          if (size > MAX_OUTPUT) finish(new Error('The compressed video is too large. Please trim it.'));
        };
        recorder.onerror = () => finish(new Error('Video compression failed. Nothing has been uploaded.'));
        recorder.onstop = () => finish();
        element.onerror = () => finish(new Error('Video playback failed during compression.'));
        element.onended = () => { if (recorder.state !== 'inactive') recorder.stop(); };
        const paint = () => { if (settled) return; context.drawImage(element, 0, 0, canvas.width, canvas.height); progress(Math.min(.99, element.currentTime / element.duration)); frame = requestAnimationFrame(paint); };
        if (signal) signal.addEventListener('abort', aborted, {once:true});
        document.addEventListener('visibilitychange', hidden);
        recorder.start(250); paint();
        element.play().catch(() => finish(new Error('Video playback was blocked. Tap Retry and keep the tab open.')));
        if (signal && signal.aborted) aborted();
      });
      check(signal);
      if (!blob.size || blob.size > MAX_OUTPUT) throw new Error('No usable compressed video was produced.');
      progress(1);
      return new File([blob], fileName(file.name, mime.startsWith('video/mp4') ? '.mp4' : '.webm'), {type:blob.type});
    } finally {
      cancelAnimationFrame(frame); element.pause(); element.removeAttribute('src'); element.load();
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      if (stream) stream.getTracks().forEach(track => track.stop());
      if (destination) destination.stream.getTracks().forEach(track => track.stop());
      if (source) source.disconnect();
      await audio.context.close().catch(() => {}); URL.revokeObjectURL(url);
    }
  }
  async function prepare(file, {signal, progress = () => {}, audio} = {}) {
    const kind = validate(file);
    return kind === 'photo' ? photo(file, signal, progress) : video(file, signal, progress, audio);
  }
  root.FamMediaCompression = {prepare, validate, fit, videoMime, audioSession, MAX_INPUT, MAX_OUTPUT, MAX_SECONDS};
})(window);
