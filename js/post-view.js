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
    const [mediaResult, commentsResult] = await Promise.all([
      FX.client.from('post_media').select('media_path,media_type,sort_order').eq('post_id', post.id).order('sort_order', {ascending: true}),
      FX.client.from('post_comments').select('post_id').eq('post_id', post.id).eq('status','published')
    ]);
    if(mediaResult.error){FXStates.fail(postHost,mediaResult.error,{retry:loadPost,title:'Post photos and videos could not be loaded'});return;}
    if(commentsResult.error){FXStates.fail(postHost,commentsResult.error,{retry:loadPost,title:'Post comment information could not be loaded'});return;}
    const mediaItems = mediaResult.data?.length ? mediaResult.data : (post.media_path ? [{media_path:post.media_path,media_type:post.media_type||'image',sort_order:1}] : []);
    const mediaUrls = await Promise.all(mediaItems.map(item => FX.mediaUrl(item.media_path)));
    const media = mediaItems.map((item,index)=>({url:mediaUrls[index],type:item.media_type,name:`frnxup-${post.id}-${item.sort_order}.${(item.media_path?.split('.').pop()||(item.media_type==='video'?'mp4':'jpg')).toLowerCase()}`})).filter(item=>item.url);
    const galleryKey=`post-detail-${post.id}`;
    const gallery = media.length>1&&media.every(item=>item.type==='image')
      ? (window.FXMediaTools?.carousel(media,galleryKey,'Photos in post')||'')
      : (window.FXMediaTools?.collage(media,galleryKey,'Post media') || '');
    const myReaction = post.post_reactions?.find(reaction => reaction.user_id === FX.user?.id)?.reaction || '';
    const name = post.profiles?.display_name || post.profiles?.username || 'Frnxup member';
    let authorPage=null;
    if(post.page_id){const {data,error:pageError}=await FX.client.from('frnxup_pages').select('name,slug,avatar_path').eq('id',post.page_id).maybeSingle();if(pageError){FXStates.fail(postHost,pageError,{retry:loadPost,title:'Page author information could not be loaded'});return;}authorPage=data||null;}
    else {const {data,error:pageError}=await FX.client.from('frnxup_pages').select('name,slug,avatar_path').eq('owner_user_id',post.user_id).eq('status','active').order('created_at',{ascending:false}).limit(1).maybeSingle();if(pageError){FXStates.fail(postHost,pageError,{retry:loadPost,title:'Page author information could not be loaded'});return;}authorPage=data||null;}
    const shownName=post.page_id?(authorPage?.name||name):name;
    const authorHref=authorPage?`/Pages/view.html?slug=${encodeURIComponent(authorPage.slug)}`:`/Dashboard/profile.html?id=${encodeURIComponent(post.user_id)}`;
    const authorAvatar=authorPage?.avatar_path?await FX.mediaUrl(authorPage.avatar_path):'';
    const engagement=window.FXPostReactions?.markup(post.id,post.post_reactions||[],commentsResult.data?.length||0)||`<div class="post-actions"><button data-comment="${post.id}">Comments</button></div>`;
    postHost.innerHTML = `<article class="card post-card" data-post="${post.id}" data-owner="${post.user_id}" data-my-reaction="${FX.esc(myReaction)}">
      <div class="post-header">
        <a class="avatar" href="${authorHref}">${authorAvatar?`<img src="${FX.esc(authorAvatar)}" alt="">`:FX.esc(shownName.slice(0, 2).toUpperCase())}</a>
        <div class="post-head-copy"><b><a href="${authorHref}">${FX.esc(shownName)}</a></b><small>${post.page_id?'Frnxup Page':`@${FX.esc(post.profiles?.username || 'member')}`} · ${FX.esc(FX.relative(post.created_at))} · ${FX.esc(post.visibility)}</small>${authorPage?`<a class="fx-post-page-badge" href="${authorHref}">▣ ${FX.esc(authorPage.name)} · Frnxup Page</a>`:''}</div>
        <button class="post-more" data-post-menu="${post.id}" aria-label="Post options" title="Post options">•••</button>
      </div>
      ${post.body ? `<div class="post-text">${FX.esc(post.body)}</div>` : ''}
      ${gallery}
      ${post.location_label ? `<small class="muted">⌖ ${FX.esc(post.location_label)}</small>` : ''}
      ${engagement}
    </article>`;
    FXStates.loaded(postHost);
    postHost.addEventListener('click', async event => {
      const comment = event.target.closest('[data-comment]');
      if (comment) {
        if (!window.FrnxupComments) return FX.toast('Comments are unavailable. Refresh and try again.');
        window.FrnxupComments.openModal({ type: 'post', contextId: postId, title: 'Comments' });
        return;
      }
      const share = event.target.closest('[data-share]');
      const send = event.target.closest('[data-send]');
      if (!share && !send) return;
      const url = `${location.origin}/Posts/view.html?id=${encodeURIComponent(postId)}`;
      if (send && navigator.share) {
        try { await navigator.share({title:'Frnxup post',text:'Check out this post on Frnxup',url}); }
        catch(error) { if(error?.name!=='AbortError')FX.toast(error.message); }
      } else {
        try { if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(url);else throw new Error('Clipboard unavailable'); FX.toast('Post link copied.'); }
        catch (_) { FX.toast(url); }
      }
    });
  }

  await loadPost();
  if (new URLSearchParams(location.search).get('comments') === '1' &&
      $('#post-detail')?.dataset.fxHasContent === 'true' && window.FrnxupComments) {
    window.FrnxupComments.openModal({ type: 'post', contextId: postId, title: 'Comments' });
  }
});
