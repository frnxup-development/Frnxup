(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const esc = (value) => FX.esc(String(value ?? ''));
  const params = new URLSearchParams(location.search);
  const aliases = { videos: 'reels', reel: 'reels', mention: 'mentions' };
  const routeFiles = { all: 'all.html', photos: 'photos.html', reels: 'reels.html', mentions: 'mentions.html' };
  const labels = {
    all: ['All', 'All posts published by this Page, including text, photos and videos.'],
    photos: ['Photos', 'Photographs published by this Page.'],
    reels: ['Reels', 'Video posts published by this Page. Videos start muted; use the player controls to unmute.'],
    mentions: ['Mentions', 'Public posts that mention this Page using its @slug.']
  };

  const requestedFilter = document.body?.dataset.pageMediaFilter || params.get('filter') || 'all';
  let filter = aliases[requestedFilter] || requestedFilter;
  if (!routeFiles[filter]) filter = 'all';

  const host = $('#page-media-list');
  const back = $('#page-media-back');
  let page = null;
  let ownerView = false;

  function readStoredSlug() {
    try { return localStorage.getItem('frnxup_last_public_page_slug') || ''; } catch (_) { return ''; }
  }

  function rememberPage() {
    try {
      if (page?.slug) localStorage.setItem('frnxup_last_public_page_slug', page.slug);
      if (page?.id) localStorage.setItem('frnxup_last_page_id', page.id);
    } catch (_) { /* Storage is optional; route links still carry their own identifier. */ }
  }

  function routeFor(name) {
    const file = routeFiles[name] || routeFiles.all;
    const key = ownerView ? `id=${encodeURIComponent(page.id)}` : `slug=${encodeURIComponent(page.slug)}`;
    return `/Pages/${file}?${key}`;
  }

  function setMessage(message, isError = false) {
    host.innerHTML = `<div class="pages-empty${isError ? ' page-media-error' : ''}">${esc(message)}</div>`;
  }

  async function setHeaderImage(selector, path, alt) {
    const image = $(selector);
    if (!image) return;
    image.hidden = true;
    image.removeAttribute('src');
    if (!path) return;
    try {
      const url = await FX.mediaUrl(path);
      if (!url) return;
      image.alt = alt || '';
      image.onload = () => { image.hidden = false; };
      image.onerror = () => { image.hidden = true; };
      image.src = url;
      if (image.complete && image.naturalWidth > 0) image.hidden = false;
    } catch (_) { image.hidden = true; }
  }

  async function updateNavigation() {
    const [title, description] = labels[filter];
    $('#page-media-title').textContent = `${page.name} · ${title}`;
    $('#page-media-description').textContent = filter === 'mentions'
      ? `Public posts that mention @${page.slug}.`
      : description;
    $('#page-media-slug').textContent = `@${page.slug}`;

    const avatar = $('#page-media-avatar');
    if (avatar) {
      avatar.textContent = (page.name || 'F').slice(0, 1).toUpperCase();
      if (page.avatar_path) {
        try {
          const url = await FX.mediaUrl(page.avatar_path);
          if (url) {
            const img = document.createElement('img');
            img.src = url;
            img.alt = page.name;
            img.loading = 'eager';
            img.onerror = () => { avatar.textContent = (page.name || 'F').slice(0, 1).toUpperCase(); };
            avatar.replaceChildren(img);
          }
        } catch (_) { /* Keep the Page initial as a safe fallback. */ }
      }
    }
    await setHeaderImage('#page-media-cover-image', page.cover_path, `${page.name} cover`);

    const profileLink = $('#page-media-profile');
    if (profileLink) {
      profileLink.href = `/Pages/view.html?slug=${encodeURIComponent(page.slug)}`;
      profileLink.hidden = false;
    }
    if (back) {
      back.href = ownerView
        ? `/Pages/dashboard.html?id=${encodeURIComponent(page.id)}`
        : `/Pages/view.html?slug=${encodeURIComponent(page.slug)}`;
      back.textContent = ownerView ? '‹ Page dashboard' : '‹ Public Page';
    }
    document.querySelectorAll('[data-page-media-route]').forEach((link) => {
      const key = link.dataset.pageMediaRoute;
      link.href = routeFor(key);
      link.classList.toggle('active', key === filter);
      link.setAttribute('aria-current', key === filter ? 'page' : 'false');
    });
  }

  async function loadPageById(id) {
    return FX.client.from('frnxup_pages')
      .select('id,owner_user_id,name,slug,category,avatar_path,cover_path,status')
      .eq('status', 'active').eq('id', id).maybeSingle();
  }

  async function loadPageBySlug(slug) {
    return FX.client.from('frnxup_pages')
      .select('id,owner_user_id,name,slug,category,avatar_path,cover_path,status')
      .eq('status', 'active').eq('slug', slug).maybeSingle();
  }

  async function resolvePage() {
    if (!FX.client) throw new Error('Frnxup database connection is unavailable. Refresh and try again.');
    await FX.loadUser();

    let requestedId = params.get('id') || params.get('page_id');
    let requestedSlug = params.get('slug') || params.get('page_slug');
    let usedActivePageFallback = false;
    const rememberedSlug = readStoredSlug();
    let fallbackSlug = rememberedSlug;
    if (!fallbackSlug) {
      try {
        const referrer = new URL(document.referrer);
        if (referrer.pathname.endsWith('/Pages/view.html')) fallbackSlug = referrer.searchParams.get('slug') || '';
      } catch (_) { /* No usable referrer. */ }
    }

    // Opened media links should always carry an ID or slug. These fallbacks
    // recover older bookmarks that did not retain the Page identifier.
    if (!requestedId && !requestedSlug) {
      requestedId = FX.activePageId?.() || null;
      usedActivePageFallback = !!requestedId;
      if (!requestedId) requestedSlug = fallbackSlug;
    }
    if (!requestedId && !requestedSlug) {
      throw new Error('This media link has no Page ID or slug. Open the Page first, then choose All, Reels or Mentions.');
    }

    let result = requestedSlug ? await loadPageBySlug(requestedSlug) : await loadPageById(requestedId);
    if (result.error) throw new Error(`Unable to load this Page: ${result.error.message}`);

    // A stale active-owner ID can exist on a shared device. In that case,
    // recover the last public Page slug rather than opening the wrong Page.
    if (usedActivePageFallback && result.data && FX.user?.id !== result.data.owner_user_id && fallbackSlug) {
      result = await loadPageBySlug(fallbackSlug);
      if (result.error) throw new Error(`Unable to load this Page: ${result.error.message}`);
      usedActivePageFallback = false;
    }
    if (!result.data && requestedId && fallbackSlug) {
      result = await loadPageBySlug(fallbackSlug);
      if (result.error) throw new Error(`Unable to load this Page: ${result.error.message}`);
      usedActivePageFallback = false;
    }
    if (!result.data) throw new Error('Page not found or unavailable. Check the Page link and try again.');

    page = result.data;
    ownerView = !!FX.user && FX.user.id === page.owner_user_id;
    if (usedActivePageFallback && !ownerView) {
      throw new Error('The saved active Page is not owned by this account. Open the public Page link and try again.');
    }
    if (ownerView) FX.setActivePage?.(page.id);
    rememberPage();
  }

  async function getMediaByPost(posts) {
    const ids = posts.map((post) => post.id);
    const byPost = new Map();
    if (ids.length) {
      const { data, error } = await FX.client
        .from('post_media')
        .select('post_id,media_path,media_type,sort_order')
        .in('post_id', ids)
        .order('sort_order', { ascending: true });
      if (error) throw new Error(`Unable to load post media: ${error.message}`);
      (data || []).forEach((item) => {
        if (!byPost.has(item.post_id)) byPost.set(item.post_id, []);
        byPost.get(item.post_id).push(item);
      });
    }
    posts.forEach((post) => {
      if (!byPost.has(post.id) && post.media_path) {
        byPost.set(post.id, [{
          post_id: post.id,
          media_path: post.media_path,
          media_type: post.media_type || 'image',
          sort_order: 1
        }]);
      }
    });
    return byPost;
  }

  async function queryPosts() {
    let query = FX.client.from('posts')
      .select('id,user_id,page_id,body,media_path,media_type,visibility,status,created_at')
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .limit(100);

    if (filter === 'mentions') {
      query = query.is('page_id', null)
        .eq('visibility', 'public')
        .ilike('body', `%@${page.slug}%`);
    } else {
      query = query.eq('page_id', page.id);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Unable to load ${labels[filter][0].toLowerCase()}: ${error.message}`);
    return data || [];
  }

  async function renderPosts(posts) {
    if (!posts.length) {
      const messages = {
        all: 'This Page has not published any posts yet.',
        photos: 'This Page has not published any photos yet.',
        reels: 'This Page has not published any Reels yet.',
        mentions: `No public posts mentioning @${page.slug} were found yet.`
      };
      setMessage(messages[filter]);
      return;
    }

    const byPost = await getMediaByPost(posts);
    const flatMedia = [...byPost.values()].flat();
    const signedUrls = await Promise.all(flatMedia.map((item) => FX.mediaUrl(item.media_path)));
    const urlByPath = new Map(flatMedia.map((item, index) => [item.media_path, signedUrls[index]]));

    const userIds = [...new Set(posts.map((post) => post.user_id).filter(Boolean))];
    let profilesById = new Map();
    if (userIds.length) {
      const { data: profiles, error } = await FX.client.from('profiles')
        .select('id,username,display_name')
        .in('id', userIds);
      if (!error) profilesById = new Map((profiles || []).map((profile) => [profile.id, profile]));
    }

    const cards = [];
    for (const post of posts) {
      let media = (byPost.get(post.id) || []).map((item) => ({
        url: urlByPath.get(item.media_path),
        type: item.media_type === 'video' ? 'video' : 'image'
      })).filter((item) => item.url);

      if (filter === 'photos') media = media.filter((item) => item.type === 'image');
      if (filter === 'reels') media = media.filter((item) => item.type === 'video');

      const profile = profilesById.get(post.user_id) || {};
      const author = filter === 'mentions'
        ? (profile.display_name || profile.username || 'Frnxup member')
        : page.name;
      const mediaMarkup = media.map((item) => item.type === 'video'
        ? `<video class="page-media-content" controls playsinline preload="metadata" src="${esc(item.url)}" aria-label="Page Reel"></video>`
        : `<img class="page-media-content" loading="lazy" decoding="async" src="${esc(item.url)}" alt="Photo published by ${esc(page.name)}">`
      ).join('');

      if ((filter === 'photos' || filter === 'reels') && !media.length) continue;
      if (!media.length && !post.body) continue;
      const bodyText = post.body ? `<p class="page-media-post-text">${esc(post.body)}</p>` : '';
      cards.push(`<article class="page-media-item" data-post-id="${esc(post.id)}">
        <div class="page-media-post-head"><b>${esc(author)}</b><small>${filter === 'mentions' ? `Mentioned @${esc(page.slug)}` : 'Frnxup Page'} · ${esc(FX.relative(post.created_at))}</small></div>
        ${bodyText}${mediaMarkup ? `<div class="page-media-post-assets">${mediaMarkup}</div>` : ''}
      </article>`);
    }

    if (!cards.length) {
      setMessage(filter === 'photos' ? 'No photos are available for this Page yet.' : 'No Reels are available for this Page yet.');
      return;
    }
    host.innerHTML = cards.join('');
  }

  async function init() {
    try {
      setMessage('Loading Page content…');
      await resolvePage();
      await updateNavigation();
      document.body.classList.add('fx-page-media-ready');
      const posts = await queryPosts();
      await renderPosts(posts);
    } catch (error) {
      setMessage(error?.message || 'Unable to load Page media.', true);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
