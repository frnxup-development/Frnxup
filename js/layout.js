(() => {
  const shell = document.querySelector('[data-frnxup-shell]');
  if (!shell) return;

  const icons = {
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    friends: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1M16 5.5a3 3 0 0 1 0 5.8M18 14a5 5 0 0 1 3 4.6V20"/>',
    messages: '<path d="M20.5 11.5a8.5 8.5 0 0 1-9 8.5 9.7 9.7 0 0 1-4-.8L3 21l1.5-4A8.3 8.3 0 0 1 3 11.5 8.5 8.5 0 0 1 12 3a8.5 8.5 0 0 1 8.5 8.5Z"/><path d="M7 12h.01M12 12h.01M17 12h.01"/>',
    rooms: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 9h8M8 13h5M8 17h3"/>',
    reels: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 4l4 6M14 4l4 6M3 10h18"/><path d="M10 14v4l4-2-4-2Z"/>',
    horn: '<path d="M3 10v4a2 2 0 0 0 2 2h2l10 4V4L7 8H5a2 2 0 0 0-2 2Z"/><path d="M7 16l2 5h4l-2-4M20 9l2-2M20 15l2 2"/>',
    profile: '<circle cx="12" cy="8" r="3.5"/><path d="M4 21a8 8 0 0 1 16 0"/>'
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icons[name]}</svg>`;
  const links = [
    ['Home', '/index.html', 'home'],
    ['Friends', '/Friends/index.html', 'friends'],
    ['Reels', '/Reels/index.html', 'reels'],
    ['Messages', '/Messages/index.html', 'messages'],
    ['Rooms', '/Rooms/index.html', 'rooms'],
    ['Notifications', '/Notifications/index.html', 'horn']
  ];
  const current = location.pathname;
  const activeFor = (key, url) => {
    if (key === 'home') return current === '/' || current === '/index.html';
    if (key === 'friends') return current.startsWith('/Friends/');
    if (key === 'reels') return current.startsWith('/Reels/');
    if (key === 'messages') return current.startsWith('/Messages/');
    if (key === 'rooms') return current.startsWith('/Rooms/');
    if (key === 'horn') return current.startsWith('/Notifications/');
    return current === url;
  };

  shell.innerHTML = `
    <header class="brand-header">
      <a class="brand" href="/index.html"><img src="/Asset/frnxup-mark.svg" alt=""><span>Frnxup</span></a>
      <button class="menu-button" id="fx-menu" aria-label="Open menu" title="Menu">☰</button>
      <nav class="menu-popover" id="fx-menu-pop" aria-label="More navigation">
        <a href="/Rooms/index.html">Communities &amp; rooms</a>
        <a href="/Friends/index.html">Find people</a>
        <a href="/Reels/index.html">Watch Reels</a>
        <a href="/Posts/saved.html">Saved posts</a>
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
        ${links.map(([label, url, key]) => `<a class="action-link ${activeFor(key, url) ? 'selected' : ''}" href="${url}" title="${label}" aria-label="${label}">${icon(key)}</a>`).join('')}
      </nav>
      <a class="dashboard-icon" href="/Dashboard/index.html" title="User dashboard" aria-label="User dashboard">${icon('profile')}</a>
    </header>`;

  document.getElementById('fx-menu')?.addEventListener('click', () => document.getElementById('fx-menu-pop')?.classList.toggle('open'));
  document.addEventListener('click', (event) => {
    const pop = document.getElementById('fx-menu-pop');
    if (pop && !pop.contains(event.target) && event.target.id !== 'fx-menu') pop.classList.remove('open');
  });

  document.addEventListener('DOMContentLoaded', async () => {
    if (document.body.classList.contains('fx-reels-page')) return;
    try {
      await FX.loadUser();
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
