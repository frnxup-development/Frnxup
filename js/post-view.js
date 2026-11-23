document.addEventListener('DOMContentLoaded', async () => {
  const $ = FX.qs;
  try { await FX.loadUser(); } catch (error) { const host = $('#post-detail'); if (host) FXStates.fail(host, error, { retry: () => location.reload(), title: 'Your post session could not be refreshed' }); return; }
  const postId = new URLSearchParams(location.search).get('id');
  if (!FX.client) {
    FXStates.render($('#post-detail'), 'configuration');
    return;
  }
  if (!postId) {
    FXStates.render($('#post-detail'), 'unavailable', { title: 'No post selected', message: 'Open a post from the Frnxup feed to view its details and comments.' });
    return;
  }
  const emojiReactions = [
    { key: 'like', emoji: '👍', label: 'Like' },
    { key: 'love', emoji: '❤️', label: 'Love' },
    { key: 'haha', emoji: '😂', label: 'Haha' },
    { key: 'wow', emoji: '😮', label: 'Wow' },
    { key: 'sad', emoji: '😢', label: 'Sad' },
    { key: 'angry', emoji: '😡', label: 'Angry' },
    { key: 'support', emoji: '🤗', label: 'Support' }
  ];
  const hiddenKey = `frnxup-hidden-comments:${postId}`;
  const hiddenComments = new Set(JSON.parse(localStorage.getItem(hiddenKey) || '[]'));
  let replyTarget = null;
  let allComments = [];
  let reactionsByComment = new Map();

  async function loadPost() {
    const postHost = $('#post-detail');if(postHost.dataset.fxHasContent!=='true')FXStates.loading(postHost,{title:'Loading post',message:'Fetching the post and its media.'});
    const { data: post, error } = await FX.client.from('posts')
      .select('id,user_id,page_id,body,media_path,media_type,visibility,location_label,status,created_at,profiles!posts_user_id_fkey(username,display_name),post_reactions(user_id,reaction),repost_of')
      .eq('id', postId).eq('status', 'published').maybeSingle();
    if (error) { FXStates.fail(postHost,error,{retry:loadPost}); return; }
    if (!post) { FXStates.render(postHost,'unavailable',{title:'This post is unavailable',message:'It may have been removed, made private or is no longer accessible.'}); return; }
    const {data: mediaRows,error:mediaError} = await FX.client.from('post_media').select('media_path,media_type,sort_order').eq('post_id', post.id).order('sort_order', {ascending: true});
    if(mediaError){FXStates.fail(postHost,mediaError,{retry:loadPost,title:'Post photos and videos could not be loaded'});return;}
    const mediaItems = mediaRows?.length ? mediaRows : (post.media_path ? [{media_path:post.media_path,media_type:post.media_type||'image',sort_order:1}] : []);
    const mediaUrls = await Promise.all(mediaItems.map(item => FX.mediaUrl(item.media_path)));
    const gallery = window.FXMediaTools?.collage(mediaItems.map((item,index)=>({url:mediaUrls[index],type:item.media_type,name:`frnxup-${post.id}-${item.sort_order}.${(item.media_path?.split('.').pop()||(item.media_type==='video'?'mp4':'jpg')).toLowerCase()}`})).filter(item=>item.url),`post-detail-${post.id}`,'Post media') || '';
    const mine = !!FX.user && post.post_reactions?.some(reaction => reaction.user_id === FX.user.id);
    const name = post.profiles?.display_name || post.profiles?.username || 'Frnxup member';
    let authorPage=null;
    if(post.page_id){const {data,error:pageError}=await FX.client.from('frnxup_pages').select('name,slug,avatar_path').eq('id',post.page_id).maybeSingle();if(pageError){FXStates.fail(postHost,pageError,{retry:loadPost,title:'Page author information could not be loaded'});return;}authorPage=data||null;}
    else {const {data,error:pageError}=await FX.client.from('frnxup_pages').select('name,slug,avatar_path').eq('owner_user_id',post.user_id).eq('status','active').order('created_at',{ascending:false}).limit(1).maybeSingle();if(pageError){FXStates.fail(postHost,pageError,{retry:loadPost,title:'Page author information could not be loaded'});return;}authorPage=data||null;}
    const shownName=post.page_id?(authorPage?.name||name):name;
    const authorHref=authorPage?`/Pages/view.html?slug=${encodeURIComponent(authorPage.slug)}`:`/Dashboard/profile.html?id=${encodeURIComponent(post.user_id)}`;
    const authorAvatar=authorPage?.avatar_path?await FX.mediaUrl(authorPage.avatar_path):'';
    postHost.innerHTML = `<article class="card post-card" data-post="${post.id}" data-owner="${post.user_id}">
      <div class="post-header">
        <a class="avatar" href="${authorHref}">${authorAvatar?`<img src="${FX.esc(authorAvatar)}" alt="">`:FX.esc(shownName.slice(0, 2).toUpperCase())}</a>
        <div class="post-head-copy"><b><a href="${authorHref}">${FX.esc(shownName)}</a></b><small>${post.page_id?'Frnxup Page':`@${FX.esc(post.profiles?.username || 'member')}`} · ${FX.esc(FX.relative(post.created_at))} · ${FX.esc(post.visibility)}</small>${authorPage?`<a class="fx-post-page-badge" href="${authorHref}">▣ ${FX.esc(authorPage.name)} · Frnxup Page</a>`:''}</div>
        <button class="post-more" data-post-menu="${post.id}" aria-label="Post options" title="Post options">•••</button>
      </div>
      ${post.body ? `<div class="post-text">${FX.esc(post.body)}</div>` : ''}
      ${gallery}
      ${post.location_label ? `<small class="muted">⌖ ${FX.esc(post.location_label)}</small>` : ''}
      <div class="post-actions">${FX.user ? `<button id="like-post" class="${mine ? 'active' : ''}">♡ ${post.post_reactions?.length || 0} Like</button><button id="bookmark-post">▣ Save</button>` : `<a class="small" href="/Auth/index.html?next=${encodeURIComponent(location.pathname + location.search)}">Log in to react or save</a>`}<button id="share-post">↗ Share</button></div>
    </article>`;
    FXStates.loaded(postHost);
    if (FX.user) $('#like-post').onclick = async () => {
      const { error: reactionError } = await FX.client.from('post_reactions').insert({ post_id: postId, user_id: FX.user.id, reaction: 'like' });
      if (reactionError && reactionError.code !== '23505') FX.toast(reactionError.message);
      loadPost();
    };
    $('#share-post').onclick = async () => {
      const url = location.href;
      if (navigator.share) {
        try { await navigator.share({ title: 'Frnxup post', url }); return; }
        catch (error) { if (error?.name === 'AbortError') return; }
      }
      await navigator.clipboard.writeText(url);
      FX.toast('Post link copied.');
    };
    if (FX.user) $('#bookmark-post').onclick = async () => {
      const { error: saveError } = await FX.client.from('bookmarks').insert({ user_id: FX.user.id, post_id: postId });
      FX.toast(saveError?.code === '23505' ? 'This post is already saved.' : saveError ? saveError.message : 'Post saved.');
    };
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
      ${deleted || !FX.user ? '' : `<div class="comment-reaction-picker">${emojiReactions.map(reaction => `<button type="button" data-comment-react="${reaction.key}" data-comment-id="${comment.id}" title="${reaction.label}" aria-label="${reaction.label}">${reaction.emoji}</button>`).join('')}</div>`}
      <div class="comment-context-actions">${items.map(([action, label]) => `<button type="button" data-comment-action="${action}" data-comment-id="${comment.id}" class="${action === 'delete' || action === 'report' ? 'danger-action' : ''}">${label}</button>`).join('')}</div>
    </div>`;
  }

  function renderComment(comment, depth = 0) {
    const mine = !!FX.user && comment.user_id === FX.user.id;
    const name = comment.profiles?.display_name || comment.profiles?.username || 'Frnxup member';
    const deleted = comment.status === 'deleted';
    const hidden = hiddenComments.has(comment.id);
    const reactions = reactionsByComment.get(comment.id) || [];
    const counts = new Map();
    reactions.forEach(reaction => counts.set(reaction.reaction, (counts.get(reaction.reaction) || 0) + 1));
    const children = comment.children || [];
    const body = hidden ? '<span class="muted">You hid this comment.</span>' : FX.esc(deleted ? 'This comment was deleted.' : comment.body);
    const summary = [...counts.entries()].map(([key, count]) => {
      const info = emojiReactions.find(item => item.key === key);
      const mineReaction = !!FX.user && reactions.some(item => item.user_id === FX.user.id && item.reaction === key);
      return `<span class="comment-reaction-chip ${mineReaction ? 'mine' : ''}">${info?.emoji || '👍'} ${count}</span>`;
    }).join('');
    return `<article class="comment-item ${hidden ? 'comment-hidden' : ''}" id="comment-${comment.id}" data-comment-node="${comment.id}" style="--comment-depth:${depth}">
      <div class="comment-head"><b>${FX.esc(name)}</b><time>${FX.esc(FX.relative(comment.created_at))}</time>${mine ? '<span class="comment-own-mark">You</span>' : ''}
        <button type="button" class="comment-open-menu" data-comment-open="${comment.id}" aria-label="Comment options">•••</button>
      </div>
      <div class="comment-body ${deleted ? 'deleted' : ''}" data-comment-hold="${comment.id}">${body}</div>
      ${summary ? `<div class="comment-reaction-summary">${summary}</div>` : ''}
      ${hidden ? `<div class="comment-context-actions"><button type="button" data-restore-comment="${comment.id}">Show comment</button></div>` : contextMarkup(comment, mine)}
      ${children.length ? `<div class="comment-children">${children.map(child => renderComment(child, depth + 1)).join('')}</div>` : ''}
    </article>`;
  }

  async function fetchAllComments() {
    const batchSize = 500;
    const collected = [];
    for (let start = 0; ; start += batchSize) {
      const { data, error } = await FX.client.from('post_comments')
        .select('id,post_id,user_id,parent_id,body,status,created_at,profiles!post_comments_user_id_fkey(username,display_name)')
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
    if(host.dataset.fxHasContent!=='true')FXStates.loading(host,{title:'Loading comments',message:'Fetching the full comment thread and replies.'});
    try {
      allComments = await fetchAllComments();
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
      const nodes = new Map(allComments.map(comment => [comment.id, { ...comment, children: [] }]));
      const roots = [];
      allComments.forEach(comment => {
        const node = nodes.get(comment.id);
        const parent = comment.parent_id ? nodes.get(comment.parent_id) : null;
        if (parent) parent.children.push(node);
        else roots.push(node);
      });
      $('#comment-count').textContent = `${allComments.length} comment${allComments.length === 1 ? '' : 's'}`;
      if (!roots.length) { FXStates.empty(host,{title:'Be the first to comment',message:'Start the conversation on this post.'}); FXStates.loaded(host); return; }
      host.innerHTML = roots.map(comment => renderComment(comment)).join('');FXStates.loaded(host);
    } catch (error) { FXStates.fail(host,error,{retry:loadComments}); }
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
    const comment = allComments.find(item => item.id === id);
    const name = comment?.profiles?.display_name || comment?.profiles?.username || 'member';
    replyTarget = id;
    $('#reply-context').hidden = false;
    $('#reply-context').innerHTML = `Replying to ${FX.esc(name)}<button type="button" id="cancel-comment-reply">Cancel</button>`;
    $('#comment-body').placeholder = `Reply to ${name}…`;
    $('#comment-body').focus();
  }

  async function shareComment(id) {
    const url = `${location.origin}/Posts/view.html?id=${encodeURIComponent(postId)}#comment-${encodeURIComponent(id)}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Frnxup comment', url }); return; }
      catch (error) { if (error?.name === 'AbortError') return; }
    }
    await navigator.clipboard.writeText(url);
    FX.toast('Comment link copied.');
  }

  async function handleCommentAction(action, id) {
    const comment = allComments.find(item => item.id === id);
    if (!comment) return;
    const mine = !!FX.user && comment.user_id === FX.user.id;
    if (!FX.user && !['copy', 'share', 'hide'].includes(action)) throw new Error('Please log in to interact with comments.');
    if (action === 'reply') return startReply(id);
    if (action === 'copy') {
      await navigator.clipboard.writeText(comment.body || 'This comment was deleted.');
      FX.toast('Comment copied.');
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
    const current = (reactionsByComment.get(id) || []).find(item => item.user_id === FX.user.id);
    if (current?.reaction === reaction) {
      const { error } = await FX.client.from('comment_reactions').delete().eq('comment_id', id).eq('user_id', FX.user.id);
      if (error) throw error;
    } else {
      const { error } = await FX.client.from('comment_reactions').upsert({ comment_id: id, user_id: FX.user.id, reaction }, { onConflict: 'comment_id,user_id' });
      if (error) throw error;
    }
    await loadComments();
  }

  if (!FX.user) {
    $('#comment-body').placeholder = 'Log in to join the discussion…';
    $('#comment-body').setAttribute('aria-label', 'Log in to write a comment');
    $('#send-comment').textContent = 'Log in to comment';
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
      $('#comment-body').placeholder = 'Write a comment…';
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
    $('#comment-body').placeholder = 'Write a comment…';
  });

  $('#comments-list').addEventListener('pointerdown', event => {
    const target = event.target.closest('[data-comment-hold]');
    if (!target || event.pointerType === 'mouse') return;
    const id = target.dataset.commentHold;
    clearTimeout(window.frnxupCommentHoldTimer);
    window.frnxupCommentHoldTimer = setTimeout(() => openCommentMenu(id), 520);
  });
  ['pointerup', 'pointercancel', 'pointerleave', 'pointermove'].forEach(type => {
    $('#comments-list').addEventListener(type, () => clearTimeout(window.frnxupCommentHoldTimer), { passive: true });
  });
  $('#comments-list').addEventListener('contextmenu', event => {
    const target = event.target.closest('[data-comment-hold]');
    if (!target) return;
    event.preventDefault();
    openCommentMenu(target.dataset.commentHold);
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
    const react = event.target.closest('[data-comment-react]');
    if (react) {
      try { await reactToComment(react.dataset.commentId, react.dataset.commentReact); }
      catch (error) { FX.toast(error.message); }
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
  });

  await loadPost();
  await loadComments();
});
