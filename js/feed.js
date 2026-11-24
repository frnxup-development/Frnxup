(() => {
const $=FX.qs; let activeFilter='latest', activeContentFilter='all', feedMediaObserver=null;
function person(p){return `<a class="row-card" style="text-decoration:none;padding:8px;border:0" href="/Dashboard/profile.html?id=${p.id}"><div class="avatar sm">${FX.esc((p.display_name||p.username||'F').slice(0,2).toUpperCase())}</div><div class="grow"><b>${FX.esc(p.display_name||p.username)}</b><small>@${FX.esc(p.username||'member')}</small></div><span class="tag">View</span></a>`}
async function loadSuggestions(){
 const host=$('#suggestions');if(!host)return;if(!FX.client){FXStates.render(host,'configuration');return;}if(host.dataset.fxHasContent!=='true')FXStates.loading(host,{title:'Loading people you may know',message:'Finding relevant Frnxup members.'});if(!FX.user){FXStates.empty(host,{title:'Sign in to see suggestions',message:'People you may know will appear here after you sign in.'});return;}
 const {data,error}=await FX.client.rpc('frnxup_friend_suggestions',{p_limit:5});
 if(error){FXStates.fail(host,error,{retry:loadSuggestions});return;}
 if(!data?.length){FXStates.empty(host,{title:'No suggestions right now',message:'New people you may know will appear here.'});return;}
 host.innerHTML=data.map(p=>person({...p,display_name:p.display_name+(p.shared_interests?` · ${p.shared_interests} shared interests`:'')})).join('');FXStates.loaded(host);
}
async function loadRooms(){
 const host=$('#popular-rooms');if(!host)return;if(!FX.client){FXStates.render(host,'configuration');return;}if(host.dataset.fxHasContent!=='true')FXStates.loading(host,{title:'Loading popular rooms',message:'Finding active public communities.'});
 const {data,error}=await FX.client.from('rooms').select('id,name,description,category,member_count').eq('status','active').eq('visibility','public').order('member_count',{ascending:false}).limit(4);
 if(error){FXStates.fail(host,error,{retry:loadRooms});return;}
 if(!data?.length){FXStates.empty(host,{title:'No public rooms to show',message:'Explore Frnxup again later to discover active communities.'});return;}
 host.innerHTML=data.map(r=>`<a href="/Rooms/view.html?id=${r.id}" class="row-card" style="text-decoration:none;padding:9px;border:0"><div class="avatar sm">#</div><div class="grow"><b>${FX.esc(r.name)}</b><small>${r.member_count||0} members · ${FX.esc(r.category||'Community')}</small></div></a>`).join('');FXStates.loaded(host);
}
async function loadStatuses(){
 const host=$('#status-list');if(!host)return;if(!FX.client){FXStates.render(host,'configuration');return;}if(!FX.user){FXStates.empty(host,{title:'Sign in to see status updates',message:'Stories shared by your community will appear here.'});return;}
 if(!host.querySelector('.fx-story-row'))FXStates.loading(host,{title:'Loading stories and status',message:'Checking for new updates from your community.'});
 const {data,error}=await FX.client.from('statuses').select('id,user_id,text,media_path,media_type,created_at,expires_at,profiles!statuses_user_id_fkey(username,display_name,avatar_path)').gt('expires_at',new Date().toISOString()).order('created_at',{ascending:false}).limit(60);
 if(error){FXStates.fail(host,error,{retry:loadStatuses});return;}
 const groups=new Map();(data||[]).forEach(row=>{if(!groups.has(row.user_id))groups.set(row.user_id,[]);groups.get(row.user_id).push(row)});
 const cards=['<button type="button" class="fx-story-card fx-story-create" data-add-status><span class="fx-story-create-icon">＋</span><span class="fx-story-name">Add to story</span></button>'];
 for(const [userId,rows] of groups){
   const latest=rows[0],media=latest.media_path?await FX.mediaUrl(latest.media_path):'';
   const name=latest.profiles?.display_name||latest.profiles?.username||'Frnxup member';
   const avatar=latest.profiles?.avatar_path?await FX.mediaUrl(latest.profiles.avatar_path):'';
   const background=media&&latest.media_type==='image'?` style="background-image:linear-gradient(0deg,#07111dcc,transparent 65%),url('${FX.esc(media)}')"`:'';
   cards.push(`<button type="button" class="fx-story-card" data-story-user="${FX.esc(userId)}"${background}>${latest.media_type==='video'&&media?'<span class="fx-story-play">▶</span>':''}<span class="fx-story-count">${rows.length}</span>${avatar?`<img class="fx-story-avatar" src="${FX.esc(avatar)}" alt="">`:`<span class="fx-story-avatar fx-story-initial">${FX.esc(name.slice(0,1).toUpperCase())}</span>`}<span class="fx-story-name">${FX.esc(name)}</span></button>`);
 }
 host.innerHTML=`<div class="fx-story-row">${cards.join('')}</div>`;FXStates.loaded(host);
 host.onclick=event=>{
   if(event.target.closest('[data-add-status]')){ $('#status-modal').classList.add('open'); return; }
   const card=event.target.closest('[data-story-user]');if(!card)return;
   const rows=groups.get(card.dataset.storyUser)||[];let index=0;
   const show=async()=>{
     const row=rows[index];const url=row.media_path?await FX.mediaUrl(row.media_path):'';
     let modal=document.querySelector('.fx-story-viewer');if(!modal){modal=document.createElement('div');modal.className='fx-story-viewer';document.body.append(modal);}
     const owner=row.profiles?.display_name||row.profiles?.username||'Frnxup member';
     modal.innerHTML=`<section class="fx-story-panel"><header><b>${FX.esc(owner)}</b><small>${FX.esc(FX.relative(row.created_at))}</small><button class="fx-story-close" type="button">×</button></header><div class="fx-story-content">${row.text?`<p>${FX.esc(row.text)}</p>`:''}${url?(row.media_type==='video'?`<video src="${FX.esc(url)}" controls autoplay playsinline></video>`:`<img src="${FX.esc(url)}" alt="Status photo">`):''}</div><footer><span>${index+1} / ${rows.length}</span>${url?'<button type="button" class="fx-story-save">↓ Save to device</button>':''}<button type="button" class="fx-story-prev" ${index===0?'disabled':''}>Previous</button><button type="button" class="fx-story-next" ${index>=rows.length-1?'disabled':''}>Next</button></footer><small class="fx-story-expiry">Expires ${FX.time(row.expires_at)}</small></section>`;
     modal.classList.add('open');modal.querySelector('.fx-story-close').onclick=()=>modal.classList.remove('open');
     modal.querySelector('.fx-story-prev').onclick=()=>{if(index>0){index--;show();}};modal.querySelector('.fx-story-next').onclick=()=>{if(index<rows.length-1){index++;show();}};
     modal.querySelector('.fx-story-save')?.addEventListener('click',()=>window.FXMediaTools?.save(url,`frnxup-status-${row.id}.${(row.media_path?.split('.').pop()|| (row.media_type==='video'?'mp4':'jpg')).toLowerCase()}`));
   };show();
 };
}
function observeFeedVideos(host){
 if(feedMediaObserver)feedMediaObserver.disconnect();
 const videos=[...host.querySelectorAll('[data-feed-video]')];
 if(!videos.length)return;
 const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 feedMediaObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{
   const video=entry.target;
   if(entry.isIntersecting&&entry.intersectionRatio>=.45&&!reduced){video.muted=video.dataset.userMuted!=='false';video.play().catch(()=>{});}
   else video.pause();
 }),{threshold:[0,.2,.45,.75]});
 videos.forEach(video=>{video.muted=true;feedMediaObserver.observe(video);});
}
function captionMarkup(body,kind='post'){
 if(!body)return '';
 const safe=FX.esc(body);
 if(kind==='reel')return `<div class="fx-feed-reel-caption fx-post-caption is-collapsed" data-post-caption><p class="fx-caption-text">${safe}</p><button type="button" class="fx-caption-toggle" data-caption-toggle hidden>See all</button></div>`;
 return `<div class="post-text fx-post-caption is-collapsed" data-post-caption><span class="fx-caption-text">${safe}</span><button type="button" class="fx-caption-toggle" data-caption-toggle hidden>See all</button></div>`;
}
function setupPostCaptions(host){
 const captions=[...host.querySelectorAll('[data-post-caption]')];
 if(!captions.length)return;
 const measure=()=>captions.forEach(caption=>{
   const text=caption.querySelector('.fx-caption-text'),button=caption.querySelector('[data-caption-toggle]');
   if(!text||!button)return;
   // Character count catches long text even on browsers where line-clamp
   // doesn't expose the unclamped height through scrollHeight.
   const longByLength=(text.textContent||'').trim().length>180;
   const longByLayout=text.scrollHeight>text.clientHeight+2;
   const shouldCollapse=longByLength||longByLayout;
   button.hidden=!shouldCollapse;
   if(!shouldCollapse){caption.classList.remove('is-collapsed','is-expanded');}
 });
 if('requestAnimationFrame' in window)requestAnimationFrame(measure);else setTimeout(measure,0);
}
function pollMarkup(postId,poll,myVote,results){if(!poll)return '';const total=results.reduce((n,r)=>n+Number(r.vote_count||0),0),closed=new Date(poll.expires_at)<=new Date(),reveal=myVote!==undefined||closed;return `<div class="poll-widget"><div class="poll-question">${FX.esc(poll.question)}</div>${(poll.options||[]).map((label,index)=>{const r=results.find(x=>Number(x.option_index)===index),count=Number(r?.vote_count||0),pct=total?Math.round(count*100/total):0;return reveal?`<div class="poll-result"><span class="poll-result-bar" style="width:${pct}%"></span><div class="poll-result-label"><b>${FX.esc(label)} ${myVote===index?'✓':''}</b><span>${pct}% · ${count}</span></div></div>`:`<button class="poll-choice" data-poll-vote="${postId}" data-option="${index}">${FX.esc(label)}</button>`}).join('')}<div class="poll-meta">${total} vote${total===1?'':'s'} · ${closed?'Poll closed':`Closes ${FX.time(poll.expires_at)}`}</div></div>`}
async function loadFeed(){
 const host=$('#feed-list');if(!host)return;if(!FX.client){FXStates.render(host,'configuration');return;}if(!FX.user){FXStates.empty(host,{title:'Sign in to see your feed',message:'Posts from friends and communities will appear here.'});return;}
 if(host.dataset.fxHasContent!=='true')FXStates.loading(host,{title:'Loading your feed',message:'Fetching the latest posts from your Frnxup community.'});
 let q=FX.client.from('posts').select('id,user_id,page_id,body,media_path,media_type,content_type,visibility,created_at,profiles!posts_user_id_fkey(username,display_name,avatar_path),post_reactions(user_id,reaction),repost_of').eq('status','published').order('created_at',{ascending:false}).limit(40);
 if(activeContentFilter!=='all')q=q.eq('content_type',activeContentFilter);
 if(activeFilter==='friends'){
   const {data:fs,error:friendshipError}=await FX.client.from('friendships').select('user_a,user_b').or(`user_a.eq.${FX.user.id},user_b.eq.${FX.user.id}`);
   if(friendshipError){FXStates.fail(host,friendshipError,{retry:loadFeed});return;}
   const ids=(fs||[]).map(x=>x.user_a===FX.user.id?x.user_b:x.user_a);
   if(!ids.length){FXStates.empty(host,{title:'Your friends-only feed is empty',message:'Add friends to see their updates here.'});return;}
   q=q.in('user_id',ids);
 }
 const {data,error}=await q;
 if(error){FXStates.fail(host,error,{retry:loadFeed});return;}
 if(!data?.length){FXStates.empty(host,{title:'Your feed is waiting for its first post',message:'There are no posts to show right now. Share something or connect with more people.'});return;}
 const ids=data.map(p=>p.id);const authorIds=[...new Set(data.map(p=>p.user_id).filter(Boolean))];
 const {data:authorPages,error:authorPagesError}=await FX.client.from('frnxup_pages').select('id,owner_user_id,name,slug,avatar_path,status').in('owner_user_id',authorIds).eq('status','active').order('created_at',{ascending:false});
 if(authorPagesError){FXStates.fail(host,authorPagesError,{retry:loadFeed,title:'Page identity information could not be loaded'});return;}
 const pageById=new Map((authorPages||[]).map(x=>[x.id,x]));const pageByOwner=new Map();(authorPages||[]).forEach(x=>{if(!pageByOwner.has(x.owner_user_id))pageByOwner.set(x.owner_user_id,x)});
 const memberFollowIds=authorIds.filter(id=>id!==FX.user.id),pageFollowIds=[...new Set(data.map(post=>post.page_id).filter(Boolean))];let followingMembers=new Set(),followingPages=new Set();
 if(memberFollowIds.length){const result=await FX.client.from('user_follows').select('following_id').eq('follower_id',FX.user.id).in('following_id',memberFollowIds);if(!result.error)followingMembers=new Set((result.data||[]).map(row=>row.following_id));}
 if(pageFollowIds.length){const result=await FX.client.from('frnxup_page_followers').select('page_id').eq('user_id',FX.user.id).in('page_id',pageFollowIds);if(!result.error)followingPages=new Set((result.data||[]).map(row=>row.page_id));}
 const ids2=ids;const repostIds=[...new Set(data.map(p=>p.repost_of).filter(Boolean))];let repostAuthors=new Map();
 if(repostIds.length){const {data:originals,error:originalError}=await FX.client.from('posts').select('id,profiles!posts_user_id_fkey(username,display_name)').in('id',repostIds);if(originalError){FXStates.fail(host,originalError,{retry:loadFeed,title:'Reposted content could not be loaded'});return;}repostAuthors=new Map((originals||[]).map(x=>[x.id,x.profiles]));}
 const [mediaRowsResult,pollResult,voteResult]=await Promise.all([
   FX.client.from('post_media').select('id,post_id,media_path,media_type,sort_order').in('post_id',ids).order('sort_order',{ascending:true}),
   FX.client.from('post_polls').select('post_id,question,options,expires_at').in('post_id',ids),
   FX.client.from('poll_votes').select('post_id,option_index').eq('user_id',FX.user.id).in('post_id',ids)
 ]);
 const dependentError=[mediaRowsResult,pollResult,voteResult].find(result=>result?.error)?.error;
 if(dependentError){FXStates.fail(host,dependentError,{retry:loadFeed,title:'Post media or poll information could not be loaded'});return;}
 const mediaByPost=new Map();
 (mediaRowsResult.data||[]).forEach(row=>{if(!mediaByPost.has(row.post_id))mediaByPost.set(row.post_id,[]);mediaByPost.get(row.post_id).push(row)});
 for(const post of data){if(!mediaByPost.has(post.id)&&post.media_path)mediaByPost.set(post.id,[{post_id:post.id,media_path:post.media_path,media_type:post.media_type||'image',sort_order:1}]);}
 const allMedia=[...mediaByPost.values()].flat();
 const [urls,authorAvatars,pageAvatars]=await Promise.all([Promise.all(allMedia.map(item=>FX.mediaUrl(item.media_path))),Promise.all(data.map(post=>post.profiles?.avatar_path?FX.mediaUrl(post.profiles.avatar_path):'')),Promise.all((authorPages||[]).map(page=>page.avatar_path?FX.mediaUrl(page.avatar_path):''))]);
 const pageAvatarMap=new Map((authorPages||[]).map((page,index)=>[page.id,pageAvatars[index]]));
 const urlMap=new Map(allMedia.map((item,index)=>[item.media_path,urls[index]]));
 const polls=pollResult.data||[],votes=Object.fromEntries((voteResult.data||[]).map(v=>[v.post_id,Number(v.option_index)]));let resultRows=[];
 if(polls.length){const {data:r,error:pollResultsError}=await FX.client.rpc('frnxup_poll_results',{p_post_ids:polls.map(x=>x.post_id)});if(pollResultsError){FXStates.fail(host,pollResultsError,{retry:loadFeed,title:'Poll results could not be loaded'});return;}resultRows=r||[];}
 const pollMap=Object.fromEntries(polls.map(x=>[x.post_id,x]));
 host.innerHTML=data.map((p,postIndex)=>{
   const mine=p.post_reactions?.some(r=>r.user_id===FX.user.id),pResults=resultRows.filter(r=>r.post_id===p.id);
   const media=(mediaByPost.get(p.id)||[]).map(item=>({url:urlMap.get(item.media_path),type:item.media_type,name:`frnxup-${p.id}-${item.sort_order}.${(item.media_path?.split('.').pop()||(item.media_type==='video'?'mp4':'jpg')).toLowerCase()}`})).filter(item=>item.url);
   const galleryKey=`post-${p.id}`;
   const page=p.page_id?pageById.get(p.page_id):null;const badge=page||pageByOwner.get(p.user_id);const authorName=page?.name||p.profiles?.display_name||p.profiles?.username||'Frnxup member';const authorLink=page?`/Pages/view.html?slug=${encodeURIComponent(page.slug)}`:`/Dashboard/profile.html?id=${encodeURIComponent(p.user_id)}`;const avatarUrl=page?pageAvatarMap.get(page.id):authorAvatars[postIndex];
   const contentType=p.content_type||(media[0]?.type==='video'?'video':media.length?'image':'text');
   let gallery='';
   if(contentType==='reel'&&media[0]?.type==='video'){
     const isPage=!!page,followId=isPage?page.id:p.user_id,following=isPage?followingPages.has(followId):followingMembers.has(followId),canFollow=isPage?page.owner_user_id!==FX.user.id:p.user_id!==FX.user.id;
     const followButton=canFollow?`<button type="button" class="fx-feed-reel-follow ${following?'following':''}" data-feed-follow-id="${FX.esc(followId)}" data-feed-follow-kind="${isPage?'page':'member'}" data-feed-following="${following?'1':'0'}">${following?'Following ✓':'Follow'}</button>`:'';
     gallery=`<section class="fx-feed-reel-media"><video data-feed-video="${p.id}" class="fx-feed-auto-video fx-feed-reel-video" src="${FX.esc(media[0].url)}" muted loop playsinline preload="metadata" aria-label="Reel video"></video><div class="fx-feed-reel-shade"></div><button class="fx-feed-video-sound" type="button" data-feed-sound="${p.id}" aria-label="Turn sound on">🔇</button><div class="fx-feed-reel-info"><div class="fx-feed-reel-creator"><b>${FX.esc(authorName)}</b>${followButton}</div><span>${FX.esc(p.profiles?.username?`@${p.profiles.username}`:isPage?'Frnxup Page':'Frnxup creator')}</span>${p.body?captionMarkup(p.body,'reel'):''}<a href="/Reels/index.html?post=${encodeURIComponent(p.id)}">Open full-screen Reels ↗</a></div><div class="fx-feed-reel-actions"><button class="${mine?'active':''}" data-react="${p.id}">♡<small>${p.post_reactions?.length||0}</small></button><button data-comment="${p.id}" data-comment-type="reel">▢<small>Comment</small></button><button data-share="${p.id}">↗<small>Share</small></button></div></section>`;
   }else if(media.length===1&&media[0]?.type==='video'){
     gallery=`<div class="fx-feed-video-card"><video data-feed-video="${p.id}" class="fx-feed-auto-video" src="${FX.esc(media[0].url)}" muted playsinline controls preload="metadata" aria-label="Video post"></video><button type="button" class="fx-feed-video-sound" data-feed-sound="${p.id}" aria-label="Turn sound on">🔇 Sound</button></div>`;
   }else if(media.length){gallery=window.FXMediaTools?.collage(media,galleryKey,'Post media')||'';}
   const isReel=contentType==='reel';
   const shouldCollapseCaption=isReel||contentType==='image'||contentType==='video';
   const postCaption=p.body?(isReel?captionMarkup(p.body,'reel'):shouldCollapseCaption?captionMarkup(p.body):`<div class="post-text">${FX.esc(p.body)}</div>`):'';
   const actions=isReel?'':`<div class="post-actions"><button class="${mine?'active':''}" data-react="${p.id}">♡ ${p.post_reactions?.length||0} Like</button><button data-comment="${p.id}">▢ Comment</button><button data-share="${p.id}">↗ Share</button><button data-save="${p.id}">▣ Save</button></div>`;
   return `<article class="card post-card fx-post-card-${FX.esc(contentType)}" data-post="${p.id}" data-owner="${p.user_id}" data-content-type="${FX.esc(contentType)}"><div class="post-header"><a class="avatar" href="${authorLink}">${avatarUrl?`<img src="${FX.esc(avatarUrl)}" alt="">`:FX.esc(authorName.slice(0,2).toUpperCase())}</a><div class="post-head-copy"><b><a href="${authorLink}">${FX.esc(authorName)}</a></b><small>${page?'Frnxup Page':`@${FX.esc(p.profiles?.username||'member')}`} · ${FX.relative(p.created_at)} · ${FX.esc(p.visibility)}</small>${badge?`<a class="fx-post-page-badge" href="/Pages/view.html?slug=${encodeURIComponent(badge.slug)}">▣ ${FX.esc(badge.name)} · Frnxup Page</a>`:''}</div><button class="post-more" data-post-menu="${p.id}" aria-label="Post options" title="Post options">•••</button></div>${p.repost_of?`<div class="repost-label">↻ Reposted from ${FX.esc(repostAuthors.get(p.repost_of)?.display_name||repostAuthors.get(p.repost_of)?.username||'another member')}</div>`:''}${postCaption}${gallery}${pollMarkup(p.id,pollMap[p.id],votes[p.id],pResults)}${actions}</article>`;
 }).join('');FXStates.loaded(host);setupPostCaptions(host);observeFeedVideos(host);
}
async function createPost(){
 const body=$('#post-content').value.trim(),files=[...($('#post-media').files||[])],visibility=$('#post-visibility').value,msg=$('#post-message'),pollActive=!$('#poll-builder').hidden,question=$('#poll-question').value.trim(),options=[...document.querySelectorAll('.poll-option')].map(x=>x.value.trim()).filter(Boolean);
 if(!body&&!files.length&&!pollActive){FX.setMessage(msg,'Write something, attach media or create a poll.','error');return;}
 if(pollActive&&(question.length<3||options.length<2)){FX.setMessage(msg,'Add a poll question and at least two options.','error');return;}
 const videos=files.filter(file=>file.type.startsWith('video/'));
 if(files.length>20||files.some(file=>!file.type.startsWith('image/')&&!file.type.startsWith('video/'))||videos.length>1||(videos.length&&files.length>1)){FX.setMessage(msg,'Choose up to 20 photos OR one video. Do not mix them in one post.','error');return;}
 if(!FX.user){location.href='/Auth/index.html';return;}
 const submit=$('#publish-post');submit.disabled=true;let uploaded=[],postId=null;
 try{
   for(const file of files){const path=await FX.upload(file,'posts');uploaded.push({media_path:path,media_type:file.type.startsWith('video/')?'video':'image',sort_order:uploaded.length+1});}
   const first=uploaded[0]||null;
   const activePageId=FX.activePageId();
   const {data:post,error}=await FX.client.from('posts').insert({user_id:FX.user.id,page_id:activePageId,body:body||question,media_path:first?.media_path||null,media_type:first?.media_type||null,content_type:!uploaded.length?'text':first?.media_type==='video'?'video':'image',visibility,location_label:$('#post-location-label').value.trim()||null}).select('id').single();
   if(error)throw error;postId=post.id;
   // Insert records one at a time so the database limit trigger validates the
   // accumulated photo/video set reliably, including multi-photo selections.
   for(const item of uploaded){const {error:mediaError}=await FX.client.from('post_media').insert({post_id:post.id,...item});if(mediaError)throw new Error(`${mediaError.message}. Ensure the post-photo migration has been run in Supabase.`);}
   if(pollActive){const expiry=new Date(Date.now()+Number($('#poll-duration').value)*86400000).toISOString();const {error:pollError}=await FX.client.from('post_polls').insert({post_id:post.id,question,options,expires_at:expiry});if(pollError)throw pollError;}
   $('#post-modal').classList.remove('open');$('#post-content').value='';$('#post-media').value='';$('#post-location-label').value='';$('#poll-question').value='';document.querySelectorAll('.poll-option').forEach(x=>x.value='');$('#poll-builder').hidden=true;document.querySelector('.fx-upload-preview[data-for="post-media"]')?.replaceChildren();
   FX.toast(uploaded.length>1?'Your photo collage has been published.':pollActive?'Your poll has been published.':'Your post has been published.');msg.nextElementSibling?.matches('[data-fx-upload-state-slot]')&&msg.nextElementSibling.remove();msg.textContent='';await loadFeed();
 }catch(e){if(postId)await FX.client.from('posts').delete().eq('id',postId);if(uploaded.length)await FX.client.storage.from('frnxup-media').remove(uploaded.map(x=>x.media_path));FXStates.failUpload(msg,e,{retry:createPost});}
 finally{submit.disabled=false;}
}
function setCapturedPostFile(file){
 const input=$('#post-media');const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;input.multiple=file.type.startsWith('image/');input.accept=file.type.startsWith('image/')?'image/*':'video/*';input.dispatchEvent(new Event('change',{bubbles:true}));
}
function launchPostCamera(mode='all'){
 if(!FX.user){location.href='/Auth/index.html';return;}
 $('#post-modal').classList.add('open');
 if(!window.FXCamera){FX.toast('Camera is not available. Choose a file from your device.');return;}
 window.FXCamera.open({mode,onFile:setCapturedPostFile});
}
async function createStatus(){const body=$('#status-text').value.trim(),file=$('#status-media').files[0];if(!body&&!file){FX.setMessage('#status-message','Write a status or attach media.');return}try{let path=null,kind=null;if(file){path=await FX.upload(file,'statuses');kind=file.type.startsWith('video/')?'video':'image'}const expires=new Date(Date.now()+24*60*60*1000).toISOString();const {error}=await FX.client.from('statuses').insert({user_id:FX.user.id,text:body,media_path:path,media_type:kind,visibility:$('#status-visibility').value,expires_at:expires});if(error)throw error;$('#status-modal').classList.remove('open');$('#status-text').value='';$('#status-media').value='';document.querySelector('.fx-upload-preview[data-for="status-media"]')?.replaceChildren();FX.toast('Status shared for 24 hours.');const msg=$('#status-message');msg.nextElementSibling?.matches('[data-fx-upload-state-slot]')&&msg.nextElementSibling.remove();msg.textContent='';loadStatuses()}catch(e){FXStates.failUpload('#status-message',e,{retry:createStatus})}}
document.addEventListener('visibilitychange',()=>{if(document.hidden)document.querySelectorAll('[data-feed-video]').forEach(video=>video.pause());});
document.addEventListener('DOMContentLoaded',async()=>{
 try { await FX.loadUser(); } catch(initError) { ['#suggestions','#status-list','#popular-rooms','#feed-list'].forEach(selector=>{const host=$(selector);if(host)FXStates.fail(host,initError,{retry:()=>location.reload(),title:'Frnxup feed could not be initialized'});}); return; }
 if(!FX.client){['#suggestions','#status-list','#popular-rooms','#feed-list'].forEach(selector=>{const host=$(selector);if(host)FXStates.render(host,'configuration');});return;}
 if(FX.user){if(FX.settings.posting_enabled===false){$('#open-post').disabled=true;$('#open-post').textContent='Posting is temporarily disabled';$('#post-photo').disabled=true;$('#post-video').disabled=true;$('#post-camera').disabled=true;$('#post-take-photo').disabled=true;$('#post-record-video').disabled=true;$('#post-poll').disabled=true}if(FX.settings.statuses_enabled===false){$('#add-status').disabled=true;$('#add-status').textContent='Statuses disabled'}$('#composer-avatar').textContent=(FX.profile?.display_name||'F').slice(0,1).toUpperCase();if(FX.profile?.avatar_path){const avatarUrl=await FX.mediaUrl(FX.profile.avatar_path);if(avatarUrl)$('#composer-avatar').innerHTML=`<img src="${FX.esc(avatarUrl)}" alt="Your profile photo">`;}loadSuggestions();loadStatuses();loadFeed();}else{const next='/Auth/index.html?next='+encodeURIComponent(location.pathname+location.search);[['#suggestions','Sign in to see people you may know'],['#status-list','Sign in to see status updates'],['#feed-list','Sign in to see your feed']].forEach(([selector,title])=>{const host=$(selector);if(host)FXStates.render(host,'auth',{title,message:'This Frnxup feature is available after you sign in.',href:next});});}loadRooms();
 $('#open-post').onclick=()=>{$('#post-media').accept='image/*';$('#post-media').multiple=true;$('#post-modal').classList.add('open')};$('#post-photo-top').onclick=()=>{$('#post-media').accept='image/*';$('#post-media').multiple=true;$('#post-modal').classList.add('open');$('#post-media').click()};$('#post-photo').onclick=()=>{$('#post-media').accept='image/*';$('#post-media').multiple=true;$('#post-modal').classList.add('open');$('#post-media').click()};$('#post-video').onclick=()=>{$('#post-media').accept='video/*';$('#post-media').multiple=false;$('#post-modal').classList.add('open');$('#post-media').click()};$('#post-camera').onclick=()=>launchPostCamera('all');$('#post-take-photo').onclick=()=>launchPostCamera('photo');$('#post-record-video').onclick=()=>launchPostCamera('video');$('#post-poll').onclick=()=>{$('#poll-builder').hidden=false;$('#post-modal').classList.add('open');$('#poll-question').focus()};$('#add-poll-option').onclick=()=>{const fields=document.querySelectorAll('.poll-option');if(fields.length>=6)return FX.toast('A poll can have up to six options.');const input=document.createElement('input');input.className='poll-option';input.maxLength=80;input.placeholder=`Option ${fields.length+1}`;$('#poll-options').append(input)};$('#post-location').onclick=()=>{$('#post-modal').classList.add('open');$('#post-location-label').focus()};$('#add-status').onclick=()=>{if(!FX.user)return location.href='/Auth/index.html';$('#status-modal').classList.add('open')};$('#publish-post').onclick=createPost;$('#publish-status').onclick=createStatus;FX.qsa('[data-close]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.close).classList.remove('open'));$('#feed-filter').onchange=()=>{activeFilter=$('#feed-filter').value;loadFeed()};$('#feed-content-filters').addEventListener('click',event=>{const button=event.target.closest('[data-feed-type]');if(!button)return;activeContentFilter=button.dataset.feedType;$('#feed-content-filters').querySelectorAll('[data-feed-type]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));$('#feed-list').dataset.feedType=activeContentFilter;loadFeed();});$('#feed-list').addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;try{if(b.hasAttribute('data-caption-toggle')){const caption=b.closest('[data-post-caption]');if(!caption)return;const expanded=caption.classList.toggle('is-expanded');caption.classList.toggle('is-collapsed',!expanded);b.textContent=expanded?'See less':'See all';}else if(b.dataset.pollVote!==undefined){const {error}=await FX.client.rpc('frnxup_vote_poll',{p_post_id:b.dataset.pollVote,p_option_index:Number(b.dataset.option)});if(error)throw error;loadFeed()}else if(b.dataset.react){const {error}=await FX.client.from('post_reactions').insert({post_id:b.dataset.react,user_id:FX.user.id,reaction:'like'});if(error&&error.code!=='23505')throw error;loadFeed()}else if(b.dataset.save){const {error}=await FX.client.from('bookmarks').insert({user_id:FX.user.id,post_id:b.dataset.save});if(error&&error.code!=='23505')throw error;FX.toast('Post saved.')}else if(b.dataset.comment){const type=b.dataset.commentType||'post';if(window.FrnxupComments)window.FrnxupComments.openModal({type,contextId:b.dataset.comment,title:type==='reel'?'Reel comments':'Comments'});else location.href='/Posts/view.html?id='+b.dataset.comment}else if(b.dataset.share){const url=location.origin+'/Posts/view.html?id='+b.dataset.share;if(navigator.share)await navigator.share({title:'Frnxup post',url});else{await navigator.clipboard.writeText(url);FX.toast('Post link copied.')}}else if(b.dataset.feedFollowId){const following=b.dataset.feedFollowing==='1',kind=b.dataset.feedFollowKind,id=b.dataset.feedFollowId;const result=kind==='page'?(following?await FX.client.from('frnxup_page_followers').delete().eq('page_id',id).eq('user_id',FX.user.id):await FX.client.from('frnxup_page_followers').insert({page_id:id,user_id:FX.user.id})):(following?await FX.client.from('user_follows').delete().eq('follower_id',FX.user.id).eq('following_id',id):await FX.client.from('user_follows').insert({follower_id:FX.user.id,following_id:id}));if(result.error&&result.error.code!=='23505')throw result.error;const next=!following;b.dataset.feedFollowing=next?'1':'0';b.textContent=next?'Following ✓':'Follow';b.classList.toggle('following',next);}else if(b.dataset.feedSound){const video=document.querySelector(`[data-feed-video=\"${CSS.escape(b.dataset.feedSound)}\"]`);if(video){video.muted=!video.muted;video.dataset.userMuted=String(video.muted);b.textContent=video.muted?'🔇':'🔊';if(!video.paused)video.play().catch(()=>{});}}}catch(err){if(err?.name!=='AbortError')FX.toast(err.message)}});
});
})();
