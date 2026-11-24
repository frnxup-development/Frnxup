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
    const { data, error } = await FX.client.from('notifications').select('*,profiles!notifications_actor_id_fkey(display_name,username,avatar_path)')
      .eq('user_id', FX.user.id).order('created_at', { ascending: false }).limit(100);
    if (error) { FXStates.fail(host, error, { retry: load }); return; }
    if (!(data || []).length) {
      FXStates.empty(host, { title: 'You are all caught up', message: 'There are no new notifications to show right now.' });
      FXStates.loaded(host);
      return;
    }
    const notificationIcon = type => /birthday/.test(type) ? '🌸' : /memory/.test(type) ? '🕰️' : /friend/.test(type) ? '♧' : /status/.test(type) ? '◉' : /upload|post/.test(type) ? '▧' : /room/.test(type) ? '▤' : /profile/.test(type) ? '◉' : /message/.test(type) ? '✉' : '●';
    const notificationHref = item => item.type === 'birthday_self' ? '/Dashboard/index.html' : item.target_type === 'memory' ? '/Dashboard/memories.html' : item.target_type === 'profile' && item.target_id ? `/Dashboard/profile.html?id=${encodeURIComponent(item.target_id)}` : (item.target_type === 'post' && item.target_id) ? `/Posts/view.html?id=${encodeURIComponent(item.target_id)}` : item.target_type === 'status' ? '/index.html' : item.target_type === 'room' && item.target_id ? `/Rooms/view.html?id=${encodeURIComponent(item.target_id)}` : '/Notifications/index.html';
    host.innerHTML = data.map(n => `<a class="row-card fx-notification-row" href="${notificationHref(n)}" data-notification="${FX.esc(n.id)}" style="${n.read_at ? 'opacity:.68' : ''}"><div class="avatar sm">${notificationIcon(n.type||'')}</div><div class="grow"><b>${FX.esc(n.title || 'Frnxup notification')}</b><small>${n.profiles?.display_name || n.profiles?.username ? `<b>${FX.esc(n.profiles.display_name || n.profiles.username)}</b> · ` : ''}${FX.esc(n.body || '')} · ${FX.relative(n.created_at)}</small></div>${n.read_at ? '' : '<span class="pill">New</span>'}</a>`).join('');
    host.querySelectorAll('[data-notification]').forEach(item => item.addEventListener('click', async () => {
      const id = item.dataset.notification;
      try { await FX.client.from('notifications').update({read_at:new Date().toISOString()}).eq('id',id).eq('user_id',FX.user.id).is('read_at',null); } catch (_) {}
    }));
    FXStates.loaded(host);
  }
  await load();
  let notificationRefreshTimer = null;
  const scheduleNotificationRefresh = () => { if (notificationRefreshTimer) window.clearTimeout(notificationRefreshTimer); notificationRefreshTimer = window.setTimeout(load, 300); };
  try { FX.client.channel(`fx-notifications-page-${FX.user.id}`).on('postgres_changes',{event:'*',schema:'public',table:'notifications',filter:`user_id=eq.${FX.user.id}`},scheduleNotificationRefresh).subscribe(); } catch (_) {}
  if (markAll) markAll.onclick = async () => {
    markAll.disabled = true;
    const { error } = await FX.client.from('notifications').update({ read_at: new Date().toISOString() })
      .eq('user_id', FX.user.id).is('read_at', null);
    markAll.disabled = false;
    if (error) FXStates.fail(host, error, { retry: load });
    else { FX.toast('Notifications marked as read.'); await load(); }
  };
});
