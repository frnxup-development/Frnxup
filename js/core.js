(() => {
  const cfg = window.FRNXUP_CONFIG || {};
  const configured = !!(cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes('YOUR-PROJECT') && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes('YOUR_'));
  const REMEMBER_DEVICE_KEY = 'frnxup_remember_device';

  // Supabase keeps only its session tokens in this adapter. Passwords are never stored.
  // Remembered sessions use localStorage; ordinary sessions use sessionStorage.
  const authStorage = {
    getItem(key) {
      try {
        const choice = localStorage.getItem(REMEMBER_DEVICE_KEY);
        if (choice === '1') return localStorage.getItem(key);
        if (choice === '0') return sessionStorage.getItem(key);
        // Preserve sessions created by earlier Frnxup versions until the member chooses otherwise.
        const legacy = localStorage.getItem(key);
        return legacy !== null ? legacy : sessionStorage.getItem(key);
      } catch (_) { return null; }
    },
    setItem(key, value) {
      try {
        const remember = localStorage.getItem(REMEMBER_DEVICE_KEY) === '1';
        const target = remember ? localStorage : sessionStorage;
        const other = remember ? sessionStorage : localStorage;
        target.setItem(key, value);
        other.removeItem(key);
      } catch (_) {}
    },
    removeItem(key) {
      try { localStorage.removeItem(key); } catch (_) {}
      try { sessionStorage.removeItem(key); } catch (_) {}
    }
  };

  const client = configured && window.supabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { storage: authStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  }) : null;

  // A member's saved session is read locally first so the app does not wait for
  // profile/settings requests before opening the page. Supabase RLS still
  // validates every protected data request on the server.
  const authStorageKey = (() => {
    try { return `sb-${new URL(cfg.SUPABASE_URL).hostname.split('.')[0]}-auth-token`; }
    catch (_) { return null; }
  })();

  function readStoredSession() {
    if (!authStorageKey) return null;
    try {
      const raw = authStorage.getItem(authStorageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.access_token && parsed.user ? parsed : null;
    } catch (_) { return null; }
  }

  function tokenIsFresh(session, minimumSeconds = 15) {
    const token = session?.access_token;
    if (!token) return false;
    try {
      const payloadPart = token.split('.')[1];
      if (!payloadPart) return false;
      const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
      const exp = Number(payload.exp || session.expires_at || 0);
      return Number.isFinite(exp) && exp > (Date.now() / 1000) + minimumSeconds;
    } catch (_) { return false; }
  }

  function withTimeout(task, milliseconds, fallback = null) {
    return new Promise(resolve => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; resolve(fallback); }
      }, milliseconds);
      Promise.resolve(task).then(value => {
        if (!settled) { settled = true; clearTimeout(timer); resolve(value); }
      }).catch(() => {
        if (!settled) { settled = true; clearTimeout(timer); resolve(fallback); }
      });
    });
  }

  // Every member-facing page is private. Authentication and administration pages remain public entry points.
  function requiresAccountSession(pathname) {
    const path = String(pathname || '/');
    return !(path === '/Auth' || path.startsWith('/Auth/') || path === '/Admin' || path.startsWith('/Admin/'));
  }
  function loginDestination() {
    const next = location.pathname + location.search + location.hash;
    return `/Auth/index.html?next=${encodeURIComponent(next || '/')}`;
  }
  function safeNextPath() {
    return location.pathname + location.search + location.hash;
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
      if (this._settingsLoaded) return this.settings;
      if (this._settingsPromise) return this._settingsPromise;
      this._settingsPromise = (async () => {
        const result = await withTimeout(client.from('site_settings').select('key,value'), 2500, null);
        if (result && !result.error) {
          this.settings = Object.fromEntries((result.data || []).map(item => [item.key, item.value]));
          this._settingsLoaded = true;
        }
        return this.settings;
      })();
      try { return await this._settingsPromise; }
      finally { this._settingsPromise = null; }
    },
    enabled(key) { return this.settings[key] !== false; },
    async session() { if (!client) return null; const { data, error } = await client.auth.getSession(); return error ? null : (data.session || null); },
    getRememberDevice() {
      try {
        const choice = localStorage.getItem(REMEMBER_DEVICE_KEY);
        if (choice === '1') return true;
        if (choice === '0') return false;
        const projectRef = new URL(cfg.SUPABASE_URL).hostname.split('.')[0];
        return !!localStorage.getItem(`sb-${projectRef}-auth-token`);
      } catch (_) { return false; }
    },
    setRememberDevice(remember) {
      try { localStorage.setItem(REMEMBER_DEVICE_KEY, remember ? '1' : '0'); } catch (_) {}
    },
    async checkSessionFast() {
      if (!client) return null;
      if (this._fastSessionReady && this.user) return this.user;

      // Most returning members are authenticated by a still-valid saved token.
      // Reading it locally avoids a blocking network round-trip on mobile.
      const cached = readStoredSession();
      if (cached && tokenIsFresh(cached)) {
        this.user = cached.user;
        this.profile = null;
        this.sessionPresent = true;
        this._fastSessionReady = true;
        // Let Supabase complete initialization/refresh in the background.
        withTimeout(client.auth.getSession(), 5000, null).then(result => {
          if (result?.data?.session?.user) {
            this.user = result.data.session.user;
            this.sessionPresent = true;
          } else if (result && !result.data?.session) {
            this.user = null;
            this.profile = null;
            this.sessionPresent = false;
            if (requiresAccountSession(location.pathname)) location.replace(loginDestination());
          }
        });
        return this.user;
      }

      // First-time visitors and near-expired sessions may need Supabase to
      // initialize or refresh the session. Never leave the screen waiting forever.
      const result = await withTimeout(client.auth.getSession(), 6500, null);
      const session = result?.data?.session || null;
      if (session?.user && tokenIsFresh(session, 5)) {
        this.user = session.user;
        this.profile = null;
        this.sessionPresent = true;
        this._fastSessionReady = true;
        return this.user;
      }
      this.user = null;
      this.profile = null;
      this.sessionPresent = false;
      return null;
    },
    async loadUser() {
      if (!client) return null;
      if (this.user && this._fastSessionReady) {
        // Return the authenticated member immediately. Profile/settings hydrate
        // in the background so mobile users can start using the page sooner.
        this.loadProfile().catch(() => {});
        return this.user;
      }
      if (this._loadUserPromise) return this._loadUserPromise;

      this._loadUserPromise = (async () => {
        const user = await this.checkSessionFast();
        if (user) this.loadProfile().catch(() => {});
        return user;
      })();
      try { return await this._loadUserPromise; }
      finally { this._loadUserPromise = null; }
    },
    async loadProfile() {
      if (!client || !this.user) return null;
      const userId = this.user.id;
      if (this._profileLoadedUserId === userId) return this.profile;
      if (this._profilePromise && this._profilePromiseUserId === userId) return this._profilePromise;

      this._profilePromiseUserId = userId;
      this._profilePromise = (async () => {
        const [result] = await Promise.all([
          withTimeout(client.from('profiles').select('*').eq('id', userId).maybeSingle(), 2500, null),
          this.loadSettings()
        ]);
        if (this.user?.id === userId) {
          this.profile = result && !result.error ? (result.data || null) : null;
          if (result) this._profileLoadedUserId = userId;
        }
        return this.profile;
      })();

      try { return await this._profilePromise; }
      finally {
        if (this._profilePromiseUserId === userId) {
          this._profilePromise = null;
          this._profilePromiseUserId = null;
        }
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
        let detail = null;
        try { detail = await error.context?.json(); if (detail?.error) message = detail.error; } catch (_) {}
        // Preserve safe diagnostic fields so the Admin login can display database lookup details.
        const thrown = new Error(message);
        if (detail && typeof detail === 'object') {
          thrown.code = detail.code || null;
          thrown.diagnostics = detail.database_error || null;
          thrown.project_ref = detail.project_ref || null;
          thrown.auth_user_id = detail.auth_user_id || null;
          thrown.server_detail = detail;
        }
        throw thrown;
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
    async admin(action, params = {}) { let staffToken = null; try { staffToken = sessionStorage.getItem('frnxup_admin_staff_session'); } catch (_) {} return this.invoke('admin-control', { ...params, action, staff_session_token: staffToken }); }
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
        FX._fastSessionReady = false;
        FX._profileLoadedUserId = null;
        FX.profile = null;
        if (requiresAccountSession(location.pathname)) location.replace(loginDestination());
      } else if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        FX.user = session?.user || null;
        FX.profile = null;
        FX.sessionPresent = !!session?.user;
        FX._loadUserResolved = false;
        FX._loadUserPromise = null;
        FX._fastSessionReady = !!session?.user;
        FX._profileLoadedUserId = null;
        FX._profilePromise = null;
        FX._profilePromiseUserId = null;
      }
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const protectedPage = requiresAccountSession(location.pathname);
    if (!protectedPage) {
      document.documentElement.classList.remove('fx-auth-pending');
      if (window.__frnxupAuthGateTimer) clearTimeout(window.__frnxupAuthGateTimer);
      return;
    }

    if (!client) {
      document.documentElement.dataset.backend = 'unconfigured';
      location.replace(loginDestination());
      return;
    }

    document.documentElement.dataset.backend = 'connected';
    let user = null;
    try { user = await FX.checkSessionFast(); }
    catch (_) { document.documentElement.dataset.backend = 'degraded'; }

    if (!user) {
      location.replace(loginDestination());
      return;
    }

    // The session is present. Reveal the page immediately; profile, site settings,
    // feed and other content requests continue asynchronously after this point.
    if (window.__frnxupAuthGateTimer) clearTimeout(window.__frnxupAuthGateTimer);
    document.documentElement.classList.remove('fx-auth-pending');
    FX.trackActivity('page_view', 'page', location.pathname, {
      title: String(document.title || '').slice(0, 120)
    });

    // Maintenance status is non-critical and must never delay first paint.
    FX.loadProfile().then(() => {
      if (FX.settings.maintenance_mode === true && !['owner', 'admin'].includes(FX.profile?.role)) {
        if (!document.querySelector('.maintenance-banner')) {
          const banner = document.createElement('div');
          banner.className = 'maintenance-banner';
          banner.textContent = 'Frnxup is temporarily in maintenance mode. Some features may be unavailable.';
          document.body.prepend(banner);
        }
      }
    });
  });
})();
