(() => {
  const $ = FX.qs;
  const cid = new URLSearchParams(location.search).get('id');
  let selectedFriends = [];
  let selectedNames = new Map();
  let chatKind = 'dm';
  let replyTo = null;
  let realtimeChannel = null;

  const avatar = (name, url, extra = '') => url
    ? `<div class="avatar ${extra}"><img src="${FX.esc(url)}" alt=""></div>`
    : `<div class="avatar ${extra}">${FX.esc((name || 'F').trim().slice(0, 2).toUpperCase())}</div>`;

  async function friendIds() {
    const { data, error } = await FX.client.from('friendships')
      .select('user_a,user_b')
      .or(`user_a.eq.${FX.user.id},user_b.eq.${FX.user.id}`);
    if (error) throw error;
    return (data || []).map(row => row.user_a === FX.user.id ? row.user_b : row.user_a);
  }

  function renderSelected() {
    const host = $('#selected-friends');
    if (!host) return;
    host.innerHTML = selectedFriends.map(id => `<span class="selected-friend">${FX.esc(selectedNames.get(id) || 'Friend')}<button type="button" data-unselect-person="${id}" aria-label="Remove ${FX.esc(selectedNames.get(id) || 'friend')}">×</button></span>`).join('');
    if (!selectedFriends.length) host.innerHTML = `<small class="muted">${chatKind === 'dm' ? 'Select one friend to start a private conversation.' : 'Select friends to add to your private group.'}</small>`;
  }

  function renderFriendRows(rows) {
    const host = $('#chat-friend-results');
    host.innerHTML = rows.map(person => {
      const name = person.display_name || person.username || 'Frnxup member';
      const picked = selectedFriends.includes(person.id);
      return `<button type="button" class="chat-friend-row ${picked ? 'picked' : ''}" data-person="${person.id}">
        ${avatar(name, person.avatar_url, 'sm')}
        <span class="grow"><b>${FX.esc(name)}</b><small>@${FX.esc(person.username || 'member')}</small></span>
        <span class="friend-select-mark">${picked ? '✓' : '+'}</span>
      </button>`;
    }).join('') || '<div class="empty">No matching friends found.</div>';
  }

  async function searchFriends() {
    const host = $('#chat-friend-results');
    const q = $('#chat-friend-search').value.trim().replace(/[(),]/g, ' ');
    host.innerHTML = '<div class="empty">Searching your friends…</div>';
    try {
      const ids = await friendIds();
      if (!ids.length) {
        host.innerHTML = '<div class="empty">Add friends before starting a one-to-one or group conversation.</div>';
        return;
      }
      let query = FX.client.from('profiles').select('id,username,display_name,avatar_path').in('id', ids).order('display_name').limit(50);
      if (q) query = query.or(`username.ilike.%${q}%,display_name.ilike.%${q}%`);
      const { data, error } = await query;
      if (error) throw error;
      const rows = await Promise.all((data || []).map(async person => ({
        ...person,
        avatar_url: person.avatar_path ? await FX.mediaUrl(person.avatar_path) : ''
      })));
      rows.forEach(person => selectedNames.set(person.id, person.display_name || person.username));
      renderSelected();
      renderFriendRows(rows);
    } catch (error) {
      host.innerHTML = `<div class="empty">${FX.esc(error.message)}</div>`;
    }
  }

  function setChatKind(kind) {
    chatKind = kind;
    selectedFriends = [];
    selectedNames.clear();
    FX.qsa('[data-chat-kind]').forEach(button => button.classList.toggle('active', button.dataset.chatKind === kind));
    $('#group-name-wrap').hidden = kind !== 'group';
    $('#start-dm').hidden = kind !== 'dm';
    $('#start-group').hidden = kind !== 'group';
    $('#group-name').value = '';
    renderSelected();
    searchFriends();
  }

  async function createChat(kind) {
    if (kind === 'dm' && selectedFriends.length !== 1) {
      FX.toast('Choose exactly one friend for a private conversation.');
      return;
    }
    if (kind === 'group' && selectedFriends.length < 1) {
      FX.toast('Choose at least one friend for the group.');
      return;
    }
    const title = kind === 'group' ? $('#group-name').value.trim() : null;
    if (kind === 'group' && !title) {
      FX.toast('Give your group a name.');
      $('#group-name').focus();
      return;
    }
    try {
      const { data, error } = await FX.client.rpc('create_conversation', {
        p_kind: kind,
        p_title: title,
        p_member_ids: selectedFriends
      });
      if (error) throw error;
      location.href = `chat.html?id=${encodeURIComponent(data)}`;
    } catch (error) {
      FX.toast(error.message);
    }
  }

  async function loadSuggestions() {
    const { data, error } = await FX.client.rpc('frnxup_friend_suggestions', { p_limit: 8 });
    if (error || !data?.length) return '';
    const ids = data.map(person => person.id);
    const { data: profiles } = await FX.client.from('profiles').select('id,avatar_path').in('id', ids);
    const paths = new Map((profiles || []).map(profile => [profile.id, profile.avatar_path]));
    const rows = await Promise.all(data.map(async person => ({
      ...person,
      avatar_url: paths.get(person.id) ? await FX.mediaUrl(paths.get(person.id)) : ''
    })));
    return `<section class="people-suggestions">
      <div class="suggestions-heading"><h2>People you may know <span aria-label="Suggestions based on your network">i</span></h2><div class="suggestion-heading-actions"><a href="/Friends/suggestions.html" aria-label="See all suggestions">See all</a><button type="button" data-suggestion-scroll="prev" aria-label="Scroll suggestions left">‹</button><button type="button" data-suggestion-scroll="next" aria-label="Scroll suggestions right">›</button></div></div>
      <div class="suggestion-track-wrap"><div class="suggestion-track">${rows.map(person => {
        const name = person.display_name || person.username || 'Frnxup member';
        const count = Number(person.mutual_count || person.mutual_friends || 0);
        return `<article class="suggestion-card" data-suggestion="${person.id}">
          <button class="suggestion-dismiss" data-dismiss-suggestion="${person.id}" type="button" aria-label="Hide suggestion">×</button>
          <a class="avatar suggestion-avatar" href="/Dashboard/profile.html?id=${encodeURIComponent(person.id)}" aria-label="View ${FX.esc(name)} profile"><span class="suggestion-avatar-fallback">${FX.esc(name.trim().slice(0, 2).toUpperCase())}</span>${person.avatar_url ? `<img src="${FX.esc(person.avatar_url)}" alt="${FX.esc(name)} profile picture" loading="lazy" decoding="async" onerror="this.remove()">` : ''}</a>
          <b class="suggestion-name">${FX.esc(name)}</b>
          <small class="suggestion-mutual">${count} mutual friend${count === 1 ? '' : 's'}</small>
          <button class="suggestion-add" data-add-person="${person.id}" type="button">＋ Add Friend</button>
        </article>`;
      }).join('')}</div></div>
    </section>`;
  }

  async function loadConversations() {
    const host = $('#conversation-list');
    const { data, error } = await FX.client.from('conversation_members')
      .select('conversation_id,joined_at,conversations(id,kind,title,last_message_at,conversation_members(user_id,profiles(username,display_name,avatar_path)))')
      .eq('user_id', FX.user.id);
    if (error) {
      host.innerHTML = `<div class="empty">${FX.esc(error.message)}</div>`;
      return;
    }
    const byId = new Map();
    (data || []).forEach(row => { if (row.conversations) byId.set(row.conversations.id, row.conversations); });
    const rows = [...byId.values()].filter(row => row.kind !== 'group' || FX.settings.groups_enabled !== false).sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));
    const ids = rows.map(row => row.id);
    let latest = new Map();
    if (ids.length) {
      const { data: messages } = await FX.client.from('messages')
        .select('id,conversation_id,body,media_type,sender_id,created_at,deleted_at')
        .in('conversation_id', ids)
        .order('created_at', { ascending: false })
        .limit(Math.max(200, ids.length * 5));
      (messages || []).forEach(message => { if (!latest.has(message.conversation_id)) latest.set(message.conversation_id, message); });
    }
    const suggestionMarkup = await loadSuggestions();
    const rendered = await Promise.all(rows.map(async conversation => {
      const peers = (conversation.conversation_members || []).filter(member => member.user_id !== FX.user.id);
      const name = conversation.title || peers.map(member => member.profiles?.display_name || member.profiles?.username).join(', ') || 'Private conversation';
      const first = peers[0]?.profiles;
      const avatarUrl = conversation.kind === 'dm' && first?.avatar_path ? await FX.mediaUrl(first.avatar_path) : '';
      const message = latest.get(conversation.id);
      const preview = message ? (message.deleted_at ? 'Message deleted' : message.body || (message.media_type ? 'Shared a file' : 'New message')) : 'Start a conversation';
      const stamp = message?.created_at || conversation.last_message_at;
      const groupCount = (conversation.conversation_members || []).length;
      return `<a class="message-row" data-conversation-row href="chat.html?id=${encodeURIComponent(conversation.id)}">
        ${avatar(conversation.kind === 'group' ? 'G' : name, avatarUrl, 'message-avatar')}
        <span class="message-row-copy"><b>${FX.esc(name)}</b><small>${conversation.kind === 'group' ? `Group chat · ${groupCount} members` : 'One-to-one message'}</small><span>${FX.esc(preview)}</span></span>
        <time>${FX.esc(FX.relative(stamp))}</time>
      </a>`;
    }));
    if (rendered.length) {
      host.innerHTML = rendered.slice(0, 2).join('') + suggestionMarkup + rendered.slice(2).join('');
    } else {
      host.innerHTML = (suggestionMarkup || '') + '<div class="messages-empty">No conversations yet. Start a private message with one friend or create a group chat.</div>';
    }
    if (!suggestionMarkup && !rendered.length) host.innerHTML = '<div class="messages-empty">No conversations or friend suggestions yet.</div>';
  }

  async function addFriend(id, button) {
    button.disabled = true;
    try {
      const { error } = await FX.client.from('friend_requests').insert({ sender_id: FX.user.id, receiver_id: id });
      if (error) throw error;
      button.textContent = 'Request sent';
      button.classList.add('sent');
      FX.toast('Friend request sent.');
    } catch (error) {
      button.disabled = false;
      FX.toast(error.message);
    }
  }

  async function loadChat() {
    const { data: conversation, error } = await FX.client.from('conversations')
      .select('id,kind,title,created_by,conversation_members(user_id,role,profiles(username,display_name,avatar_path))')
      .eq('id', cid).single();
    if (error) {
      FX.toast(error.message);
      return;
    }
    if (conversation.kind === 'group' && FX.settings.groups_enabled === false) {
      $('#chat-messages').innerHTML = '<div class="empty">Group chats are temporarily disabled by Frnxup administrators.</div>';
      $('#message-input').disabled = true;
      $('#send-message').disabled = true;
      $('#group-tools').hidden = true;
      return;
    }
    const members = conversation.conversation_members || [];
    const peers = members.filter(member => member.user_id !== FX.user.id);
    const names = peers.map(member => member.profiles?.display_name || member.profiles?.username).filter(Boolean);
    $('#chat-title').textContent = conversation.title || names.join(', ') || 'Private chat';
    $('#chat-subtitle').textContent = conversation.kind === 'group' ? `Group conversation · ${members.length} members` : 'One-to-one conversation';
    const myMembership = members.find(member => member.user_id === FX.user.id);
    const manager = myMembership?.role === 'admin' || conversation.created_by === FX.user.id;
    if (conversation.kind === 'group') {
      $('#group-tools').hidden = false;
      $('#group-add-member').hidden = !manager;
      $('#group-members').innerHTML = members.map(member => `<span class="tag">${FX.esc(member.profiles?.display_name || member.profiles?.username || 'Member')}${manager && member.user_id !== conversation.created_by ? ` <button data-group-remove="${member.user_id}" aria-label="Remove member">×</button>` : ''}</span>`).join('');
    } else {
      $('#group-tools').hidden = true;
    }
    await loadMessages();
    if (!realtimeChannel) {
      realtimeChannel = FX.client.channel(`frnxup-chat-${cid}`).on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${cid}`
      }, () => loadMessages()).subscribe();
    }
  }

  async function loadMessages() {
    const host = $('#chat-messages');
    const { data, error } = await FX.client.from('messages')
      .select('id,body,media_path,media_type,created_at,sender_id,reply_to,edited_at,deleted_at,profiles!messages_sender_id_fkey(username,display_name),message_receipts(user_id,read_at)')
      .eq('conversation_id', cid).order('created_at', { ascending: true }).limit(500);
    if (error) {
      host.innerHTML = `<div class="empty">${FX.esc(error.message)}</div>`;
      return;
    }
    const urls = await Promise.all((data || []).map(message => FX.mediaUrl(message.media_path)));
    const messageMap = new Map((data || []).map(message => [message.id, message]));
    host.innerHTML = (data || []).map((message, index) => {
      const own = message.sender_id === FX.user.id;
      const text = message.deleted_at ? 'This message was deleted' : message.body;
      const seen = (message.message_receipts || []).filter(receipt => receipt.read_at).length;
      const reply = message.reply_to ? messageMap.get(message.reply_to) : null;
      const author = message.profiles?.display_name || message.profiles?.username || 'Member';
      return `<article class="message-bubble ${own ? 'mine' : ''}" style="align-self:${own ? 'flex-end' : 'flex-start'}">
        <b class="message-author">${FX.esc(own ? 'You' : author)}</b>
        ${reply ? `<small class="message-reply-preview">↳ ${FX.esc(reply.body || 'Attachment')}</small>` : ''}
        ${text ? `<div class="message-body">${FX.esc(text)}</div>` : ''}
        ${urls[index] ? (message.media_type === 'video' ? `<video src="${urls[index]}" controls playsinline></video>` : message.media_type === 'audio' ? `<audio src="${urls[index]}" controls></audio>` : `<img src="${urls[index]}" alt="Message attachment">`) : ''}
        <small class="message-time">${FX.esc(FX.relative(message.created_at))} ${message.edited_at ? '· edited' : ''} ${own && seen ? `· Seen by ${seen}` : ''}</small>
        ${!message.deleted_at ? `<div class="msg-tools"><button data-reply="${message.id}" data-name="${FX.esc(author)}">Reply</button>${own ? `<button data-edit="${message.id}">Edit</button><button data-delete="${message.id}">Delete</button>` : ''}</div>` : ''}
      </article>`;
    }).join('') || '<div class="empty">Start the conversation.</div>';
    host.scrollTop = host.scrollHeight;
    const unread = (data || []).filter(message => message.sender_id !== FX.user.id && !(message.message_receipts || []).some(receipt => receipt.user_id === FX.user.id && receipt.read_at));
    if (unread.length) {
      await FX.client.from('message_receipts').upsert(unread.map(message => ({ message_id: message.id, user_id: FX.user.id, read_at: new Date().toISOString() })), { onConflict: 'message_id,user_id' });
    }
  }

  async function sendMessage(overrideFile = null) {
    const body = $('#message-input').value.trim();
    const file = overrideFile || $('#message-file').files[0];
    if (!body && !file) return;
    try {
      let path = null;
      let type = null;
      if (file) {
        path = await FX.upload(file, 'messages');
        type = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'image';
      }
      const { error } = await FX.client.from('messages').insert({
        conversation_id: cid, sender_id: FX.user.id, body, media_path: path, media_type: type, reply_to: replyTo
      });
      if (error) throw error;
      $('#message-input').value = '';
      $('#message-file').value = '';
      document.querySelector('.fx-upload-preview[data-for="message-file"]')?.replaceChildren();
      $('#reply-context').textContent = '';
      replyTo = null;
      loadMessages();
    } catch (error) {
      FX.toast(error.message);
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    await FX.loadUser();
    if (!FX.user) {
      const next = encodeURIComponent(location.pathname + location.search);
      const notice = `<div class="empty"><a href="/Auth/index.html?next=${next}">Sign in</a> to view conversations and send messages.</div>`;
      if ($('#conversation-list')) $('#conversation-list').innerHTML = notice;
      else if ($('#chat-messages')) $('#chat-messages').innerHTML = notice;
      return;
    }
    if (FX.settings.messaging_enabled === false) {
      FX.toast('Messaging is temporarily disabled by administrators.');
      return;
    }

    if ($('#conversation-list')) {
      await loadConversations();
      $('#new-chat').addEventListener('click', () => {
        $('#chat-modal').classList.add('open');
        setChatKind('dm');
        $('#chat-friend-search').focus();
      });
      $('#close-chat-modal').addEventListener('click', () => $('#chat-modal').classList.remove('open'));
      $('#chat-modal').addEventListener('click', event => { if (event.target.id === 'chat-modal') $('#chat-modal').classList.remove('open'); });
      FX.qsa('[data-chat-kind]').forEach(button => { if(button.dataset.chatKind==='group' && FX.settings.groups_enabled===false){button.disabled=true;button.title='Group chats are temporarily disabled by administrators.';} button.addEventListener('click', () => {if(!button.disabled)setChatKind(button.dataset.chatKind);}); });
      $('#chat-friend-search').addEventListener('input', searchFriends);
      $('#chat-friend-results').addEventListener('click', event => {
        const button = event.target.closest('[data-person]');
        if (!button) return;
        const id = button.dataset.person;
        const name = button.querySelector('.grow b')?.textContent || 'Friend';
        if (selectedFriends.includes(id)) selectedFriends = selectedFriends.filter(value => value !== id);
        else if (chatKind === 'dm') selectedFriends = [id];
        else if (selectedFriends.length < 49) selectedFriends.push(id);
        selectedNames.set(id, name);
        renderSelected();
        $('#chat-friend-results').querySelectorAll('[data-person]').forEach(row => {
          const selected = selectedFriends.includes(row.dataset.person);
          row.classList.toggle('picked', selected);
          row.querySelector('.friend-select-mark').textContent = selected ? '✓' : '+';
        });
      });
      $('#selected-friends').addEventListener('click', event => {
        const button = event.target.closest('[data-unselect-person]');
        if (!button) return;
        selectedFriends = selectedFriends.filter(id => id !== button.dataset.unselectPerson);
        renderSelected();
        $('#chat-friend-results').querySelectorAll('[data-person]').forEach(row => {
          const selected = selectedFriends.includes(row.dataset.person);
          row.classList.toggle('picked', selected);
          row.querySelector('.friend-select-mark').textContent = selected ? '✓' : '+';
        });
      });
      $('#start-dm').addEventListener('click', () => createChat('dm'));
      $('#start-group').addEventListener('click', () => createChat('group'));
      $('#toggle-chat-search').addEventListener('click', () => {
        const wrap = $('#chat-search-wrap');
        wrap.hidden = !wrap.hidden;
        if (!wrap.hidden) $('#chat-search').focus();
        else $('#chat-search').value = '';
        document.querySelectorAll('[data-conversation-row]').forEach(row => row.hidden = false);
      });
      $('#chat-search').addEventListener('input', event => {
        const q = event.target.value.toLowerCase();
        document.querySelectorAll('[data-conversation-row]').forEach(row => row.hidden = !row.textContent.toLowerCase().includes(q));
      });
      $('#conversation-list').addEventListener('click', async event => {
        const add = event.target.closest('[data-add-person]');
        if (add) {
          event.preventDefault();
          await addFriend(add.dataset.addPerson, add);
          return;
        }
        const dismiss = event.target.closest('[data-dismiss-suggestion]');
        if (dismiss) {
          const card = dismiss.closest('.suggestion-card');
          card?.remove();
          return;
        }
        const scrollButton = event.target.closest('[data-suggestion-scroll]');
        if (scrollButton) {
          const track = $('#conversation-list .suggestion-track');
          if (track) track.scrollBy({ left: (scrollButton.dataset.suggestionScroll === 'prev' ? -1 : 1) * Math.max(250, track.clientWidth * 0.78), behavior: 'smooth' });
        }
      });
      return;
    }

    if ($('#chat-messages')) {
      if (!cid) return FX.toast('Conversation not specified.');
      await loadChat();
      $('#send-message').addEventListener('click', () => sendMessage());
      $('#group-add-member')?.addEventListener('click', async () => {
        const username = prompt('Enter the exact username of your Frnxup friend to add');
        if (!username) return;
        try {
          const { data: profile, error: profileError } = await FX.client.from('profiles').select('id').ilike('username', username.replace(/^@/, '')).maybeSingle();
          if (profileError || !profile) throw new Error('Friend not found or profile is not visible.');
          const { error } = await FX.client.rpc('manage_group_member', { p_conversation_id: cid, p_user_id: profile.id, p_action: 'add' });
          if (error) throw error;
          FX.toast('Friend added to the group.');
          loadChat();
        } catch (error) { FX.toast(error.message); }
      });
      $('#group-members')?.addEventListener('click', async event => {
        const button = event.target.closest('[data-group-remove]');
        if (!button || !confirm('Remove this member from the group?')) return;
        const { error } = await FX.client.rpc('manage_group_member', { p_conversation_id: cid, p_user_id: button.dataset.groupRemove, p_action: 'remove' });
        if (error) FX.toast(error.message);
        else { FX.toast('Group member removed.'); loadChat(); }
      });
      $('#chat-messages').addEventListener('click', async event => {
        const button = event.target.closest('button');
        if (!button) return;
        try {
          if (button.dataset.reply) {
            replyTo = button.dataset.reply;
            $('#reply-context').textContent = `Replying to ${button.dataset.name || 'member'} · tap to cancel`;
            $('#reply-context').onclick = () => { replyTo = null; $('#reply-context').textContent = ''; };
            $('#message-input').focus();
          }
          if (button.dataset.edit) {
            const next = prompt('Edit your message');
            if (next === null || !next.trim()) return;
            const { error } = await FX.client.from('messages').update({ body: next.trim(), edited_at: new Date().toISOString() }).eq('id', button.dataset.edit).eq('sender_id', FX.user.id);
            if (error) throw error;
            loadMessages();
          }
          if (button.dataset.delete) {
            if (!confirm('Delete this message?')) return;
            const { error } = await FX.client.from('messages').update({ body: 'Message deleted', deleted_at: new Date().toISOString() }).eq('id', button.dataset.delete).eq('sender_id', FX.user.id);
            if (error) throw error;
            loadMessages();
          }
        } catch (error) { FX.toast(error.message); }
      });
      let recorder = null;
      let voiceChunks = [];
      $('#record-voice')?.addEventListener('click', async () => {
        try {
          if (recorder?.state === 'recording') {
            recorder.stop();
            $('#record-voice').textContent = '🎙 Voice';
            return;
          }
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          recorder = new MediaRecorder(stream);
          voiceChunks = [];
          recorder.ondataavailable = event => { if (event.data.size) voiceChunks.push(event.data); };
          recorder.onstop = () => {
            const blob = new Blob(voiceChunks, { type: recorder.mimeType || 'audio/webm' });
            const file = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type });
            stream.getTracks().forEach(track => track.stop());
            sendMessage(file);
          };
          recorder.start();
          $('#record-voice').textContent = '■ Stop recording';
        } catch (_) { FX.toast('Microphone permission is unavailable on this device or browser.'); }
      });
      $('#message-input').addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); }
      });
    }
  });
})();
