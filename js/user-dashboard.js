(() => {
  const $ = FX.qs;
  const esc = FX.esc;
  const FALLBACK_COVER = 'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1800&q=85';
  let ownProfile = null;

  const initials = value => String(value || 'F').trim().slice(0, 1).toUpperCase();
  const countLabel = value => Number(value || 0).toLocaleString();
  const setAvatar = async (el, path, name) => {
    if (!el) return;
    el.textContent = initials(name);
    if (path) {
      const url = await FX.mediaUrl(path);
      if (url) el.innerHTML = `<img src="${esc(url)}" alt="${esc(name || 'Profile photo')}">`;
    }
  };
  const showError = (message, target = '#fx-post-message') => {
    const el = $(target);
    if (el) el.textContent = message || 'Something went wrong. Please try again.';
  };
  const countRows = async (table, configure) => {
    let query = FX.client.from(table).select('*', {count: 'exact', head: true});
    query = configure(query);
    const {count, error} = await query;
    if (error) return null;
    return count || 0;
  };

  async function loadStats() {
    const id = FX.user.id;
    const [friends, posts, groups, alerts, messages] = await Promise.all([
      countRows('friendships', q => q.or(`user_a.eq.${id},user_b.eq.${id}`)),
      countRows('posts', q => q.eq('user_id', id).eq('status', 'published')),
      countRows('room_members', q => q.eq('user_id', id).eq('status', 'active')),
      countRows('notifications', q => q.eq('user_id', id).is('read_at', null)),
      countRows('message_receipts', q => q.eq('user_id', id).is('read_at', null))
    ]);
    $('#fx-stat-friends').textContent = friends === null ? '—' : countLabel(friends);
    $('#fx-stat-posts').textContent = posts === null ? '—' : countLabel(posts);
    $('#fx-stat-groups').textContent = groups === null ? '—' : countLabel(groups);
    $('#fx-stat-unread').textContent = alerts === null ? '—' : countLabel(alerts);
    $('#fx-top-notifications').textContent = alerts === null ? '0' : countLabel(alerts);
    $('#fx-side-notifications').textContent = alerts === null ? '0' : countLabel(alerts);
    $('#fx-top-messages').textContent = messages === null ? '0' : countLabel(messages);
    $('#fx-side-messages').textContent = messages === null ? '0' : countLabel(messages);
  }

  async function loadCompletion(profile) {
    const {data: details} = await FX.client.from('profile_details').select('education,occupation,interests').eq('profile_id', FX.user.id).maybeSingle();
    const checks = [
      !!profile.display_name,
      !!profile.username,
      !!profile.bio,
      !!profile.avatar_path,
      !!profile.cover_path,
      !!(details?.education || details?.occupation),
      !!(details?.interests?.length)
    ];
    const percent = Math.round(checks.filter(Boolean).length / checks.length * 100);
    $('#fx-progress-number').textContent = `${percent}%`;
    $('#fx-progress-ring').style.setProperty('--progress', `${percent * 3.6}deg`);
  }

  async function loadActivity() {
    const {data, error} = await FX.client.from('notifications')
      .select('id,actor_id,type,title,body,created_at,read_at')
      .eq('user_id', FX.user.id).order('created_at', {ascending: false}).limit(5);
    const host = $('#fx-activity-list');
    if (error) {
      host.innerHTML = '<div class="fx-loading">Activity is temporarily unavailable.</div>';
      return;
    }
    if (!data?.length) {
      host.innerHTML = '<div class="fx-loading">No new activity yet. Your community updates will appear here.</div>';
      return;
    }
    const actorIds = [...new Set(data.map(x => x.actor_id).filter(Boolean))];
    let actors = new Map();
    if (actorIds.length) {
      const {data: profiles} = await FX.client.from('profiles').select('id,display_name,username,avatar_path').in('id', actorIds);
      actors = new Map((profiles || []).map(p => [p.id, p]));
    }
    host.innerHTML = data.map(row => {
      const actor = actors.get(row.actor_id);
      const text = row.body || row.title || 'You have a new Frnxup update.';
      const icon = /message|chat/i.test(row.type) ? '✉' : /friend/i.test(row.type) ? '♧' : /like|reaction/i.test(row.type) ? '♥' : '●';
      return `<div class="fx-activity-item ${row.read_at ? '' : 'unread'}"><span class="fx-activity-icon">${icon}</span><div class="fx-activity-copy"><b>${esc(actor?.display_name || actor?.username || row.title || 'Frnxup')}</b> ${esc(text)}<small>${esc(FX.relative(row.created_at))}</small></div></div>`;
    }).join('');
  }

  async function loadTrending() {
    const host = $('#fx-trending');
    const {data, error} = await FX.client.from('rooms').select('id,name,category,member_count')
      .eq('status', 'active').eq('visibility', 'public').order('member_count', {ascending: false}).limit(6);
    if (error || !data?.length) return;
    const tags = [...new Set(data.map(room => room.category || room.name).filter(Boolean))].slice(0, 6);
    host.innerHTML = `<a class="fx-topic" href="/Rooms/index.html">#Frnxup</a>` + tags.map(tag => `<a class="fx-topic" href="/Rooms/index.html">#${esc(tag.replace(/\s+/g, ''))}</a>`).join('');
  }

  async function loadOwnPosts() {
    const host = $('#fx-own-posts');
    const {data, error} = await FX.client.from('posts').select('id,body,media_path,media_type,created_at')
      .eq('user_id', FX.user.id).is('page_id', null).eq('status', 'published').order('created_at', {ascending: false}).limit(3);
    if (error) { host.innerHTML = '<div class="fx-loading">Your posts could not be loaded right now.</div>'; return; }
    if (!data?.length) { host.innerHTML = '<div class="fx-loading">You have not published a post yet. Share your first update above.</div>'; return; }
    const ids = data.map(post => post.id);
    const {data: rows} = await FX.client.from('post_media').select('post_id,media_path,media_type,sort_order').in('post_id', ids).order('sort_order', {ascending: true});
    const byPost = new Map();
    (rows || []).forEach(row => { if (!byPost.has(row.post_id)) byPost.set(row.post_id, []); byPost.get(row.post_id).push(row); });
    data.forEach(post => { if (!byPost.has(post.id) && post.media_path) byPost.set(post.id, [{post_id: post.id, media_path: post.media_path, media_type: post.media_type || 'image', sort_order: 1}]); });
    const all = [...byPost.values()].flat();
    const urls = await Promise.all(all.map(item => FX.mediaUrl(item.media_path)));
    const urlMap = new Map(all.map((item, index) => [item.media_path, urls[index]]));
    host.innerHTML = data.map(post => {
      const media = (byPost.get(post.id) || []).map(item => ({url: urlMap.get(item.media_path), type: item.media_type, name: `frnxup-${post.id}-${item.sort_order}.${(item.media_path?.split('.').pop() || (item.media_type === 'video' ? 'mp4' : 'jpg')).toLowerCase()}`})).filter(item => item.url);
      const collage = window.FXMediaTools?.collage(media, `dashboard-${post.id}`, 'Your post media') || '';
      return `<article class="fx-own-post"><div class="fx-own-post-head"><span class="avatar">${esc(initials(ownProfile?.display_name || ownProfile?.username))}</span><div><b>${esc(ownProfile?.display_name || ownProfile?.username || 'You')}</b><small>${esc(FX.relative(post.created_at))}</small></div></div>${post.body ? `<div class="fx-own-post-body">${esc(post.body)}</div>` : ''}${collage}</article>`;
    }).join('');
  }

  async function updateProfileImage(kind, file) {
    if (!file) return;
    try {
      const path = await FX.upload(file, kind === 'cover' ? 'covers' : 'avatars');
      const field = kind === 'cover' ? 'cover_path' : 'avatar_path';
      const {error} = await FX.client.from('profiles').update({[field]: path}).eq('id', FX.user.id);
      if (error) throw error;
      ownProfile[field] = path;
      if (FX.profile) FX.profile[field] = path;
      if (kind === 'cover') {
        const url = await FX.mediaUrl(path);
        if (url) $('#fx-cover').style.backgroundImage = `url("${url}")`;
      } else {
        await setAvatar($('#dash-avatar'), path, ownProfile.display_name || ownProfile.username);
        await setAvatar($('#fx-top-avatar'), path, ownProfile.display_name || ownProfile.username);
        await setAvatar($('#fx-composer-avatar'), path, ownProfile.display_name || ownProfile.username);
      }
      await loadCompletion(ownProfile);
      FX.toast(kind === 'cover' ? 'Cover photo updated.' : 'Profile photo updated.');
    } catch (error) {
      FX.toast(error.message || 'Unable to update this photo.');
    }
  }

  function openPostModal() {
    const modal = $('#fx-post-modal');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    $('#fx-post-body').focus();
  }
  function closePostModal() {
    const modal = $('#fx-post-modal');
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }

  async function createPost(event) {
    event.preventDefault();
    if (FX.settings.posting_enabled === false) return showError('Posting is temporarily disabled by Frnxup administrators.');
    const body = $('#fx-post-body').value.trim();
    const files = [...($('#fx-post-file').files || [])];
    if (!body && !files.length) return showError('Write something or attach a photo/video.');
    const videos = files.filter(file => file.type.startsWith('video/'));
    if (files.length > 20 || files.some(file => !file.type.startsWith('image/') && !file.type.startsWith('video/')) || videos.length > 1 || (videos.length && files.length > 1)) {
      return showError('Choose up to 20 photos OR one video. Do not mix them in one post.');
    }
    const submit = $('#fx-publish-post');
    submit.disabled = true;
    showError('Preparing your post…');
    let uploaded = [];
    let postId = null;
    try {
      for (const file of files) {
        const path = await FX.upload(file, 'posts');
        uploaded.push({media_path: path, media_type: file.type.startsWith('video/') ? 'video' : 'image', sort_order: uploaded.length + 1});
      }
      const first = uploaded[0] || null;
      const {data: post, error} = await FX.client.from('posts').insert({
        user_id: FX.user.id, page_id: FX.activePageId(), body, media_path: first?.media_path || null,
        media_type: first?.media_type || null, visibility: $('#fx-post-visibility').value
      }).select('id').single();
      if (error) throw error;
      postId = post.id;
      // Sequential inserts let the server-side trigger validate the full
      // accumulated set, including the one-video-only and 20-photo limits.
      for (const item of uploaded) {
        const {error: mediaError} = await FX.client.from('post_media').insert({post_id: post.id, ...item});
        if (mediaError) throw new Error(`${mediaError.message}. Run Supabase/migrations/20261121_post_photo_collages.sql in your Supabase SQL Editor.`);
      }
      $('#fx-post-body').value = '';
      $('#fx-post-file').value = '';
      $('#fx-post-visibility').value = 'public';
      document.querySelector('.fx-upload-preview[data-for="fx-post-file"]')?.replaceChildren();
      closePostModal();
      FX.toast(uploaded.length > 1 ? 'Your photo collage has been published.' : 'Your post has been published.');
      showError('');
      await Promise.all([loadOwnPosts(), loadStats()]);
    } catch (error) {
      if (postId) await FX.client.from('posts').delete().eq('id', postId);
      if (uploaded.length) await FX.client.storage.from('frnxup-media').remove(uploaded.map(item => item.media_path));
      showError(error.message);
    } finally {
      submit.disabled = false;
    }
  }

  function profileUploadPreview(kind, file) {
    if (!file || !file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    const originalCover = $('#fx-cover').style.backgroundImage;
    const originalAvatar = $('#dash-avatar').innerHTML;
    const target = kind === 'cover' ? $('#fx-cover') : $('#dash-avatar');
    if (kind === 'cover') target.style.backgroundImage = `url("${url}")`;
    else target.innerHTML = `<img src="${url}" alt="Profile photo preview">`;
    let panel = document.querySelector('.fx-profile-upload-confirm');
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'fx-profile-upload-confirm';
      const anchor = $('.fx-profile-bar') || $('#fx-cover');
      anchor.insertAdjacentElement('afterend', panel);
    }
    panel.innerHTML = `<div><b>Preview your ${kind} photo</b><small>This preview has not been saved yet.</small></div><button type="button" class="button primary" id="fx-confirm-profile-upload">Use this photo</button><button type="button" class="button subtle" id="fx-cancel-profile-upload">Cancel</button>`;
    $('#fx-confirm-profile-upload').onclick = async () => { panel.remove(); await updateProfileImage(kind, file); URL.revokeObjectURL(url); };
    $('#fx-cancel-profile-upload').onclick = () => { panel.remove(); URL.revokeObjectURL(url); if (kind === 'cover') $('#fx-cover').style.backgroundImage = originalCover || `url("${FALLBACK_COVER}")`; else $('#dash-avatar').innerHTML = originalAvatar; };
  }

  async function init() {
    if (!FX.client || !FX.configured) {
      const host = document.querySelector('.fx-dashboard-content');
      if (host) host.insertAdjacentHTML('afterbegin', '<p class="auth-state-notice">Frnxup could not connect to the account service. Please check the site configuration or your connection, then refresh.</p>');
      return;
    }
    await FX.loadUser();
    await FX.loadProfile();
    // core.js is the single source of truth for protected-route redirects.
    // Avoid a second redirect here, which can create a login bounce during a session refresh.
    if (!FX.user) return;
    const pageModeId=FX.activePageId();if(pageModeId){const {data:activePage}=await FX.client.from('frnxup_pages').select('id,name,slug').eq('id',pageModeId).eq('owner_user_id',FX.user.id).eq('status','active').maybeSingle();const card=$('#fx-page-mode-card');if(activePage&&card){card.hidden=false;card.innerHTML=`<div class="fx-page-mode-title">Posting as page</div><b>${esc(activePage.name)}</b><a href="/Pages/dashboard.html?id=${activePage.id}">Open page dashboard</a><button type="button" id="fx-page-mode-clear">Switch to personal account</button>`;$('#fx-page-mode-clear').onclick=()=>{FX.setActivePage(null);location.reload()};}else FX.setActivePage(null);} 

    ownProfile = FX.profile || {};
    const name = ownProfile.display_name || ownProfile.username || 'Frnxup member';
    $('#dash-name').textContent = name;
    $('#dash-handle').textContent = '@' + (ownProfile.username || 'member');
    $('#fx-bio').textContent = ownProfile.bio || 'Connect · Share · Grow Together';
    $('#fx-verified').hidden = !ownProfile.is_verified;
    $('#fx-account-status').textContent = ownProfile.account_status === 'active' ? 'Active Account' : 'Account Restricted';
    const coverUrl = ownProfile.cover_path ? await FX.mediaUrl(ownProfile.cover_path) : '';
    $('#fx-cover').style.backgroundImage = `url("${coverUrl || FALLBACK_COVER}")`;
    await Promise.all([
      setAvatar($('#dash-avatar'), ownProfile.avatar_path, name),
      setAvatar($('#fx-top-avatar'), ownProfile.avatar_path, name),
      setAvatar($('#fx-composer-avatar'), ownProfile.avatar_path, name),
      loadStats(), loadActivity(), loadTrending(), loadOwnPosts(), loadCompletion(ownProfile)
    ]);

    if (FX.settings.posting_enabled === false) {
      ['#fx-open-composer', '#fx-compose-text', '#fx-compose-photo', '#fx-compose-video', '#fx-compose-feeling', '#fx-compose-submit'].forEach(selector => {
        const control = $(selector);
        if (control) { control.setAttribute('aria-disabled', 'true'); control.classList.add('is-disabled'); }
      });
      $('#fx-open-composer').addEventListener('click', event => { event.preventDefault(); FX.toast('Posting is temporarily disabled by Frnxup administrators.'); });
    } else {
      $('#fx-open-composer').addEventListener('click', event => {event.preventDefault(); openPostModal();});
      $('#fx-compose-text').addEventListener('click', openPostModal);
      $('#fx-compose-submit').addEventListener('click', openPostModal);
      $('#fx-compose-photo').addEventListener('click', () => {openPostModal(); $('#fx-post-file').accept = 'image/*'; $('#fx-post-file').multiple = true; $('#fx-post-file').click();});
      $('#fx-compose-video').addEventListener('click', () => {openPostModal(); $('#fx-post-file').accept = 'video/*'; $('#fx-post-file').multiple = false; $('#fx-post-file').click();});
      $('#fx-compose-feeling').addEventListener('click', () => {openPostModal(); $('#fx-post-body').value = 'I am feeling 😊 ';});
    }
    $('#fx-change-cover').addEventListener('click', () => $('#fx-cover-file').click());
    $('#fx-cover-file').addEventListener('change', event => profileUploadPreview('cover', event.target.files[0]));
    $('#fx-change-avatar').addEventListener('click', () => $('#fx-avatar-file').click());
    $('#fx-avatar-file').addEventListener('change', event => profileUploadPreview('avatar', event.target.files[0]));
    $('#fx-close-modal').addEventListener('click', closePostModal);
    $('#fx-post-modal').addEventListener('click', event => {if (event.target.id === 'fx-post-modal') closePostModal();});
    $('#fx-post-form').addEventListener('submit', createPost);
    $('#fx-mobile-menu').addEventListener('click', () => $('#fx-sidebar').classList.toggle('mobile-open'));
    document.addEventListener('click', event => {
      if (window.matchMedia('(max-width:700px)').matches && !$('#fx-sidebar').contains(event.target) && event.target.id !== 'fx-mobile-menu') $('#fx-sidebar').classList.remove('mobile-open');
    });
    $('#logout').addEventListener('click', async () => {
      await FX.trackActivity('sign_out','auth',location.pathname);
      const {error} = await FX.client.auth.signOut();
      if (error) FX.toast(error.message);
      else location.href = '/index.html';
    });
    $('#fx-search-form').addEventListener('submit', event => {
      event.preventDefault();
      const query = $('#fx-search-input').value.trim();
      if (!query) return;
      location.href = '/Friends/suggestions.html?q=' + encodeURIComponent(query);
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
