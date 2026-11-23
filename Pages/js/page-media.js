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
    mentions: ['Mentions', `Public posts that mention this Page using @${params.get('slug') || 'its page slug'}.`]
  };

  const bodyFilter = document.body?.dataset.pageMediaFilter;
  let filter = aliases[bodyFilter || params.get('filter') || 'all'] || bodyFilter || params.get('filter') || 'all';
  if (!routeFiles[filter]) filter = 'all';

  const host = $('#page-media-list');
  const back = $('#page-media-back');
  let page = null;
  let ownerView = false;

  function routeFor(name) {
    const file = routeFiles[name] || routeFiles.all;
    const key = ownerView ? `id=${encodeURIComponent(page.id)}` : `slug=${encodeURIComponent(page.slug)}`;
    return `/Pages/${file}?${key}`;
  }

  function setMessage(message, isError = false) {
    host.innerHTML = `<div class="pages-empty${isError ? ' page-media-error' : ''}">${esc(message)}</div>`;
  }

  function updateNavigation() {
    const [title, description] = labels[filter];
    $('#page-media-title').textContent = `${page.name} · ${title}`;
    $('#page-media-description').textContent = filter === 'mentions'
      ? `Public posts that mention @${page.slug}.`
      : description;
    $('#page-media-slug').textContent = `@${page.slug}`;
    const avatar = $('#page-media-avatar');
    if (page.avatar_path && avatar) {
      FX.mediaUrl(page.avatar_path).then((url) => {
        if (url) avatar.innerHTML = `<img src="${esc(url)}" alt="${esc(page.name)}">`;
      }).catch(() => {});
    } else if (avatar) {
      avatar.textContent = (page.name || 'F').slice(0, 1).toUpperCase();
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

  async function resolvePage() {
    if (!FX.client) throw new Error('Frnxup database connection is unavailable. Refresh and try again.');
    await FX.loadUser();

    let requestedId = params.get('id');
    const requestedSlug = params.get('slug');
    let usedActivePageFallback = false;

    // Older dashboard bookmarks sometimes omit the query parameter. Recover the
    // last Page selected in the owner dashboard, then verify it belongs to this user.
    if (!requestedId && !requestedSlug) {
      requestedId = FX.activePageId?.() || null;
      usedActivePageFallback = !!requestedId;
    }
    if (!requestedId && !requestedSlug) {
      throw new Error('This Page link is missing its Page ID or slug. Open the media section from the Page dashboard again.');
    }

    let query = FX.client.from('frnxup_pages').select('id,owner_user_id,name,slug,category,avatar_path,cover_path,status').eq('status', 'active');
    query = requestedSlug ? query.eq('slug', requestedSlug) : query.eq('id', requestedId);
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(`Unable to load this Page: ${error.message}`);
    if (!data) throw new Error('Page not found or unavailable. Check the Page link and try again.');

    const isOwner = !!FX.user && FX.user.id === data.owner_user_id;
    if (usedActivePageFallback && !isOwner) {
      throw new Error('The saved active Page is not owned by this account. Open the correct Page dashboard and try again.');
    }
    page = data;
    ownerView = isOwner;
    if (ownerView) FX.setActivePage?.(page.id);
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
      // Match the same @slug convention used by the Page's Review posts and tags screen.
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
        ? `<video class="page-media-content" controls autoplay muted loop playsinline preload="metadata" src="${esc(item.url)}" aria-label="Page Reel"></video>`
        : `<img class="page-media-content" loading="lazy" decoding="async" src="${esc(item.url)}" alt="Photo published by ${esc(page.name)}">`
      ).join('');

      // Photos/Reels show only matching media. All/Mentions also preserve text-only posts.
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
      setMessage('Loading Page media…');
      await resolvePage();
      updateNavigation();
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
