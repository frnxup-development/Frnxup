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
  const ROOT_PAGE_SIZE = 25;
  const REPLY_PAGE_SIZE = 20;
  const DISCUSSION_CACHE_TTL = 90 * 1000;
  const discussionCache = new Map();
  const signedMediaCache = new Map();
  const profileCache = new Map();

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
    if (type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|oga|opus|webm)$/i.test(name)) return 'audio';
    if (/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|odt|ods|odp)$/i.test(name)) return 'document';
    throw new Error('Choose an image, GIF, video, voice note or supported document.');
  }

  function shellMarkup(title) {
    return `<section class="fx-unified-comments" aria-label="${esc(title)}">
      <header class="fx-unified-comments-head"><div><h2>${esc(title)}</h2><small data-fx-comment-count>Opening discussion…</small></div></header>
      <div class="fx-unified-thread" data-fx-comment-list aria-live="polite" aria-busy="true">
        <div class="fx-comment-skeleton" aria-hidden="true"><i></i><span><b></b><em></em></span></div>
        <div class="fx-comment-skeleton" aria-hidden="true"><i></i><span><b></b><em></em></span></div>
        <div class="fx-comment-skeleton" aria-hidden="true"><i></i><span><b></b><em></em></span></div>
      </div>
      <form class="fx-unified-composer" data-fx-comment-form>
        <div class="fx-unified-reply-context" data-fx-reply-context hidden></div>
        <div class="fx-unified-mention-suggestions" data-fx-mention-suggestions hidden></div>
        <div class="fx-unified-compose-top"><textarea data-fx-comment-input maxlength="2000" rows="2" placeholder="Write a comment… use @ to mention someone" aria-label="Write a comment"></textarea><button class="fx-unified-send" type="submit" aria-label="Post comment">➤</button></div>
        <div class="fx-unified-compose-tools">
          <button type="button" data-fx-pick="image">▧ Photo</button><button type="button" data-fx-pick="gif">GIF</button><button type="button" data-fx-pick="video">▶ Video</button><button type="button" data-fx-record-voice>🎙 Voice note</button><button type="button" data-fx-pick="audio">♫ Audio</button><button type="button" data-fx-pick="document">▤ Document</button><button type="button" data-fx-contact>▣ Share contact</button>
        </div>
        <div class="fx-unified-voice-status" data-fx-voice-status hidden aria-live="polite"><span class="fx-unified-record-dot"></span><span data-fx-voice-time>Ready to record</span><button type="button" data-fx-cancel-record hidden>Cancel</button></div>
        <input type="file" data-fx-input="image" accept="image/*" multiple hidden>
        <input type="file" data-fx-input="gif" accept="image/gif" multiple hidden>
        <input type="file" data-fx-input="video" accept="video/*" multiple hidden>
        <input type="file" data-fx-input="audio" accept="audio/*" multiple hidden>
        <input type="file" data-fx-input="document" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.odt,.ods,.odp,application/pdf,text/plain" multiple hidden>
        <div class="fx-unified-pending" data-fx-pending hidden></div>
        <div class="fx-unified-contact" data-fx-contact-form hidden><p>Device contact selection is unavailable in this browser. Add a contact card manually instead.</p><label>Contact name<input data-fx-contact-name maxlength="100" autocomplete="name"></label><label>Phone number<input data-fx-contact-phone maxlength="40" inputmode="tel" autocomplete="tel"></label><label>Email address<input data-fx-contact-email type="email" maxlength="160" autocomplete="email"></label><div><button type="button" data-fx-contact-cancel>Cancel</button><button type="button" data-fx-contact-save>Add contact card</button></div></div>
        <p class="fx-unified-composer-note" data-fx-comment-note hidden></p>
      </form>
    </section>`;
  }

  async function mount(root, config = {}) {
    // The comments component receives discussion identifiers only. It never
    // receives or queries the parent post body, photos, video or Reel metadata.
    config = {
      type: config.type,
      contextId: config.contextId || config.id,
      title: config.title,
      scrollToLatest: config.scrollToLatest,
      onCountChange: typeof config.onCountChange === 'function' ? config.onCountChange : null
    };
    const contextType = String(config.type || 'post').toLowerCase();
    const contextId = String(config.contextId || '');
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
    let replyCounts = new Map();
    let replyPages = new Map();
    let replyTarget = null;
    let pending = [];
    let mentions = [];
    let mentionQueryToken = 0;
    let disposed = false;
    let rootOffset = 0;
    let rootHasMore = true;
    let rootLoading = false;
    let lazyMediaObserver = null;
    const cacheKey = `${context.type}:${context.id}:${FX.user?.id || 'anon'}`;
    let voiceRecorder = null;
    let voiceStream = null;
    let voiceChunks = [];
    let voiceTimer = null;
    let voiceStartedAt = 0;
    let cancelVoiceOnStop = false;
    const voiceButton = $('[data-fx-record-voice]', root);
    const voiceStatus = $('[data-fx-voice-status]', root);
    const voiceTime = $('[data-fx-voice-time]', root);
    const voiceCancel = $('[data-fx-cancel-record]', root);

    function renderAttachment(item) {
      if (item.type === 'contact') {
        return `<article class="fx-unified-attachment fx-unified-contact-card"><b>▣ ${esc(item.name || 'Shared contact')}</b>${item.phone ? `<span>${esc(item.phone)}</span>` : ''}${item.email ? `<span>${esc(item.email)}</span>` : ''}<button type="button" data-fx-save-contact="${esc(item._commentId || '')}" data-fx-contact-index="${Number(item._index || 0)}">Save contact</button></article>`;
      }
      const path = item.path || '';
      if (!path) return `<div class="fx-unified-attachment fx-unified-file">${esc(item.name || 'Attachment')} · unavailable</div>`;
      const lazy = `data-fx-lazy-path="${esc(path)}"`;
      if (item.type === 'image' || item.type === 'gif') return `<a class="fx-unified-attachment fx-unified-image" data-fx-lazy-link data-fx-attachment-path="${esc(path)}" href="#" target="_blank" rel="noopener" aria-label="Open ${item.type === 'gif' ? 'GIF' : 'image'} ${esc(item.name || '')}"><img data-fx-lazy-type="image" ${lazy} loading="lazy" decoding="async" alt="${esc(item.name || item.type)}"><small>${item.type === 'gif' ? 'GIF' : 'Image'}</small></a>`;
      if (item.type === 'video') return `<div class="fx-unified-attachment fx-unified-video"><video controls playsinline preload="none" data-fx-lazy-type="video" ${lazy}></video><small>${esc(item.name || 'Video')}</small></div>`;
      if (item.type === 'audio') return `<div class="fx-unified-attachment fx-unified-audio"><div class="fx-unified-audio-title">🎙 ${esc(item.name || 'Voice note')}</div><audio controls preload="none" data-fx-lazy-type="audio" ${lazy}></audio></div>`;
      return `<a class="fx-unified-attachment fx-unified-file" data-fx-lazy-link ${lazy} href="#" target="_blank" rel="noopener">▤ <span>${esc(item.name || 'Document')}</span><small>${esc(item.mime || 'File')}</small></a>`;
    }
    function prepareRows(data) {
      return (data || []).map(row => ({
        ...row,
        _attachments: Array.isArray(row.attachments) ? row.attachments.map(item => ({ ...item })) : []
      }));
    }
    function cloneRows(data) {
      return (data || []).map(row => ({ ...row, profiles: row.profiles ? { ...row.profiles } : null, attachments: Array.isArray(row.attachments) ? row.attachments.map(item => ({ ...item })) : [], _attachments: Array.isArray(row._attachments) ? row._attachments.map(item => ({ ...item })) : [] }));
    }
    function renderComment(comment) {
      const mine = !!FX.user && comment.user_id === FX.user.id;
      const profile = comment.profiles || {};
      const name = profile.display_name || profile.username || 'Frnxup member';
      const avatarPath = profile.avatar_path || '';
      const deleted = comment.status === 'deleted';
      const reactionRows = reactions.get(comment.id) || [];
      const ownReaction = reactionRows.find(r => r.user_reaction)?.reaction || null;
      const summary = reactionRows.map(row => { const item=REACTIONS.find(r=>r.key===row.reaction); return `<span class="fx-unified-reaction-chip ${row.user_reaction?'mine':''}">${item?.emoji||'👍'} ${Number(row.reaction_count)||0}</span>`; }).join('');
      const attachments = deleted ? '' : (comment._attachments || []).map((item,index) => renderAttachment({...item,_commentId:comment.id,_index:index})).join('');
      const children = comment.children || [];
      const replyCount = replyCounts.get(comment.id);
      const replyState = replyPages.get(comment.id);
      const loadedReplies = replyState?.loaded ?? children.length;
      const canLoadReplies = Number(replyCount || 0) > loadedReplies;
      const replyControl = canLoadReplies ? `<button type="button" class="fx-unified-load-replies" data-fx-load-replies="${comment.id}" ${replyState?.loading?'disabled':''}>${replyState?.loading?'Loading replies…':loadedReplies ? `Load more replies (${Number(replyCount)-loadedReplies} left)` : `View ${replyCount} ${replyCount===1?'reply':'replies'}`}</button>` : '';
      const actions = `<div class="fx-unified-comment-actions"><button type="button" data-fx-reply="${comment.id}">Reply</button><button type="button" data-fx-react="${comment.id}">React${ownReaction ? ` · ${REACTIONS.find(x=>x.key===ownReaction)?.emoji||'👍'}` : ''}</button>${mine && !deleted ? `<button type="button" data-fx-edit="${comment.id}">Edit</button><button type="button" data-fx-delete="${comment.id}">Delete</button>` : ''}<button type="button" data-fx-share="${comment.id}">Share</button>${!mine && FX.user && !deleted ? `<button type="button" data-fx-report="${comment.id}">Report</button>` : ''}</div>`;
      const reactionTray = `<div class="fx-unified-reaction-tray" data-fx-tray="${comment.id}" hidden>${REACTIONS.map(r=>`<button type="button" title="${r.label}" data-fx-reaction="${r.key}" data-fx-reaction-id="${comment.id}">${r.emoji}</button>`).join('')}</div>`;
      const avatarMarkup = avatarPath ? `<img data-fx-lazy-type="image" data-fx-lazy-path="${esc(avatarPath)}" loading="lazy" alt="">` : esc(name.slice(0,1).toUpperCase());
      return `<article class="fx-unified-comment" id="fx-comment-${comment.id}" data-fx-comment="${comment.id}">
        <div class="fx-unified-comment-main"><div class="fx-unified-avatar">${avatarMarkup}</div>
          <div class="fx-unified-comment-content"><div class="fx-unified-comment-bubble"><div class="fx-unified-comment-byline"><b>${esc(name)}</b><time datetime="${esc(comment.created_at)}">${esc(FX.relative(comment.created_at))}</time>${mine?'<small>You</small>':''}</div><div class="fx-unified-comment-text ${deleted?'deleted':''}">${deleted?'This comment was deleted.':bodyMarkup(comment.body)}</div>${attachments ? `<div class="fx-unified-attachments">${attachments}</div>` : ''}</div>
            ${summary ? `<div class="fx-unified-reactions">${summary}</div>` : '<div class="fx-unified-reactions" hidden></div>'}${actions}${replyControl}${reactionTray}
          </div></div>
        ${children.length ? `<div class="fx-unified-children">${children.map(renderComment).join('')}</div>` : ''}
      </article>`;
    }
    function renderList(options = {}) {
      const previousTop = list.scrollTop;
      const previousHeight = list.scrollHeight;
      const wasAtBottom = previousTop + list.clientHeight >= previousHeight - 28;
      const tree = buildTree(rows);
      const pager = rootHasMore ? `<button type="button" class="fx-unified-load-earlier" data-fx-load-earlier ${rootLoading?'disabled':''}>${rootLoading?'Loading earlier comments…':'Load earlier comments'}</button>` : '';
      list.setAttribute('aria-busy', String(rootLoading));
      list.innerHTML = `${pager}${tree.length ? tree.map(renderComment).join('') : (rootLoading ? '<div class="fx-unified-empty">Loading comments…</div>' : '<div class="fx-unified-empty">No comments yet. Start the conversation.</div>')}`;
      const loaded = rows.length;
      countNode.textContent = `${loaded.toLocaleString()} loaded · ${rootHasMore ? 'more available' : 'up to date'}`;
      if (config.onCountChange) config.onCountChange(loaded);
      if (options.scrollToBottom || (options.preserveScroll && wasAtBottom)) list.scrollTop = list.scrollHeight;
      else if (options.preserveScroll) list.scrollTop = previousTop + (list.scrollHeight - previousHeight);
      observeLazyMedia();
    }
    function observeLazyMedia() {
      if (disposed || !root.isConnected) return;
      if (!('IntersectionObserver' in window)) {
        root.querySelectorAll('[data-fx-lazy-path]').forEach(loadLazyElement);
        return;
      }
      if (!lazyMediaObserver) lazyMediaObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          lazyMediaObserver.unobserve(entry.target);
          loadLazyElement(entry.target);
        });
      }, { root: list, rootMargin: '220px 0px', threshold: 0.01 });
      root.querySelectorAll('[data-fx-lazy-path]:not([data-fx-lazy-observed])').forEach(element => {
        element.dataset.fxLazyObserved = '1';
        lazyMediaObserver.observe(element);
      });
    }
    async function getCachedMediaUrl(path) {
      const key = `${FX.user?.id || 'anon'}:${path}`;
      const cached = signedMediaCache.get(key);
      if (cached?.url && cached.expiresAt > Date.now()) return cached.url;
      if (cached?.promise && cached.expiresAt > Date.now()) return cached.promise;
      const promise = Promise.resolve(FX.mediaUrl(path)).then(url => {
        if (url) signedMediaCache.set(key,{url,expiresAt:Date.now()+50*60*1000});
        else signedMediaCache.delete(key);
        return url;
      }).catch(error=>{signedMediaCache.delete(key);throw error;});
      signedMediaCache.set(key,{promise,expiresAt:Date.now()+60*1000});
      return promise;
    }
    async function loadLazyElement(element) {
      const path = element?.dataset?.fxLazyPath;
      if (!path || element.dataset.fxLazyLoading === '1' || element.dataset.fxLazyReady === '1') return null;
      element.dataset.fxLazyLoading = '1';
      try {
        const url = await getCachedMediaUrl(path);
        if (!url || !element.isConnected) return null;
        const kind = element.dataset.fxLazyType || (element.tagName === 'IMG' ? 'image' : 'href');
        if (kind === 'href') element.href = url;
        else { element.src = url; if (kind === 'video' || kind === 'audio') element.load(); }
        element.dataset.fxLazyReady = '1';
        return url;
      } catch (_) {
        element.dataset.fxLazyError = '1';
        return null;
      } finally { delete element.dataset.fxLazyLoading; }
    }
    function cacheDiscussion() {
      discussionCache.set(cacheKey, {
        at: Date.now(), rows: cloneRows(rows), rootOffset, rootHasMore,
        replyCounts: [...replyCounts.entries()],
        replyPages: [...replyPages.entries()].map(([id,state]) => [id,{...state}]),
        reactions: [...reactions.entries()].map(([id,value]) => [id,value.map(item=>({...item}))])
      });
    }
    async function hydrateProfiles(ids) {
      const unique = [...new Set((ids || []).filter(Boolean))];
      const missing = unique.filter(id => !profileCache.has(id));
      if (missing.length) {
        const {data,error} = await FX.client.from('profiles')
          .select('id,username,display_name,avatar_path')
          .in('id',missing);
        if (error) { console.warn('Frnxup comment profile hydration failed:', error.message); return; }
        (data || []).forEach(profile => profileCache.set(profile.id, profile));
        // A missing profile can mean the member has been removed or is hidden by RLS.
        missing.forEach(id => { if (!profileCache.has(id)) profileCache.set(id, null); });
      }
      let changed = false;
      rows.forEach(row => {
        if (!row.profiles && profileCache.has(row.user_id)) {
          row.profiles = profileCache.get(row.user_id);
          changed = true;
        }
      });
      if (changed && !disposed) { renderList({preserveScroll:true}); cacheDiscussion(); }
    }

    async function fetchRootPage(offset) {
      const {data,error} = await FX.client.from('post_comments')
        .select('id,post_id,context_type,context_id,user_id,parent_id,body,attachments,mentions,status,created_at')
        .eq('context_type',context.type).eq('context_id',context.id).is('parent_id',null)
        .in('status',['published','deleted']).order('created_at',{ascending:false}).order('id',{ascending:false})
        .range(offset,offset + ROOT_PAGE_SIZE - 1);
      if (error) throw error;
      return prepareRows(data).reverse();
    }
    async function fetchReplyCounts(ids) {
      const unique = [...new Set((ids || []).filter(Boolean))];
      if (!unique.length) return;
      const rpc = await FX.client.rpc('frnxup_comment_reply_counts', {
        p_context_type: context.type, p_context_id: context.id, p_parent_ids: unique
      });
      // Do not fall back to an unbounded child-row query. The index-backed RPC
      // is part of the required performance migration; if it is missing, leave
      // replies available through the Reply action and log the migration issue.
      if (rpc.error) { console.warn('Frnxup reply-count RPC is unavailable:', rpc.error.message); return; }
      const data = rpc.data || [];
      unique.forEach(id => replyCounts.set(id,0));
      (data || []).forEach(item => replyCounts.set(item.parent_id,Number(item.reply_count)||0));
      if (!disposed) { renderList({preserveScroll:true}); cacheDiscussion(); }
    }
    async function fetchReactions(ids) {
      if (!FX.user) return;
      const unique = [...new Set((ids || []).filter(Boolean))];
      if (!unique.length) return;
      const {data,error} = await FX.client.rpc('frnxup_comment_reaction_summary',{p_comment_ids:unique});
      if (error) { console.warn('Frnxup reaction-summary RPC is unavailable:',error.message); return; }
      unique.forEach(id => reactions.set(id,[]));
      (data || []).forEach(item => {
        if(!reactions.has(item.comment_id)) reactions.set(item.comment_id,[]);
        reactions.get(item.comment_id).push({reaction:item.reaction,reaction_count:Number(item.reaction_count)||0,user_reaction:!!item.user_reaction});
      });
      if (!disposed) { renderList({preserveScroll:true}); cacheDiscussion(); }
    }
    async function loadInitial() {
      rootLoading = true;
      const cached = discussionCache.get(cacheKey);
      if (cached && Date.now() - cached.at < DISCUSSION_CACHE_TTL) {
        rows = cloneRows(cached.rows); rootOffset = cached.rootOffset; rootHasMore = cached.rootHasMore;
        replyCounts = new Map(cached.replyCounts || []); replyPages = new Map(cached.replyPages || []); reactions = new Map(cached.reactions || []);
        rootLoading = false; renderList({scrollToBottom:config.scrollToLatest !== false});
        hydrateProfiles(rows.map(row=>row.user_id)).catch(()=>{});
        // A valid in-memory first-page cache appears immediately; refresh quietly once it expires.
        return;
      }
      list.setAttribute('aria-busy','true');
      try {
        rows = await fetchRootPage(0);
        rootOffset = rows.length; rootHasMore = rows.length === ROOT_PAGE_SIZE; rootLoading = false;
        renderList({scrollToBottom:config.scrollToLatest !== false}); cacheDiscussion();
        const ids = rows.map(row=>row.id);
        hydrateProfiles(rows.map(row=>row.user_id)).catch(()=>{});
        fetchReplyCounts(ids).catch(()=>{});
        fetchReactions(ids).catch(()=>{});
      } catch (error) {
        rootLoading = false;
        list.innerHTML = `<div class="fx-unified-empty">Comments could not be loaded. <button type="button" data-fx-retry>Try again</button></div>`;
        countNode.textContent = 'Unable to load discussion';
        throw error;
      }
    }
    async function loadEarlierRoots() {
      if (rootLoading || !rootHasMore) return;
      rootLoading = true;
      const previousHeight = list.scrollHeight;
      const previousTop = list.scrollTop;
      renderList();
      try {
        const older = await fetchRootPage(rootOffset);
        rootOffset += older.length; rootHasMore = older.length === ROOT_PAGE_SIZE;
        const known = new Set(rows.map(row=>row.id));
        rows = [...older.filter(row=>!known.has(row.id)), ...rows];
        rootLoading = false; renderList();
        list.scrollTop = previousTop + (list.scrollHeight - previousHeight);
        cacheDiscussion();
        const ids = older.map(row=>row.id); hydrateProfiles(older.map(row=>row.user_id)).catch(()=>{}); fetchReplyCounts(ids).catch(()=>{}); fetchReactions(ids).catch(()=>{});
      } catch (error) { rootLoading=false; renderList(); toast(error.message || 'Earlier comments could not be loaded.'); }
    }
    async function loadReplies(parentId) {
      const state = replyPages.get(parentId) || {offset:0,loaded:0,loading:false,hasMore:true};
      if (state.loading || !state.hasMore) return;
      state.loading = true; replyPages.set(parentId,state); renderList({preserveScroll:true});
      try {
        const {data,error} = await FX.client.from('post_comments')
          .select('id,post_id,context_type,context_id,user_id,parent_id,body,attachments,mentions,status,created_at')
          .eq('context_type',context.type).eq('context_id',context.id).eq('parent_id',parentId)
          .in('status',['published','deleted']).order('created_at',{ascending:false}).order('id',{ascending:false})
          .range(state.offset,state.offset + REPLY_PAGE_SIZE - 1);
        if (error) throw error;
        const incoming = prepareRows(data).reverse();
        const known = new Set(rows.map(row=>row.id));
        const fresh = incoming.filter(row=>!known.has(row.id));
        rows.push(...fresh);
        state.offset += (data || []).length; state.loaded += fresh.length; state.hasMore = (data || []).length === REPLY_PAGE_SIZE; state.loading=false;
        replyPages.set(parentId,state);
        renderList({preserveScroll:true}); cacheDiscussion();
        const ids = fresh.map(row=>row.id); hydrateProfiles(fresh.map(row=>row.user_id)).catch(()=>{}); fetchReplyCounts(ids).catch(()=>{}); fetchReactions(ids).catch(()=>{});
      } catch (error) { state.loading=false; replyPages.set(parentId,state); renderList({preserveScroll:true}); toast(error.message || 'Replies could not be loaded.'); }
    }
    function invalidateCache() { discussionCache.delete(cacheKey); }
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
        const mime=(file.type || mimeFallback[ext] || 'application/octet-stream').split(';')[0].trim().toLowerCase();
        const {error}=await FX.client.storage.from('frnxup-media').upload(path,file,{cacheControl:'3600',upsert:false,contentType:mime});
        if(error) throw error;
        uploaded.push({type:item.type,path,name:file.name,mime:file.type,size:file.size});
      }
      return uploaded;
    }
    function stopVoiceTracks() {
      if (voiceStream) voiceStream.getTracks().forEach(track => track.stop());
      voiceStream = null;
    }
    function resetVoiceUI() {
      if (voiceTimer) clearInterval(voiceTimer);
      voiceTimer = null;
      if (voiceStatus) voiceStatus.hidden = true;
      if (voiceCancel) voiceCancel.hidden = true;
      if (voiceButton) { voiceButton.disabled = !FX.user; voiceButton.textContent = '🎙 Voice note'; }
    }
    function formatDuration(ms) {
      const seconds = Math.max(0, Math.floor(ms / 1000));
      return `${String(Math.floor(seconds / 60)).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}`;
    }
    async function startVoiceRecording() {
      if (!FX.user) return toast('Sign in to record a voice note.');
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        return toast('Voice recording is not supported in this browser. You can attach an audio file instead.');
      }
      try {
        voiceStream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
        if (disposed || !root.isConnected) { stopVoiceTracks(); return; }
        const candidates = ['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg;codecs=opus','audio/ogg'];
        const chosen = candidates.find(type => window.MediaRecorder.isTypeSupported?.(type)) || '';
        voiceRecorder = chosen ? new MediaRecorder(voiceStream,{mimeType:chosen}) : new MediaRecorder(voiceStream);
        voiceChunks = [];
        cancelVoiceOnStop = false;
        const activeRecorder = voiceRecorder;
        activeRecorder.ondataavailable = event => { if (event.data?.size) voiceChunks.push(event.data); };
        activeRecorder.onerror = () => { toast('Voice recording stopped because of a microphone error.'); cancelVoiceOnStop = true; };
        activeRecorder.onstop = () => {
          const rawType = activeRecorder.mimeType || voiceChunks.find(chunk => chunk.type)?.type || chosen || 'audio/webm';
          const mime = rawType.split(';')[0].toLowerCase();
          const blob = new Blob(voiceChunks,{type:mime});
          if (!cancelVoiceOnStop && blob.size) {
            if (blob.size > 25 * 1024 * 1024) toast('Voice notes must be 25 MB or smaller.');
            else {
              const ext = mime === 'audio/mp4' ? 'm4a' : mime === 'audio/ogg' ? 'ogg' : 'webm';
              const file = new File([blob],`frnxup-voice-note-${Date.now()}.${ext}`,{type:mime});
              pending.push({type:'audio',file});
              updatePending();
              toast('Voice note attached.');
            }
          }
          voiceChunks = [];
          stopVoiceTracks();
          voiceRecorder = null;
          resetVoiceUI();
        };
        activeRecorder.start(250);
        voiceStartedAt = Date.now();
        voiceStatus.hidden = false;
        voiceCancel.hidden = false;
        voiceButton.textContent = '■ Stop & attach';
        voiceButton.disabled = false;
        voiceTime.textContent = 'Recording 00:00';
        voiceTimer = setInterval(() => {
          const elapsed = Date.now() - voiceStartedAt;
          voiceTime.textContent = `Recording ${formatDuration(elapsed)}`;
          if (elapsed >= 120000 && voiceRecorder?.state === 'recording') {
            toast('Voice note limit is 2 minutes.');
            voiceRecorder.stop();
          }
        },500);
      } catch (error) {
        stopVoiceTracks();
        voiceRecorder = null;
        resetVoiceUI();
        toast(error.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow microphone access to record a voice note.' : error.message || 'Unable to start voice recording.');
      }
    }
    function stopVoiceRecording(cancel = false) {
      cancelVoiceOnStop = !!cancel;
      if (voiceRecorder && voiceRecorder.state !== 'inactive') {
        if (voiceButton) voiceButton.disabled = true;
        if (voiceTime) voiceTime.textContent = cancel ? 'Cancelling recording…' : 'Preparing voice note…';
        voiceRecorder.stop();
      } else {
        stopVoiceTracks();
        resetVoiceUI();
      }
    }
    async function pickDeviceContact() {
      if (!FX.user) return toast('Sign in to share a contact.');
      const picker = navigator.contacts?.select;
      if (typeof picker !== 'function') {
        contactForm.hidden = false;
        toast('Your browser does not provide the device contact picker. You can add the contact details manually.');
        return;
      }
      try {
        // Calling the Contact Picker from this click opens the browser/OS contact permission and selection sheet.
        const selected = await picker.call(navigator.contacts,['name','tel','email'],{multiple:false});
        if (!selected?.length) return;
        const contact = selected[0] || {};
        const first = value => Array.isArray(value) ? (value.find(Boolean) || '') : (value || '');
        const name = String(first(contact.name) || 'Frnxup contact').trim();
        const phone = String(first(contact.tel)).trim();
        const email = String(first(contact.email)).trim();
        if (!phone && !email) return toast('The selected contact has no phone number or email to share.');
        pending.push({type:'contact',contact:{name,phone,email}});
        updatePending();
        toast('Contact added. It will be shared when you post your comment.');
      } catch (error) {
        if (error.name === 'AbortError') return;
        toast(error.name === 'NotAllowedError' ? 'Contact access was not granted. You can try again or add a contact manually.' : error.message || 'Could not open your device contacts.');
      }
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
        const {data,error}=await FX.client.from('post_comments').insert(payload).select('id,post_id,context_type,context_id,user_id,parent_id,body,attachments,mentions,status,created_at').single();
        if(error) throw error;
        const posted = prepareRows([data])[0];
        posted.profiles = profileCache.get(FX.user.id) || null;
        const targetParent = replyTarget;
        if (targetParent) {
          rows.push(posted);
          replyCounts.set(targetParent,(replyCounts.get(targetParent)||0)+1);
          const parentPage=replyPages.get(targetParent)||{offset:0,loaded:0,loading:false,hasMore:true};
          parentPage.loaded += 1; replyPages.set(targetParent,parentPage);
        } else {
          rows.push(posted); rootOffset += 1;
        }
        input.value='';pending=[];mentions=[];replyTarget=null;replyContext.hidden=true;replyContext.innerHTML='';input.placeholder='Write a comment… use @ to mention someone';updatePending();
        invalidateCache(); renderList({scrollToBottom:true}); cacheDiscussion();
        hydrateProfiles([posted.user_id]).catch(()=>{}); fetchReplyCounts([posted.id]).catch(()=>{}); fetchReactions([posted.id]).catch(()=>{});
      }catch(error){toast(error.message || 'Your comment could not be posted.');}
      finally{send.disabled=false;send.textContent='➤';}
    }
    async function react(id,key) {
      if(!FX.user) return toast('Sign in to react to comments.');
      const current=(reactions.get(id)||[]).find(r=>r.user_reaction);
      if(current?.reaction===key){const {error}=await FX.client.from('comment_reactions').delete().eq('comment_id',id).eq('user_id',FX.user.id);if(error)throw error;}
      else {const {error}=await FX.client.from('comment_reactions').upsert({comment_id:id,user_id:FX.user.id,reaction:key},{onConflict:'comment_id,user_id'});if(error)throw error;}
      invalidateCache(); await fetchReactions([id]); cacheDiscussion();
    }
    async function handleAction(button) {
      const id=button.dataset.fxEdit||button.dataset.fxDelete||button.dataset.fxReply||button.dataset.fxShare||button.dataset.fxReport;
      const row=rows.find(item=>item.id===id); if(!row)return;
      if(button.hasAttribute('data-fx-reply')) return setReply(row);
      if(button.hasAttribute('data-fx-edit')){
        if(!FX.user||row.user_id!==FX.user.id)return toast('You can only edit your own comments.');
        const next=prompt('Edit your comment',row.body||'');if(next===null)return;if(!next.trim() && !(row.attachments||[]).length)return toast('A comment needs text or an attachment.');
        const {error}=await FX.client.from('post_comments').update({body:next.trim()}).eq('id',id).eq('user_id',FX.user.id);if(error)throw error;row.body=next.trim();invalidateCache();renderList({preserveScroll:true});cacheDiscussion();return;
      }
      if(button.hasAttribute('data-fx-delete')){
        if(!FX.user||row.user_id!==FX.user.id)return toast('You can only delete your own comments.');
        if(!confirm('Delete this comment? Replies will remain in the thread.'))return;
        const {error}=await FX.client.from('post_comments').update({body:'This comment was deleted.',status:'deleted'}).eq('id',id).eq('user_id',FX.user.id);if(error)throw error;row.body='This comment was deleted.';row.status='deleted';invalidateCache();renderList({preserveScroll:true});cacheDiscussion();return;
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
      const earlier=event.target.closest('[data-fx-load-earlier]');
      if(earlier){await loadEarlierRoots();return;}
      const replies=event.target.closest('[data-fx-load-replies]');
      if(replies){await loadReplies(replies.dataset.fxLoadReplies);return;}
      const retry=event.target.closest('[data-fx-retry]');
      if(retry){invalidateCache();await loadInitial().catch(error=>toast(error.message));return;}
      const lazyLink=event.target.closest('[data-fx-lazy-link]');
      if(lazyLink){
        const attachmentPath=lazyLink.dataset.fxAttachmentPath || lazyLink.dataset.fxLazyPath;
        if(attachmentPath && (lazyLink.getAttribute('href')==='#' || lazyLink.dataset.fxAttachmentPath)){
          event.preventDefault();
          const popup=window.open('about:blank','_blank');
          if(popup) popup.opener=null;
          try {
            const url=await getCachedMediaUrl(attachmentPath);
            if(url && popup) popup.location.href=url;
            else if(url){lazyLink.href=url;toast('Attachment is ready. Tap it again to open.');}
            else {popup?.close();toast('This attachment could not be opened. Check its storage access.');}
          } catch(error){popup?.close();toast(error.message || 'This attachment could not be opened.');}
          return;
        }
      }
      const pick=event.target.closest('[data-fx-pick]');if(pick){const kind=pick.dataset.fxPick;const inputFile=$(`[data-fx-input="${kind}"]`,root);inputFile?.click();return;}
      const contactBtn=event.target.closest('[data-fx-contact]');if(contactBtn){await pickDeviceContact();return;}
      if(event.target.closest('[data-fx-record-voice]')){if(voiceRecorder?.state==='recording')stopVoiceRecording(false);else await startVoiceRecording();return;}
      if(event.target.closest('[data-fx-cancel-record]')){stopVoiceRecording(true);return;}
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
      const saveContact=event.target.closest('[data-fx-save-contact]');if(saveContact){const comment=rows.find(r=>r.id===saveContact.dataset.fxSaveContact);const item=comment?._attachments?.[Number(saveContact.dataset.fxContactIndex)];if(!item||item.type!=='contact')return;const vcardEscape=value=>String(value||'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');const lines=['BEGIN:VCARD','VERSION:3.0',`FN:${vcardEscape(item.name)}`,item.phone?`TEL:${vcardEscape(item.phone)}`:'',item.email?`EMAIL:${vcardEscape(item.email)}`:'','END:VCARD'].filter(Boolean);const blob=new Blob([lines.join('\r\n')],{type:'text/vcard'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${(item.name||'contact').replace(/[^a-z0-9_-]/gi,'_')}.vcf`;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);return;}
      if(event.target.closest('[data-fx-cancel-reply]')){replyTarget=null;replyContext.hidden=true;replyContext.innerHTML='';input.placeholder='Write a comment… use @ to mention someone';}
    });
    root.querySelectorAll('[data-fx-input]').forEach(fileInput=>fileInput.addEventListener('change',()=>{
      const kind=fileInput.dataset.fxInput;
      for(const file of [...(fileInput.files||[])]){
        try{const inferred=classifyFile(file);if(kind==='gif'&&inferred!=='gif')throw new Error('Choose a GIF file.');if(kind==='image'&&inferred!=='image')throw new Error('Choose an image file.');if(kind==='video'&&inferred!=='video')throw new Error('Choose a video file.');if(kind==='audio'&&inferred!=='audio')throw new Error('Choose an audio file.');if(kind==='document'&&inferred!=='document')throw new Error('Choose a supported document.');const limit=(inferred==='document'||inferred==='audio')?25*1024*1024:100*1024*1024;if(file.size>limit)throw new Error(`${inferred==='document'?'Documents':inferred==='audio'?'Audio files':'Media'} must be ${limit/(1024*1024)} MB or smaller.`);if(pending.length>=10)throw new Error('You can attach up to 10 items to one comment.');pending.push({type:inferred,file});}catch(error){toast(error.message);}
      }
      fileInput.value='';updatePending();
    }));
    if(!FX.user){input.disabled=true;send.disabled=true;root.querySelectorAll('[data-fx-pick],[data-fx-contact],[data-fx-record-voice]').forEach(b=>b.disabled=true);const note=$('[data-fx-comment-note]',root);note.hidden=false;note.innerHTML=`<a href="/Auth/index.html?next=${encodeURIComponent(location.pathname+location.search)}">Sign in</a> to comment, reply or attach media.`;}
    const cached = discussionCache.get(cacheKey);
    if (cached && Date.now() - cached.at < DISCUSSION_CACHE_TTL) {
      rows=cloneRows(cached.rows);rootOffset=cached.rootOffset;rootHasMore=cached.rootHasMore;
      replyCounts=new Map(cached.replyCounts||[]);replyPages=new Map(cached.replyPages||[]);reactions=new Map(cached.reactions||[]);
      rootLoading=false;renderList({scrollToBottom:config.scrollToLatest !== false});
      hydrateProfiles(rows.map(row=>row.user_id)).catch(()=>{});
      // If a cache becomes stale during this visit, refresh it in the background.
      window.setTimeout(()=>{if(!disposed && Date.now()-cached.at>=DISCUSSION_CACHE_TTL){invalidateCache();loadInitial().catch(()=>{});}},DISCUSSION_CACHE_TTL);
    } else {
      loadInitial().catch(error=>{if(!disposed)toast(error.message||'Comments could not be loaded.');});
    }
    return {refresh:async()=>{invalidateCache();rows=[];rootOffset=0;rootHasMore=true;replyCounts.clear();replyPages.clear();reactions.clear();return loadInitial();},dispose(){disposed=true;form.removeEventListener('submit',submit);lazyMediaObserver?.disconnect();if(voiceRecorder?.state==='recording')stopVoiceRecording(true);else stopVoiceTracks();if(voiceTimer)clearInterval(voiceTimer);}};
  }

  function openModal(config = {}) {
    closeModal();
    // Whitelist the only data the comments panel is allowed to receive.
    // Parent-post text/media/author fields are deliberately discarded.
    const discussionConfig = {
      type: config.type,
      contextId: config.contextId || config.id,
      title: config.title,
      scrollToLatest: config.scrollToLatest,
      onCountChange: typeof config.onCountChange === 'function' ? config.onCountChange : null
    };
    const modal=document.createElement('div');modal.className='fx-unified-comments-modal';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.innerHTML=`<button class="fx-unified-comments-backdrop" type="button" data-fx-modal-close aria-label="Close comments"></button><div class="fx-unified-comments-panel"><div class="fx-unified-modal-top"><span></span><button type="button" data-fx-modal-close aria-label="Close comments">×</button></div><div data-fx-modal-content></div></div>`;
    document.body.appendChild(modal);document.body.classList.add('fx-comments-open');activeModal=modal;
    modal.querySelectorAll('[data-fx-modal-close]').forEach(button=>button.addEventListener('click',closeModal));
    mount($('[data-fx-modal-content]',modal),discussionConfig).then(instance=>{if(!modal.isConnected)instance.dispose();else modal._dispose=instance.dispose;}).catch(error=>{const host=$('[data-fx-modal-content]',modal);if(host.isConnected)host.innerHTML=`<div class="fx-unified-empty">${esc(error.message||'Comments could not be loaded.')}</div>`;});
    const closeOnEscape=event=>{if(event.key==='Escape')closeModal();};modal._closeOnEscape=closeOnEscape;document.addEventListener('keydown',closeOnEscape);
    return modal;
  }
  function closeModal(){if(!activeModal)return;document.removeEventListener('keydown',activeModal._closeOnEscape);activeModal._dispose?.();activeModal.remove();activeModal=null;document.body.classList.remove('fx-comments-open');}
  window.FrnxupComments={mount,openModal,closeModal};
})();
