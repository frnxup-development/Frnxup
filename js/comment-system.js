/* Shared Frnxup comments for posts, Reels, room messages and Group contexts. */
(() => {
  'use strict';
  if (window.FrnxupComments) return;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const $ = (selector, root = document) => root.querySelector(selector);
  const REACTIONS = [
    {key:'like',emoji:'👍',label:'Like'},{key:'love',emoji:'❤️',label:'Love'},
    {key:'haha',emoji:'😂',label:'Haha'},{key:'wow',emoji:'😮',label:'Wow'},
    {key:'sad',emoji:'😢',label:'Sad'},{key:'angry',emoji:'😡',label:'Angry'},
    {key:'support',emoji:'🤗',label:'Support'}
  ];
  const ALLOWED_CONTEXTS = new Set(['post','reel','room','group']);
  let activeModal = null;

  function toast(message) { window.FX?.toast?.(message); }
  function bodyMarkup(text) {
    const safe = esc(text || '');
    return safe.replace(/(^|\s)(@[A-Za-z0-9_.]{1,40})/g, '$1<span class="fx-unified-mention">$2</span>');
  }
  function buildTree(rows) {
    const nodes = new Map(rows.map(row => [row.id, {...row,children:[]} ]));
    const roots = [];
    rows.forEach(row => {
      const node = nodes.get(row.id);
      const parent = row.parent_id ? nodes.get(row.parent_id) : null;
      if (parent) parent.children.push(node); else roots.push(node);
    });
    const order = list => list.sort((a,b) => new Date(a.created_at)-new Date(b.created_at) || String(a.id).localeCompare(String(b.id)));
    order(roots);
    const sortChildren = node => { order(node.children); node.children.forEach(sortChildren); };
    roots.forEach(sortChildren);
    return roots;
  }
  function formatTime(value) {
    try { return new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)); }
    catch (_) { return value || ''; }
  }
  function classifyFile(file) {
    const type = (file.type || '').toLowerCase();
    const name = file.name || 'attachment';
    if (type === 'image/gif' || /\.gif$/i.test(name)) return 'gif';
    if (type.startsWith('image/')) return 'image';
    if (type.startsWith('video/')) return 'video';
    if (/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|odt|ods|odp)$/i.test(name)) return 'document';
    throw new Error('Choose an image, GIF, video or supported document.');
  }

  function shellMarkup(title) {
    return `<section class="fx-unified-comments" aria-label="${esc(title)}">
      <header class="fx-unified-comments-head"><div><h2>${esc(title)}</h2><small data-fx-comment-count>Loading discussion…</small></div><label class="fx-unified-sort">Oldest first</label></header>
      <div class="fx-unified-thread" data-fx-comment-list><div class="fx-unified-empty">Loading comments…</div></div>
      <form class="fx-unified-composer" data-fx-comment-form>
        <div class="fx-unified-reply-context" data-fx-reply-context hidden></div>
        <div class="fx-unified-mention-suggestions" data-fx-mention-suggestions hidden></div>
        <div class="fx-unified-compose-top"><textarea data-fx-comment-input maxlength="2000" rows="2" placeholder="Write a comment… use @ to mention someone" aria-label="Write a comment"></textarea><button class="fx-unified-send" type="submit" aria-label="Post comment">➤</button></div>
        <div class="fx-unified-compose-tools">
          <button type="button" data-fx-pick="image">▧ Photo</button><button type="button" data-fx-pick="gif">GIF</button><button type="button" data-fx-pick="video">▶ Video</button><button type="button" data-fx-pick="document">▤ Document</button><button type="button" data-fx-contact>▣ Contact</button>
          <span class="fx-unified-tools-spacer"></span><small>Replies · media · mentions</small>
        </div>
        <input type="file" data-fx-input="image" accept="image/*" multiple hidden>
        <input type="file" data-fx-input="gif" accept="image/gif" multiple hidden>
        <input type="file" data-fx-input="video" accept="video/*" multiple hidden>
        <input type="file" data-fx-input="document" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.odt,.ods,.odp,application/pdf,text/plain" multiple hidden>
        <div class="fx-unified-pending" data-fx-pending hidden></div>
        <div class="fx-unified-contact" data-fx-contact-form hidden><label>Contact name<input data-fx-contact-name maxlength="100" autocomplete="name"></label><label>Phone number<input data-fx-contact-phone maxlength="40" inputmode="tel" autocomplete="tel"></label><label>Email address<input data-fx-contact-email type="email" maxlength="160" autocomplete="email"></label><div><button type="button" data-fx-contact-cancel>Cancel</button><button type="button" data-fx-contact-save>Add contact card</button></div></div>
        <p class="fx-unified-composer-note" data-fx-comment-note>${window.FX?.user ? 'Comments appear in chronological order.' : 'Sign in to comment, reply or attach media.'}</p>
      </form>
    </section>`;
  }

  async function mount(root, config) {
    const contextType = String(config.type || 'post').toLowerCase();
    const contextId = String(config.contextId || config.id || '');
    if (!ALLOWED_CONTEXTS.has(contextType) || !contextId) throw new Error('A valid Frnxup comment context is required.');
    root.innerHTML = shellMarkup(config.title || (contextType === 'reel' ? 'Reel comments' : contextType === 'room' ? 'Room comments' : contextType === 'group' ? 'Group comments' : 'Comments'));
    const list = $('[data-fx-comment-list]', root);
    const form = $('[data-fx-comment-form]', root);
    const input = $('[data-fx-comment-input]', root);
    const send = $('[type="submit"]', form);
    const countNode = $('[data-fx-comment-count]', root);
    const replyContext = $('[data-fx-reply-context]', root);
    const mentionBox = $('[data-fx-mention-suggestions]', root);
    const pendingBox = $('[data-fx-pending]', root);
    const contactForm = $('[data-fx-contact-form]', root);
    const context = {type:contextType,id:contextId};
    let rows = [];
    let reactions = new Map();
    let replyTarget = null;
    let pending = [];
    let mentions = [];
    let mentionQueryToken = 0;
    let disposed = false;

    function renderAttachment(item) {
      if (item.type === 'contact') {
        return `<article class="fx-unified-attachment fx-unified-contact-card"><b>▣ ${esc(item.name || 'Shared contact')}</b>${item.phone ? `<span>${esc(item.phone)}</span>` : ''}${item.email ? `<span>${esc(item.email)}</span>` : ''}<button type="button" data-fx-save-contact="${esc(item._commentId || '')}" data-fx-contact-index="${Number(item._index || 0)}">Save contact</button></article>`;
      }
      const url = item.url || '';
      if (!url) return `<div class="fx-unified-attachment fx-unified-file">${esc(item.name || 'Attachment')} · unavailable</div>`;
      if (item.type === 'image' || item.type === 'gif') return `<a class="fx-unified-attachment fx-unified-image" href="${esc(url)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(url)}" alt="${esc(item.name || item.type)}"><small>${item.type === 'gif' ? 'GIF' : 'Image'}</small></a>`;
      if (item.type === 'video') return `<div class="fx-unified-attachment fx-unified-video"><video controls playsinline preload="metadata" src="${esc(url)}"></video><small>${esc(item.name || 'Video')}</small></div>`;
      return `<a class="fx-unified-attachment fx-unified-file" href="${esc(url)}" target="_blank" rel="noopener">▤ <span>${esc(item.name || 'Document')}</span><small>${esc(item.mime || 'File')}</small></a>`;
    }
    function renderComment(comment) {
      const mine = !!FX.user && comment.user_id === FX.user.id;
      const profile = comment.profiles || {};
      const name = profile.display_name || profile.username || 'Frnxup member';
      const avatar = comment._avatar || '';
      const deleted = comment.status === 'deleted';
      const ownReaction = (reactions.get(comment.id) || []).find(r => r.user_id === FX.user?.id);
      const counts = new Map();
      (reactions.get(comment.id) || []).forEach(r => counts.set(r.reaction,(counts.get(r.reaction)||0)+1));
      const summary = [...counts.entries()].map(([key,total]) => { const item=REACTIONS.find(r=>r.key===key); return `<span class="fx-unified-reaction-chip ${ownReaction?.reaction===key?'mine':''}">${item?.emoji||'👍'} ${total}</span>`; }).join('');
      const attachments = deleted ? '' : (comment._attachments || []).map((item,index) => renderAttachment({...item,_commentId:comment.id,_index:index})).join('');
      const children = comment.children || [];
      const actions = `<div class="fx-unified-comment-actions"><button type="button" data-fx-reply="${comment.id}">Reply</button><button type="button" data-fx-react="${comment.id}">React${ownReaction ? ` · ${REACTIONS.find(x=>x.key===ownReaction.reaction)?.emoji||'👍'}` : ''}</button>${mine && !deleted ? `<button type="button" data-fx-edit="${comment.id}">Edit</button><button type="button" data-fx-delete="${comment.id}">Delete</button>` : ''}<button type="button" data-fx-share="${comment.id}">Share</button>${!mine && FX.user && !deleted ? `<button type="button" data-fx-report="${comment.id}">Report</button>` : ''}</div>`;
      const reactionTray = `<div class="fx-unified-reaction-tray" data-fx-tray="${comment.id}" hidden>${REACTIONS.map(r=>`<button type="button" title="${r.label}" data-fx-reaction="${r.key}" data-fx-reaction-id="${comment.id}">${r.emoji}</button>`).join('')}</div>`;
      return `<article class="fx-unified-comment" id="fx-comment-${comment.id}" data-fx-comment="${comment.id}">
        <div class="fx-unified-comment-main"><div class="fx-unified-avatar">${avatar ? `<img src="${esc(avatar)}" alt="">` : esc(name.slice(0,1).toUpperCase())}</div>
          <div class="fx-unified-comment-content"><div class="fx-unified-comment-bubble"><div class="fx-unified-comment-byline"><b>${esc(name)}</b><time datetime="${esc(comment.created_at)}">${esc(FX.relative(comment.created_at))}</time>${mine?'<small>You</small>':''}</div><div class="fx-unified-comment-text ${deleted?'deleted':''}">${deleted?'This comment was deleted.':bodyMarkup(comment.body)}</div>${attachments ? `<div class="fx-unified-attachments">${attachments}</div>` : ''}</div>
            ${summary ? `<div class="fx-unified-reactions">${summary}</div>` : ''}${actions}${reactionTray}
          </div></div>
        ${children.length ? `<div class="fx-unified-children">${children.map(renderComment).join('')}</div>` : ''}
      </article>`;
    }
    async function hydrateRows(data) {
      const profs = [...new Set(data.map(row => row.user_id).filter(Boolean))];
      const avatars = new Map();
      const profiles = data.map(row => row.profiles).filter(Boolean);
      await Promise.all(profiles.map(async p => { if (p.avatar_path) { try { avatars.set(p.id, await FX.mediaUrl(p.avatar_path)); } catch (_) {} } }));
      const attachmentTasks = [];
      data.forEach(row => {
        row._avatar = avatars.get(row.profiles?.id || row.user_id) || '';
        row._attachments = Array.isArray(row.attachments) ? row.attachments.map(item => ({...item})) : [];
        row._attachments.forEach(item => { if (item.path) attachmentTasks.push(FX.mediaUrl(item.path).then(url => { item.url = url; }).catch(()=>{})); });
      });
      await Promise.all(attachmentTasks);
    }
    async function load() {
      list.innerHTML = '<div class="fx-unified-empty">Loading chronological comments…</div>';
      const collected = [];
      for (let start=0; ; start+=500) {
        const {data,error} = await FX.client.from('post_comments')
          .select('id,post_id,context_type,context_id,user_id,parent_id,body,attachments,mentions,status,created_at,profiles!post_comments_user_id_fkey(id,username,display_name,avatar_path)')
          .eq('context_type',context.type).eq('context_id',context.id)
          .in('status',['published','deleted']).order('created_at',{ascending:true}).range(start,start+499);
        if (error) throw error;
        collected.push(...(data||[]));
        if (!data || data.length<500) break;
      }
      rows = collected;
      reactions = new Map();
      if (FX.user) {
        for (let start=0; start<rows.length; start+=500) {
          const ids=rows.slice(start,start+500).map(r=>r.id);
          if (!ids.length) continue;
          const {data,error}=await FX.client.from('comment_reactions').select('comment_id,user_id,reaction').in('comment_id',ids);
          if(error) throw error;
          (data||[]).forEach(r=>{if(!reactions.has(r.comment_id))reactions.set(r.comment_id,[]);reactions.get(r.comment_id).push(r);});
        }
      }
      await hydrateRows(rows);
      const tree=buildTree(rows);
      countNode.textContent=`${rows.length.toLocaleString()} comment${rows.length===1?'':'s'} · chronological`;
      list.innerHTML=tree.length?tree.map(renderComment).join(''):'<div class="fx-unified-empty">No comments yet. Start the conversation.</div>';
      if (config.onCountChange) config.onCountChange(rows.length);
      if (config.scrollToLatest !== false) list.scrollTop=list.scrollHeight;
    }
    function setReply(row) {
      replyTarget=row.id;
      const name=row.profiles?.display_name || row.profiles?.username || 'member';
      replyContext.hidden=false;
      replyContext.innerHTML=`Replying to <b>${esc(name)}</b><button type="button" data-fx-cancel-reply>Cancel</button>`;
      input.placeholder=`Reply to ${name}…`;
      input.focus();
    }
    async function findMentions(query) {
      const token=++mentionQueryToken;
      if (!FX.client || !FX.user) { mentionBox.hidden=true; return; }
      let request=FX.client.from('profiles').select('id,username,display_name,avatar_path').eq('account_status','active').order('username').limit(8);
      if (query) request=request.ilike('username',`${query}%`);
      const {data,error}=await request;
      if (token!==mentionQueryToken) return;
      if(error||!data?.length){mentionBox.hidden=true;return;}
      mentionBox.innerHTML=data.map(p=>`<button type="button" data-fx-mention-id="${p.id}" data-fx-mention-name="${esc(p.username)}"><b>@${esc(p.username)}</b><small>${esc(p.display_name||'Frnxup member')}</small></button>`).join('');
      mentionBox.hidden=false;
    }
    function updatePending() {
      if (!pending.length) { pendingBox.hidden=true; pendingBox.innerHTML=''; return; }
      pendingBox.hidden=false;
      pendingBox.innerHTML=pending.map((item,index)=>`<span>${esc(item.contact?.name || item.file?.name || item.type)} <button type="button" data-fx-remove-pending="${index}" aria-label="Remove attachment">×</button></span>`).join('');
    }
    async function uploadPending() {
      const uploaded=[];
      for(const item of pending){
        if(item.type==='contact'){uploaded.push({type:'contact',name:item.contact.name,phone:item.contact.phone,email:item.contact.email});continue;}
        const file=item.file;
        const safeName=file.name.replace(/[^a-z0-9._-]/gi,'_').slice(-110) || 'attachment';
        const path=`${FX.user.id}/comments/${context.type}/${context.id}/${Date.now()}_${Math.random().toString(36).slice(2,8)}_${safeName}`;
        const ext=(file.name.split('.').pop()||'').toLowerCase();
        const mimeFallback={pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',txt:'text/plain',csv:'text/csv',odt:'application/vnd.oasis.opendocument.text',ods:'application/vnd.oasis.opendocument.spreadsheet',odp:'application/vnd.oasis.opendocument.presentation',gif:'image/gif'};
        const mime=file.type || mimeFallback[ext] || 'application/octet-stream';
        const {error}=await FX.client.storage.from('frnxup-media').upload(path,file,{cacheControl:'3600',upsert:false,contentType:mime});
        if(error) throw error;
        uploaded.push({type:item.type,path,name:file.name,mime:file.type,size:file.size});
      }
      return uploaded;
    }
    async function submit(event) {
      event.preventDefault();
      if(!FX.user){location.href='/Auth/index.html?next='+encodeURIComponent(location.pathname+location.search);return;}
      const body=input.value.trim();
      if(!body && !pending.length) return;
      if(body.length>2000) return toast('Comments can contain up to 2,000 characters.');
      send.disabled=true; send.textContent='…';
      try{
        const attachments=await uploadPending();
        const payload={post_id:(context.type==='post'||context.type==='reel')?context.id:null,context_type:context.type,context_id:context.id,user_id:FX.user.id,parent_id:replyTarget,body,attachments,mentions};
        const {data,error}=await FX.client.from('post_comments').insert(payload).select('id').single();
        if(error) throw error;
        input.value='';pending=[];mentions=[];replyTarget=null;replyContext.hidden=true;replyContext.innerHTML='';input.placeholder='Write a comment… use @ to mention someone';updatePending();
        await load();
      }catch(error){toast(error.message || 'Your comment could not be posted.');}
      finally{send.disabled=false;send.textContent='➤';}
    }
    async function react(id,key) {
      if(!FX.user) return toast('Sign in to react to comments.');
      const current=(reactions.get(id)||[]).find(r=>r.user_id===FX.user.id);
      if(current?.reaction===key){const {error}=await FX.client.from('comment_reactions').delete().eq('comment_id',id).eq('user_id',FX.user.id);if(error)throw error;}
      else {const {error}=await FX.client.from('comment_reactions').upsert({comment_id:id,user_id:FX.user.id,reaction:key},{onConflict:'comment_id,user_id'});if(error)throw error;}
      await load();
    }
    async function handleAction(button) {
      const id=button.dataset.fxEdit||button.dataset.fxDelete||button.dataset.fxReply||button.dataset.fxShare||button.dataset.fxReport;
      const row=rows.find(item=>item.id===id); if(!row)return;
      if(button.hasAttribute('data-fx-reply')) return setReply(row);
      if(button.hasAttribute('data-fx-edit')){
        if(!FX.user||row.user_id!==FX.user.id)return toast('You can only edit your own comments.');
        const next=prompt('Edit your comment',row.body||'');if(next===null)return;if(!next.trim() && !(row.attachments||[]).length)return toast('A comment needs text or an attachment.');
        const {error}=await FX.client.from('post_comments').update({body:next.trim()}).eq('id',id).eq('user_id',FX.user.id);if(error)throw error;await load();return;
      }
      if(button.hasAttribute('data-fx-delete')){
        if(!FX.user||row.user_id!==FX.user.id)return toast('You can only delete your own comments.');
        if(!confirm('Delete this comment? Replies will remain in the thread.'))return;
        const {error}=await FX.client.from('post_comments').update({body:'This comment was deleted.',status:'deleted'}).eq('id',id).eq('user_id',FX.user.id);if(error)throw error;await load();return;
      }
      if(button.hasAttribute('data-fx-share')){
        const url=`${location.origin}${location.pathname}${location.search}#fx-comment-${id}`;
        if(navigator.share){try{await navigator.share({title:'Frnxup comment',url});return;}catch(e){if(e.name==='AbortError')return;}}
        await navigator.clipboard.writeText(url);toast('Comment link copied.');return;
      }
      if(button.hasAttribute('data-fx-report')){
        if(!FX.user)return;const reason=prompt('Why are you reporting this comment?');if(!reason?.trim())return;
        const {error}=await FX.client.from('reports').insert({reporter_id:FX.user.id,target_type:'comment',target_id:id,reason:reason.trim()});if(error)throw error;toast('Comment reported.');
      }
    }
    form.addEventListener('submit',submit);
    input.addEventListener('input',()=>{
      const match=input.value.slice(0,input.selectionStart).match(/(?:^|\s)@([A-Za-z0-9_.]{0,30})$/);
      if(match) findMentions(match[1]); else mentionBox.hidden=true;
    });
    input.addEventListener('keydown',event=>{if(event.key==='Escape'){mentionBox.hidden=true;}});
    root.addEventListener('click',async event=>{
      const pick=event.target.closest('[data-fx-pick]');if(pick){const kind=pick.dataset.fxPick;const inputFile=$(`[data-fx-input="${kind}"]`,root);inputFile?.click();return;}
      const contactBtn=event.target.closest('[data-fx-contact]');if(contactBtn){contactForm.hidden=!contactForm.hidden;return;}
      if(event.target.closest('[data-fx-contact-cancel]')){contactForm.hidden=true;return;}
      if(event.target.closest('[data-fx-contact-save]')){
        const name=$('[data-fx-contact-name]',root).value.trim(),phone=$('[data-fx-contact-phone]',root).value.trim(),email=$('[data-fx-contact-email]',root).value.trim();
        if(!name || (!phone&&!email))return toast('Enter a contact name and at least a phone number or email.');
        pending.push({type:'contact',contact:{name,phone,email}});contactForm.hidden=true;updatePending();return;
      }
      const rm=event.target.closest('[data-fx-remove-pending]');if(rm){pending.splice(Number(rm.dataset.fxRemovePending),1);updatePending();return;}
      const mention=event.target.closest('[data-fx-mention-id]');if(mention){const username=mention.dataset.fxMentionName;const start=input.value.slice(0,input.selectionStart).search(/(?:^|\s)@[A-Za-z0-9_.]*$/);const before=input.value.slice(0,input.selectionStart);const lastAt=before.lastIndexOf('@');const tokenStart=lastAt>=0?lastAt:before.length;input.setRangeText(`@${username} `,tokenStart,input.selectionStart,'end');mentions.push({id:mention.dataset.fxMentionId,username});mentionBox.hidden=true;input.focus();return;}
      const reaction=event.target.closest('[data-fx-reaction]');if(reaction){try{await react(reaction.dataset.fxReactionId,reaction.dataset.fxReaction);}catch(error){toast(error.message);}return;}
      const reply=event.target.closest('[data-fx-reply], [data-fx-edit], [data-fx-delete], [data-fx-share], [data-fx-report]');if(reply){try{await handleAction(reply);}catch(error){toast(error.message);}return;}
      const reactBtn=event.target.closest('[data-fx-react]');if(reactBtn){const tray=$(`[data-fx-tray="${CSS.escape(reactBtn.dataset.fxReact)}"]`,root);if(tray)tray.hidden=!tray.hidden;return;}
      const saveContact=event.target.closest('[data-fx-save-contact]');if(saveContact){const comment=rows.find(r=>r.id===saveContact.dataset.fxSaveContact);const item=comment?._attachments?.[Number(saveContact.dataset.fxContactIndex)];if(!item||item.type!=='contact')return;const lines=['BEGIN:VCARD','VERSION:3.0',`FN:${item.name||''}`,item.phone?`TEL:${item.phone}`:'',item.email?`EMAIL:${item.email}`:'','END:VCARD'].filter(Boolean);const blob=new Blob([lines.join('\r\n')],{type:'text/vcard'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${(item.name||'contact').replace(/[^a-z0-9_-]/gi,'_')}.vcf`;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);return;}
      if(event.target.closest('[data-fx-cancel-reply]')){replyTarget=null;replyContext.hidden=true;replyContext.innerHTML='';input.placeholder='Write a comment… use @ to mention someone';}
    });
    root.querySelectorAll('[data-fx-input]').forEach(fileInput=>fileInput.addEventListener('change',()=>{
      const kind=fileInput.dataset.fxInput;
      for(const file of [...(fileInput.files||[])]){
        try{const inferred=classifyFile(file);if(kind==='gif'&&inferred!=='gif')throw new Error('Choose a GIF file.');if(kind==='image'&&inferred!=='image')throw new Error('Choose an image file.');if(kind==='video'&&inferred!=='video')throw new Error('Choose a video file.');if(kind==='document'&&inferred!=='document')throw new Error('Choose a supported document.');const limit=inferred==='document'?25*1024*1024:100*1024*1024;if(file.size>limit)throw new Error(`${inferred==='document'?'Documents':'Media'} must be ${inferred==='document'?'25':'100'} MB or smaller.`);if(pending.length>=10)throw new Error('You can attach up to 10 items to one comment.');pending.push({type:inferred,file});}catch(error){toast(error.message);}
      }
      fileInput.value='';updatePending();
    }));
    if(!FX.user){input.disabled=true;send.disabled=true;root.querySelectorAll('[data-fx-pick],[data-fx-contact]').forEach(b=>b.disabled=true);$('[data-fx-comment-note]',root).innerHTML=`<a href="/Auth/index.html?next=${encodeURIComponent(location.pathname+location.search)}">Sign in</a> to comment, reply or attach media.`;}
    await load();
    return {refresh:load,dispose(){disposed=true;form.removeEventListener('submit',submit);}};
  }

  function openModal(config) {
    closeModal();
    const modal=document.createElement('div');modal.className='fx-unified-comments-modal';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.innerHTML=`<button class="fx-unified-comments-backdrop" type="button" data-fx-modal-close aria-label="Close comments"></button><div class="fx-unified-comments-panel"><div class="fx-unified-modal-top"><span></span><button type="button" data-fx-modal-close aria-label="Close comments">×</button></div><div data-fx-modal-content></div></div>`;
    document.body.appendChild(modal);document.body.classList.add('fx-comments-open');activeModal=modal;
    modal.querySelectorAll('[data-fx-modal-close]').forEach(button=>button.addEventListener('click',closeModal));
    mount($('[data-fx-modal-content]',modal),config).catch(error=>{const host=$('[data-fx-modal-content]',modal);host.innerHTML=`<div class="fx-unified-empty">${esc(error.message||'Comments could not be loaded.')}</div>`;});
    const closeOnEscape=event=>{if(event.key==='Escape')closeModal();};modal._closeOnEscape=closeOnEscape;document.addEventListener('keydown',closeOnEscape);
    return modal;
  }
  function closeModal(){if(!activeModal)return;document.removeEventListener('keydown',activeModal._closeOnEscape);activeModal.remove();activeModal=null;document.body.classList.remove('fx-comments-open');}
  window.FrnxupComments={mount,openModal,closeModal};
})();
