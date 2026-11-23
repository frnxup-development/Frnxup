(() => {
  const $ = FX.qs;
  const view = document.body.dataset.friendsView || 'hub';

  const initials = profile => (profile?.display_name || profile?.username || 'F').trim().slice(0, 2).toUpperCase();
  async function avatar(profile, size = 'lg') {
    const photo = profile?.avatar_path ? await FX.mediaUrl(profile.avatar_path) : '';
    return `<span class="avatar ${size} fx-friend-avatar"><span class="fx-avatar-fallback">${FX.esc(initials(profile))}</span>${photo ? `<img src="${FX.esc(photo)}" alt="${FX.esc(profile?.display_name || profile?.username || 'Member')} profile picture" loading="lazy" decoding="async" onerror="this.remove()">` : ''}</span>`;
  }
  async function personRow(profile, actions = '') {
    const name = profile?.display_name || profile?.username || 'Frnxup member';
    return `<div class="fx-friend-row"><a class="fx-friend-identity" href="/Dashboard/profile.html?id=${encodeURIComponent(profile.id)}">${await avatar(profile)}<span class="fx-friend-copy"><b>${FX.esc(name)}</b><small>@${FX.esc(profile?.username || 'member')}</small></span></a><div class="fx-friend-actions">${actions}</div></div>`;
  }
  function setEmpty(id, message) { const host = $(id); if (host) host.innerHTML = `<div class="empty">${FX.esc(message)}</div>`; }

  async function renderMyFriends() {
    const host = $('#my-friends');
    if (!host) return;
    const { data: friendships, error } = await FX.client.from('friendships').select('user_a,user_b').or(`user_a.eq.${FX.user.id},user_b.eq.${FX.user.id}`);
    if (error) return setEmpty('#my-friends', error.message);
    const ids = (friendships || []).map(row => row.user_a === FX.user.id ? row.user_b : row.user_a);
    if (!ids.length) return setEmpty('#my-friends', 'Your friends will appear here. Find people and send a friend request to get started.');
    const { data: profiles, error: profileError } = await FX.client.from('profiles').select('id,username,display_name,avatar_path').in('id', ids).order('display_name');
    if (profileError) return setEmpty('#my-friends', profileError.message);
    const rows = await Promise.all((profiles || []).map(profile => personRow(profile, `<a class="button subtle" href="/Dashboard/profile.html?id=${encodeURIComponent(profile.id)}">Profile</a><button class="button danger" data-remove-friend="${profile.id}" type="button">Remove</button>`)));
    host.innerHTML = rows.join('') || '<div class="empty">Your friends will appear here.</div>';
  }

  async function renderRequests() {
    const host = $('#friend-requests');
    if (!host) return;
    const { data, error } = await FX.client.from('friend_requests')
      .select('id,sender_id,created_at,profiles!friend_requests_sender_id_fkey(id,username,display_name,avatar_path)')
      .eq('receiver_id', FX.user.id).eq('status', 'pending').order('created_at', { ascending: false });
    if (error) return setEmpty('#friend-requests', error.message);
    const rows = await Promise.all((data || []).map(row => personRow(row.profiles, `<button class="button primary" data-accept="${row.id}" type="button">Accept</button><button class="button subtle" data-decline="${row.id}" type="button">Decline</button>`)));
    host.innerHTML = rows.join('') || '<div class="empty">No new friend requests.</div>';
  }

  async function renderSentRequests() {
    const host = $('#sent-requests');
    if (!host) return;
    const { data, error } = await FX.client.from('friend_requests')
      .select('id,receiver_id,created_at,profiles!friend_requests_receiver_id_fkey(id,username,display_name,avatar_path)')
      .eq('sender_id', FX.user.id).eq('status', 'pending').order('created_at', { ascending: false });
    if (error) return setEmpty('#sent-requests', error.message);
    const rows = await Promise.all((data || []).map(row => personRow(row.profiles, `<span class="fx-pending-label">Pending</span><button class="button subtle" data-cancel="${row.id}" type="button">Cancel</button>`)));
    host.innerHTML = rows.join('') || '<div class="empty">You have no pending sent requests.</div>';
  }

  async function renderBlocked() {
    const host = $('#blocked-members');
    if (!host) return;
    const { data: profiles, error } = await FX.client.rpc('frnxup_blocked_members');
    if (error) return setEmpty('#blocked-members', `${error.message}. Apply Supabase/migrations/20261123_blocked_members_list.sql to enable this list.`);
    if (!profiles?.length) return setEmpty('#blocked-members', 'You have not blocked anyone.');
    const rows = await Promise.all(profiles.map(profile => personRow(profile, `<button class="button primary" data-unblock="${profile.id}" type="button">Unblock</button>`)));
    host.innerHTML = rows.join('') || '<div class="empty">You have not blocked anyone.</div>';
  }

  async function renderSuggestions() {
    const host = $('#people-results');
    if (!host || !FX.client) return;
    const { data, error } = await FX.client.rpc('frnxup_friend_suggestions', { p_limit: 30 });
    if (error) return setEmpty('#people-results', error.message);
    const ids = (data || []).map(profile => profile.id);
    const { data: profiles } = ids.length ? await FX.client.from('profiles').select('id,avatar_path').in('id', ids) : { data: [] };
    const paths = new Map((profiles || []).map(profile => [profile.id, profile.avatar_path]));
    await renderPeople((data || []).map(profile => ({ ...profile, avatar_path: paths.get(profile.id) || '' })));
  }

  async function renderPeople(people) {
    const host = $('#people-results');
    if (!host) return;
    const rows = await Promise.all((people || []).map(async profile => {
      const name = profile.display_name || profile.username || 'Frnxup member';
      const photo = profile.avatar_path ? await FX.mediaUrl(profile.avatar_path) : '';
      const shared = Number(profile.shared_interests || profile.shared_count || 0);
      return `<article class="fx-person-suggestion"><a class="fx-person-suggestion-avatar" href="/Dashboard/profile.html?id=${encodeURIComponent(profile.id)}"><span class="fx-avatar-fallback">${FX.esc(initials(profile))}</span>${photo ? `<img src="${FX.esc(photo)}" alt="${FX.esc(name)} profile picture" loading="lazy" decoding="async" onerror="this.remove()">` : ''}</a><div class="fx-person-suggestion-copy"><b>${FX.esc(name)}</b><small>@${FX.esc(profile.username || 'member')}${shared ? ` · ${shared} shared interests` : ''}</small></div><a class="button subtle" href="/Dashboard/profile.html?id=${encodeURIComponent(profile.id)}">Profile</a><button class="button primary" data-add="${profile.id}" type="button">Add</button></article>`;
    }));
    host.innerHTML = rows.join('') || '<div class="empty">No suggestions yet. Invite people you know to join Frnxup.</div>';
  }

  async function searchPeople(value) {
    const q = String(value || '').trim().replace(/[(),]/g, ' ');
    if (!q) return;
    $('#people-search').value = q;
    const { data, error } = await FX.client.from('profiles').select('id,username,display_name,avatar_path')
      .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`).neq('id', FX.user.id).limit(30);
    if (error) return setEmpty('#people-results', error.message);
    await renderPeople(data || []);
  }

  async function loadCurrentView() {
    if (view === 'my') return renderMyFriends();
    if (view === 'requests') return renderRequests();
    if (view === 'sent') return renderSentRequests();
    if (view === 'blocked') return renderBlocked();
    if (view === 'suggestions') return renderSuggestions();
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

  document.addEventListener('DOMContentLoaded', async () => {
    await FX.loadUser();
    if (!FX.user) {
      FX.toast('Sign in to use Friends.');
      const next = encodeURIComponent(location.pathname + location.search);
      const main = document.querySelector('main');
      if (main) main.insertAdjacentHTML('afterbegin', `<div class="auth-state-notice">Sign in to manage your connections. <a href="/Auth/index.html?next=${next}">Sign in</a></div>`);
      return;
    }
    if (view === 'suggestions') {
      const initialQuery = new URLSearchParams(location.search).get('q');
      if (initialQuery) { $('#people-search').value = initialQuery; await searchPeople(initialQuery); }
      else await renderSuggestions();
      $('#search-people')?.addEventListener('click', () => searchPeople($('#people-search').value));
      $('#people-search')?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); searchPeople($('#people-search').value); } });
    } else {
      await loadCurrentView();
    }

    document.body.addEventListener('click', async event => {
      const button = event.target.closest('button');
      if (!button) return;
      try {
        if (button.dataset.add) await addFriend(button.dataset.add, button);
        if (button.dataset.removeFriend) {
          if (!confirm('Remove this friend?')) return;
          const pair = [FX.user.id, button.dataset.removeFriend].sort();
          const { error } = await FX.client.from('friendships').delete().eq('user_a', pair[0]).eq('user_b', pair[1]);
          if (error) throw error;
          FX.toast('Friend removed.'); await renderMyFriends();
        }
        if (button.dataset.accept || button.dataset.decline) {
          const requestId = button.dataset.accept || button.dataset.decline;
          const accepted = !!button.dataset.accept;
          const { error } = await FX.client.rpc('respond_friend_request', { p_request_id: requestId, p_accept: accepted });
          if (error) throw error;
          FX.toast(accepted ? 'Friend request accepted.' : 'Request declined.');
          await renderRequests();
        }
        if (button.dataset.cancel) {
          const { error } = await FX.client.from('friend_requests').delete().eq('id', button.dataset.cancel).eq('sender_id', FX.user.id);
          if (error) throw error;
          FX.toast('Friend request cancelled.'); await renderSentRequests();
        }
        if (button.dataset.unblock) {
          const { error } = await FX.client.from('user_blocks').delete().eq('blocker_id', FX.user.id).eq('blocked_id', button.dataset.unblock);
          if (error) throw error;
          FX.toast('Member unblocked.'); await renderBlocked();
        }
      } catch (error) { FX.toast(error.message || 'That action could not be completed.'); }
    });
  });
})();
