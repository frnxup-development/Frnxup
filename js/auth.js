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

  // Enrolled phone/authenticator factors are required before a member is
  // allowed to continue from an AAL1 session to the Frnxup member area.
  let loginMfaPromise = null;
  async function runLoginMfaGate() {
    if (!FX.client?.auth?.mfa) return false;
    const { data: aal, error: aalError } = await FX.client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalError) {
      // Phone security is opt-in. Projects that have not enabled Supabase MFA,
      // and accounts without a verified factor, must retain ordinary password login.
      // If a verified factor can be positively identified despite the AAL lookup
      // failure, stop with a clear message rather than silently skipping it.
      try {
        const { data: fallbackFactors, error: fallbackError } = await FX.client.auth.mfa.listFactors();
        const enrolled = !fallbackError && [
          ...(fallbackFactors?.phone || []), ...(fallbackFactors?.totp || [])
        ].some((factor) => factor.status === 'verified');
        if (enrolled) throw new Error('Your additional security factor is enrolled, but Frnxup could not check its status. Please try again shortly.');
      } catch (factorLookupError) {
        if (factorLookupError instanceof Error && factorLookupError.message.startsWith('Your additional security factor')) throw factorLookupError;
        // An unavailable MFA endpoint is not a reason to lock out an account
        // that has not enabled optional phone security.
      }
      return false;
    }
    if (aal?.currentLevel === 'aal2' || aal?.nextLevel !== 'aal2') return false;
    if (loginMfaPromise) return loginMfaPromise;

    const { data: factorData, error: factorError } = await FX.client.auth.mfa.listFactors();
    if (factorError) throw new Error('Frnxup needs to check your enrolled second factor, but the security service is temporarily unavailable. Please try again.');
    const factors = [
      ...(factorData?.phone || []).filter((factor) => factor.status === 'verified'),
      ...(factorData?.totp || []).filter((factor) => factor.status === 'verified')
    ];
    // AAL can briefly be stale after a user removes a factor. No verified factor
    // means MFA is not opted in, so continue with the normal login flow.
    if (!factors.length) return false;

    const loginForm = $('#login-form');
    let panel = $('#login-mfa-panel');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'login-mfa-panel';
      panel.className = 'card';
      panel.style.cssText = 'padding:18px;margin-top:14px';
      panel.innerHTML = `
        <div class="auth-heading"><span class="auth-eyebrow">SECOND-STEP VERIFICATION</span><h2 style="font-size:22px">Verify it is you</h2><p id="login-mfa-description">Enter the code sent to your verified phone.</p></div>
        <div class="field" id="login-mfa-factor-wrap"><label for="login-mfa-factor">Verification method</label><select id="login-mfa-factor"></select></div>
        <div class="field" id="login-mfa-channel-wrap"><label for="login-mfa-channel">Send code using</label><select id="login-mfa-channel"><option value="whatsapp">WhatsApp (recommended)</option><option value="sms">SMS</option></select></div>
        <div class="field"><label for="login-mfa-code">6-digit code</label><input id="login-mfa-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="000000"></div>
        <button class="button primary full" id="login-mfa-verify" type="button">Verify and continue</button>
        <button class="button subtle full" id="login-mfa-resend" type="button" style="margin-top:8px">Send code again</button>
        <p id="login-mfa-msg" class="status-line" aria-live="polite"></p>
        <button class="plain-link" id="login-mfa-signout" type="button">Sign out</button>`;
      loginForm?.insertAdjacentElement('afterend', panel);
      const factorSelect = panel.querySelector('#login-mfa-factor');
      factors.forEach((factor, index) => {
        const option = document.createElement('option');
        option.value = factor.id;
        option.textContent = factor.factor_type === 'phone' ? `Phone ${String(factor.phone || '').replace(/(\+?\d{2,4})\d+(\d{2})$/, '$1••••$2')}` : `Authenticator app ${index + 1}`;
        option.dataset.type = factor.factor_type;
        factorSelect.appendChild(option);
      });
    }

    if (loginForm) loginForm.hidden = true;
    panel.hidden = false;
    const factorSelect = panel.querySelector('#login-mfa-factor');
    const channelWrap = panel.querySelector('#login-mfa-channel-wrap');
    const channelSelect = panel.querySelector('#login-mfa-channel');
    const description = panel.querySelector('#login-mfa-description');
    const msg = panel.querySelector('#login-mfa-msg');
    const codeInput = panel.querySelector('#login-mfa-code');
    const verifyButton = panel.querySelector('#login-mfa-verify');
    const resendButton = panel.querySelector('#login-mfa-resend');
    const selectedFactor = () => factors.find((factor) => factor.id === factorSelect.value) || factors[0];
    const updateMethod = () => {
      const factor = selectedFactor();
      const isPhone = factor.factor_type === 'phone';
      channelWrap.hidden = !isPhone;
      description.textContent = isPhone ? `A 6-digit code will be sent to ${String(factor.phone || 'your verified phone').replace(/(\+?\d{2,4})\d+(\d{2})$/, '$1••••$2')}.` : 'Open your authenticator app and enter the current 6-digit code.';
      msg.textContent = '';
    };
    factorSelect.onchange = updateMethod;
    updateMethod();

    loginMfaPromise = new Promise((resolve, reject) => {
      let challengeId = null;
      let busy = false;
      const send = async () => {
        if (busy) return;
        busy = true;
        resendButton.disabled = true;
        try {
          const factor = selectedFactor();
          const options = { factorId: factor.id };
          if (factor.factor_type === 'phone') options.channel = channelSelect.value || 'whatsapp';
          const { data, error } = await FX.client.auth.mfa.challenge(options);
          if (error) throw error;
          challengeId = data.id;
          msg.textContent = factor.factor_type === 'phone'
            ? `Code sent using ${channelSelect.value === 'whatsapp' ? 'WhatsApp' : 'SMS'}. Check your phone.`
            : 'Open your authenticator app and enter the current code.';
          msg.dataset.kind = 'success';
        } catch (error) {
          msg.textContent = error?.message || 'Could not send a verification code. Try SMS or contact support.';
          msg.dataset.kind = 'error';
        } finally {
          busy = false;
          resendButton.disabled = false;
        }
      };
      resendButton.onclick = send;
      verifyButton.onclick = async () => {
        const code = codeInput.value.trim();
        if (!/^\d{6}$/.test(code)) { msg.textContent = 'Enter the 6-digit verification code.'; msg.dataset.kind = 'error'; return; }
        if (!challengeId) { msg.textContent = 'Send a verification code first.'; msg.dataset.kind = 'error'; return; }
        if (busy) return;
        busy = true;
        verifyButton.disabled = true;
        try {
          const factor = selectedFactor();
          const { error } = await FX.client.auth.mfa.verify({ factorId: factor.id, challengeId, code });
          if (error) throw error;
          const { data: verifiedAal, error: verifiedAalError } = await FX.client.auth.mfa.getAuthenticatorAssuranceLevel();
          if (verifiedAalError) throw verifiedAalError;
          if (verifiedAal?.currentLevel !== 'aal2') throw new Error('Frnxup could not confirm the second verification step. Please try again.');
          panel.hidden = true;
          if (loginForm) loginForm.hidden = false;
          resolve(true);
        } catch (error) {
          msg.textContent = error?.message || 'The code is incorrect or expired. Try again.';
          msg.dataset.kind = 'error';
        } finally {
          busy = false;
          verifyButton.disabled = false;
        }
      };
      panel.querySelector('#login-mfa-signout').onclick = async () => {
        await FX.client.auth.signOut({ scope: 'local' });
        location.replace('/Auth/index.html');
      };
      if (factors.length === 1) factorSelect.disabled = true;
      // Start with WhatsApp for phone factors; members can switch to SMS if needed.
      if (selectedFactor().factor_type === 'phone') send();
      else msg.textContent = 'Enter the code from your authenticator app.';
    }).finally(() => { loginMfaPromise = null; });
    return loginMfaPromise;
  }

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
      FX.loadUser().then(async (user) => {
        if (!user) return;
        try {
          if ($('#login-form')) {
            await runLoginMfaGate();
          } else if (FX.client?.auth?.mfa) {
            const { data: aal, error: aalError } = await FX.client.auth.mfa.getAuthenticatorAssuranceLevel();
            if (aalError) throw aalError;
            if (aal?.nextLevel === 'aal2' && aal?.currentLevel !== 'aal2') {
              location.replace(`/Auth/index.html?next=${encodeURIComponent(nextPath())}`);
              return;
            }
          }
          await FX.loadProfile();
          location.replace(nextPath());
        } catch (error) {
          setMessage('#login-msg', error?.message || 'Frnxup could not verify your second security factor.', 'error');
        }
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

        // Complete MFA before reading profiles: the opt-in RLS policy blocks
        // AAL1 reads for accounts that have a verified second factor.
        await runLoginMfaGate();
        const { data: current, error: userError } = await FX.client.auth.getUser();
        if (userError || !current?.user) throw userError || new Error('Your sign-in could not be confirmed. Please try again.');
        const { data: accountProfile, error: statusError } = await FX.client
          .from('profiles').select('account_status').eq('id', current.user.id).maybeSingle();
        if (statusError) {
          const diagnostic = statusError.code ? ` (code: ${statusError.code})` : '';
          throw new Error(`Your password was accepted, but Frnxup could not verify your account status${diagnostic}. Please try again. If this continues, contact frnxup@gmail.com.`);
        }
        if (!accountProfile) {
          await FX.client.auth.signOut();
          throw new Error('Frnxup could not find the account profile linked to this login. Contact frnxup@gmail.com for help.');
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
