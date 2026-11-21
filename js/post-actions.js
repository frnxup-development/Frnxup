(() => {
  const closeMenus = () => document.querySelectorAll('.post-menu').forEach(menu => menu.remove());

  const sharePost = async postId => {
    const url = `${location.origin}/Posts/view.html?id=${encodeURIComponent(postId)}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Frnxup post', url }); return; }
      catch (error) { if (error?.name === 'AbortError') return; }
    }
    await navigator.clipboard.writeText(url);
    FX.toast('Post link copied.');
  };

  const menuMarkup = own => `
    <div class="post-menu" role="menu">
      ${own ? '<button type="button" role="menuitem" data-post-action="delete" class="menu-danger">♲ <span>Delete</span></button><button type="button" role="menuitem" data-post-action="edit">✎ <span>Edit</span></button>' : ''}
      <button type="button" role="menuitem" data-post-action="save">▣ <span>Save</span></button>
      <button type="button" role="menuitem" data-post-action="share">↗ <span>Share</span></button>
      <button type="button" role="menuitem" data-post-action="repost">⟳ <span>Repost</span></button>
      ${own ? '' : '<button type="button" role="menuitem" data-post-action="report">⚑ <span>Report</span></button>'}
    </div>`;

  document.addEventListener('click', async event => {
    const opener = event.target.closest('[data-post-menu]');
    if (opener) {
      event.preventDefault();
      event.stopPropagation();
      const postCard = opener.closest('[data-post]') || document.querySelector('#post-detail .post-card');
      if (!postCard || !FX.user) return;
      const current = postCard.querySelector('.post-menu');
      closeMenus();
      if (current) return;
      const postId = opener.dataset.postMenu;
      const postOwner = postCard.dataset.owner || postCard.querySelector('[data-post-owner]')?.dataset.postOwner;
      let ownerId = postOwner;
      if (!ownerId) {
        const { data } = await FX.client.from('posts').select('user_id').eq('id', postId).maybeSingle();
        ownerId = data?.user_id;
      }
      postCard.insertAdjacentHTML('beforeend', menuMarkup(ownerId === FX.user.id));
      return;
    }

    const action = event.target.closest('[data-post-action]');
    if (action) {
      event.preventDefault();
      const menu = action.closest('.post-menu');
      const card = action.closest('[data-post]') || document.querySelector('#post-detail .post-card');
      const trigger = card?.querySelector('[data-post-menu]');
      const postId = trigger?.dataset.postMenu || new URLSearchParams(location.search).get('id');
      if (!postId || !FX.user) return;
      closeMenus();
      try {
        if (action.dataset.postAction === 'delete') {
          if (!confirm('Delete this post permanently?')) return;
          const { error } = await FX.client.from('posts').delete().eq('id', postId).eq('user_id', FX.user.id);
          if (error) throw error;
          FX.toast('Post deleted.');
          if (location.pathname.includes('/Posts/view.html')) location.href = '/index.html';
          else card?.remove();
        }
        if (action.dataset.postAction === 'edit') {
          const { data: post, error: readError } = await FX.client.from('posts').select('body').eq('id', postId).eq('user_id', FX.user.id).maybeSingle();
          if (readError) throw readError;
          if (!post) throw new Error('You can only edit your own post.');
          const body = prompt('Edit your post', post.body || '');
          if (body === null) return;
          const { error } = await FX.client.from('posts').update({ body: body.trim(), updated_at: new Date().toISOString() }).eq('id', postId).eq('user_id', FX.user.id);
          if (error) throw error;
          FX.toast('Post updated.');
          location.reload();
        }
        if (action.dataset.postAction === 'save') {
          const { error } = await FX.client.from('bookmarks').insert({ user_id: FX.user.id, post_id: postId });
          if (error && error.code !== '23505') throw error;
          FX.toast(error?.code === '23505' ? 'This post is already saved.' : 'Post saved.');
        }
        if (action.dataset.postAction === 'share') await sharePost(postId);
        if (action.dataset.postAction === 'repost') {
          const { data: original, error: readError } = await FX.client.from('posts')
            .select('id,user_id,body,media_path,media_type,visibility,location_label,status,repost_of')
            .eq('id', postId).eq('status', 'published').maybeSingle();
          if (readError) throw readError;
          if (!original) throw new Error('This post is no longer available to repost.');
          const originalId = original.repost_of || original.id;
          const { error } = await FX.client.from('posts').insert({
            user_id: FX.user.id,
            body: original.body || 'Reposted a post',
            media_path: original.media_path,
            media_type: original.media_type,
            visibility: original.visibility === 'only_me' ? 'friends' : original.visibility,
            location_label: original.location_label,
            repost_of: originalId
          });
          if (error) throw error;
          FX.toast('Post reposted to your feed.');
          if (location.pathname.endsWith('/index.html') || location.pathname === '/') location.reload();
        }
        if (action.dataset.postAction === 'report') {
          const reason = prompt('Why are you reporting this post?');
          if (!reason?.trim()) return;
          const { error } = await FX.client.from('reports').insert({ reporter_id: FX.user.id, target_type: 'post', target_id: postId, reason: reason.trim() });
          if (error) throw error;
          FX.toast('Report sent to the moderation team.');
        }
      } catch (error) {
        FX.toast(error.message || 'That action could not be completed.');
      }
      return;
    }

    if (!event.target.closest('.post-menu')) closeMenus();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeMenus();
  });
})();
