(() => {
const $=FX.qs; let activeFilter='latest'; let feedLikePress=null; const feedSuppressedLikes=new Set();
const feedReactionOptions=[['like','👍','Like'],['love','❤️','Love'],['laugh','😂','Haha'],['wow','😮','Wow'],['sad','😢','Sad'],['angry','😡','Angry'],['support','🤗','Support']];
function closeFeedReactionTrays(except=null){FX.qsa('#feed-list [data-post-reaction-tray]').forEach(tray=>{if(tray!==except){tray.hidden=true;tray.classList.remove('is-open');tray.parentElement?.querySelector('[data-post-like]')?.setAttribute('aria-expanded','false')}})}
function cancelFeedLikePress(){if(!feedLikePress)return;clearTimeout(feedLikePress.timer);if(feedLikePress.activated){feedSuppressedLikes.add(feedLikePress.id);setTimeout(()=>feedSuppressedLikes.delete(feedLikePress.id),850)}feedLikePress=null}
function startFeedLikePress(event,button){if(!button||(event.button!==undefined&&event.button!==0))return;cancelFeedLikePress();const id=button.dataset.postLike;const tray=button.parentElement?.querySelector('[data-post-reaction-tray]');if(!tray)return;const state={id,button,tray,x:event.clientX||0,y:event.clientY||0,activated:false,timer:null};state.timer=setTimeout(()=>{if(feedLikePress!==state)return;state.activated=true;tray.hidden=false;tray.classList.add('is-open');button.setAttribute('aria-expanded','true');try{navigator.vibrate?.(12)}catch(_){}},430);feedLikePress=state}
function moveFeedLikePress(event){if(!feedLikePress)return;if(Math.hypot((event.clientX||0)-feedLikePress.x,(event.clientY||0)-feedLikePress.y)>14)cancelFeedLikePress()}
function person(p){return `<a class="row-card" style="text-decoration:none;padding:8px;border:0" href="/Dashboard/profile.html?id=${p.id}"><div class="avatar sm">${FX.esc((p.display_name||p.username||'F').slice(0,2).toUpperCase())}</div><div class="grow"><b>${FX.esc(p.display_name||p.username)}</b><small>@${FX.esc(p.username||'member')}</small></div><span class="tag">View</span></a>`}
async function loadSuggestions(){if(!FX.client||!FX.user)return;const {data}=await FX.client.rpc('frnxup_friend_suggestions',{p_limit:5});if(data?.length)$('#suggestions').innerHTML=data.map(p=>person({...p,display_name:p.display_name+(p.shared_interests?` · ${p.shared_interests} shared interests`:'')})).join('')}
async function loadRooms(){if(!FX.client)return;const {data}=await FX.client.from('rooms').select('id,name,description,category,member_count').eq('status','active').eq('visibility','public').order('member_count',{ascending:false}).limit(4);if(data?.length)$('#popular-rooms').innerHTML=data.map(r=>`<a href="/Rooms/view.html?id=${r.id}" class="row-card" style="text-decoration:none;padding:9px;border:0"><div class="avatar sm">#</div><div class="grow"><b>${FX.esc(r.name)}</b><small>${r.member_count||0} members · ${FX.esc(r.category||'Community')}</small></div></a>`).join('')}
async function loadStatuses(){
 if(!FX.client||!FX.user)return;
 const {data,error}=await FX.client.from('statuses').select('id,user_id,text,media_path,media_type,created_at,expires_at,profiles!statuses_user_id_fkey(username,display_name,avatar_path)').gt('expires_at',new Date().toISOString()).order('created_at',{ascending:false}).limit(60);
 const host=$('#status-list');
 if(error){host.innerHTML='<div class="empty">Status updates are temporarily unavailable.</div>';return;}
 const groups=new Map();(data||[]).forEach(row=>{if(!groups.has(row.user_id))groups.set(row.user_id,[]);groups.get(row.user_id).push(row)});
 const cards=['<button type="button" class="fx-story-card fx-story-create" data-add-status><span class="fx-story-create-icon">＋</span><span class="fx-story-name">Add to story</span></button>'];
 for(const [userId,rows] of groups){
   const latest=rows[0],media=latest.media_path?await FX.mediaUrl(latest.media_path):'';
   const name=latest.profiles?.display_name||latest.profiles?.username||'Frnxup member';
   const avatar=latest.profiles?.avatar_path?await FX.mediaUrl(latest.profiles.avatar_path):'';
   const background=media&&latest.media_type==='image'?` style="background-image:linear-gradient(0deg,#07111dcc,transparent 65%),url('${FX.esc(media)}')"`:'';
   cards.push(`<button type="button" class="fx-story-card" data-story-user="${FX.esc(userId)}"${background}>${latest.media_type==='video'&&media?'<span class="fx-story-play">▶</span>':''}<span class="fx-story-count">${rows.length}</span>${avatar?`<img class="fx-story-avatar" src="${FX.esc(avatar)}" alt="">`:`<span class="fx-story-avatar fx-story-initial">${FX.esc(name.slice(0,1).toUpperCase())}</span>`}<span class="fx-story-name">${FX.esc(name)}</span></button>`);
 }
 host.innerHTML=`<div class="fx-story-row">${cards.join('')}</div>`;
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
function pollMarkup(postId,poll,myVote,results){if(!poll)return '';const total=results.reduce((n,r)=>n+Number(r.vote_count||0),0),closed=new Date(poll.expires_at)<=new Date(),reveal=myVote!==undefined||closed;return `<div class="poll-widget"><div class="poll-question">${FX.esc(poll.question)}</div>${(poll.options||[]).map((label,index)=>{const r=results.find(x=>Number(x.option_index)===index),count=Number(r?.vote_count||0),pct=total?Math.round(count*100/total):0;return reveal?`<div class="poll-result"><span class="poll-result-bar" style="width:${pct}%"></span><div class="poll-result-label"><b>${FX.esc(label)} ${myVote===index?'✓':''}</b><span>${pct}% · ${count}</span></div></div>`:`<button class="poll-choice" data-poll-vote="${postId}" data-option="${index}">${FX.esc(label)}</button>`}).join('')}<div class="poll-meta">${total} vote${total===1?'':'s'} · ${closed?'Poll closed':`Closes ${FX.time(poll.expires_at)}`}</div></div>`}
async function loadFeed(){
 if(!FX.client||!FX.user)return;
 let q=FX.client.from('posts').select('id,user_id,page_id,body,media_path,media_type,visibility,created_at,profiles!posts_user_id_fkey(username,display_name,avatar_path),post_reactions(user_id,reaction),repost_of').eq('status','published').order('created_at',{ascending:false}).limit(35);
 if(activeFilter==='friends'){
   const {data:fs}=await FX.client.from('friendships').select('user_a,user_b').or(`user_a.eq.${FX.user.id},user_b.eq.${FX.user.id}`);
   const ids=(fs||[]).map(x=>x.user_a===FX.user.id?x.user_b:x.user_a);
   if(!ids.length){$('#feed-list').innerHTML='<div class="empty">Add friends to build your friends-only feed.</div>';return;}
   q=q.in('user_id',ids);
 }
 const {data,error}=await q;
 if(error){$('#feed-list').innerHTML=`<div class="empty">${FX.esc(error.message)}</div>`;return;}
 if(!data?.length){$('#feed-list').innerHTML='<div class="empty">Your feed is ready for its first post. Say hello to your community!</div>';return;}
 const ids=data.map(p=>p.id);const authorIds=[...new Set(data.map(p=>p.user_id).filter(Boolean))];
 const {data:authorPages}=await FX.client.from('frnxup_pages').select('id,owner_user_id,name,slug,avatar_path,status').in('owner_user_id',authorIds).eq('status','active').order('created_at',{ascending:false});
 const pageById=new Map((authorPages||[]).map(x=>[x.id,x]));const pageByOwner=new Map();(authorPages||[]).forEach(x=>{if(!pageByOwner.has(x.owner_user_id))pageByOwner.set(x.owner_user_id,x)});
 const ids2=ids;const repostIds=[...new Set(data.map(p=>p.repost_of).filter(Boolean))];let repostAuthors=new Map();
 if(repostIds.length){const {data:originals}=await FX.client.from('posts').select('id,profiles!posts_user_id_fkey(username,display_name)').in('id',repostIds);repostAuthors=new Map((originals||[]).map(x=>[x.id,x.profiles]));}
 const [mediaRowsResult,pollResult,voteResult]=await Promise.all([
   FX.client.from('post_media').select('id,post_id,media_path,media_type,sort_order').in('post_id',ids).order('sort_order',{ascending:true}),
   FX.client.from('post_polls').select('post_id,question,options,expires_at').in('post_id',ids),
   FX.client.from('poll_votes').select('post_id,option_index').eq('user_id',FX.user.id).in('post_id',ids)
 ]);
 const mediaByPost=new Map();
 if(!mediaRowsResult.error)(mediaRowsResult.data||[]).forEach(row=>{if(!mediaByPost.has(row.post_id))mediaByPost.set(row.post_id,[]);mediaByPost.get(row.post_id).push(row)});
 for(const post of data){if(!mediaByPost.has(post.id)&&post.media_path)mediaByPost.set(post.id,[{post_id:post.id,media_path:post.media_path,media_type:post.media_type||'image',sort_order:1}]);}
 const allMedia=[...mediaByPost.values()].flat();
 const [urls,authorAvatars,pageAvatars]=await Promise.all([Promise.all(allMedia.map(item=>FX.mediaUrl(item.media_path))),Promise.all(data.map(post=>post.profiles?.avatar_path?FX.mediaUrl(post.profiles.avatar_path):'')),Promise.all((authorPages||[]).map(page=>page.avatar_path?FX.mediaUrl(page.avatar_path):''))]);
 const pageAvatarMap=new Map((authorPages||[]).map((page,index)=>[page.id,pageAvatars[index]]));
 const urlMap=new Map(allMedia.map((item,index)=>[item.media_path,urls[index]]));
 const polls=pollResult.data||[],votes=Object.fromEntries((voteResult.data||[]).map(v=>[v.post_id,Number(v.option_index)]));let resultRows=[];
 if(polls.length){const {data:r}=await FX.client.rpc('frnxup_poll_results',{p_post_ids:polls.map(x=>x.post_id)});resultRows=r||[];}
 const pollMap=Object.fromEntries(polls.map(x=>[x.post_id,x]));
 $('#feed-list').innerHTML=data.map((p,postIndex)=>{
   const myReaction=p.post_reactions?.find(r=>r.user_id===FX.user.id),reactionInfo=feedReactionOptions.find(r=>r[0]===myReaction?.reaction),pResults=resultRows.filter(r=>r.post_id===p.id);
   const media=(mediaByPost.get(p.id)||[]).map(item=>({url:urlMap.get(item.media_path),type:item.media_type,name:`frnxup-${p.id}-${item.sort_order}.${(item.media_path?.split('.').pop()||(item.media_type==='video'?'mp4':'jpg')).toLowerCase()}`})).filter(item=>item.url);
   const galleryKey=`post-${p.id}`;
   const gallery=window.FXMediaTools?.collage(media,galleryKey,'Post media')||'';
   const page=p.page_id?pageById.get(p.page_id):null;const badge=page||pageByOwner.get(p.user_id);const authorName=page?.name||p.profiles?.display_name||p.profiles?.username||'Frnxup member';const authorLink=page?`/Pages/view.html?slug=${encodeURIComponent(page.slug)}`:`/Dashboard/profile.html?id=${encodeURIComponent(p.user_id)}`;const avatarUrl=page?pageAvatarMap.get(page.id):authorAvatars[postIndex];
   return `<article class="card post-card" data-post="${p.id}" data-owner="${p.user_id}"><div class="post-header"><a class="avatar" href="${authorLink}">${avatarUrl?`<img src="${FX.esc(avatarUrl)}" alt="">`:FX.esc(authorName.slice(0,2).toUpperCase())}</a><div class="post-head-copy"><b><a href="${authorLink}">${FX.esc(authorName)}</a></b><small>${page?'Frnxup Page':`@${FX.esc(p.profiles?.username||'member')}`} · ${FX.relative(p.created_at)} · ${FX.esc(p.visibility)}</small>${badge?`<a class="fx-post-page-badge" href="/Pages/view.html?slug=${encodeURIComponent(badge.slug)}">▣ ${FX.esc(badge.name)} · Frnxup Page</a>`:''}</div><button class="post-more" data-post-menu="${p.id}" aria-label="Post options" title="Post options">•••</button></div>${p.repost_of?`<div class="repost-label">↻ Reposted from ${FX.esc(repostAuthors.get(p.repost_of)?.display_name||repostAuthors.get(p.repost_of)?.username||'another member')}</div>`:''}${p.body?`<div class="post-text">${FX.esc(p.body)}</div>`:''}${gallery}${pollMarkup(p.id,pollMap[p.id],votes[p.id],pResults)}<div class="post-actions"><div class="fx-post-like-wrap"><button type="button" class="fx-post-like ${myReaction?'active':''}" data-post-like="${p.id}" data-current-reaction="${myReaction?.reaction||''}" aria-expanded="false"><span class="fx-post-like-emoji">${reactionInfo?.[1]||'👍'}</span><span>${reactionInfo?.[2]||'Like'}</span><small>${p.post_reactions?.length||0}</small></button><div class="fx-reaction-tray" data-post-reaction-tray="${p.id}" hidden role="group" aria-label="Choose a reaction">${feedReactionOptions.map(([key,emoji,label])=>`<button type="button" class="fx-reaction-choice" data-post-reaction="${key}" data-post-id="${p.id}" title="${label}" aria-label="${label}">${emoji}</button>`).join('')}</div></div><button data-comment="${p.id}">▢ Comment</button><button data-share="${p.id}">↗ Share</button><button data-save="${p.id}">▣ Save</button></div></article>`;
 }).join('');
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
   const {data:post,error}=await FX.client.from('posts').insert({user_id:FX.user.id,page_id:activePageId,body:body||question,media_path:first?.media_path||null,media_type:first?.media_type||null,visibility,location_label:$('#post-location-label').value.trim()||null}).select('id').single();
   if(error)throw error;postId=post.id;
   // Insert records one at a time so the database limit trigger validates the
   // accumulated photo/video set reliably, including multi-photo selections.
   for(const item of uploaded){const {error:mediaError}=await FX.client.from('post_media').insert({post_id:post.id,...item});if(mediaError)throw new Error(`${mediaError.message}. Ensure the post-photo migration has been run in Supabase.`);}
   if(pollActive){const expiry=new Date(Date.now()+Number($('#poll-duration').value)*86400000).toISOString();const {error:pollError}=await FX.client.from('post_polls').insert({post_id:post.id,question,options,expires_at:expiry});if(pollError)throw pollError;}
   $('#post-modal').classList.remove('open');$('#post-content').value='';$('#post-media').value='';$('#post-location-label').value='';$('#poll-question').value='';document.querySelectorAll('.poll-option').forEach(x=>x.value='');$('#poll-builder').hidden=true;document.querySelector('.fx-upload-preview[data-for="post-media"]')?.replaceChildren();
   FX.toast(uploaded.length>1?'Your photo collage has been published.':pollActive?'Your poll has been published.':'Your post has been published.');await loadFeed();
 }catch(e){if(postId)await FX.client.from('posts').delete().eq('id',postId);if(uploaded.length)await FX.client.storage.from('frnxup-media').remove(uploaded.map(x=>x.media_path));FX.setMessage(msg,e.message,'error');}
 finally{submit.disabled=false;}
}
async function createStatus(){const body=$('#status-text').value.trim(),file=$('#status-media').files[0];if(!body&&!file){FX.setMessage('#status-message','Write a status or attach media.');return}try{let path=null,kind=null;if(file){path=await FX.upload(file,'statuses');kind=file.type.startsWith('video/')?'video':'image'}const expires=new Date(Date.now()+24*60*60*1000).toISOString();const {error}=await FX.client.from('statuses').insert({user_id:FX.user.id,text:body,media_path:path,media_type:kind,visibility:$('#status-visibility').value,expires_at:expires});if(error)throw error;$('#status-modal').classList.remove('open');$('#status-text').value='';$('#status-media').value='';document.querySelector('.fx-upload-preview[data-for="status-media"]')?.replaceChildren();FX.toast('Status shared for 24 hours.');loadStatuses()}catch(e){FX.setMessage('#status-message',e.message)}}
document.addEventListener('DOMContentLoaded',async()=>{
 await FX.loadUser();if(FX.user){if(FX.settings.posting_enabled===false){$('#open-post').disabled=true;$('#open-post').textContent='Posting is temporarily disabled';$('#post-photo').disabled=true;$('#post-video').disabled=true;$('#post-poll').disabled=true}if(FX.settings.statuses_enabled===false){$('#add-status').disabled=true;$('#add-status').textContent='Statuses disabled'}$('#composer-avatar').textContent=(FX.profile?.display_name||'F').slice(0,1).toUpperCase();if(FX.profile?.avatar_path){const avatarUrl=await FX.mediaUrl(FX.profile.avatar_path);if(avatarUrl)$('#composer-avatar').innerHTML=`<img src="${FX.esc(avatarUrl)}" alt="Your profile photo">`;}loadSuggestions();loadStatuses();loadRooms();loadFeed()}
 $('#open-post').onclick=()=>{$('#post-media').accept='image/*';$('#post-media').multiple=true;$('#post-modal').classList.add('open')};$('#post-photo-top').onclick=()=>{$('#post-media').accept='image/*';$('#post-media').multiple=true;$('#post-modal').classList.add('open');$('#post-media').click()};$('#post-photo').onclick=()=>{$('#post-media').accept='image/*';$('#post-media').multiple=true;$('#post-modal').classList.add('open');$('#post-media').click()};$('#post-video').onclick=()=>{$('#post-media').accept='video/*';$('#post-media').multiple=false;$('#post-modal').classList.add('open');$('#post-media').click()};$('#post-poll').onclick=()=>{$('#poll-builder').hidden=false;$('#post-modal').classList.add('open');$('#poll-question').focus()};$('#add-poll-option').onclick=()=>{const fields=document.querySelectorAll('.poll-option');if(fields.length>=6)return FX.toast('A poll can have up to six options.');const input=document.createElement('input');input.className='poll-option';input.maxLength=80;input.placeholder=`Option ${fields.length+1}`;$('#poll-options').append(input)};$('#post-location').onclick=()=>{$('#post-modal').classList.add('open');$('#post-location-label').focus()};$('#add-status').onclick=()=>{if(!FX.user)return location.href='/Auth/index.html';$('#status-modal').classList.add('open')};$('#publish-post').onclick=createPost;$('#publish-status').onclick=createStatus;FX.qsa('[data-close]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.close).classList.remove('open'));$('#feed-filter').onchange=()=>{activeFilter=$('#feed-filter').value;loadFeed()};
 $('#feed-list').addEventListener('pointerdown',e=>{const like=e.target.closest('[data-post-like]');if(like)startFeedLikePress(e,like)});
 ['pointerup','pointercancel','pointerleave'].forEach(type=>$('#feed-list').addEventListener(type,cancelFeedLikePress,{passive:true}));
 $('#feed-list').addEventListener('pointermove',moveFeedLikePress,{passive:true});
 $('#feed-list').addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;try{
   if(b.dataset.postReaction){closeFeedReactionTrays();const {data:existing,error:readError}=await FX.client.from('post_reactions').select('reaction').eq('post_id',b.dataset.postId).eq('user_id',FX.user.id).maybeSingle();if(readError)throw readError;if(existing?.reaction===b.dataset.postReaction){const {error:deleteError}=await FX.client.from('post_reactions').delete().eq('post_id',b.dataset.postId).eq('user_id',FX.user.id);if(deleteError)throw deleteError}else{if(existing){const {error:deleteError}=await FX.client.from('post_reactions').delete().eq('post_id',b.dataset.postId).eq('user_id',FX.user.id);if(deleteError)throw deleteError}const {error}=await FX.client.from('post_reactions').insert({post_id:b.dataset.postId,user_id:FX.user.id,reaction:b.dataset.postReaction});if(error)throw error}await loadFeed()}
   else if(b.dataset.postLike){const id=b.dataset.postLike;if(feedSuppressedLikes.has(id)){feedSuppressedLikes.delete(id);return}closeFeedReactionTrays();const current=b.dataset.currentReaction;let result;if(current==='like')result=await FX.client.from('post_reactions').delete().eq('post_id',id).eq('user_id',FX.user.id);else{if(current){const removed=await FX.client.from('post_reactions').delete().eq('post_id',id).eq('user_id',FX.user.id);if(removed.error)throw removed.error}result=await FX.client.from('post_reactions').insert({post_id:id,user_id:FX.user.id,reaction:'like'})}if(result.error)throw result.error;await loadFeed()}
   else if(b.dataset.pollVote!==undefined){const {error}=await FX.client.rpc('frnxup_vote_poll',{p_post_id:b.dataset.pollVote,p_option_index:Number(b.dataset.option)});if(error)throw error;loadFeed()}
   else if(b.dataset.save){const {error}=await FX.client.from('bookmarks').insert({user_id:FX.user.id,post_id:b.dataset.save});if(error&&error.code!=='23505')throw error;FX.toast(error?.code==='23505'?'This post is already saved.':'Post saved.')}
   else if(b.dataset.comment){location.href='/Posts/view.html?id='+b.dataset.comment}
   else if(b.dataset.share){const url=location.origin+'/Posts/view.html?id='+b.dataset.share;try{await navigator.clipboard.writeText(url);FX.toast('Post link copied.')}catch(_){FX.toast(url)}}
 }catch(err){FX.toast(err.message)}});
 document.addEventListener('click',e=>{if(!e.target.closest('#feed-list .fx-reaction-tray, #feed-list [data-post-like]'))closeFeedReactionTrays()});
});
})();
