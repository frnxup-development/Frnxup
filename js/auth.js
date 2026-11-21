(() => {
  const $ = FX.qs;
  const nextPath = () => {
    const raw = new URLSearchParams(location.search).get('next') || '/index.html';
    try {
      const target = new URL(raw, location.origin);
      if (target.origin !== location.origin || !target.pathname.startsWith('/')) return '/index.html';
      if (target.pathname === '/Auth/index.html' || target.pathname.startsWith('/Auth/')) return '/index.html';
      return target.pathname + target.search + target.hash;
    } catch (_) { return '/index.html'; }
  };

  function show(tab) {
    ['login', 'signup', 'reset'].forEach(name => {
      const el = $('#' + name + '-box');
      if (el) el.hidden = name !== tab;
    });
    FX.qsa('[data-tab]').forEach(button => {
      button.className = 'button ' + (button.dataset.tab === tab ? 'primary' : 'secondary');
    });
  }
  FX.qsa('[data-tab]').forEach(button => button.addEventListener('click', () => show(button.dataset.tab)));

  $('#login').addEventListener('click', async () => {
    const identity = $('#identity').value.trim();
    const password = $('#password').value;
    if (!identity || password.length < 8) return FX.setMessage('#login-msg', 'Enter your account and password.');
    if (!FX.client) return FX.setMessage('#login-msg', 'Supabase is not configured. Check js/config.js.');

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
      try { await FX.client.rpc('frnxup_log_activity', {p_action:'sign_in',p_entity_type:'auth',p_entity_id:'/Auth/index.html',p_details:{method:identity.includes('@')?'email':'username'}}); } catch (_) {}
      location.replace(nextPath());
    } catch (error) {
      FX.setMessage('#login-msg', error.message || 'Unable to sign in.');
      button.disabled = false;
    }
  });

  $('#signup').addEventListener('click', async () => {
    await FX.loadSettings();
    if (FX.settings.registration_enabled === false) return FX.setMessage('#signup-msg', 'New account registration is temporarily disabled.');
    const username = $('#username').value.trim().replace(/^@/, '');
    const email = $('#signup-email').value.trim().toLowerCase();
    const password = $('#new-password').value;
    if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) return FX.setMessage('#signup-msg', 'Username must be 3–24 characters using letters, numbers or underscore.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return FX.setMessage('#signup-msg', 'Enter a valid email address.');
    if (password.length < 8) return FX.setMessage('#signup-msg', 'Password must contain at least 8 characters.');
    if (!FX.client) return FX.setMessage('#signup-msg', 'Connect Supabase first.');

    const button = $('#signup');
    button.disabled = true;
    try {
      const { data, error } = await FX.client.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: location.origin + '/Auth/confirmed.html',
          data: { username }
        }
      });
      if (error) throw error;
      if (data.session) {
        location.replace(nextPath());
        return;
      }
      FX.setMessage('#signup-msg', 'Account created. Check your email for the confirmation link. After confirming your email, return here to log in.');
    } catch (error) {
      FX.setMessage('#signup-msg', error.message || 'Unable to create the account.');
      button.disabled = false;
    }
  });

  $('#forgot').addEventListener('click', () => show('reset'));
  $('#reset-send').addEventListener('click', async () => {
    if (!FX.client) return FX.setMessage('#reset-msg', 'Connect Supabase first.');
    const email = $('#reset-email').value.trim();
    if (!email) return FX.setMessage('#reset-msg', 'Enter the email address associated with your account.');
    const { error } = await FX.client.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/Auth/reset-password.html' });
    FX.setMessage('#reset-msg', error ? error.message : 'If this email is registered, a password reset link has been sent.');
  });

  const hash = new URLSearchParams(location.hash.replace(/^#/, '&'));
  if (hash.get('type') === 'recovery') show('reset');
  else if (new URLSearchParams(location.search).get('tab') === 'signup') show('signup');
})();
