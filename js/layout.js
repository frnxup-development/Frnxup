(() => {
  const shell = document.querySelector('[data-frnxup-shell]');
  if (!shell) return;

  const icons = {
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    friends: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1M16 5.5a3 3 0 0 1 0 5.8M18 14a5 5 0 0 1 3 4.6V20"/>',
    messages: '<path d="M20.5 11.5a8.5 8.5 0 0 1-9 8.5 9.7 9.7 0 0 1-4-.8L3 21l1.5-4A8.3 8.3 0 0 1 3 11.5 8.5 8.5 0 0 1 12 3a8.5 8.5 0 0 1 8.5 8.5Z"/><path d="M7 12h.01M12 12h.01M17 12h.01"/>',
    rooms: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 9h8M8 13h5M8 17h3"/>',
    horn: '<path d="M3 10v4a2 2 0 0 0 2 2h2l10 4V4L7 8H5a2 2 0 0 0-2 2Z"/><path d="M7 16l2 5h4l-2-4M20 9l2-2M20 15l2 2"/>',
    profile: '<circle cx="12" cy="8" r="3.5"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    reel: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3zM7 5l3-3M14 5l3-3M7 19l3 3M14 19l3 3"/>',
    market: '<path d="M5 8h14l1 13H4L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2M9 12h.01M15 12h.01"/>'
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icons[name]}</svg>`;
  if (!document.querySelector('link[data-frnxup-wordmark]')) {
    const wordmarkCss = document.createElement('link');
    wordmarkCss.rel = 'stylesheet';
    wordmarkCss.href = '/Css/frnxup-wordmark.css?v=20261125-option7';
    wordmarkCss.dataset.frnxupWordmark = 'true';
    document.head.appendChild(wordmarkCss);
  }
  const links = [
    ['Home', '/index.html', 'home'],
    ['Friends', '/Friends/index.html', 'friends'],
    ['Messages', '/Messages/index.html', 'messages'],
    ['Rooms', '/Rooms/index.html', 'rooms'],
    ['Notifications', '/Notifications/index.html', 'horn'],
    ['Create Reel', '/Reels/index.html?create=1', 'reel'],
    ['Frnxup Market', '/Market/index.html', 'market']
  ];
  const current = location.pathname;
  const activeFor = (key, url) => {
    if (key === 'home') return current === '/' || current === '/index.html';
    if (key === 'friends') return current.startsWith('/Friends/');
    if (key === 'messages') return current.startsWith('/Messages/');
    if (key === 'rooms') return current.startsWith('/Rooms/');
    if (key === 'horn') return current.startsWith('/Notifications/');
    if (key === 'reel') return current.startsWith('/Reels/');
    if (key === 'market') return current.startsWith('/Market/');
    return current === url;
  };

  shell.innerHTML = `
    <header class="brand-header">
      <a class="brand" href="/index.html" aria-label="FRNXUP home"><img src="/Asset/frnxup-mark.svg" alt=""><span class="frnxup-wordmark-text" role="img" aria-label="FRNXUP"><span class="frnxup-navy">FRN</span><span class="frnxup-x">X</span><span class="frnxup-navy">UP</span></span></a>
      <button class="menu-button" id="fx-menu" aria-label="Open menu" title="Menu">☰</button>
      <nav class="menu-popover" id="fx-menu-pop" aria-label="More navigation">
        <a href="/Rooms/index.html">Communities &amp; rooms</a>
        <a href="/Friends/index.html">Find people</a>
        <a href="/Posts/saved.html">Saved posts</a>
        <a href="/Dashboard/memories.html">Your memories</a>
        <a href="/Dashboard/index.html">Your dashboard</a>
        <a href="/Pages/index.html">Your Pages</a>
        <a href="/Market/index.html">Frnxup-Market</a>
        <a href="/Dashboard/privacy.html">Privacy &amp; security</a>
        <a href="/help.html">Help and support</a>
        <button type="button" data-theme-toggle aria-pressed="false">Switch appearance</button>
        <a href="/Auth/index.html">Log in / Sign up</a>
      </nav>
    </header>
    <header class="action-header">
      <nav class="action-nav" aria-label="Main actions">
        ${links.map(([label, url, key]) => `<a class="action-link ${activeFor(key, url) ? 'selected' : ''}" href="${url}" title="${label}" aria-label="${label}">${icon(key)}${key==='friends'?'<span class="fx-nav-badge" id="fx-nav-friends-badge" hidden></span>':key==='horn'?'<span class="fx-nav-badge" id="fx-nav-notifications-badge" hidden></span>':''}</a>`).join('')}
      </nav>
      <a class="dashboard-icon" href="/Dashboard/index.html" title="User dashboard" aria-label="User dashboard">${icon('profile')}</a>
    </header>`;

  if (!document.getElementById('fx-header-badge-style')) {
    const badgeStyle = document.createElement('style');
    badgeStyle.id = 'fx-header-badge-style';
    badgeStyle.textContent = '.action-link{position:relative}.action-link .fx-nav-badge{display:grid!important;place-items:center;position:absolute;top:5px;right:2px;min-width:18px;height:18px;padding:0 4px;border:2px solid #242526;border-radius:999px;background:#ed334c;color:#fff;font:800 10px/1 Manrope,Arial,sans-serif;box-sizing:border-box;z-index:2}.action-link .fx-nav-badge[hidden]{display:none!important}@media(max-width:700px){.action-link .fx-nav-badge{top:4px;right:0;min-width:17px;height:17px;font-size:9px}}';
    document.head.appendChild(badgeStyle);
  }

  document.getElementById('fx-menu')?.addEventListener('click', () => document.getElementById('fx-menu-pop')?.classList.toggle('open'));
  document.addEventListener('click', (event) => {
    const pop = document.getElementById('fx-menu-pop');
    if (pop && !pop.contains(event.target) && event.target.id !== 'fx-menu') pop.classList.remove('open');
  });

  let headerBadgeTimer = null;
  const scheduleHeaderBadgeRefresh = () => {
    if (headerBadgeTimer) window.clearTimeout(headerBadgeTimer);
    headerBadgeTimer = window.setTimeout(refreshHeaderBadges, 250);
  };

  async function refreshHeaderBadges() {
    if (!window.FX?.client) return;
    try { await FX.loadUser(); } catch (_) { return; }
    if (!FX.user) return;
    const uid = FX.user.id;
    const [friendCount, notificationCount] = await Promise.all([
      FX.client.from('friend_requests').select('id', {count:'exact',head:true}).eq('receiver_id',uid).eq('status','pending'),
      FX.client.from('notifications').select('id', {count:'exact',head:true}).eq('user_id',uid).is('read_at',null)
    ]);
    const setBadge = (selector, count) => {
      const node = document.querySelector(selector);
      if (!node) return;
      const value = Number(count || 0);
      node.textContent = value > 99 ? '99+' : String(value);
      node.hidden = value < 1;
      node.setAttribute('aria-label', value ? `${value} new ${selector.includes('friends') ? 'friend requests' : 'notifications'}` : 'No new alerts');
    };
    if (!friendCount.error) setBadge('#fx-nav-friends-badge', friendCount.count);
    if (!notificationCount.error) setBadge('#fx-nav-notifications-badge', notificationCount.count);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      await FX.loadUser();
      if (FX.user && FX.client) {
        // Daily reminders are deduplicated in the database and safely skipped
        // until the accompanying migration has been installed.
        try { await FX.client.rpc('frnxup_check_social_reminders'); } catch (_) {}
        refreshHeaderBadges();
        window.setInterval(refreshHeaderBadges, 45000);
        try {
          FX.client.channel(`fx-header-alerts-${FX.user.id}`)
            .on('postgres_changes',{event:'*',schema:'public',table:'notifications',filter:`user_id=eq.${FX.user.id}`},scheduleHeaderBadgeRefresh)
            .on('postgres_changes',{event:'*',schema:'public',table:'friend_requests',filter:`receiver_id=eq.${FX.user.id}`},scheduleHeaderBadgeRefresh)
            .subscribe();
        } catch (_) {}
      }

      const activeId = FX.activePageId();
      if (!FX.user || !activeId || !shell) return;
      const { data: activePage } = await FX.client.from('frnxup_pages').select('id,name').eq('id', activeId).eq('owner_user_id', FX.user.id).eq('status','active').maybeSingle();
      if (!activePage) { FX.setActivePage(null); return; }
      const banner = document.createElement('div');
      banner.className = 'fx-active-page-banner';
      banner.innerHTML = `<span>Posting as <b>${FX.esc(activePage.name)}</b></span><a href="/Pages/dashboard.html?id=${activePage.id}">Open Page</a><button type="button">Switch to personal account</button>`;
      banner.querySelector('button').addEventListener('click', () => { FX.setActivePage(null); location.reload(); });
      shell.insertAdjacentElement('afterend', banner);
    } catch (_) { /* A page-mode helper must never block navigation. */ }
  });
})();
