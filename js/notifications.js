document.addEventListener('DOMContentLoaded', async () => {
  const host = document.querySelector('#notification-list');
  const markAll = document.querySelector('#mark-all');
  if (!host) return;
  try { await FX.loadUser(); } catch (error) { FXStates.fail(host,error,{retry:()=>location.reload(),title:'Notifications could not be initialized'}); if(markAll)markAll.disabled=true; return; }
  if (!FX.client) {
    FXStates.render(host, 'configuration');
    if (markAll) markAll.disabled = true;
    return;
  }
  if (!FX.user) {
    FXStates.render(host, 'auth', { title: 'Sign in to view notifications', message: 'Your Frnxup alerts and updates will appear here after you sign in.', href: '/Auth/index.html?next=%2FNotifications%2Findex.html' });
    if (markAll) markAll.disabled = true;
    return;
  }
  async function load() {
    if (host.dataset.fxHasContent !== 'true') FXStates.loading(host, { title: 'Loading notifications', message: 'Checking your latest Frnxup alerts.' });
    const { data, error } = await FX.client.from('notifications').select('*')
      .eq('user_id', FX.user.id).order('created_at', { ascending: false }).limit(100);
    if (error) { FXStates.fail(host, error, { retry: load }); return; }
    if (!(data || []).length) {
      FXStates.empty(host, { title: 'You are all caught up', message: 'There are no new notifications to show right now.' });
      FXStates.loaded(host);
      return;
    }
    host.innerHTML = data.map(n => `<div class="row-card" style="${n.read_at ? 'opacity:.65' : ''}"><div class="avatar sm">♧</div><div class="grow"><b>${FX.esc(n.title || 'Frnxup notification')}</b><small>${FX.esc(n.body || '')} · ${FX.relative(n.created_at)}</small></div>${n.read_at ? '' : '<span class="pill">New</span>'}</div>`).join('');
    FXStates.loaded(host);
  }
  await load();
  if (markAll) markAll.onclick = async () => {
    markAll.disabled = true;
    const { error } = await FX.client.from('notifications').update({ read_at: new Date().toISOString() })
      .eq('user_id', FX.user.id).is('read_at', null);
    markAll.disabled = false;
    if (error) FXStates.fail(host, error, { retry: load });
    else { FX.toast('Notifications marked as read.'); await load(); }
  };
});
