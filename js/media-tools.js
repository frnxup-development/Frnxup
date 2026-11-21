/* Shared upload preview, photo collage, lightbox and device-save helpers. */
(() => {
  const galleries = new Map();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const prettySize = bytes => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

  async function save(url, filename = 'frnxup-media') {
    if (!url) return;
    try {
      const response = await fetch(url, {mode: 'cors'});
      if (!response.ok) throw new Error('Could not download this media.');
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename.replace(/[^a-z0-9._-]/gi, '_');
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
      return true;
    } catch (error) {
      // Fallback opens the signed media URL so it can still be saved manually.
      window.open(url, '_blank', 'noopener');
      window.FX?.toast?.('Your browser opened the media. Use its menu to save it to your device.');
      return false;
    }
  }

  let lightboxLayer = null;
  let lightboxState = {items: [], index: 0, title: 'Photo gallery'};
  function renderLightbox() {
    if (!lightboxLayer) return;
    const {items, index, title} = lightboxState;
    const item = items[index];
    if (!item) return;
    lightboxLayer.querySelector('.fx-lightbox-title').textContent = title;
    lightboxLayer.querySelector('.fx-lightbox-stage').innerHTML = item.type === 'video'
      ? `<video controls autoplay playsinline src="${esc(item.url)}"></video>`
      : `<img src="${esc(item.url)}" alt="Photo ${index + 1}">`;
    lightboxLayer.querySelector('.fx-lightbox-count').textContent = `${index + 1} / ${items.length}`;
    lightboxLayer.querySelector('.fx-lightbox-prev').disabled = items.length < 2;
    lightboxLayer.querySelector('.fx-lightbox-next').disabled = items.length < 2;
  }
  function ensureLightbox() {
    if (lightboxLayer) return;
    lightboxLayer = document.createElement('div');
    lightboxLayer.className = 'fx-lightbox';
    lightboxLayer.innerHTML = `<div class="fx-lightbox-panel" role="dialog" aria-modal="true" aria-label="Media preview"><header><b class="fx-lightbox-title"></b><button type="button" class="fx-lightbox-close" aria-label="Close">×</button></header><div class="fx-lightbox-stage"></div><footer><button type="button" class="fx-lightbox-prev">‹ Previous</button><span class="fx-lightbox-count"></span><button type="button" class="fx-lightbox-next">Next ›</button><button type="button" class="fx-lightbox-save">↓ Save to device</button></footer></div>`;
    document.body.append(lightboxLayer);
    lightboxLayer.addEventListener('click', event => {
      const {items} = lightboxState;
      if (event.target === lightboxLayer || event.target.closest('.fx-lightbox-close')) lightboxLayer.classList.remove('open');
      if (event.target.closest('.fx-lightbox-prev') && items.length > 1) { lightboxState.index = (lightboxState.index - 1 + items.length) % items.length; renderLightbox(); }
      if (event.target.closest('.fx-lightbox-next') && items.length > 1) { lightboxState.index = (lightboxState.index + 1) % items.length; renderLightbox(); }
      if (event.target.closest('.fx-lightbox-save')) {
        const item = items[lightboxState.index];
        if (item) save(item.url, item.name || `frnxup-${lightboxState.index + 1}.${item.type === 'video' ? 'mp4' : 'jpg'}`);
      }
    });
    document.addEventListener('keydown', event => {
      if (!lightboxLayer?.classList.contains('open')) return;
      const {items} = lightboxState;
      if (event.key === 'Escape') lightboxLayer.classList.remove('open');
      if (event.key === 'ArrowLeft' && items.length > 1) { lightboxState.index = (lightboxState.index - 1 + items.length) % items.length; renderLightbox(); }
      if (event.key === 'ArrowRight' && items.length > 1) { lightboxState.index = (lightboxState.index + 1) % items.length; renderLightbox(); }
    });
  }
  function openGallery(key, start = 0, title = 'Photo gallery') {
    const items = galleries.get(String(key));
    if (!items?.length) return;
    lightboxState = {items, index: Math.max(0, Math.min(Number(start) || 0, items.length - 1)), title};
    ensureLightbox();
    renderLightbox();
    lightboxLayer.classList.add('open');
  }

  function collage(items, key, title = 'Post photos') {
    const clean = (items || []).filter(item => item?.url);
    if (!clean.length) return '';
    galleries.set(String(key), clean);
    const visible = clean.slice(0, 4);
    const countClass = clean.length === 1 ? 'one' : clean.length === 2 ? 'two' : clean.length === 3 ? 'three' : 'four';
    return `<div class="fx-collage ${countClass}" data-gallery-title="${esc(title)}">${visible.map((item, index) => {
      const media = item.type === 'video'
        ? `<video src="${esc(item.url)}" muted playsinline preload="metadata"></video><span class="fx-video-mark">▶</span>`
        : `<img loading="lazy" src="${esc(item.url)}" alt="Post photo ${index + 1}">`;
      const more = index === 3 && clean.length > 4 ? `<span class="fx-collage-more">+${clean.length - 4}</span>` : '';
      return `<button type="button" class="fx-collage-tile" data-fx-gallery="${esc(key)}" data-fx-index="${index}" aria-label="Preview media ${index + 1}">${media}${more}</button>`;
    }).join('')}</div><div class="fx-media-save-row"><button type="button" class="fx-save-gallery" data-fx-save-gallery="${esc(key)}">↓ Preview & save photos</button><small>${clean.length} ${clean.length === 1 ? 'item' : 'items'} · Tap to preview</small></div>`;
  }

  function buildPreview(input) {
    const host = input.closest('.field') || input.closest('.fx-file-label') || input.parentElement;
    if (!host || input.hidden || host.hidden || input.closest('[hidden]')) return;
    let panel = host.parentElement?.querySelector(`.fx-upload-preview[data-for="${CSS.escape(input.id || '')}"]`);
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'fx-upload-preview';
      panel.dataset.for = input.id || `upload-${Math.random().toString(36).slice(2)}`;
      const placement = host.classList.contains('fx-file-label') ? host.parentElement : host;
      placement.insertAdjacentElement('afterend', panel);
    }
    input.addEventListener('change', () => {
      (panel._fxObjectUrls || []).forEach(url => URL.revokeObjectURL(url));
      panel._fxObjectUrls = [];
      panel.replaceChildren();
      const files = [...(input.files || [])];
      if (!files.length) return;
      const imageFiles = files.filter(file => file.type.startsWith('image/'));
      const videoFiles = files.filter(file => file.type.startsWith('video/'));
      if (input.multiple && (files.length > 20 || videoFiles.length || imageFiles.length !== files.length)) {
        const message = videoFiles.length ? 'Choose up to 20 photos, or choose one video separately.' : 'A post can contain at most 20 photos.';
        panel.innerHTML = `<p class="fx-upload-error">${message}</p>`;
        input.value = '';
        return;
      }
      if (videoFiles.length > 1 || (videoFiles.length && imageFiles.length)) {
        panel.innerHTML = '<p class="fx-upload-error">Choose one video or a group of photos. You cannot mix video and photos in one post.</p>';
        input.value = '';
        return;
      }
      const title = document.createElement('div');
      title.className = 'fx-upload-preview-heading';
      title.textContent = `${files.length} ${files.length === 1 ? 'file selected' : 'files selected'} · preview before sharing`;
      panel.append(title);
      const grid = document.createElement('div');
      grid.className = 'fx-upload-preview-grid';
      files.forEach((file, index) => {
        const url = URL.createObjectURL(file);
        panel._fxObjectUrls.push(url);
        const card = document.createElement('div');
        card.className = 'fx-upload-preview-card';
        const media = file.type.startsWith('video/') ? document.createElement('video') : file.type.startsWith('image/') ? document.createElement('img') : document.createElement('div');
        if (media.tagName === 'VIDEO') { media.src = url; media.controls = true; media.playsInline = true; }
        else if (media.tagName === 'IMG') { media.src = url; media.alt = `Selected upload ${index + 1}`; }
        else { media.className = 'fx-upload-file-icon'; media.textContent = file.name.toLowerCase().endsWith('.pdf') ? 'PDF' : 'FILE'; }
        const meta = document.createElement('div');
        meta.className = 'fx-upload-preview-meta';
        meta.innerHTML = `<span>${esc(file.name)}<small>${prettySize(file.size)}</small></span>`;
        const saveButton = document.createElement('button');
        saveButton.type = 'button';
        saveButton.textContent = '↓ Save preview';
        saveButton.addEventListener('click', () => save(url, file.name));
        meta.append(saveButton);
        card.append(media, meta);
        grid.append(card);
      });
      panel.append(grid);
      if (input.multiple) {
        const note = document.createElement('small');
        note.className = 'fx-upload-preview-note';
        note.textContent = 'Photos will be displayed as a collage. Tap the collage after publishing to preview and save individual photos.';
        panel.append(note);
      }
    });
  }

  document.addEventListener('click', event => {
    const tile = event.target.closest('[data-fx-gallery]');
    if (tile) { openGallery(tile.dataset.fxGallery, Number(tile.dataset.fxIndex), tile.closest('.fx-collage')?.dataset.galleryTitle || 'Photo gallery'); return; }
    const saveButton = event.target.closest('[data-fx-save-gallery]');
    if (saveButton) {
      const items = galleries.get(saveButton.dataset.fxSaveGallery) || [];
      if (items.length === 1) save(items[0].url, items[0].name || 'frnxup-photo.jpg');
      else openGallery(saveButton.dataset.fxSaveGallery, 0, 'Save each photo from the preview');
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('input[type="file"]').forEach(buildPreview);
  });
  window.addEventListener('pagehide', () => {
    document.querySelectorAll('.fx-upload-preview').forEach(panel => (panel._fxObjectUrls || []).forEach(url => URL.revokeObjectURL(url)));
  });

  window.FXMediaTools = { save, collage, openGallery, galleries };
})();
