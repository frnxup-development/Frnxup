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
  function setEmpty(id, message) { const host = $(id); if (host) FXStates.empty(host, { title: 'Nothing to show yet', message }); }
  function setError(id, error, retry) { const host = $(id); if (host) FXStates.fail(host, error, { retry }); }

  async function renderMyFriends() {
    const host = $('#my-friends');
    if (!host) return;
    if (host.dataset.fxHasContent !== 'true') FXStates.loading(host, { title: 'Loading your friends', message: 'Checking your Frnxup connections.' });
    const { data: friendships, error } = await FX.client.from('friendships').select('user_a,user_b').or(`user_a.eq.${FX.user.id},user_b.eq.${FX.user.id}`);
    if (error) return setError('#my-friends', error, renderMyFriends);
    const ids = (friendships || []).map(row => row.user_a === FX.user.id ? row.user_b : row.user_a);
    if (!ids.length) return setEmpty('#my-friends', 'Your friends will appear here. Find people and send a friend request to get started.');
    const { data: profiles, error: profileError } = await FX.client.from('profiles').select('id,username,display_name,avatar_path').in('id', ids).order('display_name');
    if (profileError) return setError('#my-friends', profileError, renderMyFriends);
    const rows = await Promise.all((profiles || []).map(profile => personRow(profile, `<a class="button subtle" href="/Dashboard/profile.html?id=${encodeURIComponent(profile.id)}">Profile</a><button class="button danger" data-remove-friend="${profile.id}" type="button">Remove</button>`)));
    host.innerHTML = rows.join('') || '<div class="empty">Your friends will appear here.</div>'; FXStates.loaded(host);
  }

  async function renderRequests() {
    const host = $('#friend-requests');
    if (!host) return;
    if (host.dataset.fxHasContent !== 'true') FXStates.loading(host, { title: 'Loading friend requests', message: 'Checking requests sent to you.' });
    const { data, error } = await FX.client.from('friend_requests')
      .select('id,sender_id,created_at,profiles!friend_requests_sender_id_fkey(id,username,display_name,avatar_path)')
      .eq('receiver_id', FX.user.id).eq('status', 'pending').order('created_at', { ascending: false });
    if (error) return setError('#friend-requests', error, renderRequests);
    const rows = await Promise.all((data || []).map(row => personRow(row.profiles, `<button class="button primary" data-accept="${row.id}" type="button">Accept</button><button class="button subtle" data-decline="${row.id}" type="button">Decline</button>`)));
    host.innerHTML = rows.join('') || '<div class="empty">No new friend requests.</div>'; FXStates.loaded(host);
  }

  async function renderSentRequests() {
    const host = $('#sent-requests');
    if (!host) return;
    if (host.dataset.fxHasContent !== 'true') FXStates.loading(host, { title: 'Loading sent requests', message: 'Checking requests you have sent.' });
    const { data, error } = await FX.client.from('friend_requests')
      .select('id,receiver_id,created_at,profiles!friend_requests_receiver_id_fkey(id,username,display_name,avatar_path)')
      .eq('sender_id', FX.user.id).eq('status', 'pending').order('created_at', { ascending: false });
    if (error) return setError('#sent-requests', error, renderSentRequests);
    const rows = await Promise.all((data || []).map(row => personRow(row.profiles, `<span class="fx-pending-label">Pending</span><button class="button subtle" data-cancel="${row.id}" type="button">Cancel</button>`)));
    host.innerHTML = rows.join('') || '<div class="empty">You have no pending sent requests.</div>'; FXStates.loaded(host);
  }

  async function renderBlocked() {
    const host = $('#blocked-members');
    if (!host) return;
    if (host.dataset.fxHasContent !== 'true') FXStates.loading(host, { title: 'Loading blocked members', message: 'Checking your blocked member list.' });
    const { data: profiles, error } = await FX.client.rpc('frnxup_blocked_members');
    if (error) return setError('#blocked-members', error, renderBlocked);
    if (!profiles?.length) return setEmpty('#blocked-members', 'You have not blocked anyone.');
    const rows = await Promise.all(profiles.map(profile => personRow(profile, `<button class="button primary" data-unblock="${profile.id}" type="button">Unblock</button>`)));
    host.innerHTML = rows.join(''); FXStates.loaded(host);
  }

  async function renderSuggestions() {
    const host = $('#people-results');
    if (!host || !FX.client) return;
    if (host.dataset.fxHasContent !== 'true') FXStates.loading(host, { title: 'Finding people', message: 'Loading member suggestions.' });
    const { data, error } = await FX.client.rpc('frnxup_friend_suggestions', { p_limit: 30 });
    if (error) return setError('#people-results', error, renderSuggestions);
    const ids = (data || []).map(profile => profile.id);
    const { data: profiles, error: profileError } = ids.length ? await FX.client.from('profiles').select('id,avatar_path').in('id', ids) : { data: [], error: null };
    if (profileError) return setError('#people-results', profileError, renderSuggestions);
    const paths = new Map((profiles || []).map(profile => [profile.id, profile.avatar_path]));
    await renderPeople((data || []).map(profile => ({ ...profile, avatar_path: paths.get(profile.id) || '' })));
  }

  async function renderPeople(people) {
    const host = $('#people-results');
    if (!host) return;
    const count = $('#people-count');
    if (count) count.textContent = people?.length ? `${people.length} ${people.length === 1 ? 'person' : 'people'}` : '';
    const rows = await Promise.all((people || []).map(async profile => {
      const name = profile.display_name || profile.username || 'Frnxup member';
      let photo = '';
      try { photo = profile.avatar_path ? await FX.mediaUrl(profile.avatar_path) : ''; } catch (_) { photo = ''; }
      const mutual = Number(profile.mutual_friends || 0);
      const shared = Number(profile.shared_interests || profile.shared_count || 0);
      const detail = [mutual ? `${mutual} mutual ${mutual === 1 ? 'friend' : 'friends'}` : '', shared ? `${shared} shared ${shared === 1 ? 'interest' : 'interests'}` : ''].filter(Boolean).join(' · ');
      const profileUrl = `/Dashboard/profile.html?id=${encodeURIComponent(profile.id)}`;
      return `<article class="fx-person-suggestion">
        <a class="fx-person-suggestion-avatar" href="${profileUrl}" aria-label="View ${FX.esc(name)}’s profile">
          <span class="fx-avatar-fallback">${FX.esc(initials(profile))}</span>
          ${photo ? `<img src="${FX.esc(photo)}" alt="${FX.esc(name)} profile picture" loading="lazy" decoding="async" onerror="this.remove()">` : ''}
        </a>
        <div class="fx-person-suggestion-copy"><b>${FX.esc(name)}</b><small>@${FX.esc(profile.username || 'member')}</small></div>
        <span class="fx-person-suggestion-detail">${detail ? FX.esc(detail) : 'Frnxup member'}</span>
        <div class="fx-person-suggestion-actions">
          <a class="button subtle" href="${profileUrl}">Profile</a>
          <button class="button primary" data-add="${FX.esc(profile.id)}" type="button">Add friend</button>
        </div>
      </article>`;
    }));
    host.innerHTML = rows.join('') || '<div class="empty">No people to show right now. Try another search or check back later.</div>';
    FXStates.loaded(host);
  }

  function setPeopleHeading(title, note) {
    const heading = $('#people-section-title');
    const description = $('#people-section-note');
    if (heading) heading.textContent = title;
    if (description) description.textContent = note;
  }

  async function searchPeople(value) {
    const q = String(value || '').trim().replace(/[(),]/g, ' ');
    const input = $('#people-search');
    if (input) input.value = q;
    if (!q) {
      setPeopleHeading('People you may know', 'Discover active Frnxup members and send a friend request.');
      return renderSuggestions();
    }
    setPeopleHeading('Search results', `Members matching “${q}”.`);
    const host = $('#people-results');
    if (host) FXStates.loading(host, { title: 'Searching Frnxup members', message: `Looking for “${q}”.` });
    const { data, error } = await FX.client.from('profiles').select('id,username,display_name,avatar_path')
      .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`).neq('id', FX.user.id).limit(30);
    if (error) return setError('#people-results', error, () => searchPeople(value));
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
    try { await FX.loadUser(); } catch (error) { const host=$('#my-friends')||$('#friend-requests')||$('#people-results')||document.querySelector('main'); if(host)FXStates.fail(host,error,{retry:()=>location.reload(),title:'Friends could not be initialized'}); return; }
    if (!FX.client) { const host=$('#my-friends')||$('#friend-requests')||$('#people-results')||document.querySelector('main'); if(host)FXStates.render(host,'configuration'); return; }
    if (!FX.user) {
      const next = encodeURIComponent(location.pathname + location.search);
      const host = $('#my-friends') || $('#friend-requests') || $('#people-results') || document.querySelector('main');
      if (host) FXStates.render(host,'auth',{title:'Sign in to manage your connections',message:'Your friends, requests and suggestions are available after you sign in.',href:`/Auth/index.html?next=${next}`});
      return;
    }
    if (view === 'suggestions') {
      const initialQuery = new URLSearchParams(location.search).get('q');
      if (initialQuery) { $('#people-search').value = initialQuery; await searchPeople(initialQuery); }
      else await renderSuggestions();
      $('#search-people')?.addEventListener('click', () => searchPeople($('#people-search').value));
      $('#people-search')?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); searchPeople($('#people-search').value); } });
      $('#people-search')?.addEventListener('search', () => { if (!$('#people-search').value.trim()) searchPeople(''); });
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
