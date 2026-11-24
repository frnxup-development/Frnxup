(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = value => FX.esc(String(value ?? ''));
  const params = new URLSearchParams(location.search);
  const grid = $('#profile-reels-grid');
  const modal = $('#profile-reel-modal');
  const fileInput = $('#profile-reel-file');
  const preview = $('#profile-reel-preview');
  const previewWrap = $('#profile-reel-preview-wrap');
  const captionInput = $('#profile-reel-caption');
  const publishButton = $('#profile-reel-publish');
  const message = $('#profile-reel-message');
  let profile = null;
  let profileId = params.get('id');
  let ownProfile = false;
  let activeFilter = 'all';
  let objectUrl = null;
  let uploadBusy = false;

  function stateLoading() {
    grid.innerHTML = '<div class="fx-profile-reels-state"><span class="fx-profile-reels-spinner"></span><b>Loading profile media…</b></div>';
  }

  function stateEmpty(title, description, showUpload = false) {
    grid.innerHTML = `<div class="fx-profile-reels-state"><h2>${esc(title)}</h2><p>${esc(description)}</p>${showUpload ? '<button type="button" id="profile-reels-empty-upload">＋ Upload your first Reel</button>' : ''}</div>`;
    $('#profile-reels-empty-upload')?.addEventListener('click', openUpload);
  }

  function formatCount(value) {
    const n = Number(value || 0);
    if (n >= 1000000) return `${(n / 1000000).toFixed(n >= 10000000 ? 0 : 1).replace(/\.0$/, '')}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}K`;
    return String(n);
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '';
    const total = Math.floor(seconds);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  async function loadProfile() {
    const user = await FX.loadUser();
    if (!user) {
      const next = `${location.pathname}${location.search}`;
      location.replace(`/Auth/index.html?next=${encodeURIComponent(next)}`);
      throw new Error('Please sign in to view profile media.');
    }
    if (!profileId) profileId = user.id;
    ownProfile = user.id === profileId;

    const { data, error } = await FX.client.from('profiles')
      .select('id,username,display_name,bio,avatar_path,cover_path,account_status')
      .eq('id', profileId).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('This profile could not be found or is not available.');
    profile = data;
    document.title = `${profile.display_name || profile.username || 'Member'} · Reels · Frnxup`;
    $('#profile-reels-name').textContent = profile.display_name || profile.username || 'Frnxup member';
    $('#profile-reels-handle').textContent = profile.username ? `@${profile.username}` : 'Frnxup member';
    $('#profile-reels-avatar').textContent = (profile.display_name || profile.username || 'F').slice(0, 1).toUpperCase();
    if (profile.avatar_path) {
      const avatar = await FX.mediaUrl(profile.avatar_path);
      if (avatar) $('#profile-reels-avatar').innerHTML = `<img src="${esc(avatar)}" alt="${esc(profile.display_name || 'Profile photo')}">`;
    }
    if (profile.cover_path) {
      const cover = await FX.mediaUrl(profile.cover_path);
      if (cover) $('#profile-reels-cover').style.backgroundImage = `url("${cover.replace(/"/g, '%22')}")`;
    }

    $('#profile-reels-back').href = `/Dashboard/profile.html?id=${encodeURIComponent(profileId)}`;
    $('#profile-reels-upload').hidden = !ownProfile;
    $('#profile-reels-edit').hidden = !ownProfile;
    $('#profile-reels-follow').hidden = ownProfile;
    if (!ownProfile) await syncFollowState();
    await loadFollowCounts();
  }

  async function loadFollowCounts() {
    const { data, error } = await FX.client.rpc('frnxup_user_follow_counts', { p_profile_id: profileId });
    if (error) {
      $('#profile-reels-followers').textContent = '—';
      $('#profile-reels-following').textContent = '—';
      console.warn('Profile follow counts unavailable:', error.message);
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    $('#profile-reels-followers').textContent = formatCount(row?.followers || 0);
    $('#profile-reels-following').textContent = formatCount(row?.following || 0);
  }

  async function syncFollowState() {
    if (!FX.user || !profileId) return;
    const { data, error } = await FX.client.from('user_follows')
      .select('follower_id').eq('follower_id', FX.user.id).eq('following_id', profileId).maybeSingle();
    if (error) { console.warn('Follow status unavailable:', error.message); return; }
    const button = $('#profile-reels-follow');
    button.dataset.following = data ? 'true' : 'false';
    button.textContent = data ? 'Following ✓' : 'Follow';
    button.classList.toggle('following', !!data);
  }

  async function toggleFollow() {
    const button = $('#profile-reels-follow');
    if (!FX.user || !profileId || ownProfile) return;
    const following = button.dataset.following === 'true';
    button.disabled = true;
    try {
      const result = following
        ? await FX.client.from('user_follows').delete().eq('follower_id', FX.user.id).eq('following_id', profileId)
        : await FX.client.from('user_follows').insert({ follower_id: FX.user.id, following_id: profileId });
      if (result.error && result.error.code !== '23505') throw result.error;
      button.dataset.following = following ? 'false' : 'true';
      button.textContent = following ? 'Follow' : 'Following ✓';
      button.classList.toggle('following', !following);
      await loadFollowCounts();
    } catch (error) {
      FX.toast(error.message || 'Your follow status could not be updated.');
    } finally { button.disabled = false; }
  }

  function setActiveTab(filter) {
    activeFilter = filter;
    $$('[data-profile-filter]').forEach(button => {
      const active = button.dataset.profileFilter === filter;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    loadGrid(filter);
  }

  async function loadGrid(filter = activeFilter) {
    stateLoading();
    try {
      let query = FX.client.from('posts')
        .select('id,user_id,body,media_path,media_type,visibility,created_at')
        .eq('status', 'published')
        .order('created_at', { ascending: false })
        .limit(100);
      if (filter === 'mentions') {
        const username = String(profile.username || '').replace(/[\\%_]/g, '\\$&');
        if (!username) { stateEmpty('No mentions yet', 'This profile does not have a username to search for.'); return; }
        query = query.is('page_id', null).eq('visibility', 'public').neq('user_id', profileId).ilike('body', `%@${username}%`);
      } else {
        query = query.eq('user_id', profileId).is('page_id', null);
      }
      const { data: posts, error } = await query;
      if (error) throw error;
      if (!posts?.length) {
        const messages = {
          all: ['No posts yet', 'This profile has not shared any posts yet.'],
          photos: ['No photos yet', 'Photos shared by this member will appear here.'],
          reels: ['No Reels yet', 'Short videos shared by this member will appear here.'],
          mentions: ['No mentions yet', `Public posts mentioning @${profile.username || 'this member'} will appear here.`]
        };
        stateEmpty(messages[filter][0], messages[filter][1], ownProfile && filter === 'reels');
        return;
      }

      const postIds = posts.map(post => post.id);
      const { data: mediaRows, error: mediaError } = postIds.length
        ? await FX.client.from('post_media').select('post_id,media_path,media_type,sort_order').in('post_id', postIds).order('sort_order', { ascending: true })
        : { data: [], error: null };
      if (mediaError) throw mediaError;
      const mediaByPost = new Map();
      (mediaRows || []).forEach(row => {
        if (!mediaByPost.has(row.post_id)) mediaByPost.set(row.post_id, []);
        mediaByPost.get(row.post_id).push(row);
      });
      posts.forEach(post => {
        if (!mediaByPost.has(post.id) && post.media_path) mediaByPost.set(post.id, [{ post_id: post.id, media_path: post.media_path, media_type: post.media_type || 'image', sort_order: 1 }]);
      });

      const prepared = posts.map(post => {
        const media = mediaByPost.get(post.id) || [];
        const selected = filter === 'photos' ? media.find(item => item.media_type === 'image')
          : filter === 'reels' ? media.find(item => item.media_type === 'video')
            : media.find(item => item.media_type === 'video' || item.media_type === 'image');
        if (filter === 'photos' && !selected) return null;
        if (filter === 'reels' && !selected) return null;
        return { ...post, selected };
      }).filter(Boolean);

      if (!prepared.length) {
        const label = filter === 'photos' ? 'No photos yet' : 'No Reels yet';
        stateEmpty(label, filter === 'photos' ? 'Photos shared by this member will appear here.' : 'Short videos shared by this member will appear here.', ownProfile && filter === 'reels');
        return;
      }

      const paths = prepared.map(item => item.selected?.media_path).filter(Boolean);
      const urls = await Promise.all(paths.map(path => FX.mediaUrl(path)));
      const urlByPath = new Map(paths.map((path, index) => [path, urls[index]]));
      const reelIds = prepared.filter(item => item.selected?.media_type === 'video').map(item => item.id);
      let viewCounts = new Map();
      if (reelIds.length) {
        const { data: views, error: viewError } = await FX.client.from('frnxup_reel_views').select('post_id').in('post_id', reelIds);
        if (!viewError) (views || []).forEach(view => viewCounts.set(view.post_id, (viewCounts.get(view.post_id) || 0) + 1));
      }

      grid.innerHTML = prepared.map(post => {
        const media = post.selected;
        const url = media ? urlByPath.get(media.media_path) : '';
        const isVideo = media?.media_type === 'video';
        const caption = String(post.body || '').trim();
        const mediaNode = url
          ? (isVideo
            ? `<video src="${esc(url)}" muted playsinline preload="metadata" data-duration-for="${esc(post.id)}" aria-label="Reel preview"></video><span class="fx-profile-reel-play" aria-hidden="true">▶</span><span class="fx-profile-reel-duration" data-duration-label="${esc(post.id)}">Reel</span><span class="fx-profile-reel-views">▶ ${formatCount(viewCounts.get(post.id) || 0)} views</span>`
            : `<img src="${esc(url)}" loading="lazy" decoding="async" alt="Photo shared by ${esc(profile.display_name || profile.username)}">`)
          : `<span class="fx-profile-reel-text">${esc(caption || 'Frnxup update')}</span>`;
        const captionNode = caption && url ? `<span class="fx-profile-reel-caption">${esc(caption)}</span>` : '';
        return `<button class="fx-profile-reel-tile" type="button" data-open-post="${esc(post.id)}" data-is-reel="${isVideo ? 'true' : 'false'}" aria-label="${isVideo ? 'Watch Reel' : 'Open post'}: ${esc(caption || 'Profile post')}">${mediaNode}${captionNode}</button>`;
      }).join('');
      grid.querySelectorAll('video[data-duration-for]').forEach(video => {
        const durationLabel = $(`[data-duration-label="${CSS.escape(video.dataset.durationFor)}"]`, grid);
        const applyDuration = () => {
          const duration = formatDuration(video.duration);
          if (durationLabel && duration) durationLabel.textContent = duration;
          if (video.currentTime === 0 && video.duration > 0) {
            try { video.currentTime = Math.min(0.1, video.duration / 2); } catch (_) { /* Browser may defer seeking until data is ready. */ }
          }
        };
        video.addEventListener('loadedmetadata', applyDuration, { once: true });
        if (video.readyState >= 1) applyDuration();
      });
    } catch (error) {
      console.error('Profile media load failed:', error);
      grid.innerHTML = `<div class="fx-profile-reels-state"><h2>Profile media could not load</h2><p>${esc(error.message || 'Check your connection and try again.')}</p><button type="button" id="profile-reels-retry">Try again</button></div>`;
      $('#profile-reels-retry')?.addEventListener('click', () => loadGrid(filter));
    }
  }

  function openUpload() {
    if (!ownProfile) return;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    message.textContent = '';
    fileInput.focus({ preventScroll: true });
  }

  function closeUpload() {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    preview.removeAttribute('src');
    preview.load();
    previewWrap.hidden = true;
    fileInput.value = '';
    captionInput.value = '';
    publishButton.disabled = true;
    publishButton.textContent = 'Share Reel';
    message.textContent = '';
    uploadBusy = false;
  }

  async function publishReel() {
    if (uploadBusy) return;
    const file = fileInput.files?.[0];
    if (!file || !['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type)) {
      message.textContent = 'Choose an MP4, WebM or MOV video file.';
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      message.textContent = 'This video is larger than the 100 MB upload limit.';
      return;
    }
    uploadBusy = true;
    publishButton.disabled = true;
    publishButton.textContent = 'Uploading…';
    message.textContent = 'Uploading your video securely…';
    let path = null;
    let postId = null;
    try {
      path = await FX.upload(file, 'posts');
      const caption = captionInput.value.trim();
      const { data: post, error } = await FX.client.from('posts').insert({
        user_id: FX.user.id,
        page_id: null,
        body: caption,
        media_path: path,
        media_type: 'video',
        visibility: 'public'
      }).select('id').single();
      if (error) throw error;
      postId = post.id;
      const { error: mediaError } = await FX.client.from('post_media').insert({ post_id: postId, media_path: path, media_type: 'video', sort_order: 1 });
      if (mediaError) throw mediaError;
      FX.toast('Your Reel is now published.');
      closeUpload();
      setActiveTab('reels');
    } catch (error) {
      if (postId) await FX.client.from('posts').delete().eq('id', postId).eq('user_id', FX.user.id);
      if (path) await FX.client.storage.from('frnxup-media').remove([path]);
      message.textContent = error?.message || 'Your Reel could not be published.';
      publishButton.disabled = false;
      publishButton.textContent = 'Try again';
      uploadBusy = false;
    }
  }

  grid.addEventListener('click', event => {
    const tile = event.target.closest('[data-open-post]');
    if (!tile) return;
    const postId = tile.dataset.openPost;
    location.href = tile.dataset.isReel === 'true'
      ? `/Reels/index.html?post=${encodeURIComponent(postId)}`
      : `/Posts/view.html?id=${encodeURIComponent(postId)}`;
  });
  $$('[data-profile-filter]').forEach(button => button.addEventListener('click', () => setActiveTab(button.dataset.profileFilter)));
  $('#profile-reels-upload').addEventListener('click', openUpload);
  $('#profile-reels-follow').addEventListener('click', toggleFollow);
  $('#profile-reel-close').addEventListener('click', closeUpload);
  modal.addEventListener('click', event => { if (event.target === modal) closeUpload(); });
  publishButton.addEventListener('click', publishReel);
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    preview.removeAttribute('src');
    previewWrap.hidden = true;
    publishButton.disabled = true;
    message.textContent = '';
    if (!file) return;
    if (!['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type)) {
      message.textContent = 'This file type is not supported. Choose MP4, WebM or MOV.';
      fileInput.value = '';
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      message.textContent = 'This video is larger than the 100 MB upload limit.';
      fileInput.value = '';
      return;
    }
    objectUrl = URL.createObjectURL(file);
    preview.src = objectUrl;
    previewWrap.hidden = false;
    publishButton.disabled = false;
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeUpload(); });

  (async () => {
    stateLoading();
    try {
      await loadProfile();
      await loadGrid('all');
    } catch (error) {
      if (error?.message !== 'Please sign in to view profile media.') {
        grid.innerHTML = `<div class="fx-profile-reels-state"><h2>Profile unavailable</h2><p>${esc(error.message || 'This profile media page could not be opened.')}</p><a href="/Dashboard/index.html">Return to dashboard</a></div>`;
      }
    }
  })();
})();
