/* Shared upload preview, swipeable photo carousel, lightbox and device-save helpers. */
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
      ? `<video controls autoplay muted playsinline preload="metadata" src="${esc(item.url)}"></video>`
      : `<img src="${esc(item.url)}" alt="Photo ${index + 1} of ${items.length}">`;
    lightboxLayer.querySelector('.fx-lightbox-count').textContent = `${index + 1} / ${items.length}`;
    lightboxLayer.querySelector('.fx-lightbox-prev').disabled = index === 0;
    lightboxLayer.querySelector('.fx-lightbox-next').disabled = index >= items.length - 1;
    lightboxLayer.querySelector('.fx-lightbox-save').disabled = !item.url;
    lightboxLayer.querySelector('.fx-lightbox-thumbs').innerHTML = items.map((photo, photoIndex) => `
      <button type="button" class="fx-lightbox-thumb ${photoIndex === index ? 'active' : ''}" data-fx-lightbox-index="${photoIndex}" aria-label="Show photo ${photoIndex + 1}" aria-current="${photoIndex === index ? 'true' : 'false'}">
        <img src="${esc(photo.url)}" alt="">
      </button>`).join('');
    const activeThumb = lightboxLayer.querySelector('.fx-lightbox-thumb.active');
    activeThumb?.scrollIntoView({block: 'nearest', inline: 'nearest'});
  }
  function ensureLightbox() {
    if (lightboxLayer) return;
    lightboxLayer = document.createElement('div');
    lightboxLayer.className = 'fx-lightbox fx-photo-lightbox';
    lightboxLayer.innerHTML = `<div class="fx-lightbox-panel" role="dialog" aria-modal="true" aria-label="Photo gallery viewer">
      <header><b class="fx-lightbox-title"></b><span class="fx-lightbox-count"></span><button type="button" class="fx-lightbox-close" aria-label="Close gallery">×</button></header>
      <div class="fx-lightbox-stage" tabindex="0"></div>
      <nav class="fx-lightbox-thumbs" aria-label="Gallery photos"></nav>
      <footer><button type="button" class="fx-lightbox-prev" aria-label="Previous photo">‹</button><button type="button" class="fx-lightbox-next" aria-label="Next photo">›</button><button type="button" class="fx-lightbox-save">↓ Save photo</button></footer>
    </div>`;
    document.body.append(lightboxLayer);
    lightboxLayer.addEventListener('click', event => {
      const {items, index} = lightboxState;
      if (event.target === lightboxLayer || event.target.closest('.fx-lightbox-close')) { lightboxLayer.classList.remove('open'); return; }
      const thumb = event.target.closest('[data-fx-lightbox-index]');
      if (thumb) { lightboxState.index = Number(thumb.dataset.fxLightboxIndex) || 0; renderLightbox(); return; }
      if (event.target.closest('.fx-lightbox-prev') && index > 0) { lightboxState.index--; renderLightbox(); return; }
      if (event.target.closest('.fx-lightbox-next') && index < items.length - 1) { lightboxState.index++; renderLightbox(); return; }
      if (event.target.closest('.fx-lightbox-save')) {
        const item = items[lightboxState.index];
        if (item) save(item.url, item.name || `frnxup-${index + 1}.${item.type === 'video' ? 'mp4' : 'jpg'}`);
      }
    });
    const stage = lightboxLayer.querySelector('.fx-lightbox-stage');
    let startX = 0, startY = 0;
    stage.addEventListener('pointerdown', event => { startX = event.clientX; startY = event.clientY; });
    stage.addEventListener('pointerup', event => {
      const dx = event.clientX - startX, dy = event.clientY - startY;
      if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
      if (dx < 0 && lightboxState.index < lightboxState.items.length - 1) lightboxState.index++;
      if (dx > 0 && lightboxState.index > 0) lightboxState.index--;
      renderLightbox();
    });
    document.addEventListener('keydown', event => {
      if (!lightboxLayer?.classList.contains('open')) return;
      if (event.key === 'Escape') lightboxLayer.classList.remove('open');
      if (event.key === 'ArrowLeft' && lightboxState.index > 0) { lightboxState.index--; renderLightbox(); }
      if (event.key === 'ArrowRight' && lightboxState.index < lightboxState.items.length - 1) { lightboxState.index++; renderLightbox(); }
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

  function renderCarousel(root, index) {
    const key = root?.dataset.fxPhotoCarousel;
    const items = galleries.get(String(key)) || [];
    if (!root || !items.length) return;
    const selected = Math.max(0, Math.min(Number(index) || 0, items.length - 1));
    root.dataset.fxPhotoIndex = String(selected);
    const item = items[selected];
    const image = root.querySelector('[data-fx-photo-main]');
    if (image && image.src !== item.url) image.src = item.url;
    if (image) image.alt = `Photo ${selected + 1} of ${items.length}`;
    const count = root.querySelector('.fx-photo-count');
    if (count) count.textContent = `${selected + 1} / ${items.length}`;
    const stage = root.querySelector('[data-fx-photo-stage]');
    if (stage) stage.setAttribute('aria-label', `Photo ${selected + 1} of ${items.length}`);
    root.querySelectorAll('[data-fx-photo-index]').forEach(button => {
      const active = Number(button.dataset.fxPhotoIndex) === selected;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'true' : 'false');
    });
    const previous = root.querySelector('[data-fx-photo-action="prev"]');
    const next = root.querySelector('[data-fx-photo-action="next"]');
    if (previous) previous.disabled = selected === 0;
    if (next) next.disabled = selected === items.length - 1;
    root.querySelector('.fx-photo-thumbs [data-fx-photo-index].active')?.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'smooth'});
  }
  function carousel(items, key, title = 'Photos in post') {
    const clean = (items || []).filter(item => item?.url && item.type !== 'video');
    if (!clean.length) return '';
    galleries.set(String(key), clean);
    const thumbnails = clean.map((item, index) => `<button type="button" class="fx-photo-thumb ${index === 0 ? 'active' : ''}" data-fx-photo-index="${index}" aria-label="Show photo ${index + 1}" aria-current="${index === 0 ? 'true' : 'false'}"><img loading="lazy" decoding="async" src="${esc(item.url)}" alt=""></button>`).join('');
    return `<section class="fx-photo-carousel" data-fx-photo-carousel="${esc(key)}" data-fx-photo-index="0" data-gallery-title="${esc(title)}" aria-label="Post photo gallery">
      <div class="fx-photo-stage" data-fx-photo-stage tabindex="0" role="group" aria-roledescription="carousel" aria-label="Photo 1 of ${clean.length}">
        <img data-fx-photo-main src="${esc(clean[0].url)}" alt="Photo 1 of ${clean.length}" decoding="async">
        <span class="fx-photo-count" aria-live="polite">1 / ${clean.length}</span>
        <button type="button" class="fx-photo-arrow fx-photo-prev" data-fx-photo-action="prev" aria-label="Previous photo" disabled>‹</button>
        <button type="button" class="fx-photo-arrow fx-photo-next" data-fx-photo-action="next" aria-label="Next photo" ${clean.length < 2 ? 'disabled' : ''}>›</button>
        <button type="button" class="fx-photo-fullscreen" data-fx-photo-action="fullscreen" aria-label="Open full-screen photo gallery">⛶</button>
      </div>
      ${clean.length > 1 ? `<div class="fx-photo-thumbs" aria-label="Choose a photo">${thumbnails}</div><div class="fx-photo-hint"><span aria-hidden="true">ⓘ</span> Swipe left or right to view all ${clean.length} photos</div>` : ''}
    </section>`;
  }
  function collage(items, key, title = 'Post photos') {
    const clean = (items || []).filter(item => item?.url);
    if (!clean.length) return '';
    galleries.set(String(key), clean);
    const visible = clean.slice(0, 4);
    const countClass = clean.length === 1 ? 'one' : clean.length === 2 ? 'two' : clean.length === 3 ? 'three' : 'four';
    const videoClass = clean.length === 1 && clean[0].type === 'video' ? 'fx-single-video' : '';
    return `<div class="fx-collage ${countClass} ${videoClass}" data-gallery-title="${esc(title)}">${visible.map((item, index) => {
      const media = item.type === 'video'
        ? `<video class="fx-inline-post-video" src="${esc(item.url)}" muted autoplay controls playsinline preload="metadata" aria-label="Post video. Use controls to pause or turn sound on."></video>`
        : `<img loading="lazy" src="${esc(item.url)}" alt="Photo ${index + 1}">`;
      const more = index === 3 && clean.length > 4 ? `<span class="fx-collage-more">+${clean.length - 4}</span>` : '';
      if (item.type === 'video') return `<div class="fx-collage-tile fx-video-tile" data-fx-gallery="${esc(key)}" data-fx-index="${index}">${media}${more}</div>`;
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
        note.textContent = 'After publishing, photos appear in a swipeable gallery with thumbnails. Select up to 20 photos.';
        panel.append(note);
      }
    });
  }

  let swipeState = null;
  document.addEventListener('pointerdown', event => {
    const stage = event.target.closest('[data-fx-photo-stage]');
    if (stage && event.pointerType !== 'mouse') swipeState = {stage, x: event.clientX, y: event.clientY};
  }, {passive: true});
  document.addEventListener('pointerup', event => {
    if (!swipeState) return;
    const {stage, x, y} = swipeState; swipeState = null;
    const dx = event.clientX - x, dy = event.clientY - y;
    if (Math.abs(dx) < 42 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    const current = Number(stage.closest('[data-fx-photo-carousel]')?.dataset.fxPhotoIndex || 0);
    renderCarousel(stage.closest('[data-fx-photo-carousel]'), current + (dx < 0 ? 1 : -1));
  }, {passive: true});
  document.addEventListener('click', event => {
    const photoAction = event.target.closest('[data-fx-photo-action]');
    if (photoAction) {
      event.preventDefault(); event.stopPropagation();
      const root = photoAction.closest('[data-fx-photo-carousel]');
      const key = root?.dataset.fxPhotoCarousel;
      const index = Number(root?.dataset.fxPhotoIndex || 0);
      if (photoAction.dataset.fxPhotoAction === 'prev') renderCarousel(root, index - 1);
      else if (photoAction.dataset.fxPhotoAction === 'next') renderCarousel(root, index + 1);
      else if (photoAction.dataset.fxPhotoAction === 'fullscreen') openGallery(key, index, root?.dataset.galleryTitle || 'Photo gallery');
      return;
    }
    const thumb = event.target.closest('[data-fx-photo-index]');
    if (thumb && thumb.closest('[data-fx-photo-carousel]')) {
      event.preventDefault();
      renderCarousel(thumb.closest('[data-fx-photo-carousel]'), Number(thumb.dataset.fxPhotoIndex));
      return;
    }
    const stage = event.target.closest('[data-fx-photo-stage]');
    if (stage && !event.target.closest('button')) {
      const root = stage.closest('[data-fx-photo-carousel]');
      openGallery(root?.dataset.fxPhotoCarousel, Number(root?.dataset.fxPhotoIndex || 0), root?.dataset.galleryTitle || 'Photo gallery');
      return;
    }
    const tile = event.target.closest('[data-fx-gallery]');
    if (tile) {
      if (event.target.closest('.fx-inline-post-video')) return;
      openGallery(tile.dataset.fxGallery, Number(tile.dataset.fxIndex), tile.closest('.fx-collage')?.dataset.galleryTitle || 'Photo gallery');
      return;
    }
    const saveButton = event.target.closest('[data-fx-save-gallery]');
    if (saveButton) {
      const items = galleries.get(saveButton.dataset.fxSaveGallery) || [];
      if (items.length === 1) save(items[0].url, items[0].name || 'frnxup-photo.jpg');
      else openGallery(saveButton.dataset.fxSaveGallery, 0, 'Save each photo from the preview');
    }
  });
  document.addEventListener('keydown', event => {
    const stage = event.target.closest?.('[data-fx-photo-stage]');
    if (!stage || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const root = stage.closest('[data-fx-photo-carousel]');
    renderCarousel(root, Number(root?.dataset.fxPhotoIndex || 0) + (event.key === 'ArrowRight' ? 1 : -1));
  });

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('input[type="file"]').forEach(buildPreview);
  });
  window.addEventListener('pagehide', () => {
    document.querySelectorAll('.fx-upload-preview').forEach(panel => (panel._fxObjectUrls || []).forEach(url => URL.revokeObjectURL(url)));
  });

  window.FXMediaTools = {save, collage, carousel, openGallery, galleries};
})();
