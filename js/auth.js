(() => {
  const $ = FX.qs;

  // Keep the original destination through the login <-> sign-up navigation.
  const requestedNext = new URLSearchParams(location.search).get('next');
  const nextPath = () => {
    const raw = requestedNext || '/index.html';
    try {
      const target = new URL(raw, location.origin);
      if (target.origin !== location.origin || !target.pathname.startsWith('/')) return '/index.html';
      if (target.pathname === '/Auth/index.html' || target.pathname.startsWith('/Auth/')) return '/index.html';
      if (target.pathname === '/Admin' || target.pathname.startsWith('/Admin/')) return '/index.html';
      return target.pathname + target.search + target.hash;
    } catch (_) { return '/index.html'; }
  };

  const carryNext = (anchor) => {
    if (!anchor || !requestedNext) return;
    const destination = new URL(anchor.getAttribute('href'), location.href);
    destination.searchParams.set('next', requestedNext);
    anchor.href = destination.pathname + destination.search + destination.hash;
  };
  carryNext($('#switch-to-signup'));
  carryNext($('#switch-to-login'));

  const rememberDevice = $('#remember-device');
  if (rememberDevice && typeof FX.getRememberDevice === 'function') {
    rememberDevice.checked = FX.getRememberDevice();
  }
  const saveRememberChoice = () => {
    if (typeof FX.setRememberDevice === 'function') {
      FX.setRememberDevice(!!rememberDevice?.checked);
    }
  };

  // A member who is already signed in does not need to see the access forms.
  if ($('#login-form') || $('#signup-form')) {
    FX.loadUser().then(user => {
      if (user) location.replace(nextPath());
    }).catch(() => {});
  }

  const setError = (selector, error, fallback) => {
    FX.setMessage(selector, error?.message || fallback, 'error');
  };

  // Login page: supports email/password and the existing username-login function.
  const loginForm = $('#login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const identity = ($('#identity')?.value || '').trim();
      const password = $('#password')?.value || '';
      if (!identity || !password) return FX.setMessage('#login-msg', 'Enter your email or username and password.', 'error');
      if (!FX.client) return FX.setMessage('#login-msg', 'Supabase is not configured. Check js/config.js.', 'error');
      saveRememberChoice();

      const button = $('#login');
      button.disabled = true;
      try {
        let result;
        if (identity.includes('@')) {
          result = await FX.client.auth.signInWithPassword({ email: identity, password });
        } else {
          const data = await FX.invoke('username-login', { username: identity.replace(/^@/, ''), password });
          result = await FX.client.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
        }
        if (result.error) throw result.error;
        const { data: current, error } = await FX.client.auth.getUser();
        if (error) throw error;
        if (!current.user) throw new Error('Your sign-in could not be confirmed. Please try again.');
        try {
          await FX.client.rpc('frnxup_log_activity', {
            p_action: 'sign_in',
            p_entity_type: 'auth',
            p_entity_id: '/Auth/index.html',
            p_details: { method: identity.includes('@') ? 'email' : 'username' }
          });
        } catch (_) {}
        location.replace(nextPath());
      } catch (error) {
        setError('#login-msg', error, 'Unable to sign in. Please try again.');
        button.disabled = false;
      }
    });
  }

  // Sign-up page: registration is kept separate from the login page.
  const signupForm = $('#signup-form');
  if (signupForm) {
    signupForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!FX.client) return FX.setMessage('#signup-msg', 'Supabase is not configured. Check js/config.js.', 'error');

      const button = $('#signup');
      button.disabled = true;
      try {
        await FX.loadSettings();
        if (FX.settings.registration_enabled === false) {
          FX.setMessage('#signup-msg', 'New account registration is temporarily disabled.', 'error');
          button.disabled = false;
          return;
        }

        saveRememberChoice();
        const username = ($('#username')?.value || '').trim().replace(/^@/, '');
        const email = ($('#signup-email')?.value || '').trim().toLowerCase();
        const password = $('#new-password')?.value || '';
        if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) {
          FX.setMessage('#signup-msg', 'Username must be 3–24 characters using letters, numbers or underscore.', 'error');
          button.disabled = false;
          return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          FX.setMessage('#signup-msg', 'Enter a valid email address.', 'error');
          button.disabled = false;
          return;
        }
        if (password.length < 8) {
          FX.setMessage('#signup-msg', 'Password must contain at least 8 characters.', 'error');
          button.disabled = false;
          return;
        }

        const confirmationUrl = new URL('/Auth/confirmed.html', location.origin);
        confirmationUrl.searchParams.set('next', nextPath());
        const { data, error } = await FX.client.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: confirmationUrl.toString(),
            data: { username }
          }
        });
        if (error) throw error;

        if (data.session) {
          location.replace(nextPath());
          return;
        }
        FX.setMessage('#signup-msg', 'Account created. Check your email and confirm your address. Then return to the login page to sign in.', 'success');
        button.disabled = false;
      } catch (error) {
        setError('#signup-msg', error, 'Unable to create the account. Please try again.');
        button.disabled = false;
      }
    });
  }
})();
