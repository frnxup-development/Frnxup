(() => {
  const $ = FX.qs;
  const person = p => `<div class="row-card"><div class="avatar">${FX.esc((p.display_name||p.username||'F').slice(0,2).toUpperCase())}</div><div class="grow"><b>${FX.esc(p.display_name||p.username)}</b><small>@${FX.esc(p.username||'member')}</small></div><a class="button subtle" href="/Dashboard/profile.html?id=${p.id}">Profile</a><button class="button primary" data-add="${p.id}">Add</button></div>`;
  async function suggest() {
    if (!FX.client || !FX.user) return;
    const {data,error}=await FX.client.rpc('frnxup_friend_suggestions',{p_limit:30});
    const host=$('#people-results');
    if(host) host.innerHTML=error?`<div class="empty">${FX.esc(error.message)}</div>`:(data||[]).map(p=>person({...p,display_name:p.display_name+(p.shared_interests?` · ${p.shared_interests} shared interests`:'' )})).join('')||'<div class="empty">No suggestions yet. Invite people you know to join Frnxup.</div>';
  }
  async function loadLists() {
    if (!FX.client || !FX.user) return;
    const [fr,req,sent] = await Promise.all([
      FX.client.from('friendships').select('user_a,user_b').or(`user_a.eq.${FX.user.id},user_b.eq.${FX.user.id}`),
      FX.client.from('friend_requests').select('id,sender_id,profiles!friend_requests_sender_id_fkey(id,username,display_name)').eq('receiver_id',FX.user.id).eq('status','pending'),
      FX.client.from('friend_requests').select('id,receiver_id,profiles!friend_requests_receiver_id_fkey(id,username,display_name)').eq('sender_id',FX.user.id).eq('status','pending')
    ]);
    const ids=(fr.data||[]).map(x=>x.user_a===FX.user.id?x.user_b:x.user_a);
    if ($('#my-friends')) {
      if (ids.length) { const {data}=await FX.client.from('profiles').select('id,username,display_name').in('id',ids); $('#my-friends').innerHTML=(data||[]).map(p=>`<div class="row-card"><div class="avatar">${FX.esc((p.display_name||p.username||'F').slice(0,1))}</div><div class="grow"><b>${FX.esc(p.display_name||p.username)}</b><small>@${FX.esc(p.username)}</small></div><a class="button subtle" href="/Dashboard/profile.html?id=${p.id}">Profile</a><button class="button danger" data-remove-friend="${p.id}">Remove</button></div>`).join(''); }
      else $('#my-friends').innerHTML='<div class="empty">Your friends will appear here.</div>';
    }
    if ($('#friend-requests')) $('#friend-requests').innerHTML=(req.data||[]).map(x=>`<div class="row-card"><div class="grow"><b>${FX.esc(x.profiles?.display_name||x.profiles?.username)}</b><small>Wants to connect</small></div><button class="button primary" data-accept="${x.id}">Accept</button><button class="button subtle" data-decline="${x.id}">Decline</button></div>`).join('')||'<div class="empty">No new friend requests.</div>';
    if ($('#sent-requests')) $('#sent-requests').innerHTML=(sent.data||[]).map(x=>`<div class="row-card"><div class="grow"><b>${FX.esc(x.profiles?.display_name||x.profiles?.username)}</b><small>Request pending</small></div><button class="button subtle" data-cancel="${x.id}">Cancel</button></div>`).join('')||'<div class="empty">No pending sent requests.</div>';
  }
  async function addFriend(id) { const {error}=await FX.client.from('friend_requests').insert({sender_id:FX.user.id,receiver_id:id}); if(error)throw error; FX.toast('Friend request sent.'); }
  document.addEventListener('DOMContentLoaded', async () => {
    await FX.loadUser();
    if (!FX.user) { FX.toast('Sign in to use Friends.'); return; }
    const initialQuery=new URLSearchParams(location.search).get('q');
    if(!initialQuery) suggest();
    loadLists();
    const searchPeople = async value => {
      const q=String(value||'').trim().replace(/[(),]/g,' ');
      if(!q)return;
      $('#people-search').value=q;
      const {data,error}=await FX.client.from('profiles').select('id,username,display_name').or(`username.ilike.%${q}%,display_name.ilike.%${q}%`).neq('id',FX.user.id).limit(30);
      $('#people-results').innerHTML=error?`<div class="empty">${FX.esc(error.message)}</div>`:(data||[]).map(person).join('')||'<div class="empty">No matching members.</div>';
    };
    $('#search-people')?.addEventListener('click', () => searchPeople($('#people-search').value));
    $('#people-search')?.addEventListener('keydown', event => { if(event.key==='Enter'){event.preventDefault();searchPeople($('#people-search').value);} });
    if(initialQuery){$('#people-search').value=initialQuery;searchPeople(initialQuery);}
    document.body.addEventListener('click', async e => {
      const b=e.target.closest('button'); if(!b)return;
      try {
        if(b.dataset.add) await addFriend(b.dataset.add);
        if(b.dataset.removeFriend){if(!confirm('Remove this friend?'))return;const a=[FX.user.id,b.dataset.removeFriend].sort();const {error}=await FX.client.from('friendships').delete().eq('user_a',a[0]).eq('user_b',a[1]);if(error)throw error;FX.toast('Friend removed.');loadLists()}
        if(b.dataset.accept||b.dataset.decline) {
          const {error}=await FX.client.rpc('respond_friend_request',{p_request_id:b.dataset.accept||b.dataset.decline,p_accept:!!b.dataset.accept});
          if(error)throw error; FX.toast(b.dataset.accept?'Friend request accepted.':'Request declined.'); loadLists();
        }
        if(b.dataset.cancel) {
          const {error}=await FX.client.from('friend_requests').delete().eq('id',b.dataset.cancel).eq('sender_id',FX.user.id);
          if(error)throw error; loadLists();
        }
      } catch(err) { FX.toast(err.message); }
    });
  });
})();
