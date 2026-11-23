document.addEventListener('DOMContentLoaded', async () => {
  await FX.loadUser();
  const postId = new URLSearchParams(location.search).get('id');
  const $ = FX.qs;
  if (!FX.client) {
    $('#post-detail').innerHTML = '<div class="empty">The post service is temporarily unavailable. Please try again later.</div>';
    return;
  }
  if (!postId) {
    $('#post-detail').innerHTML = '<div class="empty">No post was selected.</div>';
    return;
  }

  // Post reactions use the post_reactions table's allowed keys; comment reactions
  // use comment_reactions. The visible seven choices are shared by both controls.
  const emojiReactions = [
    { key: 'like', emoji: '👍', label: 'Like' },
    { key: 'love', emoji: '❤️', label: 'Love' },
    { key: 'laugh', emoji: '😂', commentKey: 'haha', label: 'Haha' },
    { key: 'wow', emoji: '😮', label: 'Wow' },
    { key: 'sad', emoji: '😢', label: 'Sad' },
    { key: 'angry', emoji: '😡', label: 'Angry' },
    { key: 'support', emoji: '🤗', label: 'Support' }
  ];
  const commentReactionKey = key => key === 'laugh' ? 'haha' : key;
  const postReactionKey = key => key === 'haha' ? 'laugh' : key;
  const hiddenKey = `frnxup-hidden-comments:${postId}`;
  let hiddenComments = new Set();
  try { hiddenComments = new Set(JSON.parse(localStorage.getItem(hiddenKey) || '[]')); } catch (_) {}
  let replyTarget = null;
  let allComments = [];
  let reactionsByComment = new Map();
  let avatarUrls = new Map();
  let activePost = null;
  let longPressState = null;
  const suppressedClicks = new Set();

  function reactionPickerMarkup(type, id) {
    const isPost = type === 'post';
    return `<div class="fx-reaction-tray" data-${type}-reaction-tray="${FX.esc(id)}" hidden role="group" aria-label="Choose a reaction">
      ${emojiReactions.map(item => `<button type="button" class="fx-reaction-choice" data-${type}-reaction="${item.key}" ${isPost ? '' : `data-comment-id="${FX.esc(id)}"`} title="${item.label}" aria-label="${item.label}">${item.emoji}</button>`).join('')}
    </div>`;
  }

  function beginLongPress(event, button, key) {
    if (!button || (event.button !== undefined && event.button !== 0)) return;
    cancelLongPress();
    const tray = button.parentElement?.querySelector(`[data-${button.hasAttribute('data-post-like') ? 'post' : 'comment'}-reaction-tray]`);
    if (!tray) return;
    const state = {
      key,
      button,
      tray,
      x: event.clientX || 0,
      y: event.clientY || 0,
      activated: false,
      timer: null
    };
    state.timer = setTimeout(() => {
      if (longPressState !== state) return;
      state.activated = true;
      tray.hidden = false;
      tray.classList.add('is-open');
      button.setAttribute('aria-expanded', 'true');
      try { if (navigator.vibrate) navigator.vibrate(12); } catch (_) {}
    }, 430);
    longPressState = state;
  }

  function cancelLongPress() {
    if (!longPressState) return;
    clearTimeout(longPressState.timer);
    if (longPressState.activated) {
      suppressedClicks.add(longPressState.key);
      setTimeout(() => suppressedClicks.delete(longPressState.key), 850);
    }
    longPressState = null;
  }

  function trackLongPressMove(event) {
    if (!longPressState) return;
    const dx = (event.clientX || 0) - longPressState.x;
    const dy = (event.clientY || 0) - longPressState.y;
    if (Math.hypot(dx, dy) > 14) cancelLongPress();
  }

  function closeReactionTrays(except = null) {
    FX.qsa('.fx-reaction-tray').forEach(tray => {
      if (tray !== except) {
        tray.hidden = true;
        tray.classList.remove('is-open');
        const button = tray.parentElement?.querySelector('[data-comment-like], [data-post-like]');
        button?.setAttribute('aria-expanded', 'false');
      }
    });
  }

  async function loadPost() {
    const { data: post, error } = await FX.client.from('posts')
      .select('id,user_id,page_id,body,media_path,media_type,visibility,location_label,status,created_at,profiles!posts_user_id_fkey(username,display_name),post_reactions(user_id,reaction),repost_of')
      .eq('id', postId).eq('status', 'published').maybeSingle();
    if (error || !post) {
      $('#post-detail').innerHTML = '<div class="empty">This post is unavailable or private.</div>';
      return;
    }
    activePost = post;
    const { data: mediaRows } = await FX.client.from('post_media').select('media_path,media_type,sort_order').eq('post_id', post.id).order('sort_order', { ascending: true });
    const mediaItems = mediaRows?.length ? mediaRows : (post.media_path ? [{ media_path: post.media_path, media_type: post.media_type || 'image', sort_order: 1 }] : []);
    const mediaUrls = await Promise.all(mediaItems.map(item => FX.mediaUrl(item.media_path)));
    const gallery = window.FXMediaTools?.collage(mediaItems.map((item, index) => ({
      url: mediaUrls[index], type: item.media_type,
      name: `frnxup-${post.id}-${item.sort_order}.${(item.media_path?.split('.').pop() || (item.media_type === 'video' ? 'mp4' : 'jpg')).toLowerCase()}`
    })).filter(item => item.url), `post-detail-${post.id}`, 'Post media') || '';
    const myReaction = !!FX.user && post.post_reactions?.find(reaction => reaction.user_id === FX.user.id);
    const reactionInfo = myReaction ? emojiReactions.find(item => item.key === postReactionKey(myReaction.reaction)) : null;
    const name = post.profiles?.display_name || post.profiles?.username || 'Frnxup member';
    let authorPage = null;
    if (post.page_id) {
      const { data } = await FX.client.from('frnxup_pages').select('name,slug,avatar_path').eq('id', post.page_id).maybeSingle();
      authorPage = data || null;
    } else {
      const { data } = await FX.client.from('frnxup_pages').select('name,slug,avatar_path').eq('owner_user_id', post.user_id).eq('status', 'active').order('created_at', { ascending: false }).limit(1).maybeSingle();
      authorPage = data || null;
    }
    const shownName = post.page_id ? (authorPage?.name || name) : name;
    const authorHref = authorPage ? `/Pages/view.html?slug=${encodeURIComponent(authorPage.slug)}` : `/Dashboard/profile.html?id=${encodeURIComponent(post.user_id)}`;
    const authorAvatar = authorPage?.avatar_path ? await FX.mediaUrl(authorPage.avatar_path) : '';
    const postCount = post.post_reactions?.length || 0;
    $('#post-detail').innerHTML = `<article class="card post-card" data-post="${post.id}" data-owner="${post.user_id}">
      <div class="post-header">
        <a class="avatar" href="${authorHref}">${authorAvatar ? `<img src="${FX.esc(authorAvatar)}" alt="">` : FX.esc(shownName.slice(0, 2).toUpperCase())}</a>
        <div class="post-head-copy"><b><a href="${authorHref}">${FX.esc(shownName)}</a></b><small>${post.page_id ? 'Frnxup Page' : `@${FX.esc(post.profiles?.username || 'member')}`} · ${FX.esc(FX.relative(post.created_at))} · ${FX.esc(post.visibility)}</small>${authorPage ? `<a class="fx-post-page-badge" href="${authorHref}">▣ ${FX.esc(authorPage.name)} · Frnxup Page</a>` : ''}</div>
        <button class="post-more" data-post-menu="${post.id}" aria-label="Post options" title="Post options">•••</button>
      </div>
      ${post.body ? `<div class="post-text">${FX.esc(post.body)}</div>` : ''}
      ${gallery}
      ${post.location_label ? `<small class="muted">⌖ ${FX.esc(post.location_label)}</small>` : ''}
      <div class="post-actions fx-post-actions">
        ${FX.user ? `<div class="fx-post-like-wrap"><button id="like-post" type="button" class="fx-post-like ${myReaction ? 'active' : ''}" data-post-like aria-expanded="false"><span class="fx-post-like-emoji">${reactionInfo?.emoji || '👍'}</span><span>${reactionInfo?.label || 'Like'}</span><small>${postCount}</small></button>${reactionPickerMarkup('post', post.id)}</div><button id="bookmark-post" type="button">▣ Save</button>` : `<a class="small" href="/Auth/index.html?next=${encodeURIComponent(location.pathname + location.search)}">Log in to react or save</a>`}
        <button id="share-post" type="button">↗ Share</button>
      </div>
    </article>`;

    $('#share-post').onclick = async () => {
      const url = location.href;
      if (navigator.share) {
        try { await navigator.share({ title: 'Frnxup post', url }); return; }
        catch (error) { if (error?.name === 'AbortError') return; }
      }
      try { await navigator.clipboard.writeText(url); FX.toast('Post link copied.'); }
      catch (_) { FX.toast(url); }
    };
    if (FX.user) $('#bookmark-post').onclick = async () => {
      const { error: saveError } = await FX.client.from('bookmarks').insert({ user_id: FX.user.id, post_id: postId });
      FX.toast(saveError?.code === '23505' ? 'This post is already saved.' : saveError ? saveError.message : 'Post saved.');
    };
  }

  async function reactToPost(reaction) {
    if (!FX.user) throw new Error('Please log in to react to posts.');
    const current = activePost?.post_reactions?.find(item => item.user_id === FX.user.id);
    if (current?.reaction === reaction || (!reaction && current)) {
      const { error } = await FX.client.from('post_reactions').delete().eq('post_id', postId).eq('user_id', FX.user.id);
      if (error) throw error;
    } else {
      // The current post_reactions RLS policy permits INSERT/DELETE but not UPDATE.
      if (current) {
        const { error: deleteError } = await FX.client.from('post_reactions').delete().eq('post_id', postId).eq('user_id', FX.user.id);
        if (deleteError) throw deleteError;
      }
      const { error } = await FX.client.from('post_reactions').insert({ post_id: postId, user_id: FX.user.id, reaction });
      if (error) throw error;
    }
    await loadPost();
  }

  function contextMarkup(comment, mine) {
    const deleted = comment.status === 'deleted';
    const items = !FX.user
      ? [['copy', 'Copy'], ['share', 'Share']]
      : deleted
        ? [['reply', 'Reply'], ['copy', 'Copy']]
        : mine
          ? [['edit', 'Edit'], ['reply', 'Reply'], ['copy', 'Copy'], ['share', 'Share'], ['delete', 'Delete comment']]
          : [['reply', 'Reply'], ['copy', 'Copy'], ['hide', 'Hide'], ['report', 'Report']];
    return `<div class="comment-context-menu" hidden>
      <div class="comment-context-actions">${items.map(([action, label]) => `<button type="button" data-comment-action="${action}" data-comment-id="${comment.id}" class="${action === 'delete' || action === 'report' ? 'danger-action' : ''}">${label}</button>`).join('')}</div>
    </div>`;
  }

  function renderComment(comment, depth = 0) {
    const mine = !!FX.user && comment.user_id === FX.user.id;
    const name = comment.profiles?.display_name || comment.profiles?.username || 'Frnxup member';
    const deleted = comment.status === 'deleted';
    const hidden = hiddenComments.has(comment.id);
    const reactions = reactionsByComment.get(comment.id) || [];
    const myReaction = FX.user ? reactions.find(item => item.user_id === FX.user.id) : null;
    const counts = new Map();
    reactions.forEach(reaction => counts.set(reaction.reaction, (counts.get(reaction.reaction) || 0) + 1));
    const children = comment.children || [];
    const body = hidden ? '<span class="muted">You hid this comment.</span>' : FX.esc(deleted ? 'This comment was deleted.' : comment.body);
    const summary = [...counts.entries()].map(([key, count]) => {
      const info = emojiReactions.find(item => (item.commentKey || item.key) === key || item.key === key);
      const mineMark = !!myReaction && myReaction.reaction === key;
      return `<span class="fx-comment-reaction-chip ${mineMark ? 'mine' : ''}">${info?.emoji || '👍'} <b>${count}</b></span>`;
    }).join('');
    const avatarUrl = avatarUrls.get(comment.user_id) || '';
    const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase() || 'F';
    const avatar = avatarUrl ? `<img src="${FX.esc(avatarUrl)}" alt="${FX.esc(name)}" loading="lazy">` : FX.esc(initials);
    const replyControls = FX.user && !deleted ? `<button type="button" class="fx-comment-reply" data-comment-action="reply" data-comment-id="${comment.id}">Reply</button>` : '';
    const likeControl = FX.user && !deleted ? `<button type="button" class="fx-comment-like ${myReaction ? 'active' : ''}" data-comment-like="${comment.id}" aria-expanded="false" aria-label="${myReaction ? (emojiReactions.find(item => (item.commentKey || item.key) === myReaction.reaction || item.key === myReaction.reaction)?.label || 'Reacted') : 'Like'}">${myReaction ? (emojiReactions.find(item => (item.commentKey || item.key) === myReaction.reaction || item.key === myReaction.reaction)?.emoji || '👍') : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10v11H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3Zm0 0 4.2-7.1a2.1 2.1 0 0 1 2.8-.7c.7.4 1 1.3.8 2.1L14 10h5a3 3 0 0 1 2.9 3.8l-2 6A3 3 0 0 1 19 22H7"/></svg>'}</button>${reactionPickerMarkup('comment', comment.id)}` : '';
    return `<article class="comment-item fx-comment-node ${hidden ? 'comment-hidden' : ''}" id="comment-${comment.id}" data-comment-node="${comment.id}" style="--comment-depth:${Math.min(depth, 12)}">
      <div class="fx-comment-row">
        <a class="fx-comment-avatar" href="/Dashboard/profile.html?id=${encodeURIComponent(comment.user_id)}" aria-label="View ${FX.esc(name)} profile">${avatar}</a>
        <div class="fx-comment-main">
          <div class="fx-comment-bubble ${deleted ? 'deleted' : ''}">
            <div class="fx-comment-byline"><a href="/Dashboard/profile.html?id=${encodeURIComponent(comment.user_id)}">${FX.esc(name)}</a><time>· ${FX.esc(FX.relative(comment.created_at))}</time>${mine ? '<span class="fx-comment-you">You</span>' : ''}<button type="button" class="comment-open-menu" data-comment-open="${comment.id}" aria-label="Comment options">•••</button></div>
            <div class="comment-body ${deleted ? 'deleted' : ''}" data-comment-hold="${comment.id}">${body}</div>
          </div>
          ${summary ? `<div class="fx-comment-reaction-summary">${summary}</div>` : ''}
          <div class="fx-comment-tools">${replyControls}${myReaction ? `<span class="fx-comment-reacted-label">${emojiReactions.find(item => (item.commentKey || item.key) === myReaction.reaction || item.key === myReaction.reaction)?.label || 'Reacted'}</span>` : ''}${likeControl}</div>
          ${hidden ? `<div class="comment-context-actions"><button type="button" data-restore-comment="${comment.id}">Show comment</button></div>` : contextMarkup(comment, mine)}
        </div>
      </div>
      ${children.length ? `<div class="comment-children">${children.map(child => renderComment(child, depth + 1)).join('')}</div>` : ''}
    </article>`;
  }

  async function fetchAllComments() {
    const batchSize = 500;
    const collected = [];
    for (let start = 0; ; start += batchSize) {
      const { data, error } = await FX.client.from('post_comments')
        .select('id,post_id,user_id,parent_id,body,status,created_at,profiles!post_comments_user_id_fkey(username,display_name,avatar_path)')
        .eq('post_id', postId)
        .in('status', ['published', 'deleted'])
        .order('created_at', { ascending: true })
        .range(start, start + batchSize - 1);
      if (error) throw error;
      collected.push(...(data || []));
      if (!data || data.length < batchSize) break;
    }
    return collected;
  }

  async function loadComments() {
    const host = $('#comments-list');
    host.innerHTML = '<div class="comment-empty">Loading comments…</div>';
    try {
      allComments = await fetchAllComments();
      // Resolve each distinct commenter avatar once and reuse the signed URL on refresh.
      const avatarEntries = new Map();
      allComments.forEach(comment => {
        if (comment.profiles?.avatar_path && !avatarUrls.has(comment.user_id)) avatarEntries.set(comment.user_id, comment.profiles.avatar_path);
      });
      await Promise.all([...avatarEntries].map(async ([userId, path]) => {
        const url = await FX.mediaUrl(path);
        if (url) avatarUrls.set(userId, url);
      }));

      reactionsByComment = new Map();
      for (let start = 0; start < allComments.length; start += 500) {
        const ids = allComments.slice(start, start + 500).map(comment => comment.id);
        if (!ids.length) continue;
        const { data, error } = await FX.client.from('comment_reactions').select('comment_id,user_id,reaction').in('comment_id', ids);
        if (error) throw error;
        (data || []).forEach(reaction => {
          if (!reactionsByComment.has(reaction.comment_id)) reactionsByComment.set(reaction.comment_id, []);
          reactionsByComment.get(reaction.comment_id).push(reaction);
        });
      }

      // Build the reply tree from parent_id. Every reply may itself have replies;
      // nesting is not capped by the interface or by this renderer.
      const nodes = new Map(allComments.map(comment => [comment.id, { ...comment, children: [] }]));
      const roots = [];
      // Detect broken/cyclic parent chains defensively, then build the thread tree.
      const safeParent = new Map();
      allComments.forEach(comment => {
        let parentId = comment.parent_id;
        const seen = new Set([comment.id]);
        let cursor = parentId;
        let cyclic = false;
        while (cursor && nodes.has(cursor)) {
          if (seen.has(cursor)) { cyclic = true; break; }
          seen.add(cursor);
          cursor = nodes.get(cursor).parent_id;
        }
        safeParent.set(comment.id, cyclic || !nodes.has(parentId) ? null : parentId);
      });
      allComments.forEach(comment => {
        const node = nodes.get(comment.id);
        const parentId = safeParent.get(comment.id);
        const parent = parentId ? nodes.get(parentId) : null;
        if (parent) parent.children.push(node);
        else roots.push(node);
      });

      const total = allComments.length;
      $('#comment-count').textContent = `${total.toLocaleString()} comment${total === 1 ? '' : 's'}`;
      host.innerHTML = roots.map(comment => renderComment(comment)).join('') || '<div class="comment-empty">No comments yet. Start the conversation.</div>';
    } catch (error) {
      host.innerHTML = `<div class="comment-empty">${FX.esc(error.message)}</div>`;
    }
  }

  function closeCommentMenus(except = null) {
    FX.qsa('.comment-context-menu').forEach(menu => {
      if (menu !== except) menu.hidden = true;
    });
    FX.qsa('.comment-item.context-open').forEach(item => {
      if (!except || !item.contains(except)) item.classList.remove('context-open');
    });
  }

  function openCommentMenu(id) {
    closeCommentMenus();
    const node = document.querySelector(`[data-comment-node="${CSS.escape(id)}"]`);
    const menu = node?.querySelector('.comment-context-menu');
    if (menu) {
      menu.hidden = false;
      node.classList.add('context-open');
    }
  }

  function startReply(id) {
    if (!FX.user) {
      location.href = '/Auth/index.html?next=' + encodeURIComponent(location.pathname + location.search + `#comment-${id}`);
      return;
    }
    const comment = allComments.find(item => item.id === id);
    const name = comment?.profiles?.display_name || comment?.profiles?.username || 'member';
    replyTarget = id;
    $('#reply-context').hidden = false;
    $('#reply-context').innerHTML = `Replying to ${FX.esc(name)}<button type="button" id="cancel-comment-reply">Cancel</button>`;
    $('#comment-body').placeholder = `Reply to ${name}…`;
    $('#comment-body').focus({ preventScroll: true });
    $('#comment-composer').scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  async function shareComment(id) {
    const url = `${location.origin}/Posts/view.html?id=${encodeURIComponent(postId)}#comment-${encodeURIComponent(id)}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Frnxup comment', url }); return; }
      catch (error) { if (error?.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); FX.toast('Comment link copied.'); }
    catch (_) { FX.toast(url); }
  }

  async function handleCommentAction(action, id) {
    const comment = allComments.find(item => item.id === id);
    if (!comment) return;
    const mine = !!FX.user && comment.user_id === FX.user.id;
    if (!FX.user && !['copy', 'share', 'hide'].includes(action)) throw new Error('Please log in to interact with comments.');
    if (action === 'reply') return startReply(id);
    if (action === 'copy') {
      try { await navigator.clipboard.writeText(comment.body || 'This comment was deleted.'); FX.toast('Comment copied.'); }
      catch (_) { FX.toast(comment.body || 'This comment was deleted.'); }
    }
    if (action === 'share') await shareComment(id);
    if (action === 'hide') {
      hiddenComments.add(id);
      localStorage.setItem(hiddenKey, JSON.stringify([...hiddenComments]));
      await loadComments();
    }
    if (action === 'report') {
      const reason = prompt('Why are you reporting this comment?');
      if (!reason?.trim()) return;
      const { error } = await FX.client.from('reports').insert({ reporter_id: FX.user.id, target_type: 'comment', target_id: id, reason: reason.trim() });
      if (error) throw error;
      FX.toast('Comment reported to the moderation team.');
    }
    if (action === 'edit') {
      if (comment.status === 'deleted') throw new Error('Deleted comments cannot be edited.');
      if (!mine) throw new Error('You can only edit your own comments.');
      const body = prompt('Edit your comment', comment.body);
      if (body === null) return;
      if (!body.trim()) throw new Error('A comment cannot be empty.');
      const { error } = await FX.client.from('post_comments').update({ body: body.trim() }).eq('id', id).eq('user_id', FX.user.id);
      if (error) throw error;
      await loadComments();
    }
    if (action === 'delete') {
      if (comment.status === 'deleted') throw new Error('This comment has already been deleted.');
      if (!mine) throw new Error('You can only delete your own comments.');
      if (!confirm('Delete this comment? Replies will remain in the conversation.')) return;
      const { error } = await FX.client.from('post_comments').update({ body: 'This comment was deleted.', status: 'deleted' }).eq('id', id).eq('user_id', FX.user.id);
      if (error) throw error;
      await loadComments();
    }
  }

  async function reactToComment(id, reaction) {
    if (!FX.user) throw new Error('Please log in to react to comments.');
    const target = allComments.find(item => item.id === id);
    if (!target || target.status !== 'published') throw new Error('Reactions are unavailable for this comment.');
    const dbReaction = commentReactionKey(reaction);
    const current = (reactionsByComment.get(id) || []).find(item => item.user_id === FX.user.id);
    if (current?.reaction === dbReaction) {
      const { error } = await FX.client.from('comment_reactions').delete().eq('comment_id', id).eq('user_id', FX.user.id);
      if (error) throw error;
    } else {
      const { error } = await FX.client.from('comment_reactions').upsert({ comment_id: id, user_id: FX.user.id, reaction: dbReaction }, { onConflict: 'comment_id,user_id' });
      if (error) throw error;
    }
    await loadComments();
  }

  if (!FX.user) {
    $('#comment-body').placeholder = 'Log in to join the discussion…';
    $('#comment-body').setAttribute('aria-label', 'Log in to write a comment');
    $('#send-comment').textContent = 'Log in to comment';
  } else if (FX.profile?.display_name) {
    $('#comment-body').placeholder = `Comment as ${FX.profile.display_name}…`;
  }
  const composeAvatar = $('.fx-compose-avatar');
  if (composeAvatar && FX.profile) {
    const composeName = FX.profile.display_name || FX.profile.username || 'F';
    composeAvatar.textContent = composeName.trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase();
    if (FX.profile.avatar_path) {
      FX.mediaUrl(FX.profile.avatar_path).then(composeAvatarUrl => { if (composeAvatarUrl) composeAvatar.innerHTML = `<img src="${FX.esc(composeAvatarUrl)}" alt="">`; }).catch(() => {});
    }
  }

  $('#send-comment').addEventListener('click', async () => {
    if (!FX.user) {
      location.href = '/Auth/index.html?next=' + encodeURIComponent(location.pathname + location.search);
      return;
    }
    const body = $('#comment-body').value.trim();
    if (!body) return;
    $('#send-comment').disabled = true;
    try {
      const { error } = await FX.client.from('post_comments').insert({ post_id: postId, user_id: FX.user.id, body, parent_id: replyTarget });
      if (error) throw error;
      $('#comment-body').value = '';
      replyTarget = null;
      $('#reply-context').hidden = true;
      $('#reply-context').innerHTML = '';
      $('#comment-body').placeholder = FX.profile?.display_name ? `Comment as ${FX.profile.display_name}…` : 'Write a comment…';
      await loadComments();
    } catch (error) {
      FX.toast(error.message);
    } finally {
      $('#send-comment').disabled = false;
    }
  });

  $('#reply-context').addEventListener('click', event => {
    if (event.target.id !== 'cancel-comment-reply') return;
    replyTarget = null;
    $('#reply-context').hidden = true;
    $('#reply-context').innerHTML = '';
    $('#comment-body').placeholder = FX.profile?.display_name ? `Comment as ${FX.profile.display_name}…` : 'Write a comment…';
  });
  $('#close-comments-sheet').addEventListener('click', () => {
    if (window.matchMedia('(max-width: 700px)').matches) {
      let sameOriginReferrer = false;
      try { sameOriginReferrer = !!document.referrer && new URL(document.referrer).origin === location.origin; } catch (_) {}
      if (sameOriginReferrer && history.length > 1) history.back();
      else location.href = '/index.html';
    }
  });

  $('#post-detail').addEventListener('pointerdown', event => {
    const button = event.target.closest('[data-post-like]');
    if (button) beginLongPress(event, button, `post:${postId}`);
  });
  $('#comments-list').addEventListener('pointerdown', event => {
    const button = event.target.closest('[data-comment-like]');
    if (button) beginLongPress(event, button, `comment:${button.dataset.commentLike}`);
    const target = event.target.closest('[data-comment-hold]');
    if (!target || event.pointerType === 'mouse') return;
    const id = target.dataset.commentHold;
    clearTimeout(window.frnxupCommentHoldTimer);
    window.frnxupCommentHoldTimer = setTimeout(() => openCommentMenu(id), 620);
  });

  ['pointerup', 'pointercancel', 'pointerleave'].forEach(type => {
    $('#post-detail').addEventListener(type, cancelLongPress, { passive: true });
    $('#comments-list').addEventListener(type, () => { cancelLongPress(); clearTimeout(window.frnxupCommentHoldTimer); }, { passive: true });
  });
  $('#post-detail').addEventListener('pointermove', trackLongPressMove, { passive: true });
  $('#comments-list').addEventListener('pointermove', event => {
    trackLongPressMove(event);
    // A comment-body hold opens the context menu; moving cancels the pending hold.
    if (event.target.closest('[data-comment-hold]')) clearTimeout(window.frnxupCommentHoldTimer);
  }, { passive: true });

  $('#post-detail').addEventListener('click', async event => {
    const choice = event.target.closest('[data-post-reaction]');
    if (choice) {
      closeReactionTrays();
      try { await reactToPost(choice.dataset.postReaction); } catch (error) { FX.toast(error.message); }
      return;
    }
    const like = event.target.closest('[data-post-like]');
    if (like) {
      if (suppressedClicks.has(`post:${postId}`)) { suppressedClicks.delete(`post:${postId}`); return; }
      closeReactionTrays();
      try {
        await reactToPost('like');
      } catch (error) { FX.toast(error.message); }
    }
  });

  $('#comments-list').addEventListener('click', async event => {
    const open = event.target.closest('[data-comment-open]');
    if (open) { openCommentMenu(open.dataset.commentOpen); return; }
    const restore = event.target.closest('[data-restore-comment]');
    if (restore) {
      hiddenComments.delete(restore.dataset.restoreComment);
      localStorage.setItem(hiddenKey, JSON.stringify([...hiddenComments]));
      await loadComments();
      return;
    }
    const react = event.target.closest('[data-comment-reaction]');
    if (react) {
      closeReactionTrays();
      try { await reactToComment(react.dataset.commentId, react.dataset.commentReaction); }
      catch (error) { FX.toast(error.message); }
      return;
    }
    const like = event.target.closest('[data-comment-like]');
    if (like) {
      const id = like.dataset.commentLike;
      if (suppressedClicks.has(`comment:${id}`)) { suppressedClicks.delete(`comment:${id}`); return; }
      closeReactionTrays();
      try { await reactToComment(id, 'like'); } catch (error) { FX.toast(error.message); }
      return;
    }
    const action = event.target.closest('[data-comment-action]');
    if (action) {
      closeCommentMenus();
      try { await handleCommentAction(action.dataset.commentAction, action.dataset.commentId); }
      catch (error) { FX.toast(error.message); }
    }
  });

  document.addEventListener('click', event => {
    if (!event.target.closest('.comment-item')) closeCommentMenus();
    if (!event.target.closest('.fx-reaction-tray, [data-comment-like], [data-post-like]')) closeReactionTrays();
  });

  await loadPost();
  await loadComments();
});
