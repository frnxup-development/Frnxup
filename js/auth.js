(() => {
  // If core.js did not initialise, leave the form in place and let the small
  // inline guard in signup.html prevent a native page reload.
  if (!window.FX) {
    const message = document.querySelector('#signup-msg');
    if (message) {
      message.textContent = 'Frnxup could not start the registration service. Please reload this page.';
      message.dataset.kind = 'error';
    }
    return;
  }

  const FX = window.FX;
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
    try {
      const destination = new URL(anchor.getAttribute('href'), location.href);
      destination.searchParams.set('next', requestedNext);
      anchor.href = destination.pathname + destination.search + destination.hash;
    } catch (_) {}
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

  const setMessage = (selector, message, kind = 'info') => {
    if (typeof FX.setMessage === 'function') FX.setMessage(selector, message, kind);
    else {
      const element = $(selector);
      if (element) {
        element.textContent = message;
        element.dataset.kind = kind;
      }
    }
  };

  const accountStatusFromUrl = new URLSearchParams(location.search).get('accountStatus');
  if (accountStatusFromUrl === 'banned' || accountStatusFromUrl === 'suspended') {
    try {
      sessionStorage.setItem('frnxup_restricted_status', accountStatusFromUrl);
      sessionStorage.removeItem('frnxup_appeal_ticket');
    } catch (_) {}
    location.replace(`/Auth/restricted.html?status=${encodeURIComponent(accountStatusFromUrl)}`);
  }
  if (new URLSearchParams(location.search).get('appealSubmitted') === '1') {
    setMessage('#login-msg', 'Your account appeal was submitted securely. The Frnxup team will review it. You will be contacted through your verified email.', 'success');
  }

  const readableSignupError = (error) => {
    const message = String(error?.message || error || '').trim();
    const lower = `${error?.code || ''} ${message}`.toLowerCase();

    if (lower.includes('permanently banned from frnxup') || lower.includes('banned_account_identities') || lower.includes('account permanently banned')) {
      return 'This email, phone number or username is associated with an account permanently banned from Frnxup. Contact frnxup support at frnxup@gmail.com.';
    }
    if (lower.includes('frnxup registration is temporarily disabled') || lower.includes('registration is temporarily disabled')) {
      return 'New account registration is temporarily disabled by Frnxup administrators.';
    }
    if (lower.includes('user already registered') || lower.includes('already been registered') || lower.includes('email_exists')) {
      return 'This email may already have a Frnxup account. Try logging in or use Forgot password.';
    }
    if (lower.includes('password') && (lower.includes('weak') || lower.includes('short') || lower.includes('at least'))) {
      return 'Please choose a stronger password that meets the password requirements.';
    }
    if (lower.includes('invalid email') || lower.includes('email address')) {
      return 'Please check that your email address is valid.';
    }
    if (lower.includes('rate limit') || lower.includes('too many requests') || lower.includes('email_send_rate_limit')) {
      return 'Too many registration or confirmation emails were requested. Please wait a little and try again.';
    }
    if (lower.includes('failed to fetch') || lower.includes('network') || lower.includes('load failed') || lower.includes('connection')) {
      return 'A network problem interrupted registration. Your entries are still here. Check your connection and try again.';
    }
    if (lower.includes('frnxup_signup_timeout')) {
      return 'Frnxup has not received a response yet. Your entries are still here. Check your email or try logging in before submitting again.';
    }
    if (lower.includes('database error saving new user') || lower.includes('error creating user') || lower.includes('trigger')) {
      return 'Frnxup could not register this account. The email, phone number or username may be blocked by an account safety restriction, or the signup service may be temporarily unavailable. Contact Frnxup support at frnxup@gmail.com if you believe this is a mistake.';
    }
    if (message) return message.slice(0, 240);
    return 'Unable to create your account. Your entries are still here; please try again.';
  };

  const waitForSignup = (promise, milliseconds) => new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const timeout = new Error('FRNXUP_SIGNUP_TIMEOUT');
      timeout.code = 'FRNXUP_SIGNUP_TIMEOUT';
      resolve({ timeout, value: null });
    }, milliseconds);

    Promise.resolve(promise).then((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ value, timeout: null });
    }, (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ error, timeout: null });
    });
  });

  // Avoid creating duplicate accounts if a previous mobile-network request is
  // still being processed after the visible request timed out.
  let pendingSignupRequest = null;
  const signupForm = $('#signup-form');
  if (signupForm) {
    signupForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      if (pendingSignupRequest) {
        setMessage('#signup-msg', 'Your previous registration request is still processing. Please check your email or try logging in before submitting again.', 'info');
        return;
      }

      const usernameField = $('#username');
      const emailField = $('#signup-email');
      const passwordField = $('#new-password');
      const button = $('#signup');
      const username = (usernameField?.value || '').trim().replace(/^@/, '').toLowerCase();
      const email = (emailField?.value || '').trim().toLowerCase();
      const password = passwordField?.value || '';

      // Validate before disabling the button or making any network request.
      if (!/^[a-z0-9_]{3,24}$/.test(username)) {
        setMessage('#signup-msg', 'Username must be 3–24 characters using letters, numbers or underscore.', 'error');
        usernameField?.focus();
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
        setMessage('#signup-msg', 'Enter a valid email address.', 'error');
        emailField?.focus();
        return;
      }
      if (password.length < 8) {
        setMessage('#signup-msg', 'Password must contain at least 8 characters.', 'error');
        passwordField?.focus();
        return;
      }
      if (!FX.client) {
        setMessage('#signup-msg', 'The registration service is unavailable. Please reload the page and try again.', 'error');
        return;
      }
      if (navigator.onLine === false) {
        setMessage('#signup-msg', 'Your device appears to be offline. Connect to the internet and try again. Your entries will remain here.', 'error');
        return;
      }

      saveRememberChoice();
      const originalLabel = button?.textContent || 'Create account';
      if (button) {
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.textContent = 'Creating account…';
      }
      setMessage('#signup-msg', 'Creating your Frnxup account…', 'info');

      try {
        const confirmationUrl = new URL('/Auth/confirmed.html', location.origin);
        confirmationUrl.searchParams.set('next', nextPath());

        // The database trigger is the authoritative guard for registration_enabled
        // and maintenance mode. Avoid a separate site_settings request here; it
        // adds mobile latency and can fail independently of account creation.
        const signupRequest = FX.client.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: confirmationUrl.toString(),
            data: { username }
          }
        });
        pendingSignupRequest = signupRequest;
        signupRequest.finally(() => {
          if (pendingSignupRequest === signupRequest) pendingSignupRequest = null;
        }).catch(() => {});

        const outcome = await waitForSignup(signupRequest, 30000);
        if (outcome.timeout) throw outcome.timeout;
        if (outcome.error) throw outcome.error;

        const { data, error } = outcome.value || {};
        if (error) throw error;
        if (!data?.user) throw new Error('Frnxup did not return a new account record. Please try again.');

        // Supabase can return an empty identities array for an email that is
        // already registered, rather than returning an explicit error.
        if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          setMessage('#signup-msg', 'This email may already have a Frnxup account. Try logging in or use Forgot password.', 'error');
          return;
        }

        if (data.session) {
          setMessage('#signup-msg', 'Your account is ready. Opening Frnxup…', 'success');
          location.replace(nextPath());
          return;
        }

        setMessage('#signup-msg', `Account created. Check ${email} for the confirmation email, then return here to log in.`, 'success');
      } catch (error) {
        setMessage('#signup-msg', readableSignupError(error), 'error');
      } finally {
        if (button) {
          button.disabled = false;
          button.removeAttribute('aria-busy');
          button.textContent = originalLabel;
        }
        // Do not clear username, email, password, or other fields on an error.
      }
    });

    // This flag is set only after a working submit handler has been attached.
    window.__FRNXUP_SIGNUP_HANDLER_READY = true;
    window.dispatchEvent(new Event('frnxup-signup-handler-ready'));
  }

  // A member who is already signed in does not need to see the access forms.
  if (accountStatusFromUrl !== 'banned' && accountStatusFromUrl !== 'suspended' && ($('#login-form') || signupForm)) {
    if (typeof FX.loadUser === 'function') {
      FX.loadUser().then(user => {
        if (user) location.replace(nextPath());
      }).catch(() => {});
    }
  }

  // Restricted accounts are redirected to a dedicated static screen only
  // after the server verifies their password and current account status.
  const loginForm = $('#login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      try { sessionStorage.removeItem('frnxup_appeal_ticket'); sessionStorage.removeItem('frnxup_restricted_status'); } catch (_) {}
      const identity = ($('#identity')?.value || '').trim();
      const password = $('#password')?.value || '';
      if (!identity || !password) return setMessage('#login-msg', 'Enter your email or username and password.', 'error');
      if (!FX.client) return setMessage('#login-msg', 'Supabase is not configured. Check js/config.js.', 'error');
      if (navigator.onLine === false) return setMessage('#login-msg', 'You appear to be offline. Connect to the internet and try again.', 'error');
      saveRememberChoice();

      const button = $('#login');
      const originalLabel = button?.textContent || 'Log in securely';
      if (button) {
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.textContent = 'Checking account…';
      }
      try {
        const data = await FX.invoke('username-login', {
          identifier: identity,
          username: identity,
          password
        });

        if (data?.restricted && data?.appeal_ticket && ['suspended', 'banned'].includes(data.account_status)) {
          await FX.client.auth.signOut().catch(() => {});
          try {
            sessionStorage.setItem('frnxup_appeal_ticket', data.appeal_ticket);
            sessionStorage.setItem('frnxup_restricted_status', data.account_status);
          } catch (_) {
            throw new Error('Your browser could not securely open the account restriction page. Enable site storage and try again.');
          }
          location.replace(`/Auth/restricted.html?status=${encodeURIComponent(data.account_status)}`);
          return;
        }
        if (!data?.access_token || !data?.refresh_token) {
          throw new Error(data?.error || 'Frnxup could not complete sign-in. Please check your details and try again.');
        }

        const { error: sessionError } = await FX.client.auth.setSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token
        });
        if (sessionError) throw sessionError;

        const { data: current, error: userError } = await FX.client.auth.getUser();
        if (userError || !current?.user) throw userError || new Error('Your sign-in could not be confirmed. Please try again.');
        const { data: accountProfile, error: statusError } = await FX.client
          .from('profiles').select('account_status').eq('id', current.user.id).maybeSingle();
        if (statusError || !accountProfile) {
          await FX.client.auth.signOut();
          throw new Error('Frnxup could not verify this account status. Please check your connection and try again.');
        }
        if (accountProfile.account_status !== 'active') {
          await FX.client.auth.signOut();
          throw new Error('Frnxup could not complete this sign-in because the account status changed. Please try again.');
        }
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
        setMessage('#login-msg', error?.message || 'Unable to sign in. Please try again.', 'error');
      } finally {
        if (button) {
          button.disabled = false;
          button.removeAttribute('aria-busy');
          button.textContent = originalLabel;
        }
      }
    });
  }
})();
