document.addEventListener('DOMContentLoaded', async () => {
  const host = document.querySelector('#notification-list');
  const markAll = document.querySelector('#mark-all');
  if (!host) return;

  try {
    await FX.loadUser();
  } catch (error) {
    FXStates.fail(host, error, { retry: () => location.reload(), title: 'Notifications could not be initialized' });
    if (markAll) markAll.disabled = true;
    return;
  }

  if (!FX.client) {
    FXStates.render(host, 'configuration');
    if (markAll) markAll.disabled = true;
    return;
  }
  if (!FX.user) {
    FXStates.render(host, 'auth', {
      title: 'Sign in to view notifications',
      message: 'Your Frnxup alerts and updates will appear here after you sign in.',
      href: '/Auth/index.html?next=%2FNotifications%2Findex.html'
    });
    if (markAll) markAll.disabled = true;
    return;
  }

  const typePresentation = type => {
    const value = String(type || '').toLowerCase();
    if (/reaction|like/.test(value)) return { icon: '👍', kind: 'reaction' };
    if (/comment|mention/.test(value)) return { icon: '💬', kind: 'comment' };
    if (/friend/.test(value)) return { icon: '👥', kind: 'friend' };
    if (/upload|photo|video|post/.test(value)) return { icon: '▣', kind: 'media' };
    if (/room|group/.test(value)) return { icon: '▤', kind: 'community' };
    if (/message/.test(value)) return { icon: '✉', kind: 'message' };
    if (/birthday/.test(value)) return { icon: '🎂', kind: 'birthday' };
    if (/memory/.test(value)) return { icon: '🕰️', kind: 'memory' };
    if (/profile/.test(value)) return { icon: '◉', kind: 'profile' };
    if (/market/.test(value)) return { icon: '🛍️', kind: 'market' };
    return { icon: '●', kind: 'general' };
  };

  const notificationHref = item => {
    if (item.type === 'birthday_self') return '/Dashboard/index.html';
    if (item.target_type === 'memory') return '/Dashboard/memories.html';
    if (item.target_type === 'profile' && item.target_id) return `/Dashboard/profile.html?id=${encodeURIComponent(item.target_id)}`;
    if (item.target_type === 'post' && item.target_id) return `/Posts/view.html?id=${encodeURIComponent(item.target_id)}`;
    if (item.target_type === 'status') return '/index.html';
    if (item.target_type === 'room' && item.target_id) return `/Rooms/view.html?id=${encodeURIComponent(item.target_id)}`;
    if (item.target_type === 'conversation' && item.target_id) return `/Messages/chat.html?id=${encodeURIComponent(item.target_id)}`;
    return '/Notifications/index.html';
  };

  const notificationAction = item => {
    const type = String(item.type || '').toLowerCase();
    const body = String(item.body || '').trim();
    if (/post_reaction/.test(type)) return 'reacted to your post.';
    if (/post_comment/.test(type)) return body && !/^someone commented/i.test(body) ? `commented on your post: “${body}”` : 'commented on your post.';
    if (/comment_mention/.test(type)) return body ? `mentioned you in a comment: “${body}”` : 'mentioned you in a comment.';
    if (/friend_request_response/.test(type)) return 'responded to your friend request.';
    if (/friend_request/.test(type)) return 'sent you a friend request.';
    if (/new_upload|profile_photo/.test(type)) return 'shared a new photo or video.';
    if (/profile_cover/.test(type)) return 'updated their cover photo.';
    if (/new_post/.test(type)) return 'shared a new post.';
    if (/new_message/.test(type)) return body ? `sent you a message: “${body}”` : 'sent you a message.';
    if (/room_activity/.test(type)) return 'posted a new message in a room you belong to.';
    if (/memory/.test(type)) return 'shared a memory reminder with you.';
    if (/birthday/.test(type)) return body || 'is celebrating a birthday today.';
    return body || item.title || 'sent you an update.';
  };

  const initials = name => String(name || 'F').trim().split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join('').toUpperCase() || 'F';

  async function loadMediaForNotifications(items) {
    const postIds = [...new Set(items.filter(item => item.target_type === 'post' && item.target_id).map(item => item.target_id))];
    const mediaByPost = new Map();
    if (!postIds.length) return mediaByPost;

    try {
      const { data: posts } = await FX.client.from('posts').select('id,media_path,media_type').in('id', postIds);
      (posts || []).forEach(post => {
        if (post.media_path && post.media_type !== 'video') mediaByPost.set(post.id, post.media_path);
      });
    } catch (_) {}

    const missingIds = postIds.filter(id => !mediaByPost.has(id));
    if (missingIds.length) {
      try {
        const { data: media } = await FX.client.from('post_media').select('post_id,media_path,media_type,sort_order').in('post_id', missingIds).eq('media_type', 'image').order('sort_order', { ascending: true }).limit(100);
        (media || []).forEach(row => { if (!mediaByPost.has(row.post_id)) mediaByPost.set(row.post_id, row.media_path); });
      } catch (_) {}
    }
    return mediaByPost;
  }

  async function load() {
    if (host.dataset.fxHasContent !== 'true') {
      FXStates.loading(host, { title: 'Loading notifications', message: 'Checking your latest Frnxup alerts.' });
    }

    const { data, error } = await FX.client.from('notifications')
      .select('*,profiles!notifications_actor_id_fkey(display_name,username,avatar_path)')
      .eq('user_id', FX.user.id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      FXStates.fail(host, error, { retry: load });
      return;
    }

    const items = data || [];
    if (!items.length) {
      if (markAll) markAll.disabled = true;
      FXStates.empty(host, { title: 'You are all caught up', message: 'There are no new notifications to show right now.' });
      FXStates.loaded(host);
      return;
    }

    const mediaByPost = await loadMediaForNotifications(items);
    const imagePaths = [...new Set([
      ...items.map(item => item.profiles?.avatar_path).filter(Boolean),
      ...items.map(item => item.target_type === 'post' ? mediaByPost.get(item.target_id) : null).filter(Boolean)
    ])];
    const signedUrls = new Map();
    await Promise.all(imagePaths.map(async path => {
      try {
        const url = await FX.mediaUrl(path);
        if (url) signedUrls.set(path, url);
      } catch (_) {}
    }));

    host.innerHTML = items.map(item => {
      const actor = item.profiles?.display_name || item.profiles?.username || 'Frnxup';
      const avatarPath = item.profiles?.avatar_path || '';
      const avatarUrl = signedUrls.get(avatarPath) || '';
      const avatarMarkup = avatarUrl
        ? `<img src="${FX.esc(avatarUrl)}" alt="${FX.esc(actor)}" loading="lazy">`
        : `<span>${FX.esc(initials(actor))}</span>`;
      const presentation = typePresentation(item.type);
      const postPath = item.target_type === 'post' ? mediaByPost.get(item.target_id) : '';
      const thumbnailUrl = postPath ? (signedUrls.get(postPath) || '') : '';
      const thumbnailMarkup = thumbnailUrl
        ? `<span class="fx-notification-thumb"><img src="${FX.esc(thumbnailUrl)}" alt="Related post photo" loading="lazy"></span>`
        : `<span class="fx-notification-go" aria-hidden="true">›</span>`;
      const isUnread = !item.read_at;
      return `<a class="fx-notification-card${isUnread ? ' is-unread' : ' is-read'}" href="${FX.esc(notificationHref(item))}" data-notification="${FX.esc(item.id)}" data-read="${isUnread ? 'false' : 'true'}" aria-label="${FX.esc(`${actor} ${notificationAction(item)}`)}">
        <span class="fx-notification-avatar-wrap"><span class="fx-notification-avatar">${avatarMarkup}</span><span class="fx-notification-type-icon is-${FX.esc(presentation.kind)}">${presentation.icon}</span></span>
        <span class="fx-notification-content"><span class="fx-notification-copy"><strong>${FX.esc(actor)}</strong> ${FX.esc(notificationAction(item))}</span><time datetime="${FX.esc(item.created_at || '')}">${FX.esc(FX.relative(item.created_at))}</time></span>
        ${thumbnailMarkup}
        ${isUnread ? '<span class="fx-notification-unread-dot" aria-label="Unread"></span>' : ''}
      </a>`;
    }).join('');

    if (markAll) markAll.disabled = !items.some(item => !item.read_at);

    host.querySelectorAll('[data-notification]').forEach(card => card.addEventListener('click', async event => {
      event.preventDefault();
      const id = card.dataset.notification;
      const href = card.getAttribute('href');
      if (card.dataset.read !== 'true') {
        try {
          const { error: updateError } = await FX.client.from('notifications')
            .update({ read_at: new Date().toISOString() })
            .eq('id', id).eq('user_id', FX.user.id).is('read_at', null);
          if (updateError) console.warn('Could not mark notification as read:', updateError.message);
        } catch (updateError) {
          console.warn('Could not mark notification as read:', updateError);
        }
      }
      location.assign(href);
    }));

    FXStates.loaded(host);
  }

  await load();
  let notificationRefreshTimer = null;
  const scheduleNotificationRefresh = () => {
    if (notificationRefreshTimer) window.clearTimeout(notificationRefreshTimer);
    notificationRefreshTimer = window.setTimeout(load, 300);
  };
  try {
    FX.client.channel(`fx-notifications-page-${FX.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${FX.user.id}` }, scheduleNotificationRefresh)
      .subscribe();
  } catch (_) {}

  if (markAll) markAll.onclick = async () => {
    if (markAll.disabled) return;
    markAll.disabled = true;
    markAll.textContent = 'Marking…';
    const { error } = await FX.client.from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', FX.user.id).is('read_at', null);
    markAll.textContent = 'Mark all as read';
    if (error) {
      markAll.disabled = false;
      FX.toast('Could not mark notifications as read. Please try again.');
      console.error('Mark all notifications as read failed:', error);
    } else {
      FX.toast('Notifications marked as read.');
      await load();
    }
  };
});
