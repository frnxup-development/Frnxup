/* Full-screen Frnxup camera for photo, video and Reel capture. Requires HTTPS and user permission. */
(() => {
  'use strict';
  if (window.FXCamera) return;
  let layer, stream = null, recorder = null, chunks = [], facing = 'environment', timer = null, startedAt = 0;
  let currentMode = 'all', currentFile = null, onFile = null, videoEl, previewEl, messageEl, recordBtn, shutterBtn;
  const supported = (type) => !type || currentMode === 'all' || (currentMode === 'photo' && type.startsWith('image/')) || (currentMode === 'video' && type.startsWith('video/'));
  const bestVideoMime = () => ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4'].find(type => window.MediaRecorder?.isTypeSupported?.(type)) || '';
  const stopStream = () => { if (stream) stream.getTracks().forEach(track => track.stop()); stream = null; if (videoEl) videoEl.srcObject = null; };
  const releaseFullScreen = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); } catch (_) {} };
  function ensureLayer() {
    if (layer) return;
    layer = document.createElement('section');
    layer.className = 'fx-camera-layer';
    layer.setAttribute('role','dialog'); layer.setAttribute('aria-modal','true'); layer.setAttribute('aria-label','Frnxup camera');
    layer.innerHTML = `
      <header class="fx-camera-top"><button type="button" data-camera-close aria-label="Close camera">×</button><b>Frnxup Camera</b><button type="button" data-camera-flip aria-label="Switch front or back camera">↻</button></header>
      <div class="fx-camera-stage"><video class="fx-camera-live" autoplay muted playsinline></video><img class="fx-camera-preview" alt="Camera capture preview" hidden><div class="fx-camera-rec-dot" hidden>● REC <span>00:00</span></div><div class="fx-camera-hint">Allow camera access to capture your moment</div></div>
      <div class="fx-camera-message" role="status"></div>
      <div class="fx-camera-controls"><button type="button" class="fx-camera-gallery" data-camera-gallery>▧ <span>Gallery</span></button><button type="button" class="fx-camera-shutter" data-camera-shutter aria-label="Take photo"><span></span></button><button type="button" class="fx-camera-record" data-camera-record>● <span>Record</span></button></div>
      <div class="fx-camera-preview-actions" hidden><button type="button" data-camera-retake>Retake</button><button type="button" data-camera-use>Use this media</button></div>
      <input type="file" class="fx-camera-file" accept="image/*,video/*" hidden>
    `;
    document.body.append(layer);
    videoEl = layer.querySelector('.fx-camera-live'); previewEl = layer.querySelector('.fx-camera-preview');
    messageEl = layer.querySelector('.fx-camera-message'); recordBtn = layer.querySelector('[data-camera-record]'); shutterBtn = layer.querySelector('[data-camera-shutter]');
    layer.addEventListener('click', async event => {
      if (event.target.closest('[data-camera-close]')) close();
      else if (event.target.closest('[data-camera-flip]')) await startCamera(facing === 'environment' ? 'user' : 'environment');
      else if (event.target.closest('[data-camera-shutter]')) capturePhoto();
      else if (event.target.closest('[data-camera-record]')) toggleRecording();
      else if (event.target.closest('[data-camera-gallery]')) layer.querySelector('.fx-camera-file').click();
      else if (event.target.closest('[data-camera-retake]')) retake();
      else if (event.target.closest('[data-camera-use]')) useFile();
    });
    layer.querySelector('.fx-camera-file').addEventListener('change', event => {
      const file = event.target.files?.[0]; if (!file) return;
      if (!supported(file.type)) { messageEl.textContent = currentMode === 'video' ? 'Choose a video file.' : currentMode === 'photo' ? 'Choose an image file.' : 'Choose a photo or video.'; event.target.value = ''; return; }
      showCapturedFile(file);
    });
  }
  async function startCamera(nextFacing = facing) {
    stopStream(); facing = nextFacing; messageEl.textContent = 'Opening camera…';
    if (!navigator.mediaDevices?.getUserMedia) { messageEl.textContent = 'Camera access is unavailable in this browser. Use Gallery to select a file.'; return false; }
    const constraints = { audio: currentMode !== 'photo', video: { facingMode: { ideal: facing }, width: { ideal: 1080 }, height: { ideal: 1920 } } };
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (firstError) {
      // A denied/unavailable microphone should not prevent camera-only capture.
      if (constraints.audio) {
        try { stream = await navigator.mediaDevices.getUserMedia({ ...constraints, audio: false }); }
        catch (_) {
          messageEl.textContent = firstError?.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access in your browser settings, or use Gallery.' : firstError?.name === 'NotFoundError' ? 'No camera was found on this device. Use Gallery to select a file.' : `Camera unavailable: ${firstError?.message || 'please use Gallery instead.'}`;
          shutterBtn.hidden = currentMode === 'video'; recordBtn.hidden = currentMode === 'photo';
          return false;
        }
      } else {
        messageEl.textContent = firstError?.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access in your browser settings, or use Gallery.' : firstError?.name === 'NotFoundError' ? 'No camera was found on this device. Use Gallery to select a file.' : `Camera unavailable: ${firstError?.message || 'please use Gallery instead.'}`;
        shutterBtn.hidden = currentMode === 'video'; recordBtn.hidden = currentMode === 'photo';
        return false;
      }
    }
    videoEl.srcObject = stream; videoEl.hidden = false; previewEl.hidden = true;
    await videoEl.play().catch(() => {});
    layer.querySelector('.fx-camera-hint').hidden = true;
    messageEl.textContent = `${facing === 'user' ? 'Front' : 'Back'} camera active${constraints.audio && !stream.getAudioTracks().length ? ' · microphone unavailable; recording without sound' : ''}`;
    layer.querySelector('[data-camera-flip]').hidden = false;
    shutterBtn.hidden = currentMode === 'video'; recordBtn.hidden = currentMode === 'photo';
    return true;
  }
  function showCapturedFile(file) {
    stopStream();
    if (layer?._previewUrl) URL.revokeObjectURL(layer._previewUrl);
    currentFile = file; stopTimer();
    if (file.size > 100 * 1024 * 1024) { currentFile = null; layer.querySelector('.fx-camera-controls').hidden = true; layer.querySelector('.fx-camera-preview-actions').hidden = false; layer.querySelector('[data-camera-retake]').hidden = false; layer.querySelector('[data-camera-use]').hidden = true; messageEl.textContent = 'This capture exceeds Frnxup’s 100 MB upload limit. Retake a shorter video or choose a smaller file.'; return; }
    videoEl.hidden = true; previewEl.hidden = true;
    const old = layer.querySelector('.fx-camera-file-preview'); old?.remove();
    const url = URL.createObjectURL(file); const media = document.createElement(file.type.startsWith('video/') ? 'video' : 'img');
    media.className = 'fx-camera-file-preview'; media.src = url;
    if (media.tagName === 'VIDEO') { media.controls = true; media.playsInline = true; }
    media.addEventListener('loadeddata', () => {}, { once:true });
    layer.querySelector('.fx-camera-stage').append(media);
    layer.querySelector('.fx-camera-stage').querySelector('.fx-camera-hint').hidden = true;
    layer.querySelector('.fx-camera-controls').hidden = true;
    layer.querySelector('.fx-camera-preview-actions').hidden = false;
    layer.querySelector('[data-camera-retake]').hidden = false; layer.querySelector('[data-camera-use]').hidden = false;
    messageEl.textContent = `${file.type.startsWith('video/') ? 'Video' : 'Photo'} ready to use · ${(file.size / 1048576).toFixed(1)} MB`;
    layer._previewUrl = url;
  }
  function capturePhoto() {
    if (!stream || !videoEl.videoWidth) { messageEl.textContent = 'Wait for the camera to become ready.'; return; }
    const canvas = document.createElement('canvas'); canvas.width = videoEl.videoWidth; canvas.height = videoEl.videoHeight;
    canvas.getContext('2d').drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      if (!blob) { messageEl.textContent = 'The photo could not be captured. Try again.'; return; }
      const file = new File([blob], `frnxup-photo-${Date.now()}.jpg`, { type:'image/jpeg', lastModified:Date.now() });
      stopStream(); showCapturedFile(file);
    }, 'image/jpeg', .92);
  }
  function toggleRecording() {
    if (recorder?.state === 'recording') { recorder.stop(); return; }
    if (!stream) { messageEl.textContent = 'Camera is not ready. Use Gallery or allow camera access.'; return; }
    if (!window.MediaRecorder) { messageEl.textContent = 'Video recording is not supported in this browser. Use Gallery to select a video.'; return; }
    try {
      chunks = []; const mimeType = bestVideoMime();
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
      recorder.onerror = () => { messageEl.textContent = 'Recording failed. Please try again.'; stopStream(); stopTimer(); };
      recorder.onstop = () => {
        stopTimer(); const rawType = recorder.mimeType || mimeType || 'video/webm';
        const type = rawType.includes('mp4') ? 'video/mp4' : 'video/webm';
        const ext = type === 'video/mp4' ? 'mp4' : 'webm';
        const file = new File(chunks, `frnxup-video-${Date.now()}.${ext}`, { type, lastModified:Date.now() });
        stopStream(); showCapturedFile(file);
      };
      recorder.start(500); startedAt = Date.now();
      layer.querySelector('[data-camera-flip]').disabled = true;
      recordBtn.classList.add('recording'); recordBtn.innerHTML = '■ <span>Stop recording</span>';
      layer.querySelector('.fx-camera-rec-dot').hidden = false; updateTimer();
    } catch (error) { messageEl.textContent = error?.message || 'Recording could not start.'; }
  }
  function updateTimer() {
    const output = layer.querySelector('.fx-camera-rec-dot span');
    timer = setInterval(() => { const secs = Math.floor((Date.now() - startedAt) / 1000); output.textContent = `${String(Math.floor(secs/60)).padStart(2,'0')}:${String(secs%60).padStart(2,'0')}`; }, 250);
  }
  function stopTimer() { if (timer) clearInterval(timer); timer = null; layer?.querySelector('.fx-camera-rec-dot')?.setAttribute('hidden',''); if (layer?.querySelector('[data-camera-flip]')) layer.querySelector('[data-camera-flip]').disabled = false; if (recordBtn) { recordBtn.classList.remove('recording'); recordBtn.innerHTML = '● <span>Record</span>'; } }
  function retake() {
    currentFile = null; layer.querySelector('.fx-camera-file-preview')?.remove();
    if (layer._previewUrl) URL.revokeObjectURL(layer._previewUrl); layer._previewUrl = null;
    layer.querySelector('.fx-camera-preview-actions').hidden = true; layer.querySelector('.fx-camera-controls').hidden = false;
    startCamera(facing);
  }
  function useFile() {
    if (!currentFile) return;
    const file = currentFile, callback = onFile;
    close();
    try { callback?.(file); } catch (error) { console.error('Frnxup camera callback failed:', error); }
  }
  async function close() {
    try { if (recorder?.state === 'recording') { recorder.onstop = null; recorder.stop(); } } catch (_) {}
    recorder = null; chunks = []; stopTimer(); stopStream(); currentFile = null; onFile = null;
    if (layer?._previewUrl) URL.revokeObjectURL(layer._previewUrl); if (layer) layer._previewUrl = null;
    await releaseFullScreen(); layer?.classList.remove('open'); document.body.classList.remove('fx-camera-open');
    if (layer) { layer.querySelector('.fx-camera-file-preview')?.remove(); layer.querySelector('.fx-camera-controls').hidden = false; layer.querySelector('.fx-camera-preview-actions').hidden = true; layer.querySelector('.fx-camera-file').value = ''; }
  }
  async function open(options = {}) {
    ensureLayer(); currentMode = options.mode || 'all'; onFile = options.onFile || null; currentFile = null;
    layer.querySelector('.fx-camera-file').accept = currentMode === 'photo' ? 'image/*' : currentMode === 'video' ? 'video/*' : 'image/*,video/*';
    layer.querySelector('.fx-camera-rec-dot').hidden = true; layer.querySelector('.fx-camera-hint').hidden = false;
    layer.querySelector('.fx-camera-controls').hidden = false; layer.querySelector('.fx-camera-preview-actions').hidden = true;
    layer.querySelector('.fx-camera-file-preview')?.remove(); recordBtn.hidden = currentMode === 'photo'; shutterBtn.hidden = currentMode === 'video';
    layer.classList.add('open'); document.body.classList.add('fx-camera-open');
    try { const fullscreenRequest = layer.requestFullscreen?.(); fullscreenRequest?.catch?.(() => {}); } catch (_) {}
    await startCamera(options.facing || 'environment');
    return true;
  }
  document.addEventListener('keydown', event => { if (layer?.classList.contains('open') && event.key === 'Escape') close(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && layer?.classList.contains('open') && recorder?.state !== 'recording') stopStream(); });
  window.FXCamera = { open, close };
})();
