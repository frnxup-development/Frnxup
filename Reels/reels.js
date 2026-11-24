(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => FX.esc(String(value ?? ''));
  const feed = $('#reels-feed');
  const uploadModal = $('#reel-upload-modal');
  const fileInput = $('#reel-file');
  const publishButton = $('#reel-publish');
  const uploadMessage = $('#reel-upload-message');
  const previewWrap = $('#reel-preview-wrap');
  const preview = $('#reel-preview');
  const captionInput = $('#reel-caption');
  let reels = [];
  let observer = null;
  let previewObjectUrl = null;
  const viewedThisSession = new Set();

  function showLoading() {
    feed.innerHTML = '<div class="fx-reels-loading"><span class="fx-reels-spinner"></span><b>Loading Reels</b><small>Finding videos from your Frnxup community.</small></div>';
  }

  function showError(message) {
    feed.innerHTML = `<div class="fx-reels-empty"><div class="empty-icon">⚠</div><h2>Reels could not load</h2><p>${esc(message || 'Check your connection and try again.')}</p><button type="button" id="reels-retry">Try again</button></div>`;
    $('#reels-retry')?.addEventListener('click', loadReels);
  }

  function showEmpty() {
    feed.innerHTML = '<div class="fx-reels-empty"><div class="empty-icon">▶</div><h2>Your Reels feed is ready</h2><p>There are no published public videos to watch yet. Be the first to share a short video with the Frnxup community.</p><button type="button" id="reels-empty-create">＋ Create a Reel</button></div>';
    $('#reels-empty-create')?.addEventListener('click', openUpload);
  }

  function formatCount(value) {
    const count = Number(value || 0);
    if (count >= 1000000) return `${(count / 1000000).toFixed(count >= 10000000 ? 0 : 1).replace(/\.0$/, '')}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1).replace(/\.0$/, '')}K`;
    return String(count);
  }

  function authorData(post, profiles, pages) {
    if (post.page_id && pages.has(post.page_id)) {
      const page = pages.get(post.page_id);
      return { name: page.name || 'Frnxup Page', handle: `@${page.slug || 'page'}`, avatar: page.avatar_url || '', link: `/Pages/view.html?slug=${encodeURIComponent(page.slug || '')}`, kind: 'page', id: page.id, canFollow: page.owner_user_id !== FX.user.id };
    }
    const profile = profiles.get(post.user_id) || {};
    return {
      name: profile.display_name || profile.username || 'Frnxup member',
      handle: profile.username ? `@${profile.username}` : 'Frnxup member',
      avatar: profile.avatar_url || '',
      link: `/Dashboard/profile.html?id=${encodeURIComponent(post.user_id)}`,
      kind: 'user',
      id: post.user_id,
      canFollow: post.user_id !== FX.user.id
    };
  }

  async function loadReels() {
    try {
      showLoading();
      const user = await FX.loadUser();
      if (!user) {
        const next = `${location.pathname}${location.search}`;
        location.replace(`/Auth/index.html?next=${encodeURIComponent(next)}`);
        return;
      }

      // Public videos from member profiles and active Frnxup Pages. RLS still
      // applies, so blocked, hidden, deleted and otherwise restricted posts stay hidden.
      const requestedPost = new URLSearchParams(location.search).get('post');
      const { data: recentPosts, error } = await FX.client.from('posts')
        .select('id,user_id,page_id,body,media_path,media_type,visibility,created_at')
        .eq('status', 'published')
        .eq('media_type', 'video')
        .order('created_at', { ascending: false })
        .limit(60);
      if (error) throw error;
      let posts = recentPosts || [];
      // A profile grid may deep-link to an older Reel outside the latest feed window.
      // Fetch that one row separately; RLS still decides whether this viewer can see it.
      if (requestedPost && !posts.some((post) => post.id === requestedPost)) {
        const { data: targetPost, error: targetError } = await FX.client.from('posts')
          .select('id,user_id,page_id,body,media_path,media_type,visibility,created_at')
          .eq('id', requestedPost).eq('status', 'published').maybeSingle();
        if (targetError) throw targetError;
        if (targetPost) posts = [targetPost, ...posts];
      }
      if (!posts.length) { showEmpty(); return; }

      const postIds = posts.map((post) => post.id);
      const userIds = [...new Set(posts.filter((post) => !post.page_id).map((post) => post.user_id).filter(Boolean))];
      const pageIds = [...new Set(posts.map((post) => post.page_id).filter(Boolean))];
      const [profilesResult, pagesResult, mediaResult, reactionsResult, commentsResult, viewsResult] = await Promise.all([
        userIds.length ? FX.client.from('profiles').select('id,username,display_name,avatar_path').in('id', userIds) : Promise.resolve({ data: [], error: null }),
        pageIds.length ? FX.client.from('frnxup_pages').select('id,owner_user_id,name,slug,avatar_path').in('id', pageIds) : Promise.resolve({ data: [], error: null }),
        FX.client.from('post_media').select('post_id,media_path,media_type,sort_order').in('post_id', postIds).order('sort_order', { ascending: true }),
        FX.client.from('post_reactions').select('post_id,user_id').in('post_id', postIds),
        FX.client.from('post_comments').select('post_id').eq('status', 'published').in('post_id', postIds),
        FX.client.from('frnxup_reel_views').select('post_id').in('post_id', postIds)
      ]);
      const dependentError = [profilesResult, pagesResult, mediaResult, reactionsResult, commentsResult].find((result) => result?.error)?.error;
      if (dependentError) throw dependentError;

      const profileRows = profilesResult.data || [];
      const pageRows = pagesResult.data || [];
      const mediaRows = mediaResult.data || [];
      const profileAvatars = await Promise.all(profileRows.map((profile) => profile.avatar_path ? FX.mediaUrl(profile.avatar_path) : ''));
      const pageAvatars = await Promise.all(pageRows.map((page) => page.avatar_path ? FX.mediaUrl(page.avatar_path) : ''));
      const profiles = new Map(profileRows.map((profile, index) => [profile.id, { ...profile, avatar_url: profileAvatars[index] }]));
      const pages = new Map(pageRows.map((page, index) => [page.id, { ...page, avatar_url: pageAvatars[index] }]));
      const mediaByPost = new Map();
      mediaRows.forEach((row) => {
        if (!mediaByPost.has(row.post_id)) mediaByPost.set(row.post_id, []);
        mediaByPost.get(row.post_id).push(row);
      });

      const normalized = posts.map((post) => {
        const matching = (mediaByPost.get(post.id) || []).find((row) => row.media_type === 'video');
        const reelPath = post.media_type === 'video' ? (post.media_path || matching?.media_path) : matching?.media_path;
        return { ...post, reel_path: reelPath || null };
      }).filter((post) => !!post.reel_path);
      const urls = await Promise.all(normalized.map((post) => FX.mediaUrl(post.reel_path)));
      const reactions = reactionsResult.data || [];
      const commentRows = commentsResult.data || [];
      const viewCounts = new Map();
      if (!viewsResult.error) (viewsResult.data || []).forEach((view) => viewCounts.set(view.post_id, (viewCounts.get(view.post_id) || 0) + 1));
      else console.warn('Reel view counts are unavailable. Apply the Reels migration to enable them:', viewsResult.error.message);
      const likedByPost = new Map();
      reactions.forEach((reaction) => {
        if (!likedByPost.has(reaction.post_id)) likedByPost.set(reaction.post_id, []);
        likedByPost.get(reaction.post_id).push(reaction.user_id);
      });
      const commentCounts = new Map();
      commentRows.forEach((comment) => commentCounts.set(comment.post_id, (commentCounts.get(comment.post_id) || 0) + 1));

      // User follow table is introduced by the included migration. If it has not
      // yet been applied, playback still works and follow actions show a clear error.
      const followIds = [...new Set(normalized.filter((post) => !post.page_id && post.user_id !== FX.user.id).map((post) => post.user_id))];
      const pageFollowIds = [...new Set(normalized.filter((post) => post.page_id).map((post) => post.page_id))];
      let followingUsers = new Set();
      let followingPages = new Set();
      if (followIds.length) {
        const result = await FX.client.from('user_follows').select('following_id').eq('follower_id', FX.user.id).in('following_id', followIds);
        if (!result.error) followingUsers = new Set((result.data || []).map((row) => row.following_id));
      }
      if (pageFollowIds.length) {
        const result = await FX.client.from('frnxup_page_followers').select('page_id').eq('user_id', FX.user.id).in('page_id', pageFollowIds);
        if (!result.error) followingPages = new Set((result.data || []).map((row) => row.page_id));
      }

      reels = normalized.map((post, index) => {
        const creator = authorData(post, profiles, pages);
        return {
          ...post,
          url: urls[index],
          creator,
          likes: (likedByPost.get(post.id) || []).length,
          liked: (likedByPost.get(post.id) || []).includes(FX.user.id),
          comments: commentCounts.get(post.id) || 0,
          views: viewCounts.get(post.id) || 0,
          following: creator.kind === 'page' ? followingPages.has(creator.id) : followingUsers.has(creator.id)
        };
      }).filter((post) => post.url);

      if (!reels.length) { showEmpty(); return; }
      renderReels();
      if (requestedPost) requestAnimationFrame(() => {
        const target = $(`[data-reel-id="${CSS.escape(requestedPost)}"]`, feed);
        target?.scrollIntoView({ behavior: 'auto', block: 'start' });
      });
    } catch (error) {
      console.error('Frnxup Reels load failed:', error);
      showError(error?.message || 'Unable to load Reels.');
    }
  }

  async function trackReelView(reel) {
    if (!reel || viewedThisSession.has(reel.id)) return;
    viewedThisSession.add(reel.id);
    const { error } = await FX.client.from('frnxup_reel_views').insert({ post_id: reel.id, viewer_id: FX.user.id });
    if (!error) {
      reel.views = Number(reel.views || 0) + 1;
      const count = $(`[data-view-count="${CSS.escape(reel.id)}"]`, feed);
      if (count) count.textContent = `· ${formatCount(reel.views)} views`;
    } else if (error.code !== '23505') {
      console.warn('Reel view could not be recorded:', error.message);
    }
  }

  function renderReels() {
    if (observer) observer.disconnect();
    feed.innerHTML = reels.map((reel, index) => {
      const avatar = reel.creator.avatar
        ? `<img src="${esc(reel.creator.avatar)}" alt="">`
        : esc((reel.creator.name || 'F').slice(0, 1).toUpperCase());
      const followButton = reel.creator.canFollow
        ? `<button class="fx-reels-follow ${reel.following ? 'following' : ''}" type="button" data-follow-kind="${reel.creator.kind}" data-follow-id="${esc(reel.creator.id)}">${reel.following ? 'Following ✓' : 'Follow'}</button>`
        : '';
      return `<article class="fx-reels-slide" data-reel-id="${esc(reel.id)}" data-reel-index="${index}">
        <video class="fx-reels-video" data-reel-video="${esc(reel.id)}" src="${esc(reel.url)}" playsinline loop muted preload="metadata" aria-label="Reel video"></video>
        <div class="fx-reels-video-shade"></div>
        <div class="fx-reels-tap-state">▶</div>
        <button class="fx-reels-sound" type="button" data-sound="${esc(reel.id)}" aria-label="Turn sound on">◖))</button>
        <div class="fx-reels-side-actions">
          <a class="fx-reels-creator-avatar" href="${esc(reel.creator.link)}" aria-label="Open ${esc(reel.creator.name)} profile">${avatar}</a>
          <button class="fx-reels-action ${reel.liked ? 'is-active' : ''}" type="button" data-like="${esc(reel.id)}" aria-label="Like Reel"><span class="action-glyph">${reel.liked ? '♥' : '♡'}</span><small data-like-count="${esc(reel.id)}">${formatCount(reel.likes)}</small></button>
          <button class="fx-reels-action" type="button" data-comment="${esc(reel.id)}" aria-label="Comment"><span class="action-glyph">▢</span><small data-comment-count="${esc(reel.id)}">${formatCount(reel.comments)}</small></button>
          <button class="fx-reels-action" type="button" data-share="${esc(reel.id)}" aria-label="Share Reel"><span class="action-glyph">↗</span><small>Share</small></button>
        </div>
        <div class="fx-reels-meta">
          <div class="fx-reels-author-row"><a class="fx-reels-author" href="${esc(reel.creator.link)}">${esc(reel.creator.name)}</a>${followButton}</div>
          <p class="fx-reels-caption">${esc(reel.body || '')}</p>
          <div class="fx-reels-tagline">♪ Original audio · Frnxup <span data-view-count="${esc(reel.id)}">· ${formatCount(reel.views)} views</span></div>
        </div>
      </article>`;
    }).join('');

    observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const video = $('video', entry.target);
        if (!video) return;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.62) {
          const reel = reels.find((item) => item.id === entry.target.dataset.reelId);
          if (reel) trackReelView(reel);
          $$('.fx-reels-video', feed).forEach((other) => { if (other !== video) other.pause(); });
          video.play().then(() => entry.target.classList.remove('paused')).catch(() => entry.target.classList.add('paused'));
        } else {
          video.pause();
        }
      });
    }, { root: feed, threshold: [0, 0.25, 0.62, 0.9] });
    $$('.fx-reels-slide', feed).forEach((slide) => observer.observe(slide));
  }

  function openUpload() {
    uploadModal.classList.add('open');
    uploadModal.setAttribute('aria-hidden', 'false');
    uploadMessage.textContent = '';
    $('#reel-caption').focus();
  }

  function closeUpload() {
    uploadModal.classList.remove('open');
    uploadModal.setAttribute('aria-hidden', 'true');
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = null;
    preview.removeAttribute('src');
    preview.load();
    previewWrap.hidden = true;
    fileInput.value = '';
    captionInput.value = '';
    publishButton.disabled = true;
    publishButton.textContent = 'Share Reel';
    uploadMessage.textContent = '';
  }

  function openComments(postId) {
    const reel = reels.find(item => item.id === postId);
    if (!window.FrnxupComments) return FX.toast('The comments feature is unavailable. Refresh Frnxup and try again.');
    window.FrnxupComments.openModal({
      type: 'post', contextId: postId, title: 'Reel comments',
      onCountChange: count => {
        if (reel) reel.comments = count;
        const countNode = $(`[data-comment-count="${CSS.escape(postId)}"]`);
        if (countNode) countNode.textContent = formatCount(count);
      }
    });
  }

  function closeComments() { window.FrnxupComments?.closeModal(); }

  async function toggleLike(postId, button) {
    if (!FX.user) return;
    const reel = reels.find((item) => item.id === postId);
    if (!reel) return;
    button.disabled = true;
    try {
      if (reel.liked) {
        const { error } = await FX.client.from('post_reactions').delete().eq('post_id', postId).eq('user_id', FX.user.id);
        if (error) throw error;
        reel.liked = false;
        reel.likes = Math.max(0, reel.likes - 1);
      } else {
        const { error } = await FX.client.from('post_reactions').insert({ post_id: postId, user_id: FX.user.id, reaction: 'like' });
        if (error && error.code !== '23505') throw error;
        reel.liked = true;
        reel.likes += 1;
      }
      button.classList.toggle('is-active', reel.liked);
      $('.action-glyph', button).textContent = reel.liked ? '♥' : '♡';
      $(`[data-like-count="${CSS.escape(postId)}"]`).textContent = formatCount(reel.likes);
    } catch (error) { FX.toast(error.message || 'Your reaction could not be saved.'); }
    finally { button.disabled = false; }
  }

  async function toggleFollow(button) {
    const kind = button.dataset.followKind;
    const targetId = button.dataset.followId;
    const reel = reels.find((item) => item.creator.id === targetId && item.creator.kind === kind);
    if (!reel || !FX.user || targetId === FX.user.id) return;
    button.disabled = true;
    try {
      if (kind === 'page') {
        const result = reel.following
          ? await FX.client.from('frnxup_page_followers').delete().eq('page_id', targetId).eq('user_id', FX.user.id)
          : await FX.client.from('frnxup_page_followers').insert({ page_id: targetId, user_id: FX.user.id });
        if (result.error && result.error.code !== '23505') throw result.error;
      } else {
        const result = reel.following
          ? await FX.client.from('user_follows').delete().eq('follower_id', FX.user.id).eq('following_id', targetId)
          : await FX.client.from('user_follows').insert({ follower_id: FX.user.id, following_id: targetId });
        if (result.error && result.error.code !== '23505') throw result.error;
      }
      const updated = !reel.following;
      reels.filter((item) => item.creator.id === targetId && item.creator.kind === kind).forEach((item) => { item.following = updated; });
      $$(`[data-follow-kind="${CSS.escape(kind)}"][data-follow-id="${CSS.escape(targetId)}"]`, feed).forEach((el) => {
        el.classList.toggle('following', updated);
        el.textContent = updated ? 'Following ✓' : 'Follow';
      });
    } catch (error) {
      FX.toast(error.message || 'Follow could not be updated.');
    } finally { button.disabled = false; }
  }

  async function shareReel(postId) {
    const url = new URL('/Posts/view.html', location.origin);
    url.searchParams.set('id', postId);
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Frnxup Reel', text: 'Watch this Reel on Frnxup', url: url.toString() });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url.toString());
        FX.toast('Reel link copied.');
      } else {
        const field = document.createElement('textarea');
        field.value = url.toString(); field.style.position = 'fixed'; field.style.opacity = '0';
        document.body.append(field); field.select();
        const copied = document.execCommand('copy'); field.remove();
        if (!copied) throw new Error('Link sharing is unavailable in this browser.');
        FX.toast('Reel link copied.');
      }
    } catch (error) { if (error?.name !== 'AbortError') FX.toast(error.message || 'This Reel could not be shared.'); }
  }

  async function publishReel() {
    const file = fileInput.files?.[0];
    if (!file || !['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type)) { uploadMessage.textContent = 'Choose an MP4, WebM or MOV video file.'; return; }
    if (file.size > 100 * 1024 * 1024) { uploadMessage.textContent = 'This video is larger than the 100 MB upload limit.'; return; }
    const caption = captionInput.value.trim();
    publishButton.disabled = true;
    publishButton.textContent = 'Uploading…';
    uploadMessage.textContent = 'Uploading your video securely…';
    let path = null;
    let postId = null;
    try {
      path = await FX.upload(file, 'posts');
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
      const { error: mediaError } = await FX.client.from('post_media').insert({
        post_id: postId,
        media_path: path,
        media_type: 'video',
        sort_order: 1
      });
      if (mediaError) throw mediaError;
      FX.toast('Your Reel is now published.');
      closeUpload();
      await loadReels();
      const slide = $(`[data-reel-id="${CSS.escape(postId)}"]`, feed);
      slide?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      if (postId) await FX.client.from('posts').delete().eq('id', postId).eq('user_id', FX.user.id);
      if (path) await FX.client.storage.from('frnxup-media').remove([path]);
      uploadMessage.textContent = error?.message || 'Your Reel could not be published.';
      publishButton.disabled = false;
      publishButton.textContent = 'Try again';
    }
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    publishButton.disabled = !file;
    uploadMessage.textContent = '';
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    if (!file) { previewWrap.hidden = true; return; }
    if (!['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type)) {
      uploadMessage.textContent = 'Choose an MP4, WebM or MOV video file.';
      publishButton.disabled = true;
      previewWrap.hidden = true;
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      uploadMessage.textContent = 'This video is larger than the 100 MB upload limit.';
      publishButton.disabled = true;
      previewWrap.hidden = true;
      return;
    }
    previewObjectUrl = URL.createObjectURL(file);
    preview.src = previewObjectUrl;
    previewWrap.hidden = false;
  });

  $('#reel-camera').addEventListener('click', openUpload);
  $('#reel-create-fab').addEventListener('click', openUpload);
  $$('[data-reel-close]').forEach((button) => button.addEventListener('click', closeUpload));
  $('#reel-publish').addEventListener('click', publishReel);
  uploadModal.addEventListener('click', (event) => { if (event.target === uploadModal) closeUpload(); });

  feed.addEventListener('click', async (event) => {
    const sound = event.target.closest('[data-sound]');
    if (sound) {
      const video = $(`[data-reel-video="${CSS.escape(sound.dataset.sound)}"]`, feed);
      if (!video) return;
      video.muted = !video.muted;
      sound.textContent = video.muted ? '◖))' : '🔊';
      sound.setAttribute('aria-label', video.muted ? 'Turn sound on' : 'Mute video');
      if (!video.paused) video.play().catch(() => {});
      return;
    }
    const like = event.target.closest('[data-like]');
    if (like) { await toggleLike(like.dataset.like, like); return; }
    const comment = event.target.closest('[data-comment]');
    if (comment) { openComments(comment.dataset.comment); return; }
    const share = event.target.closest('[data-share]');
    if (share) { await shareReel(share.dataset.share); return; }
    const follow = event.target.closest('[data-follow-id]');
    if (follow) { await toggleFollow(follow); return; }
    const video = event.target.closest('.fx-reels-video');
    if (video) {
      const slide = video.closest('.fx-reels-slide');
      if (video.paused) { video.play().then(() => slide.classList.remove('paused')).catch(() => {}); }
      else { video.pause(); slide.classList.add('paused'); }
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { closeUpload(); closeComments(); }
    if (uploadModal.classList.contains('open') || document.querySelector('.fx-unified-comments-modal')) return;
    if (event.key === 'ArrowDown' || event.key === 'PageDown') {
      event.preventDefault();
      const active = feed.querySelector('.fx-reels-slide:hover') || feed.querySelector('.fx-reels-slide');
      const next = active?.nextElementSibling;
      next?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (event.key === 'ArrowUp' || event.key === 'PageUp') {
      event.preventDefault();
      const active = feed.querySelector('.fx-reels-slide:hover') || feed.querySelector('.fx-reels-slide');
      active?.previousElementSibling?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  loadReels();
})();
