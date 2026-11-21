(() => {
  const cfg = window.FRNXUP_CONFIG || {};
  const configured = !!(cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes('YOUR-PROJECT') && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes('YOUR_'));
  const client = configured && window.supabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;

  // The member-facing Frnxup site is private. Only authentication flows and
  // the separately protected administrator area are exempt from the member gate.
  function requiresAccountSession(pathname) {
    const path = String(pathname || '/').replace(/\\/g, '/');
    const isAuthRoute = path === '/Auth' || path.startsWith('/Auth/');
    const isAdminRoute = path === '/Admin' || path.startsWith('/Admin/');
    return !isAuthRoute && !isAdminRoute;
  }
  function safeNextPath() {
    const path = location.pathname === '/' ? '/index.html' : location.pathname;
    return path + location.search + location.hash;
  }
  function redirectToMemberLogin() {
    const next = encodeURIComponent(safeNextPath());
    location.replace(`/Auth/index.html?next=${next}`);
  }
  const FX = {
    client, configured, user: null, profile: null, settings: {},
    qs: (selector, rootNode = document) => rootNode.querySelector(selector),
    qsa: (selector, rootNode = document) => [...rootNode.querySelectorAll(selector)],
    esc: value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])),
    toast(message) {
      let el = document.getElementById('fx-toast');
      if (!el) { el = document.createElement('div'); el.id = 'fx-toast'; el.className = 'toast'; document.body.append(el); }
      el.textContent = message; el.classList.add('show'); clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => el.classList.remove('show'), 3600);
    },
    time(value) { if (!value) return ''; const date = new Date(value); return isNaN(+date) ? '' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); },
    relative(value) { if (!value) return ''; const elapsed = Math.max(0, Date.now() - new Date(value).getTime()); const minutes = Math.floor(elapsed / 60000); if (minutes < 1) return 'just now'; if (minutes < 60) return `${minutes}m ago`; const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours}h ago`; return `${Math.floor(hours / 24)}d ago`; },
    async loadSettings() {
      if (!client) return this.settings;
      try {
        const { data, error } = await client.from('site_settings').select('key,value');
        if (!error) this.settings = Object.fromEntries((data || []).map(item => [item.key, item.value]));
      } catch (_) {}
      return this.settings;
    },
    enabled(key) { return this.settings[key] !== false; },
    async session() { if (!client) return null; const { data, error } = await client.auth.getSession(); return error ? null : (data.session || null); },
    async loadUser() {
      if (!client) return null;
      if (this._loadUserPromise) return this._loadUserPromise;
      if (this._loadUserResolved) return this.user;

      this._loadUserPromise = (async () => {
        let sessionData = null;
        try {
          const result = await client.auth.getSession();
          sessionData = result?.data || null;
        } catch (_) {}

        const sessionUser = sessionData?.session?.user || null;
        this.sessionPresent = !!sessionUser;
        if (!sessionUser) {
          this.user = null;
          this.profile = null;
          return null;
        }

        // getSession() is the persisted local session snapshot. If the network
        // call to getUser() fails temporarily, keep that snapshot rather than
        // falsely treating the member as signed out and bouncing to login.
        let resolvedUser = sessionUser;
        try {
          const result = await client.auth.getUser();
          if (!result?.error && result?.data?.user) resolvedUser = result.data.user;
        } catch (_) {}

        this.user = resolvedUser;
        try {
          const { data: profile, error } = await client.from('profiles')
            .select('*').eq('id', resolvedUser.id).maybeSingle();
          this.profile = error ? null : (profile || null);
        } catch (_) {
          this.profile = null;
        }
        await this.loadSettings();
        return this.user;
      })();

      try {
        return await this._loadUserPromise;
      } finally {
        this._loadUserPromise = null;
        this._loadUserResolved = true;
      }
    },
    async requireAuth() {
      const user = await this.loadUser();
      if (!user) {
        this.showAuthNotice('Please sign in to use this feature.');
        return null;
      }
      return user;
    },
    showAuthNotice(message, destination = '/Auth/index.html') {
      const main = document.querySelector('main');
      if (!main) return;
      let notice = document.getElementById('fx-auth-notice');
      if (!notice) {
        notice = document.createElement('div');
        notice.id = 'fx-auth-notice';
        notice.className = 'auth-state-notice';
        main.prepend(notice);
      }
      const next = encodeURIComponent(location.pathname + location.search + location.hash);
      const href = destination.includes('?') ? destination : `${destination}?next=${next}`;
      notice.textContent = '';
      const text = document.createElement('span');
      text.textContent = `${message} `;
      const link = document.createElement('a');
      link.href = href;
      link.textContent = 'Sign in';
      notice.append(text, link);
    },
    async trackActivity(action, entityType = null, entityId = null, details = {}) {
      if (!client || !this.user) return false;
      try {
        const { error } = await client.rpc('frnxup_log_activity', {
          p_action: String(action || 'activity').slice(0, 48),
          p_entity_type: entityType ? String(entityType).slice(0, 48) : null,
          p_entity_id: entityId == null ? null : String(entityId).slice(0, 160),
          p_details: details && typeof details === 'object' ? details : {}
        });
        return !error;
      } catch (_) { return false; }
    },
    async invoke(name, body) {
      if (!client) throw new Error('Connect your Frnxup Supabase project first. See README.md.');
      const { data, error } = await client.functions.invoke(name, { body });
      if (error) {
        let message = error.message || 'The server request failed.';
        try { const detail = await error.context?.json(); if (detail?.error) message = detail.error; } catch (_) {}
        throw new Error(message);
      }
      if (data?.error) throw new Error(data.error);
      return data;
    },
    async upload(file, folder = 'posts') {
      if (!this.enabled('uploads_enabled')) throw new Error('Media uploads are temporarily disabled by Frnxup administrators.');
      if (!client || !this.user) throw new Error('Please sign in first.');
      if (!file) return null;
      const limits = { avatars: 5 * 1024 * 1024, covers: 12 * 1024 * 1024, 'pages-avatar': 5 * 1024 * 1024, 'pages-cover': 12 * 1024 * 1024, messages: 30 * 1024 * 1024, statuses: 60 * 1024 * 1024, posts: 100 * 1024 * 1024, market: 15 * 1024 * 1024, verification: 10 * 1024 * 1024 };
      const max = limits[folder] || 30 * 1024 * 1024;
      if (file.size > max) throw new Error(`File is too large. The limit for ${folder} is ${Math.round(max / 1024 / 1024)} MB.`);
      const type = file.type || '';
      if (['avatars', 'covers', 'pages-avatar', 'pages-cover'].includes(folder) && !type.startsWith('image/')) throw new Error('Please select an image file.');
      if (['posts', 'statuses'].includes(folder) && !(type.startsWith('image/') || type.startsWith('video/'))) throw new Error('Please select an image or video file.');
      if (folder === 'market' && !type.startsWith('image/')) throw new Error('Marketplace listing photographs must be image files.');
      if (folder === 'messages' && !(type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/'))) throw new Error('Unsupported message attachment.');
      const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
      const path = `${this.user.id}/${folder}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
      const { error } = await client.storage.from('frnxup-media').upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' });
      if (error) throw error;
      return path;
    },
    async mediaUrl(path) { if (!path || !client) return ''; const { data, error } = await client.storage.from('frnxup-media').createSignedUrl(path, 3600); return error ? '' : data.signedUrl; },
    async profileLink(id) { return `../Dashboard/profile.html?id=${encodeURIComponent(id)}`; },
    activePageId() { try { return localStorage.getItem('frnxup_active_page_id') || null; } catch (_) { return null; } },
    setActivePage(pageId) { try { if (pageId) localStorage.setItem('frnxup_active_page_id', String(pageId)); else localStorage.removeItem('frnxup_active_page_id'); } catch (_) {} },
    setMessage(element, message, kind = 'info') { if (typeof element === 'string') element = document.querySelector(element); if (element) { element.textContent = message; element.dataset.kind = kind; } },
    async admin(action, params = {}) { return this.invoke('admin-control', { action, ...params }); }
  };
  window.FX = FX;

  if (client?.auth?.onAuthStateChange) {
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        FX.user = null;
        FX.profile = null;
        FX.sessionPresent = false;
        FX._loadUserResolved = true;
        FX._loadUserPromise = null;
        if (requiresAccountSession(location.pathname)) {
          document.documentElement.classList.remove('fx-auth-ready');
          redirectToMemberLogin();
        }
      } else if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        FX.user = session?.user || null;
        FX.profile = null;
        FX.sessionPresent = !!session?.user;
        FX._loadUserResolved = false;
        FX._loadUserPromise = null;
      }
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const memberPage = requiresAccountSession(location.pathname);

    // Auth confirmation/reset and the separately protected admin pages remain
    // reachable without a member session. Reveal them immediately.
    if (!memberPage) {
      document.documentElement.classList.add('fx-auth-ready');
      document.documentElement.dataset.backend = client ? 'connected' : 'unconfigured';
      return;
    }

    // Fail closed: no Supabase client means no member area access.
    if (!client) {
      document.documentElement.dataset.backend = 'unconfigured';
      redirectToMemberLogin();
      return;
    }

    document.documentElement.dataset.backend = 'connected';
    try {
      await FX.loadUser();
    } catch (_) {
      // A transient auth/network error must not turn an absent session into access.
      document.documentElement.dataset.backend = 'degraded';
    }

    if (!FX.user) {
      redirectToMemberLogin();
      return;
    }

    // Reveal protected content only after a persisted Supabase session is found.
    document.documentElement.classList.add('fx-auth-ready');

    // Log signed-in page visits centrally. Query strings are deliberately omitted.
    FX.trackActivity('page_view', 'page', location.pathname, {
      title: String(document.title || '').slice(0, 120)
    });

    if (FX.settings.maintenance_mode === true && !['owner', 'admin'].includes(FX.profile?.role)) {
      const banner = document.createElement('div');
      banner.className = 'maintenance-banner';
      banner.textContent = 'Frnxup is temporarily in maintenance mode. Some features may be unavailable.';
      document.body.prepend(banner);
    }
  });
})();
