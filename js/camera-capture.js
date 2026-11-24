/* Full-screen Frnxup camera: photo, video and Reel capture. Requires HTTPS and user permission. */
(() => {
  'use strict';
  if (window.FXCamera) return;

  let layer, stream = null, recorder = null, chunks = [], facing = 'environment';
  let timer = null, startedAt = 0, currentMode = 'all', currentFile = null, onFile = null;
  let videoEl, messageEl, recordBtn, shutterBtn;

  const supported = type => !type || currentMode === 'all' ||
    (currentMode === 'photo' && type.startsWith('image/')) ||
    (currentMode === 'video' && type.startsWith('video/'));
  const bestVideoMime = () => [
    'video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4'
  ].find(type => window.MediaRecorder?.isTypeSupported?.(type)) || '';
  const stopStream = () => {
    if (stream) stream.getTracks().forEach(track => { try { track.stop(); } catch (_) {} });
    stream = null;
    if (videoEl) videoEl.srcObject = null;
  };
  const releaseFullScreen = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); } catch (_) {}
  };

  function setFacingButtons() {
    if (!layer) return;
    layer.querySelectorAll('[data-camera-facing]').forEach(button => {
      const active = button.dataset.cameraFacing === facing;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function ensureLayer() {
    if (layer) return;
    layer = document.createElement('section');
    layer.className = 'fx-camera-layer';
    layer.setAttribute('role','dialog');
    layer.setAttribute('aria-modal','true');
    layer.setAttribute('aria-label','Frnxup camera');
    layer.innerHTML = `
      <header class="fx-camera-top">
        <button type="button" data-camera-close aria-label="Close camera">×</button>
        <b>Frnxup Camera</b>
        <div class="fx-camera-facing" role="group" aria-label="Choose camera">
          <button type="button" data-camera-facing="user" aria-pressed="false">Front</button>
          <button type="button" data-camera-facing="environment" aria-pressed="true">Back</button>
        </div>
        <button type="button" data-camera-flip aria-label="Switch front or back camera" title="Switch camera">↻</button>
      </header>
      <div class="fx-camera-stage">
        <video class="fx-camera-live" autoplay muted playsinline></video>
        <div class="fx-camera-rec-dot" hidden>● REC <span>00:00</span></div>
        <div class="fx-camera-hint">Allow camera access to capture your moment</div>
      </div>
      <div class="fx-camera-message" role="status" aria-live="polite"></div>
      <div class="fx-camera-controls">
        <button type="button" class="fx-camera-gallery" data-camera-gallery>▧ <span>Gallery</span></button>
        <button type="button" class="fx-camera-shutter" data-camera-shutter aria-label="Take photo"><span></span></button>
        <button type="button" class="fx-camera-record" data-camera-record>● <span>Record</span></button>
      </div>
      <div class="fx-camera-preview-actions" hidden>
        <button type="button" data-camera-retake>Retake</button>
        <button type="button" data-camera-use>Use this media</button>
      </div>
      <input type="file" class="fx-camera-file" accept="image/*,video/*" hidden>
    `;
    document.body.append(layer);
    videoEl = layer.querySelector('.fx-camera-live');
    messageEl = layer.querySelector('.fx-camera-message');
    recordBtn = layer.querySelector('[data-camera-record]');
    shutterBtn = layer.querySelector('[data-camera-shutter]');

    layer.addEventListener('click', async event => {
      const frontOrBack = event.target.closest('[data-camera-facing]');
      if (event.target.closest('[data-camera-close]')) close();
      else if (frontOrBack) await startCamera(frontOrBack.dataset.cameraFacing);
      else if (event.target.closest('[data-camera-flip]')) await startCamera(facing === 'environment' ? 'user' : 'environment');
      else if (event.target.closest('[data-camera-shutter]')) capturePhoto();
      else if (event.target.closest('[data-camera-record]')) toggleRecording();
      else if (event.target.closest('[data-camera-gallery]')) layer.querySelector('.fx-camera-file').click();
      else if (event.target.closest('[data-camera-retake]')) retake();
      else if (event.target.closest('[data-camera-use]')) useFile();
    });
    layer.querySelector('.fx-camera-file').addEventListener('change', event => {
      const file = event.target.files?.[0];
      if (!file) return;
      if (!supported(file.type)) {
        messageEl.textContent = currentMode === 'video' ? 'Choose a video file.' : currentMode === 'photo' ? 'Choose an image file.' : 'Choose a photo or video.';
        event.target.value = '';
        return;
      }
      showCapturedFile(file);
    });
  }

  async function cameraDeviceFor(targetFacing) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter(device => device.kind === 'videoinput');
      const patterns = targetFacing === 'user'
        ? /(front|user|facetime|selfie)/i
        : /(back|rear|environment|world)/i;
      return cameras.find(camera => patterns.test(camera.label || '')) || null;
    } catch (_) { return null; }
  }

  function cameraErrorMessage(error, targetFacing) {
    const which = targetFacing === 'user' ? 'front' : 'back';
    if (!window.isSecureContext) return 'Camera access requires HTTPS. Open Frnxup using its secure https:// address.';
    if (!navigator.mediaDevices?.getUserMedia) return 'This browser does not provide camera access. Open Frnxup in Chrome or another supported browser, or use Gallery.';
    if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') return 'Camera permission was denied. Allow camera access for Frnxup in your browser/site settings, then try again.';
    if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') return `No ${which} camera was found. Try the other camera or choose a video from Gallery.`;
    if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError') return 'The camera is busy or unavailable. Close other camera apps and try again.';
    if (error?.name === 'OverconstrainedError' || error?.name === 'ConstraintNotSatisfiedError') return `The ${which} camera is unavailable on this device. Try the other camera.`;
    return `Camera could not start (${error?.name || 'error'}). Check browser permissions or use Gallery.`;
  }

  async function acquireCamera(targetFacing) {
    const wantsAudio = currentMode !== 'photo';
    const device = await cameraDeviceFor(targetFacing);
    const quality = { width: { ideal: 1080 }, height: { ideal: 1920 } };
    const videoChoices = [];
    if (device?.deviceId) videoChoices.push({ ...quality, deviceId: { exact: device.deviceId } });
    videoChoices.push(
      { ...quality, facingMode: { exact: targetFacing } },
      { ...quality, facingMode: { ideal: targetFacing } },
      { facingMode: { ideal: targetFacing } },
      true
    );

    let lastError = null;
    for (const video of videoChoices) {
      if (wantsAudio) {
        try { return { stream: await navigator.mediaDevices.getUserMedia({ video, audio: true }), silent: false }; }
        catch (error) { lastError = error; }
      }
      try { return { stream: await navigator.mediaDevices.getUserMedia({ video, audio: false }), silent: wantsAudio }; }
      catch (error) { lastError = error; }
    }
    throw lastError || new Error('Camera access failed');
  }

  async function startCamera(nextFacing = facing) {
    if (!navigator.mediaDevices?.getUserMedia) {
      messageEl.textContent = cameraErrorMessage(null, nextFacing);
      layer.querySelector('.fx-camera-controls').hidden = false;
      shutterBtn.hidden = currentMode === 'video';
      recordBtn.hidden = currentMode === 'photo';
      return false;
    }
    if (recorder?.state === 'recording') {
      messageEl.textContent = 'Stop recording before switching cameras.';
      return false;
    }

    stopStream();
    facing = nextFacing === 'user' ? 'user' : 'environment';
    setFacingButtons();
    messageEl.textContent = `Opening ${facing === 'user' ? 'front' : 'back'} camera…`;
    layer.querySelector('.fx-camera-controls').hidden = false;
    shutterBtn.hidden = currentMode === 'video';
    recordBtn.hidden = currentMode === 'photo';

    try {
      const result = await acquireCamera(facing);
      stream = result.stream;
      videoEl.srcObject = stream;
      videoEl.hidden = false;
      await videoEl.play().catch(() => {});
      layer.querySelector('.fx-camera-hint').hidden = true;
      const actual = stream.getVideoTracks?.()[0]?.getSettings?.().facingMode;
      const actualFacing = actual === 'user' || actual === 'environment' ? actual : facing;
      if (actualFacing !== facing) { facing = actualFacing; setFacingButtons(); }
      const micNote = currentMode !== 'photo' && !stream.getAudioTracks().length ? ' · microphone unavailable, video will be silent' : '';
      messageEl.textContent = `${facing === 'user' ? 'Front' : 'Back'} camera ready${micNote}`;
      layer.querySelector('[data-camera-flip]').disabled = false;
      return true;
    } catch (error) {
      messageEl.textContent = cameraErrorMessage(error, facing);
      layer.querySelector('.fx-camera-hint').hidden = false;
      shutterBtn.hidden = currentMode === 'video';
      recordBtn.hidden = currentMode === 'photo';
      layer.querySelector('[data-camera-flip]').disabled = false;
      return false;
    }
  }

  function showCapturedFile(file) {
    stopStream();
    if (layer?._previewUrl) URL.revokeObjectURL(layer._previewUrl);
    currentFile = file;
    stopTimer();
    if (file.size > 100 * 1024 * 1024) {
      currentFile = null;
      layer.querySelector('.fx-camera-controls').hidden = true;
      layer.querySelector('.fx-camera-preview-actions').hidden = false;
      layer.querySelector('[data-camera-retake]').hidden = false;
      layer.querySelector('[data-camera-use]').hidden = true;
      messageEl.textContent = 'This capture exceeds Frnxup’s 100 MB upload limit. Retake a shorter video or choose a smaller file.';
      return;
    }
    layer.querySelector('.fx-camera-file-preview')?.remove();
    const url = URL.createObjectURL(file);
    const media = document.createElement(file.type.startsWith('video/') ? 'video' : 'img');
    media.className = 'fx-camera-file-preview';
    media.src = url;
    if (media.tagName === 'VIDEO') { media.controls = true; media.playsInline = true; }
    layer.querySelector('.fx-camera-stage').append(media);
    layer.querySelector('.fx-camera-hint').hidden = true;
    layer.querySelector('.fx-camera-controls').hidden = true;
    layer.querySelector('.fx-camera-preview-actions').hidden = false;
    layer.querySelector('[data-camera-retake]').hidden = false;
    layer.querySelector('[data-camera-use]').hidden = false;
    messageEl.textContent = `${file.type.startsWith('video/') ? 'Video' : 'Photo'} ready to use · ${(file.size / 1048576).toFixed(1)} MB`;
    layer._previewUrl = url;
  }

  function capturePhoto() {
    if (!stream || !videoEl.videoWidth) { messageEl.textContent = 'Wait for the camera to become ready.'; return; }
    const canvas = document.createElement('canvas');
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) { messageEl.textContent = 'Photo capture is unavailable. Try again.'; return; }
    context.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      if (!blob) { messageEl.textContent = 'The photo could not be captured. Try again.'; return; }
      const file = new File([blob], `frnxup-photo-${Date.now()}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
      showCapturedFile(file);
    }, 'image/jpeg', 0.92);
  }

  function toggleRecording() {
    if (recorder?.state === 'recording') { recorder.stop(); return; }
    if (!stream) { messageEl.textContent = 'Camera is not ready. Choose Front or Back, or use Gallery.'; return; }
    if (!window.MediaRecorder) { messageEl.textContent = 'Video recording is not supported in this browser. Use Gallery to select a video.'; return; }
    try {
      chunks = [];
      const mimeType = bestVideoMime();
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
      recorder.onerror = () => { messageEl.textContent = 'Recording failed. Please try again.'; stopStream(); stopTimer(); };
      recorder.onstop = () => {
        stopTimer();
        const rawType = recorder?.mimeType || mimeType || 'video/webm';
        const type = rawType.includes('mp4') ? 'video/mp4' : 'video/webm';
        const ext = type === 'video/mp4' ? 'mp4' : 'webm';
        const file = new File(chunks, `frnxup-video-${Date.now()}.${ext}`, { type, lastModified: Date.now() });
        stopStream();
        recorder = null;
        showCapturedFile(file);
      };
      recorder.start(500);
      startedAt = Date.now();
      layer.querySelector('[data-camera-facing="user"]').disabled = true;
      layer.querySelector('[data-camera-facing="environment"]').disabled = true;
      layer.querySelector('[data-camera-flip]').disabled = true;
      recordBtn.classList.add('recording');
      recordBtn.innerHTML = '■ <span>Stop recording</span>';
      layer.querySelector('.fx-camera-rec-dot').hidden = false;
      updateTimer();
    } catch (error) { messageEl.textContent = error?.message || 'Recording could not start.'; }
  }

  function updateTimer() {
    const output = layer.querySelector('.fx-camera-rec-dot span');
    timer = setInterval(() => {
      const secs = Math.floor((Date.now() - startedAt) / 1000);
      output.textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
    }, 250);
  }
  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
    layer?.querySelector('.fx-camera-rec-dot')?.setAttribute('hidden', '');
    layer?.querySelectorAll('[data-camera-facing]').forEach(button => { button.disabled = false; });
    if (layer?.querySelector('[data-camera-flip]')) layer.querySelector('[data-camera-flip]').disabled = false;
    if (recordBtn) { recordBtn.classList.remove('recording'); recordBtn.innerHTML = '● <span>Record</span>'; }
  }

  function retake() {
    currentFile = null;
    layer.querySelector('.fx-camera-file-preview')?.remove();
    if (layer._previewUrl) URL.revokeObjectURL(layer._previewUrl);
    layer._previewUrl = null;
    layer.querySelector('.fx-camera-preview-actions').hidden = true;
    layer.querySelector('.fx-camera-controls').hidden = false;
    startCamera(facing);
  }

  function useFile() {
    if (!currentFile) return;
    const file = currentFile;
    const callback = onFile;
    close();
    try { callback?.(file); } catch (error) { console.error('Frnxup camera callback failed:', error); }
  }

  async function close() {
    try { if (recorder?.state === 'recording') { recorder.onstop = null; recorder.stop(); } } catch (_) {}
    recorder = null;
    chunks = [];
    stopTimer();
    stopStream();
    currentFile = null;
    onFile = null;
    if (layer?._previewUrl) URL.revokeObjectURL(layer._previewUrl);
    if (layer) layer._previewUrl = null;
    await releaseFullScreen();
    layer?.classList.remove('open');
    document.body.classList.remove('fx-camera-open');
    if (layer) {
      layer.querySelector('.fx-camera-file-preview')?.remove();
      layer.querySelector('.fx-camera-controls').hidden = false;
      layer.querySelector('.fx-camera-preview-actions').hidden = true;
      layer.querySelector('.fx-camera-file').value = '';
      layer.querySelector('.fx-camera-hint').hidden = false;
    }
  }

  async function open(options = {}) {
    ensureLayer();
    currentMode = options.mode || 'all';
    onFile = typeof options.onFile === 'function' ? options.onFile : null;
    currentFile = null;
    facing = options.facing === 'user' ? 'user' : 'environment';
    layer.querySelector('.fx-camera-file').accept = currentMode === 'photo' ? 'image/*' : currentMode === 'video' ? 'video/*' : 'image/*,video/*';
    layer.querySelector('.fx-camera-rec-dot').hidden = true;
    layer.querySelector('.fx-camera-hint').hidden = false;
    layer.querySelector('.fx-camera-controls').hidden = false;
    layer.querySelector('.fx-camera-preview-actions').hidden = true;
    layer.querySelector('.fx-camera-file-preview')?.remove();
    recordBtn.hidden = currentMode === 'photo';
    shutterBtn.hidden = currentMode === 'video';
    setFacingButtons();
    layer.classList.add('open');
    document.body.classList.add('fx-camera-open');
    try { const request = layer.requestFullscreen?.(); request?.catch?.(() => {}); } catch (_) {}
    await startCamera(facing);
    return true;
  }

  document.addEventListener('keydown', event => {
    if (layer?.classList.contains('open') && event.key === 'Escape') close();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && layer?.classList.contains('open') && recorder?.state !== 'recording') stopStream();
  });

  window.FXCamera = { open, close };
})();
