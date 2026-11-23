(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = value => FX.esc(value);
  const params = new URLSearchParams(location.search);
  const pageId = params.get('id') || FX.activePageId();
  const action = document.body.dataset.pageAction || 'actions';
  let page = null;
  const root = $('#page-action-content');
  const link = (name, id = pageId) => `/Pages/${name}.html?id=${encodeURIComponent(id || '')}`;
  const dashboard = () => link('dashboard');
  const shareUrl = () => `${location.origin}/Pages/view.html?slug=${encodeURIComponent(page.slug)}`;

  const menuItems = [
    ['📣','Advertise','Create an advertising enquiry for this Page.','advertise'],
    ['◉','Page status','Check whether the Page is public or hidden.','status'],
    ['▣','Add action button','Add a call-to-action button to the public Page.','action-button'],
    ['▤','Archive','Restore posts you have archived.','archive'],
    ['☷','Activity log','Review recent Page management activity.','activity-log'],
    ['▧','Review posts and tags','Review Page posts and posts mentioning this Page.','review-posts'],
    ['✦','Add highlights','Add featured photos to the Page.','highlights'],
    ['⌕','Search','Search posts published by this Page.','search'],
    ['♧','Invite people to connect','Invite Frnxup members to follow this Page.','invite'],
    ['↗','Copy Link to Page','Share the Page using its public link.','share'],
    ['◎','Change profile picture','Upload or replace the Page profile picture.','profile-photo'],
    ['▰','Change cover picture','Upload or replace the Page cover picture.','cover-photo'],
    ['＋','Create a post','Publish a text, photo or video post as this Page.','create-post'],
    ['♙','Manage followers','View or remove Page followers.','followers'],
    ['✎','Edit Page details','Change the Page name, category and description.','edit-details'],
    ['⚙','Page settings','Control follower count and public visibility.','settings'],
    ['◷','Add to story','Share a photo or video story for 24 hours.','story'],
    ['↩','Switch to personal account','Leave Page mode and return to your personal account.','switch-account']
  ];

  function stateError(host, error, retry) { if (host) FXStates.fail(host, error, { retry, title: 'Could not load this Page section' }); }
  function stateEmpty(host, title, text) { if (host) FXStates.empty(host, { title, message: text }); }
  function message(text, kind = 'info') {
    const node = $('#action-message');
    if (!node) { FX.toast(text); return; }
    node.textContent = text;
    node.dataset.kind = kind;
  }
  function frame(title, description, body) {
    if (!root) return;
    root.innerHTML = `<a class="pa-back" href="${dashboard()}">‹ Back to Page dashboard</a>
      <header class="pa-heading"><span>PAGE MANAGEMENT</span><h1>${esc(title)}</h1><p>${esc(description)}</p></header>${body}
      <p id="action-message" class="pa-message" role="status" aria-live="polite"></p>`;
  }
  function log(actionName, details = {}) {
    return FX.client.from('frnxup_page_activity').insert({page_id:page.id,actor_id:FX.user.id,action:actionName,details});
  }
  function safeUrl(value) {
    try { const u = new URL(value); return ['https:','http:'].includes(u.protocol) ? u.href : ''; } catch (_) { return ''; }
  }
  async function loadPage() {
    if (!FX.client) throw new Error('Frnxup is not connected to Supabase. Check /js/config.js.');
    const user = await FX.loadUser();
    if (!user?.id) { FX.showAuthNotice('Sign in to manage your Page.'); throw new Error('Please sign in, then return to this Page action.'); }
    if (!pageId) throw new Error('The Page ID is missing. Open this action from your Page dashboard.');
    const {data,error} = await FX.client.from('frnxup_pages').select('*').eq('id',pageId).eq('owner_user_id',user.id).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('This Page could not be found or you do not own it.');
    page = data;
    return page;
  }
  function menu() {
    const cards = menuItems.map(([icon,title,desc,file]) => `<a class="pa-action-card" href="${link(file)}"><span class="pa-action-icon">${icon}</span><span><b>${esc(title)}</b><small>${esc(desc)}</small></span><strong>›</strong></a>`).join('');
    frame('Page actions','Open each Page tool on its own screen. Your Page dashboard remains separate.',`<section class="pa-menu-grid">${cards}</section>`);
  }
  async function imageEditor(kind) {
    const avatar = kind === 'profile-photo';
    const field = avatar ? 'avatar_path' : 'cover_path';
    const folder = avatar ? 'pages-avatar' : 'pages-cover';
    const current = page[field] ? await FX.mediaUrl(page[field]) : '';
    const title = avatar ? 'Page profile picture' : 'Page cover picture';
    frame(title, avatar ? 'Choose a square image that members can recognize easily.' : 'Choose a wide image that represents your Page.');
    root.querySelector('.pa-heading').insertAdjacentHTML('afterend', `
      <section class="pa-panel">
        <div class="pa-photo-preview ${avatar?'is-avatar':'is-cover'}" id="photo-preview">${current?`<img src="${esc(current)}" alt="Current Page ${avatar?'profile':'cover'}">`:`<span>${avatar?esc(page.name.slice(0,1).toUpperCase()):'Your Page cover will appear here'}</span>`}</div>
        <label class="pa-label" for="page-photo-file">${avatar?'Select profile picture':'Select cover picture'}</label>
        <input class="pa-input" type="file" id="page-photo-file" accept="image/jpeg,image/png,image/webp,image/gif">
        <small class="pa-help">${avatar?'JPG, PNG, WebP or GIF · maximum 5 MB.':'JPG, PNG, WebP or GIF · maximum 12 MB.'}</small>
        <div class="pa-buttons"><button class="pa-primary" type="button" id="save-page-photo">Save picture</button><a class="pa-secondary" href="${dashboard()}">Cancel</a></div>
      </section>`);
    const input = $('#page-photo-file');
    input.addEventListener('change', () => {
      const file = input.files?.[0]; if (!file) return;
      const url = URL.createObjectURL(file); $('#photo-preview').innerHTML = `<img src="${url}" alt="Selected Page image">`;
    });
    $('#save-page-photo').onclick = async () => {
      const file = input.files?.[0]; if (!file) return message('Choose an image first.','error');
      const button = $('#save-page-photo'); button.disabled = true; button.textContent = 'Uploading…';
      try {
        const path = await FX.upload(file,folder);
        const {error} = await FX.client.from('frnxup_pages').update({[field]:path}).eq('id',page.id).eq('owner_user_id',FX.user.id);
        if (error) throw error;
        await log(avatar?'profile_picture_updated':'cover_picture_updated',{file_name:file.name});
        message('Picture saved successfully.','success'); FX.toast(`${title} updated.`);
        setTimeout(()=>location.assign(dashboard()),650);
      } catch (e) { FXStates.failUpload($('#action-message'),e,{retry:()=>$('#save-page-photo').click()}); button.disabled=false; button.textContent='Save picture'; }
    };
  }
  function createPost() {
    frame('Create a Page post','Publish an update in your Page identity. Photos or one video can be attached.',`
      <form class="pa-panel" id="page-post-form">
        <label class="pa-label" for="post-text">Post text</label><textarea class="pa-input" id="post-text" maxlength="5000" rows="6" placeholder="What's happening with your Page?"></textarea>
        <label class="pa-label" for="post-files">Photos or video</label><input class="pa-input" id="post-files" type="file" accept="image/*,video/*" multiple>
        <small class="pa-help">Up to 20 photos, or one video. Photos and video cannot be mixed in one post.</small><div id="post-preview" class="pa-preview-grid"></div>
        <div class="pa-buttons"><button class="pa-primary" id="publish-page-post" type="submit">Publish post</button><a class="pa-secondary" href="${dashboard()}">Cancel</a></div>
      </form>`);
    const input=$('#post-files');
    input.onchange=()=>{const host=$('#post-preview');host.replaceChildren();[...(input.files||[])].forEach(f=>{const url=URL.createObjectURL(f),el=document.createElement(f.type.startsWith('video/')?'video':'img');el.src=url;if(el.tagName==='VIDEO'){el.controls=true;el.playsInline=true}host.append(el)})};
    $('#page-post-form').onsubmit=async e=>{
      e.preventDefault(); const files=[...(input.files||[])],videos=files.filter(f=>f.type.startsWith('video/'));
      if(files.length>20||videos.length>1||(videos.length&&files.length>1)||files.some(f=>!f.type.startsWith('image/')&&!f.type.startsWith('video/')))return message('Choose up to 20 photos OR one video.','error');
      const body=$('#post-text').value.trim(); if(!body&&!files.length)return message('Write something or attach media before publishing.','error');
      const btn=$('#publish-page-post');btn.disabled=true;btn.textContent='Publishing…';let uploaded=[],postId=null;
      try {
        for(const file of files){const path=await FX.upload(file,'posts');uploaded.push({media_path:path,media_type:file.type.startsWith('video/')?'video':'image',sort_order:uploaded.length+1});}
        const first=uploaded[0]||null;
        const {data,error}=await FX.client.from('posts').insert({user_id:FX.user.id,page_id:page.id,body,media_path:first?.media_path||null,media_type:first?.media_type||null,visibility:'public'}).select('id').single();
        if(error)throw error;postId=data.id;
        for(const item of uploaded){const {error:mediaError}=await FX.client.from('post_media').insert({post_id:postId,...item});if(mediaError)throw mediaError;}
        await log('post_published',{post_id:postId,media_count:uploaded.length});message('Your Page post has been published.','success');FX.toast('Page post published.');setTimeout(()=>location.assign(dashboard()),700);
      } catch(err) {
        if(postId)await FX.client.from('posts').delete().eq('id',postId);
        if(uploaded.length)await FX.client.storage.from('frnxup-media').remove(uploaded.map(x=>x.media_path));
        FXStates.failUpload($('#action-message'),err,{retry:()=>$('#page-post-form').requestSubmit()});btn.disabled=false;btn.textContent='Publish post';
      }
    };
  }
  function switchAccount() {
    frame('Switch to personal account','This ends Page mode on this device. Your Page and its posts remain unchanged.',`<section class="pa-panel"><div class="pa-notice"><b>What happens next?</b><p>You will return to your personal Frnxup dashboard. You can switch back to this Page at any time.</p></div><div class="pa-buttons"><button class="pa-primary" id="confirm-switch-personal" type="button">Switch to personal account</button><a class="pa-secondary" href="${dashboard()}">Stay on this Page</a></div></section>`);
    $('#confirm-switch-personal').onclick=async()=>{await log('switched_to_personal_account');FX.setActivePage(null);location.assign('/Dashboard/index.html')};
  }
  function sharePage() {
    const url=shareUrl();
    frame('Share your Page','Copy the Page link or use your phone’s share sheet to send it to people.',`<section class="pa-panel"><label class="pa-label" for="page-share-url">Public Page link</label><input class="pa-input" id="page-share-url" readonly value="${esc(url)}"><div class="pa-buttons"><button class="pa-primary" type="button" id="copy-page-link">Copy link</button><button class="pa-secondary" type="button" id="native-share-page">Share…</button></div><p class="pa-help">Anyone with access to this Page can open the link. ${page.visibility_mode==='hidden'?'This Page is currently hidden; make it public in Page status before sharing.':''}</p></section>`);
    $('#copy-page-link').onclick=async()=>{try{await navigator.clipboard.writeText(url);message('Page link copied.','success');}catch(_){$('#page-share-url').select();message('Select and copy the link above.','info');}};
    $('#native-share-page').onclick=async()=>{try{if(navigator.share)await navigator.share({title:page.name,text:`Visit ${page.name} on Frnxup`,url});else{await navigator.clipboard.writeText(url);message('Page link copied.','success');}}catch(e){if(e.name!=='AbortError')message('Your browser could not open the share sheet. Copy the link instead.','error');}};
  }
  async function followers() {
    frame('Manage followers','Review the members who follow this Page. Removing a follower does not block their personal account.',`<section class="pa-panel"><div id="page-followers-list" class="pa-list"><p>Loading followers…</p></div></section>`);
    const host=$('#page-followers-list');
    FXStates.loading(host,{title:'Loading Page followers',message:'Fetching members who follow this Page.'});
    const {data:rows,error}=await FX.client.from('frnxup_page_followers').select('user_id,created_at').eq('page_id',page.id).order('created_at',{ascending:false});
    if(error){stateError(host,error,followers);return;} if(!rows?.length){stateEmpty(host,'No followers yet','This Page does not have any followers yet.');return;}
    const ids=rows.map(x=>x.user_id);const {data:members,error:memberError}=await FX.client.from('profiles').select('id,username,display_name,avatar_path').in('id',ids);
    if(memberError){stateError(host,memberError,followers);return;}
    const map=new Map((members||[]).map(m=>[m.id,m]));
    host.innerHTML=await Promise.all(rows.map(async row=>{const m=map.get(row.user_id)||{},avatar=m.avatar_path?await FX.mediaUrl(m.avatar_path):'';return `<article class="pa-member-row"><div class="pa-member-avatar">${avatar?`<img src="${esc(avatar)}" alt="">`:esc((m.display_name||m.username||'F').slice(0,1).toUpperCase())}</div><div class="pa-member-copy"><b>${esc(m.display_name||m.username||'Frnxup member')}</b><small>@${esc(m.username||'member')} · ${esc(FX.relative(row.created_at))}</small></div><button type="button" class="pa-secondary" data-remove-follower="${esc(row.user_id)}">Remove</button></article>`;})).then(x=>x.join(''));FXStates.loaded(host);
    host.querySelectorAll('[data-remove-follower]').forEach(button=>button.onclick=async()=>{if(!confirm('Remove this member from your Page followers?'))return;button.disabled=true;const {error:removeError}=await FX.client.from('frnxup_page_followers').delete().eq('page_id',page.id).eq('user_id',button.dataset.removeFollower);if(removeError){message(removeError.message,'error');button.disabled=false;return;}await log('follower_removed',{user_id:button.dataset.removeFollower});button.closest('.pa-member-row').remove();if(!host.querySelector('.pa-member-row'))host.innerHTML='<p class="pa-empty">This Page does not have any followers yet.</p>';});
  }
  function editDetails() {
    frame('Edit Page details','Update the information shown on your public Page.',`<form class="pa-panel" id="edit-page-form"><label class="pa-label" for="edit-name">Page name</label><input class="pa-input" id="edit-name" required maxlength="80" value="${esc(page.name)}"><label class="pa-label" for="edit-slug">Page link slug</label><input class="pa-input" id="edit-slug" required minlength="3" maxlength="40" pattern="[a-z0-9-]{3,40}" value="${esc(page.slug)}"><label class="pa-label" for="edit-category">Category</label><input class="pa-input" id="edit-category" maxlength="80" value="${esc(page.category||'Other')}"><label class="pa-label" for="edit-about">Description</label><textarea class="pa-input" id="edit-about" maxlength="3000" rows="5">${esc(page.about||'')}</textarea><label class="pa-label" for="edit-location">Location</label><input class="pa-input" id="edit-location" maxlength="120" value="${esc(page.location||'')}"><label class="pa-label" for="edit-website">Website</label><input class="pa-input" id="edit-website" type="url" maxlength="240" value="${esc(page.website||'')}"><div class="pa-buttons"><button class="pa-primary" type="submit">Save Page details</button><a class="pa-secondary" href="${dashboard()}">Cancel</a></div></form>`);
    $('#edit-page-form').onsubmit=async e=>{e.preventDefault();const payload={name:$('#edit-name').value.trim(),slug:$('#edit-slug').value.trim().toLowerCase(),category:$('#edit-category').value.trim()||'Other',about:$('#edit-about').value.trim(),location:$('#edit-location').value.trim()||null,website:$('#edit-website').value.trim()||null};if(payload.name.length<2||!/^[a-z0-9-]{3,40}$/.test(payload.slug))return message('Check the Page name and link format.','error');const btn=e.submitter;btn.disabled=true;const {error}=await FX.client.from('frnxup_pages').update(payload).eq('id',page.id).eq('owner_user_id',FX.user.id);btn.disabled=false;if(error)return message(error.message,'error');Object.assign(page,payload);await log('page_details_updated',{fields:Object.keys(payload)});message('Page details saved.','success');setTimeout(()=>location.assign(dashboard()),650);};
  }
  function settings() {
    frame('Page settings','Control your follower count and public discoverability.',`<form class="pa-panel" id="page-settings-form"><label class="pa-check"><input id="show-follower-count" type="checkbox" ${page.follower_count_visible?'checked':''}><span><b>Show follower count publicly</b><small>When disabled, only you can see the exact count.</small></span></label><label class="pa-label" for="page-visibility">Page visibility</label><select class="pa-input" id="page-visibility"><option value="public" ${page.visibility_mode!=='hidden'?'selected':''}>Public — anyone can view and follow</option><option value="hidden" ${page.visibility_mode==='hidden'?'selected':''}>Hidden — only you can view and manage it</option></select><div class="pa-buttons"><button class="pa-primary" type="submit">Save settings</button><a class="pa-secondary" href="${dashboard()}">Cancel</a></div></form>`);
    $('#page-settings-form').onsubmit=async e=>{e.preventDefault();const payload={follower_count_visible:$('#show-follower-count').checked,visibility_mode:$('#page-visibility').value};const btn=e.submitter;btn.disabled=true;const {error}=await FX.client.from('frnxup_pages').update(payload).eq('id',page.id).eq('owner_user_id',FX.user.id);btn.disabled=false;if(error)return message(error.message,'error');Object.assign(page,payload);await log('page_settings_updated',payload);message('Page settings saved.','success');};
  }
  function status() {
    const statusText=page.status==='active'?'Active':'Not active';
    const visText=page.visibility_mode==='hidden'?'Hidden from public':'Public';
    frame('Page status','Check whether visitors can discover your Page and whether it is active on Frnxup.',`<section class="pa-panel"><div class="pa-status-grid"><div><small>FRNXUP STATUS</small><b class="pa-status-pill ${page.status==='active'?'is-good':'is-warning'}">${esc(statusText)}</b></div><div><small>VISIBILITY</small><b class="pa-status-pill ${page.visibility_mode==='hidden'?'is-warning':'is-good'}">${esc(visText)}</b></div><div><small>CREATED</small><b>${esc(FX.time(page.created_at))}</b></div><div><small>PAGE SLUG</small><b>@${esc(page.slug)}</b></div></div><p class="pa-help">Page account status is controlled by Frnxup moderation. You can change public visibility in the Page settings screen.</p><div class="pa-buttons"><a class="pa-primary" href="${link('settings')}">Change visibility</a><a class="pa-secondary" href="${dashboard()}">Back to Page</a></div></section>`);
  }
  function actionButton() {
    frame('Add action button','Add a helpful call-to-action to the public Page, such as Contact, Visit website or Learn more.',`<form class="pa-panel" id="cta-form"><label class="pa-check"><input type="checkbox" id="cta-enabled" ${page.action_button_enabled?'checked':''}><span><b>Show action button on public Page</b><small>Visitors will see this button near the Page follow controls.</small></span></label><label class="pa-label" for="cta-label">Button label</label><select id="cta-label" class="pa-input"><option ${page.action_button_label==='Contact'?'selected':''}>Contact</option><option ${page.action_button_label==='Visit website'?'selected':''}>Visit website</option><option ${page.action_button_label==='Shop now'?'selected':''}>Shop now</option><option ${page.action_button_label==='Learn more'?'selected':''}>Learn more</option><option ${page.action_button_label==='Book now'?'selected':''}>Book now</option><option ${page.action_button_label==='Sign up'?'selected':''}>Sign up</option></select><label class="pa-label" for="cta-url">Destination URL</label><input class="pa-input" type="url" id="cta-url" placeholder="https://example.com" value="${esc(page.action_button_url||'')}"><div class="pa-buttons"><button class="pa-primary" type="submit">Save action button</button><a class="pa-secondary" href="${dashboard()}">Cancel</a></div></form>`);
    $('#cta-form').onsubmit=async e=>{e.preventDefault();const enabled=$('#cta-enabled').checked,url= safeUrl($('#cta-url').value.trim());if(enabled&&!url)return message('Enter a valid http:// or https:// destination URL.','error');const payload={action_button_enabled:enabled,action_button_label:$('#cta-label').value,action_button_url:url||null};const btn=e.submitter;btn.disabled=true;const {error}=await FX.client.from('frnxup_pages').update(payload).eq('id',page.id);btn.disabled=false;if(error)return message(error.message,'error');Object.assign(page,payload);await log('action_button_updated',payload);message('Public action button saved.','success');};
  }
  async function invite() {
    frame('Invite people to connect','Enter a Frnxup username. The member will receive an invitation to follow your Page.',`<form class="pa-panel" id="invite-form"><label class="pa-label" for="invite-username">Frnxup username</label><input class="pa-input" id="invite-username" placeholder="username" maxlength="24" autocomplete="off" required><div class="pa-buttons"><button class="pa-primary" type="submit">Send invitation</button><a class="pa-secondary" href="${dashboard()}">Cancel</a></div></form><section class="pa-panel"><h2>Recent invitations sent</h2><div id="sent-invites" class="pa-list">Loading…</div></section>`);
    $('#invite-form').onsubmit=async e=>{e.preventDefault();const username=$('#invite-username').value.trim().replace(/^@/,'');if(!/^[A-Za-z0-9_]{3,24}$/.test(username))return message('Enter a valid Frnxup username.','error');const btn=e.submitter;btn.disabled=true;const {data:member,error:lookupError}=await FX.client.from('profiles').select('id,username').ilike('username',username).maybeSingle();if(lookupError){btn.disabled=false;return message(lookupError.message,'error');}if(!member){btn.disabled=false;return message('No Frnxup member was found with that username.','error');}if(member.id===FX.user.id){btn.disabled=false;return message('You cannot invite yourself.','error');}
      const {error}=await FX.client.from('frnxup_page_invitations').upsert({page_id:page.id,invited_user_id:member.id,invited_by:FX.user.id,status:'pending'},{onConflict:'page_id,invited_user_id'});btn.disabled=false;if(error)return message(error.message,'error');await log('page_invitation_sent',{username:member.username});$('#invite-username').value='';message(`Invitation sent to @${member.username}.`,'success');loadSentInvites();};
    loadSentInvites();
  }
  async function loadSentInvites(){const host=$('#sent-invites');if(!host)return;const {data,error}=await FX.client.from('frnxup_page_invitations').select('id,status,created_at,member:profiles!frnxup_page_invitations_invited_user_id_fkey(username,display_name)').eq('page_id',page.id).order('created_at',{ascending:false}).limit(30);if(error){stateError(host,error,loadSentInvites);return;}if(!data?.length){stateEmpty(host,'No invitations sent','You have not sent any invitations yet.');return;}host.innerHTML=data.map(x=>`<div class="pa-list-row"><span><b>${esc(x.member?.display_name||x.member?.username||'Frnxup member')}</b><small>@${esc(x.member?.username||'member')} · ${esc(x.status)}</small></span></div>`).join('');FXStates.loaded(host);}
  function advertise() {
    frame('Advertise with this Page','Send an advertising enquiry. A request is not a paid or active campaign; the Frnxup advertising team must review it.',`<form class="pa-panel" id="ad-request-form"><label class="pa-label" for="ad-goal">Campaign objective</label><select class="pa-input" id="ad-goal"><option>Grow Page followers</option><option>Promote a product or service</option><option>Promote an event</option><option>Drive visits to a website</option><option>Brand awareness</option></select><label class="pa-label" for="ad-budget">Proposed budget (optional)</label><input class="pa-input" id="ad-budget" maxlength="80" placeholder="e.g. ₦20,000"><label class="pa-label" for="ad-destination">Destination link (optional)</label><input class="pa-input" id="ad-destination" type="url" placeholder="https://example.com"><label class="pa-label" for="ad-notes">Campaign details</label><textarea class="pa-input" id="ad-notes" maxlength="1500" rows="4" placeholder="Tell us what you want to promote."></textarea><div class="pa-buttons"><button class="pa-primary" type="submit">Submit advertising enquiry</button><a class="pa-secondary" href="${dashboard()}">Cancel</a></div></form>`);
    $('#ad-request-form').onsubmit=async e=>{e.preventDefault();const dest=$('#ad-destination').value.trim();if(dest&&!safeUrl(dest))return message('Destination link must begin with http:// or https://.','error');const btn=e.submitter;btn.disabled=true;const {error}=await FX.client.from('frnxup_page_ad_requests').insert({page_id:page.id,owner_user_id:FX.user.id,objective:$('#ad-goal').value,budget_label:$('#ad-budget').value.trim()||null,destination_url:dest||null,notes:$('#ad-notes').value.trim()||null});btn.disabled=false;if(error)return message(error.message,'error');await log('advertising_enquiry_created',{objective:$('#ad-goal').value});message('Advertising enquiry submitted for review. No payment has been taken.','success');e.target.reset();};
  }
  async function archivedPosts() {
    frame('Page archive','Restore a post to make it visible on your Page again.',`<section class="pa-panel"><div id="archive-list" class="pa-list">Loading archived posts…</div></section>`);
    const host=$('#archive-list');FXStates.loading(host,{title:'Loading Page archive',message:'Fetching posts that have been archived.'});const {data,error}=await FX.client.from('frnxup_page_post_archive').select('post_id,archived_at,post:posts(id,body,created_at,media_type)').eq('page_id',page.id).order('archived_at',{ascending:false});if(error){stateError(host,error,archivedPosts);return;}if(!data?.length){stateEmpty(host,'No archived posts','There are no archived Page posts.');return;}
    host.innerHTML=data.map(x=>`<article class="pa-post-row"><b>${esc((x.post?.body||'Media post').slice(0,180))}</b><small>Archived ${esc(FX.relative(x.archived_at))}</small><button class="pa-secondary" type="button" data-restore-post="${esc(x.post_id)}">Restore post</button></article>`).join('');
    host.querySelectorAll('[data-restore-post]').forEach(btn=>btn.onclick=async()=>{btn.disabled=true;const {error}=await FX.client.from('frnxup_page_post_archive').delete().eq('page_id',page.id).eq('post_id',btn.dataset.restorePost);if(error){btn.disabled=false;return message(error.message,'error');}await log('post_restored',{post_id:btn.dataset.restorePost});btn.closest('.pa-post-row').remove();if(!host.querySelector('.pa-post-row'))host.innerHTML='<p class="pa-empty">There are no archived Page posts.</p>';});
  }
  async function reviewPosts() {
    frame('Review posts and tags','Archive posts from this Page, or review public posts that mention its @slug.',`<section class="pa-panel"><div class="pa-tabs"><button type="button" class="active" data-review-tab="own">Page posts</button><button type="button" data-review-tab="mentions">Mentions</button></div><div id="review-post-list" class="pa-list">Loading…</div></section>`);
    const host=$('#review-post-list');
    async function load(tab='own') {
      FXStates.loading(host,{title:tab==='own'?'Loading Page posts':'Loading Page mentions',message:'Fetching posts for this review section.'});let query=FX.client.from('posts').select('id,body,media_type,created_at,user_id').eq('status','published').order('created_at',{ascending:false}).limit(40);
      if(tab==='own')query=query.eq('page_id',page.id);else query=query.ilike('body',`%@${page.slug}%`).is('page_id',null);
      const {data,error}=await query;if(error){stateError(host,error,()=>load(tab));return;}if(!data?.length){stateEmpty(host,tab==='own'?'No Page posts':'No mentions found',tab==='own'?'This Page has not published any posts yet.':'No public posts mentioning @'+page.slug+' were found.');return;}
      let archived=new Set();if(tab==='own'){const {data:arcs}=await FX.client.from('frnxup_page_post_archive').select('post_id').eq('page_id',page.id);archived=new Set((arcs||[]).map(a=>a.post_id));}
      host.innerHTML=data.map(p=>`<article class="pa-post-row"><b>${esc((p.body||'Media post').slice(0,220))}</b><small>${tab==='own'?'Page post':'Public mention'} · ${esc(FX.relative(p.created_at))}</small>${tab==='own'?`<button type="button" class="pa-secondary" data-archive-post="${esc(p.id)}" ${archived.has(p.id)?'disabled':''}>${archived.has(p.id)?'Archived':'Archive post'}</button>`:`<span class="pa-help">Posted by a Frnxup member</span>`}</article>`).join('');
      host.querySelectorAll('[data-archive-post]').forEach(btn=>btn.onclick=async()=>{btn.disabled=true;const {error}=await FX.client.from('frnxup_page_post_archive').insert({page_id:page.id,post_id:btn.dataset.archivePost,archived_by:FX.user.id});if(error){btn.disabled=false;return message(error.message,'error');}await log('post_archived',{post_id:btn.dataset.archivePost});btn.textContent='Archived';message('Post moved to the Page archive.','success');});
    }
    root.querySelectorAll('[data-review-tab]').forEach(btn=>btn.onclick=()=>{root.querySelectorAll('[data-review-tab]').forEach(x=>x.classList.toggle('active',x===btn));load(btn.dataset.reviewTab)});load();
  }
  async function highlights() {
    frame('Page highlights','Add featured images to introduce important products, events or information.',`<form class="pa-panel" id="highlight-form"><label class="pa-label" for="highlight-title">Highlight title</label><input class="pa-input" id="highlight-title" maxlength="80" required placeholder="e.g. Latest updates"><label class="pa-label" for="highlight-file">Highlight image</label><input class="pa-input" id="highlight-file" type="file" accept="image/*" required><div id="highlight-preview" class="pa-preview-grid"></div><button class="pa-primary" type="submit">Add highlight</button></form><section class="pa-panel"><h2>Current highlights</h2><div id="highlight-list" class="pa-highlight-grid">Loading…</div></section>`);
    const input=$('#highlight-file');input.onchange=()=>{const file=input.files?.[0];if(file){const img=document.createElement('img');img.src=URL.createObjectURL(file);$('#highlight-preview').replaceChildren(img)}};
    $('#highlight-form').onsubmit=async e=>{e.preventDefault();const file=input.files?.[0],title=$('#highlight-title').value.trim();if(!file||!file.type.startsWith('image/'))return message('Choose an image for this highlight.','error');const btn=e.submitter;btn.disabled=true;btn.textContent='Uploading…';try{const path=await FX.upload(file,'pages-highlights');const {error}=await FX.client.from('frnxup_page_highlights').insert({page_id:page.id,owner_user_id:FX.user.id,title,media_path:path,media_type:'image'});if(error)throw error;await log('highlight_added',{title});e.target.reset();$('#highlight-preview').replaceChildren();FXStates.clearUpload($('#action-message'));message('Highlight added.','success');await loadHighlights();}catch(err){FXStates.failUpload($('#action-message'),err,{retry:()=>$('#highlight-form').requestSubmit()});}finally{btn.disabled=false;btn.textContent='Add highlight';}};
    loadHighlights();
  }
  async function loadHighlights(){const host=$('#highlight-list');if(!host)return;if(host.dataset.fxHasContent!=='true')FXStates.loading(host,{title:'Loading Page highlights',message:'Fetching featured images for this Page.'});const {data,error}=await FX.client.from('frnxup_page_highlights').select('*').eq('page_id',page.id).order('created_at',{ascending:false});if(error){stateError(host,error,loadHighlights);return;}if(!data?.length){stateEmpty(host,'No highlights yet','No highlights have been added to this Page.');return;}host.innerHTML=await Promise.all(data.map(async h=>{const url=await FX.mediaUrl(h.media_path);return `<article class="pa-highlight-card">${url?`<img src="${esc(url)}" alt="">`:''}<b>${esc(h.title)}</b><button type="button" class="pa-secondary" data-delete-highlight="${esc(h.id)}">Remove</button></article>`;})).then(x=>x.join(''));FXStates.loaded(host);host.querySelectorAll('[data-delete-highlight]').forEach(btn=>btn.onclick=async()=>{if(!confirm('Remove this highlight?'))return;btn.disabled=true;const {error}=await FX.client.from('frnxup_page_highlights').delete().eq('id',btn.dataset.deleteHighlight).eq('page_id',page.id);if(error){btn.disabled=false;return message(error.message,'error');}await log('highlight_removed',{highlight_id:btn.dataset.deleteHighlight});loadHighlights();});}
  function search() {
    frame('Search Page posts','Search text published by this Page.',`<section class="pa-panel"><form id="page-search-form" class="pa-search"><input class="pa-input" id="page-search-query" maxlength="100" placeholder="Search Page posts…" required><button class="pa-primary" type="submit">Search</button></form><div id="page-search-results" class="pa-list"></div></section>`);
    $('#page-search-form').onsubmit=async e=>{e.preventDefault();const term=$('#page-search-query').value.trim();if(term.length<2)return message('Enter at least two characters.','error');const host=$('#page-search-results');FXStates.loading(host,{title:'Searching Page posts',message:'Looking for matching public posts.'});const {data,error}=await FX.client.from('posts').select('id,body,created_at,media_type').eq('page_id',page.id).eq('status','published').ilike('body',`%${term.replace(/[%_]/g,'\\$&')}%`).order('created_at',{ascending:false}).limit(50);if(error){stateError(host,error,()=>$('#page-search-form').requestSubmit());return;}if(!data?.length){stateEmpty(host,'No matching posts','Try another search term.');return;}host.innerHTML=data.map(p=>`<article class="pa-post-row"><b>${esc(p.body||'Media post')}</b><small>${esc(FX.relative(p.created_at))}</small></article>`).join('');FXStates.loaded(host);};
  }
  async function story() {
    frame('Add to Page story','Share one photo or video with your Page followers. Stories expire automatically after 24 hours.',`<form class="pa-panel" id="page-story-form"><label class="pa-label" for="story-caption">Caption (optional)</label><textarea class="pa-input" id="story-caption" maxlength="500" rows="3"></textarea><label class="pa-label" for="story-file">Photo or video</label><input class="pa-input" id="story-file" type="file" accept="image/*,video/*" required><div id="story-preview" class="pa-preview-grid"></div><div class="pa-buttons"><button class="pa-primary" type="submit">Share story</button><a class="pa-secondary" href="${dashboard()}">Cancel</a></div></form>`);
    const input=$('#story-file');input.onchange=()=>{const f=input.files?.[0];if(!f)return;const url=URL.createObjectURL(f),el=document.createElement(f.type.startsWith('video/')?'video':'img');el.src=url;if(el.tagName==='VIDEO'){el.controls=true;el.playsInline=true}$('#story-preview').replaceChildren(el)};
    $('#page-story-form').onsubmit=async e=>{e.preventDefault();const f=input.files?.[0];if(!f||(!f.type.startsWith('image/')&&!f.type.startsWith('video/')))return message('Choose a photo or video.','error');const btn=e.submitter;btn.disabled=true;btn.textContent='Uploading…';try{const path=await FX.upload(f,'pages-stories');const {error}=await FX.client.from('frnxup_page_stories').insert({page_id:page.id,owner_user_id:FX.user.id,media_path:path,media_type:f.type.startsWith('video/')?'video':'image',caption:$('#story-caption').value.trim()});if(error)throw error;await log('story_published',{media_type:f.type.startsWith('video/')?'video':'image'});message('Your Page story is live for 24 hours.','success');setTimeout(()=>location.assign(dashboard()),700);}catch(err){FXStates.failUpload($('#action-message'),err,{retry:()=>$('#page-story-form').requestSubmit()});btn.disabled=false;btn.textContent='Share story';}};
  }
  async function activity() {
    frame('Page activity log','Review recent actions carried out by Page administrators.',`<section class="pa-panel"><div id="page-activity-list" class="pa-list">Loading activity…</div></section>`);
    const host=$('#page-activity-list');FXStates.loading(host,{title:'Loading Page activity',message:'Fetching recent management actions.'});const {data,error}=await FX.client.from('frnxup_page_activity').select('action,details,created_at').eq('page_id',page.id).order('created_at',{ascending:false}).limit(100);if(error){stateError(host,error,activity);return;}if(!data?.length){stateEmpty(host,'No activity recorded','No Page actions have been recorded yet.');return;}host.innerHTML=data.map(row=>`<article class="pa-list-row"><span><b>${esc(row.action.replace(/_/g,' '))}</b><small>${esc(FX.time(row.created_at))}</small></span><small>${esc(JSON.stringify(row.details||{}).slice(0,160))}</small></article>`).join('');FXStates.loaded(host);
  }
  async function advertiseHistory() { /* Requests remain pending until reviewed by Frnxup. */ }
  const views={actions:menu,'profile-photo':()=>imageEditor('profile-photo'),'cover-photo':()=>imageEditor('cover-photo'),'create-post':createPost,'switch-account':switchAccount,share:sharePage,followers, 'edit-details':editDetails,settings,status,'action-button':actionButton,invite,advertise,archive:archivedPosts,'review-posts':reviewPosts,highlights,search,story,'activity-log':activity};

  async function init(){
    try{await loadPage();document.title=`${page.name} · ${action.replace(/-/g,' ')} · Frnxup`;if(views[action])await views[action]();else menu();}
    catch(error){if(root)FXStates.fail(root,error,{retry:init,title:'Page action could not be loaded'});}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
