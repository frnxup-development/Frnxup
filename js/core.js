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

  // Observe Supabase transport failures globally as well as inside each widget.
  // Local components still classify individual 401/403/404 responses themselves.
  const observedFetch = async (input, init) => {
    const requestUrl = typeof input === 'string' ? input : (input?.url || '');
    const isSupabaseRequest = !!cfg.SUPABASE_URL && requestUrl.startsWith(cfg.SUPABASE_URL);
    try {
      const response = await window.fetch(input, init);
      if (isSupabaseRequest && (response.status >= 500 || response.status === 429)) {
        window.__frnxupTransportFailed = true;
        window.FXStates?.banner('server', 'Frnxup is having trouble responding. Some content may be temporarily unavailable.');
      } else if (isSupabaseRequest && response.ok && window.__frnxupTransportFailed) {
        window.__frnxupTransportFailed = false;
        window.FXStates?.banner('online', 'Connection restored. Frnxup is responding again.', 3500);
      }
      return response;
    } catch (error) {
      if (isSupabaseRequest) {
        window.__frnxupTransportFailed = true;
        window.FXStates?.banner(navigator.onLine === false ? 'offline' : 'connection', navigator.onLine === false ? 'You are offline. Frnxup will retry when your connection returns.' : 'Frnxup could not reach its service. Check your connection and try again.');
      }
      throw error;
    }
  };
  const client = configured && window.supabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { storage: authStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    global: { fetch: observedFetch }
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
            if (requiresAccountSession(location.pathname) && !FX._forcedAccessRedirect) location.replace(loginDestination());
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
    accountRestrictionMessage(status) {
      if (status === 'banned') return 'This account is banned from using Frnxup, contact Frnxup support at frnxup@gmail.com.';
      if (status === 'suspended') return 'This account has been suspended by Frnxup administrators. Submit an appeal at /Auth/appeal.html or contact Frnxup support at frnxup@gmail.com.';
      return 'This account cannot currently access Frnxup. Contact support at frnxup@gmail.com.';
    },
    async blockRestrictedAccount(status) {
      const state = status === 'banned' ? 'banned' : 'suspended';
      this._forcedAccessRedirect = true;
      this.user = null;
      this.profile = null;
      this.sessionPresent = false;
      this._fastSessionReady = false;
      this._profileLoadedUserId = null;
      try { sessionStorage.setItem('frnxup_account_restricted', state); } catch (_) {}
      try { if (client) await client.auth.signOut(); } catch (_) {}
      const target = `/Auth/index.html?accountStatus=${encodeURIComponent(state)}`;
      if (!(location.pathname === '/Auth/index.html' && new URLSearchParams(location.search).get('accountStatus') === state)) {
        location.replace(target);
      }
      return null;
    },
    async verifyAccountStatus() {
      if (!client || !this.user) return null;
      const userId = this.user.id;
      const { data, error } = await client.from('profiles').select('account_status').eq('id', userId).maybeSingle();
      if (error || !data) return null;
      if (data.account_status !== 'active') return this.blockRestrictedAccount(data.account_status);
      return data.account_status;
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
          if (this.profile?.account_status && this.profile.account_status !== 'active') {
            await this.blockRestrictedAccount(this.profile.account_status);
            return null;
          }
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
  // Unified, theme-aware content state manager. Feature pages render real states
  // instead of treating connection failures as empty collections.
  const FXStates = (() => {
    const base = '/Asset/States/';
    const icons = {
      loading: 'loading.gif', offline: 'offline.gif', connection: 'connection.gif',
      server: 'server.gif', slow: 'slow.gif', empty: 'empty.gif', unavailable: 'unavailable.gif',
      permission: 'permission.gif', auth: 'permission.gif', image: 'image.gif', video: 'video.gif',
      upload: 'upload.gif', success: 'success.gif', configuration: 'server.gif'
    };
    const copy = {
      loading: ['Loading your content…', 'Frnxup is checking for the latest updates.'],
      offline: ['You are offline', 'Your device has no internet connection. Check your network and try again.'],
      connection: ['Could not connect to Frnxup', 'The request did not reach the Frnxup service. Your existing content has been kept.'],
      server: ['Frnxup service is temporarily unavailable', 'The server returned an error. Please try again shortly.'],
      slow: ['Your connection is taking longer than expected', 'The request timed out before the content could finish loading.'],
      empty: ['Nothing here yet', 'There is no content to show in this section right now.'],
      unavailable: ['This content is unavailable', 'The requested content could not be found or loaded.'],
      permission: ['Access is restricted', 'Your account does not have permission to view this content.'],
      auth: ['Your sign-in needs attention', 'Your session may have expired. Sign in again to continue.'],
      image: ['Image could not be loaded', 'The image file may have been moved or is temporarily unavailable.'],
      video: ['Video could not be loaded', 'The video file may have been moved or is temporarily unavailable.'],
      upload: ['Upload could not be completed', 'Check your connection and file, then try uploading again.'],
      success: ['Connection restored', 'Frnxup is connected again.'],
      configuration: ['Frnxup is not connected', 'The website has not been configured with its Supabase connection details.']
    };
    const retryRecords = new Map();
    const retryDelays = [3000, 7000, 15000];
    let banner = null;
    let bannerTimer = null;

    function el(target) {
      if (!target) return null;
      if (typeof target === 'string') return document.querySelector(target);
      return target.nodeType === 1 ? target : null;
    }
    function text(value, fallback = '') { return String(value ?? fallback); }
    function stateMarkup(type, options = {}) {
      const key = icons[type] ? type : 'unavailable';
      const [defaultTitle, defaultMessage] = copy[key];
      const reducedMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const iconFile = reducedMotion ? icons[key].replace(/\.gif$/, '.png') : icons[key];
      const title = FX.esc(text(options.title, defaultTitle));
      const message = FX.esc(text(options.message, defaultMessage));
      const detail = options.detail ? `<small class="fx-state-detail">${FX.esc(options.detail)}</small>` : '';
      const button = options.retry ? `<button type="button" class="fx-state-retry" data-fx-state-retry>${FX.esc(options.retryLabel || 'Try again')}</button>` : '';
      const href = options.href ? `<a class="fx-state-link" href="${FX.esc(options.href)}">${FX.esc(options.linkLabel || 'Sign in')}</a>` : '';
      return `<section class="fx-state-card${options.compact ? ' is-compact' : ''}${options.inline ? ' is-inline' : ''}" data-fx-state-card="${key}" role="${['offline','connection','server','slow','permission','auth','unavailable'].includes(key) ? 'alert' : 'status'}" aria-live="${['offline','connection','server','slow','permission','auth','unavailable'].includes(key) ? 'assertive' : 'polite'}"><img class="fx-state-gif" src="${base}${iconFile}" alt="" width="88" height="88" loading="eager" decoding="async"><div class="fx-state-copy"><b>${title}</b><span>${message}</span>${detail}${button}${href}</div></section>`;
    }
    function render(target, type, options = {}) {
      const host = el(target);
      if (!host) return null;
      const key = icons[type] ? type : 'unavailable';
      const preserve = options.preserve === true || (host.dataset.fxHasContent === 'true' && ['offline','connection','server','slow'].includes(key));
      host.dataset.fxState = key;
      if (preserve) {
        let warning = host.querySelector(':scope > .fx-state-warning');
        if (!warning) {
          warning = document.createElement('div');
          warning.className = 'fx-state-warning';
          host.prepend(warning);
        }
        warning.innerHTML = stateMarkup(key, { ...options, compact: true, inline: true });
      } else {
        host.innerHTML = stateMarkup(key, options);
      }
      return host;
    }
    function loading(target, options = {}) { return render(target, 'loading', options); }
    function empty(target, options = {}) { return render(target, 'empty', options); }
    function success(target, options = {}) {
      const host = render(target, 'success', { title: options.title || copy.success[0], message: options.message || copy.success[1], compact: options.compact !== false });
      if (host) setTimeout(() => { if (host.dataset.fxState === 'success') { host.replaceChildren(); delete host.dataset.fxState; } }, options.duration || 3200);
      return host;
    }
    function loaded(target) {
      const host = el(target);
      if (!host) return;
      host.dataset.fxHasContent = 'true';
      delete host.dataset.fxState;
      host.querySelectorAll(':scope > .fx-state-warning').forEach(node => node.remove());
      const record = retryRecords.get(host);
      if (record) {
        if (record.timer) clearTimeout(record.timer);
        record.count = 0;
        record.failed = false;
      }
    }
    function clearUpload(target) {
      const original = el(target);
      if (!original) return;
      const host = ['P','SPAN','SMALL','LABEL'].includes(original.tagName) ? original.nextElementSibling : original;
      if (host?.matches('[data-fx-upload-state-slot]')) host.remove();
      else if (host) { host.replaceChildren(); delete host.dataset.fxState; }
      const record = host ? retryRecords.get(host) : null;
      if (record?.timer) clearTimeout(record.timer);
      if (record) { record.failed = false; record.count = 0; record.timer = null; }
      if (['P','SPAN','SMALL','LABEL'].includes(original.tagName)) original.textContent = '';
    }
    function classify(error) {
      const message = text(error?.message || error, '').toLowerCase();
      const code = text(error?.code, '').toUpperCase();
      const status = Number(error?.status || error?.statusCode || error?.context?.status || 0);
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
      if (/invalid api key|supabase.*not configured|missing.*supabase|configuration.*missing|schema cache|relation .* does not exist|function .* does not exist|could not find the .* function|bucket .* not found|table .* not found/.test(message) || ['42P01','42883','PGRST202','PGRST205'].includes(code)) return 'configuration';
      if (status === 401 || /jwt|token.*expired|session.*expired|not authenticated/.test(message) || code === 'PGRST301') return 'auth';
      if (status === 403 || code === '42501' || /permission denied|not allowed|row-level security|insufficient privilege|forbidden/.test(message)) return 'permission';
      if (status >= 500 || status === 429 || /^5\d\d$/.test(code) || /internal server|bad gateway|service unavailable|gateway timeout|rate limit|too many requests/.test(message)) return 'server';
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError' || /timeout|timed out|deadline exceeded/.test(message)) return 'slow';
      if (/failed to fetch|network error|network request|load failed|connection refused|could not connect|connection.*failed|network.*failed|internet disconnected|fetch failed|offline/.test(message)) return 'connection';
      return 'unavailable';
    }
    function retryable(type) { return ['offline','connection','server','slow'].includes(type); }
    function scheduleRetry(host, callback, type) {
      if (!callback || !retryable(type)) return;
      let record = retryRecords.get(host);
      if (!record) { record = { count: 0, timer: null, callback, failed: true }; retryRecords.set(host, record); }
      record.callback = callback;
      record.failed = true;
      if (record.timer || record.count >= retryDelays.length || (type === 'offline' && navigator.onLine === false)) return;
      const delay = retryDelays[record.count++];
      record.timer = setTimeout(async () => {
        record.timer = null;
        if (!record.failed || !record.callback) return;
        if (navigator.onLine === false) return;
        try { await record.callback({ automatic: true }); }
        catch (_) { /* The retried operation renders its own actual state. */ }
      }, delay);
    }
    function fail(target, error, options = {}) {
      const host = el(target);
      if (!host) return null;
      const type = classify(error);
      const [title, message] = copy[type];
      const friendly = options.message || message;
      const retry = typeof options.retry === 'function' ? options.retry : null;
      if (retry) {
        const record = retryRecords.get(host) || { count: 0, timer: null, callback: retry, failed: true };
        record.callback = retry;
        record.failed = retryable(type);
        retryRecords.set(host, record);
      }
      render(host, type, {
        title: options.title || title,
        message: friendly,
        detail: options.showDetail ? (error?.message || '') : '',
        retry: !!retry,
        retryLabel: options.retryLabel || 'Try again',
        href: type === 'auth' ? '/Auth/index.html?next=' + encodeURIComponent(location.pathname + location.search) : null
      });
      if (retry) scheduleRetry(host, retry, type);
      return type;
    }
    function failInline(target, error, options = {}) {
      const original = el(target);
      if (!original) return null;
      const host = ['P','SPAN','SMALL','LABEL'].includes(original.tagName) ? (() => {
        original.textContent = '';
        let slot = original.nextElementSibling?.matches('[data-fx-upload-state-slot]') ? original.nextElementSibling : null;
        if (!slot) { slot = document.createElement('div'); slot.dataset.fxUploadStateSlot = 'true'; slot.className = 'fx-upload-state-slot'; original.insertAdjacentElement('afterend', slot); }
        return slot;
      })() : original;
      const type = classify(error);
      const [title, message] = copy[type];
      const retry = typeof options.retry === 'function' ? options.retry : null;
      if (retry) { const record = retryRecords.get(host) || { count: 0, timer: null, callback: retry, failed: retryable(type) }; record.callback = retry; record.failed = retryable(type); retryRecords.set(host, record); }
      render(host, type, { title: options.title || title, message: options.message || message, detail: options.showDetail ? (error?.message || '') : '', retry: !!retry, retryLabel: options.retryLabel || 'Try again' });
      if (retry) scheduleRetry(host, retry, type);
      return type;
    }
    function failUpload(target, error, options = {}) {
      const original = el(target);
      if (!original) return null;
      let host = original;
      // Message placeholders are often <p>/<span>; put the card in a valid sibling div.
      if (['P', 'SPAN', 'SMALL', 'LABEL'].includes(original.tagName)) {
        original.textContent = '';
        host = original.nextElementSibling?.matches('[data-fx-upload-state-slot]') ? original.nextElementSibling : null;
        if (!host) {
          host = document.createElement('div');
          host.dataset.fxUploadStateSlot = 'true';
          host.className = 'fx-upload-state-slot';
          original.insertAdjacentElement('afterend', host);
        }
      }
      const kind = classify(error);
      const retry = typeof options.retry === 'function' ? options.retry : null;
      if (retry) {
        const record = retryRecords.get(host) || { count: 0, timer: null, callback: retry, failed: true };
        record.callback = retry;
        record.failed = retryable(kind);
        retryRecords.set(host, record);
      }
      render(host, 'upload', {
        title: options.title || 'Upload could not be completed',
        message: options.message || (kind === 'permission' ? 'Frnxup could not save this file because access was denied. Check your account permissions and try again.' : kind === 'auth' ? 'Your sign-in may have expired. Sign in again, then retry the upload.' : kind === 'offline' ? copy.offline[1] : kind === 'slow' ? copy.slow[1] : kind === 'server' ? copy.server[1] : 'The file was not saved. Check your connection and file, then try again.'),
        detail: options.showDetail ? (error?.message || '') : '',
        retry: !!retry,
        retryLabel: options.retryLabel || 'Try upload again'
      });
      if (retry) scheduleRetry(host, retry, kind);
      return kind;
    }
    async function run(target, task, options = {}) {
      const host = el(target);
      if (!host || typeof task !== 'function') return;
      if (host.dataset.fxHasContent !== 'true') loading(host, options.loading || {});
      try {
        const result = await task();
        loaded(host);
        if (typeof options.render === 'function') await options.render(result, host);
        if (options.emptyWhen && options.emptyWhen(result)) empty(host, options.empty || {});
        return result;
      } catch (error) {
        fail(host, error, { ...options, retry: () => run(host, task, options) });
        return undefined;
      }
    }
    function showBanner(kind, message, duration = 0) {
      if (!document.body) return;
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'fx-connectivity-banner';
        banner.className = 'fx-connectivity-banner';
        banner.setAttribute('role', 'status');
        banner.setAttribute('aria-live', 'polite');
        document.body.prepend(banner);
      }
      banner.dataset.kind = kind;
      banner.textContent = message;
      banner.classList.add('is-visible');
      if (bannerTimer) clearTimeout(bannerTimer);
      if (duration) bannerTimer = setTimeout(() => banner?.classList.remove('is-visible'), duration);
    }
    function retryFailed() {
      retryRecords.forEach((record, host) => {
        if (!host.isConnected || !record.failed || typeof record.callback !== 'function') return;
        if (record.timer) clearTimeout(record.timer);
        record.timer = null;
        record.count = 0;
        Promise.resolve(record.callback({ automatic: true })).catch(() => {});
      });
    }
    function initConnectivity() {
      if (!document.body) return;
      if (navigator.onLine === false) showBanner('offline', 'You are offline. Frnxup will keep your loaded content and retry when you reconnect.');
      window.addEventListener('offline', () => {
        showBanner('offline', 'You are offline. Check your internet connection. Existing content is being kept.');
        retryRecords.forEach((record, host) => { if (host.isConnected && record.failed) render(host, 'offline', { preserve: host.dataset.fxHasContent === 'true', retry: true }); });
      });
      window.addEventListener('online', () => {
        showBanner('online', 'Connection restored. Refreshing sections that did not load…', 5000);
        retryFailed();
      });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initConnectivity, { once: true });
    else initConnectivity();
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-fx-state-retry]');
      if (!button) return;
      const host = button.closest('[data-fx-state]') || button.closest('[data-fx-state-card]')?.parentElement;
      if (!host) return;
      const record = retryRecords.get(host);
      if (!record?.callback) return;
      button.disabled = true;
      button.textContent = 'Trying…';
      record.count = 0;
      Promise.resolve(record.callback({ automatic: false })).finally(() => { if (button.isConnected) button.disabled = false; });
    });
    function showMediaFailure(media) {
      if (!(media instanceof HTMLImageElement || media instanceof HTMLVideoElement)) return;
      if (media.dataset.fxStateAsset || /\/Asset\/States\//.test(media.currentSrc || media.src || '')) return;
      if (media.dataset.fxMediaFailed === 'true') return;
      media.dataset.fxMediaFailed = 'true';
      const type = media instanceof HTMLVideoElement ? 'video' : 'image';
      const fallback = document.createElement('div');
      fallback.className = 'fx-media-fallback';
      fallback.innerHTML = stateMarkup(type, { compact: true });
      media.insertAdjacentElement('afterend', fallback);
      media.hidden = true;
    }
    document.addEventListener('error', event => showMediaFailure(event.target), true);
    // Catch media that failed before this shared listener was installed.
    const scanFailedMedia = () => document.querySelectorAll('img,video').forEach(media => {
      if (media instanceof HTMLImageElement && media.complete && media.naturalWidth === 0 && (media.currentSrc || media.src)) showMediaFailure(media);
      else if (media instanceof HTMLVideoElement && media.error) showMediaFailure(media);
    });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scanFailedMedia, { once: true });
    else scanFailedMedia();
    return { render, loading, empty, loaded, success, fail, failInline, failUpload, clearUpload, classify, run, banner: showBanner, retryFailed };
  })();
  window.FXStates = FXStates;
  FX.states = FXStates;
  // Upgrade ordinary form/status messages too: connection and access failures
  // become the same visual states, while validation feedback stays plain text.
  const baseSetMessage = FX.setMessage.bind(FX);
  FX.setMessage = function(target, message, kind = 'info') {
    const original = typeof target === 'string' ? document.querySelector(target) : target;
    const inlineTarget = original && ['P','SPAN','SMALL','LABEL'].includes(original.tagName);
    const value = String(message ?? '');
    const lower = value.toLowerCase();
    const successMessage = kind === 'success' || (!/\bnot\b|\bno\b|\bcould not\b|\bfailed\b|\berror\b/.test(lower) && /\b(saved|sent|updated|created|published|completed|approved|unblocked|removed|deleted|confirmed|uploaded|added)\b/.test(lower));
    const connectionFailure = kind === 'error' && /(offline|no internet|network|connection|failed to fetch|load failed|timeout|timed out|unavailable|permission denied|row-level security|forbidden|unauthorized|jwt|session.*expired|not authenticated|not found|server error|internal server)/.test(lower);
    if (inlineTarget && (successMessage || connectionFailure)) {
      baseSetMessage(target, value, kind);
      if (successMessage) {
        original.textContent = '';
        const host = original.nextElementSibling?.matches('[data-fx-upload-state-slot]') ? original.nextElementSibling : (() => { const node=document.createElement('div');node.dataset.fxUploadStateSlot='true';node.className='fx-upload-state-slot';original.insertAdjacentElement('afterend',node);return node; })();
        FXStates.success(host,{title:'Done',message:value,compact:true,duration:2800});
      } else {
        FXStates.failInline(original,new Error(value),{title:'This action could not be completed'});
      }
      return;
    }
    if (inlineTarget) FXStates.clearUpload(original);
    baseSetMessage(target, message, kind);
  };
  const fxStateStyles = document.createElement('link');
  fxStateStyles.rel = 'stylesheet';
  fxStateStyles.href = '/Css/content-states.css?v=20261123-1';
  document.head.appendChild(fxStateStyles);

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
        if (requiresAccountSession(location.pathname) && !FX._forcedAccessRedirect) location.replace(loginDestination());
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

    // Verify the authoritative profile status before revealing a protected page.
    // The database also enforces this status through restrictive RLS policies.
    await FX.loadProfile();
    if (!FX.user) return;
    if (window.__frnxupAuthGateTimer) clearTimeout(window.__frnxupAuthGateTimer);
    document.documentElement.classList.remove('fx-auth-pending');
    FX.trackActivity('page_view', 'page', location.pathname, {
      title: String(document.title || '').slice(0, 120)
    });

    // Re-check periodically so a member suspended while already online is signed
    // out promptly; RLS blocks their data access immediately after the DB change.
    if (!window.__FRNXUP_ACCOUNT_STATUS_MONITOR) {
      window.__FRNXUP_ACCOUNT_STATUS_MONITOR = setInterval(() => FX.verifyAccountStatus().catch(() => {}), 45000);
    }

    // Maintenance status is non-critical and must never delay first paint.
    Promise.resolve(FX.profile).then(() => {
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
