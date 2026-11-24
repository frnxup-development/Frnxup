document.addEventListener('DOMContentLoaded', async () => {
  const $ = FX.qs;
  try { await FX.loadUser(); } catch (error) { const host = $('#post-detail'); if (host) FXStates.fail(host, error, { retry: () => location.reload(), title: 'Your post session could not be refreshed' }); return; }
  const postId = new URLSearchParams(location.search).get('id');
  if (!FX.client) { FXStates.render($('#post-detail'), 'configuration'); return; }
  if (!postId) { FXStates.render($('#post-detail'), 'unavailable', { title: 'No post selected', message: 'Open a post from the Frnxup feed to view it and join the discussion.' }); return; }
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


  await loadPost();
  const commentsHost = $('#fx-post-comments');
  if (commentsHost && window.FrnxupComments) {
    window.FrnxupComments.mount(commentsHost, { type: 'post', contextId: postId, title: 'Comments' })
      .catch(error => { commentsHost.textContent = error.message || 'Comments could not be loaded.'; });
  }
});
