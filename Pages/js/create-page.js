(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const text = value => String(value ?? '').trim();

  function showMessage(message, kind = 'info', diagnostic = '') {
    const host = byId('create-page-message');
    const extra = byId('create-page-diagnostic');
    if (host) {
      host.textContent = message;
      host.classList.remove('is-error', 'is-success', 'is-info');
      host.classList.add(kind === 'error' ? 'is-error' : kind === 'success' ? 'is-success' : 'is-info');
    }
    if (extra) {
      extra.hidden = !diagnostic;
      extra.textContent = diagnostic;
    }
  }

  function errorDetails(error) {
    if (!error) return 'No error details were returned.';
    const parts = [];
    if (error.code) parts.push(`Code: ${error.code}`);
    if (error.message) parts.push(error.message);
    if (error.details) parts.push(`Details: ${error.details}`);
    if (error.hint) parts.push(`Hint: ${error.hint}`);
    return parts.join(' · ') || String(error);
  }

  function friendlyError(error) {
    const code = String(error?.code || '');
    const message = String(error?.message || '');
    if (code === '23505') return 'That Page link is already in use. Change the personalized link and try again.';
    if (code === '42501' || /row-level security|permission denied/i.test(message)) {
      return 'Supabase blocked Page creation. Run the included Pages database repair SQL, then try again.';
    }
    if (code === '23514') return 'Some Page details do not meet the database requirements. Check the name, category and link.';
    if (code === '42P01' || /relation .* does not exist/i.test(message)) return 'The Pages database table is missing. Run the included Pages database repair SQL.';
    if (/Invalid API key|JWT|not authenticated|session/i.test(message)) return 'Your sign-in session could not be verified. Sign in again, then retry. Your form entries are still here.';
    if (/Failed to fetch|NetworkError|fetch failed/i.test(message)) return 'Frnxup could not reach Supabase. Check your internet connection and try again. Your form entries are still here.';
    return message || 'Your Page could not be created. Your form entries are still here.';
  }

  function setBusy(button, busy) {
    button.disabled = busy;
    button.setAttribute('aria-busy', busy ? 'true' : 'false');
    button.textContent = busy ? 'Creating…' : 'Create Page';
  }

  function wireSlug(nameInput, slugInput) {
    nameInput.addEventListener('input', () => {
      if (slugInput.dataset.userEdited === 'true') return;
      slugInput.value = nameInput.value
        .toLowerCase()
        .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
    });
    slugInput.addEventListener('input', () => {
      slugInput.dataset.userEdited = 'true';
      slugInput.value = slugInput.value.toLowerCase()
        .replace(/[^a-z0-9-]/g, '').replace(/-{2,}/g, '-')
        .slice(0, 40);
    });
  }

  async function createPage(button) {
    const nameInput = byId('new-page-name');
    const slugInput = byId('new-page-slug');
    const categoryInput = byId('new-page-category');
    const aboutInput = byId('new-page-about');
    const name = text(nameInput?.value);
    const slug = text(slugInput?.value).toLowerCase();
    const category = text(categoryInput?.value) || 'Other';
    const about = text(aboutInput?.value);

    // Client validation gives immediate feedback without triggering form navigation.
    if (name.length < 2 || name.length > 80) {
      showMessage('Page name must contain between 2 and 80 characters.', 'error');
      nameInput?.focus();
      return;
    }
    if (!/^[a-z0-9-]{3,40}$/.test(slug)) {
      showMessage('Page link must contain 3–40 lowercase letters, numbers or hyphens.', 'error');
      slugInput?.focus();
      return;
    }
    if (category.length > 80 || about.length > 3000) {
      showMessage('Category must be 80 characters or fewer and description 3,000 characters or fewer.', 'error');
      return;
    }

    if (!window.FX?.client) {
      showMessage('Frnxup is not connected to Supabase. Check /js/config.js and reload the page.', 'error');
      return;
    }

    setBusy(button, true);
    showMessage('Checking your sign-in and saving your Page…');

    try {
      // Use the existing authenticated Supabase client and the established table.
      // No custom RPC function or client-supplied owner identity is required.
      const { data: sessionResult, error: sessionError } = await FX.client.auth.getSession();
      if (sessionError) throw sessionError;
      const user = sessionResult?.session?.user;
      if (!user?.id) {
        FX.showAuthNotice('Sign in to create and manage your Pages.');
        throw new Error('You are signed out. Sign in and return to this form; your entries will remain here.');
      }

      const payload = {
        owner_user_id: user.id,
        name,
        slug,
        category,
        about,
        status: 'active'
      };

      const { data, error } = await FX.client
        .from('frnxup_pages')
        .insert(payload)
        .select('id,slug,name')
        .single();
      if (error) throw error;

      let pageId = data?.id;
      // Defensive confirmation in case the API response shape is changed by a proxy.
      if (!pageId) {
        const confirmResult = await FX.client.from('frnxup_pages')
          .select('id,slug').eq('owner_user_id', user.id).eq('slug', slug).maybeSingle();
        if (confirmResult.error) throw confirmResult.error;
        pageId = confirmResult.data?.id;
      }
      if (!pageId) throw new Error('Supabase did not return a saved Page ID. No redirect was made; check Your Pages before retrying.');

      try { FX.setActivePage(pageId); } catch (_) {}
      showMessage('Your Page was created successfully. Opening its dashboard…', 'success');
      button.textContent = 'Created';
      // Redirect only after the database confirms a persisted row.
      window.location.assign(`/Pages/dashboard.html?id=${encodeURIComponent(pageId)}`);
    } catch (error) {
      showMessage(friendlyError(error), 'error', errorDetails(error));
      setBusy(button, false);
      try { FX.toast(friendlyError(error)); } catch (_) {}
    }
  }

  function init() {
    const button = byId('create-page-submit');
    const form = byId('create-page-form');
    const nameInput = byId('new-page-name');
    const slugInput = byId('new-page-slug');
    if (!button || !form || !nameInput || !slugInput) return;

    // Belt-and-braces: prevent any accidental native form submission.
    form.addEventListener('submit', event => {
      event.preventDefault();
      event.stopPropagation();
      showMessage('Use the Create Page button to save this Page.', 'info');
    }, true);
    button.addEventListener('click', () => createPage(button));
    wireSlug(nameInput, slugInput);

    if (!window.FX?.client) {
      showMessage('Frnxup could not connect to Supabase. Confirm that /js/config.js is configured.', 'error');
    } else {
      showMessage('Complete the details above, then select Create Page.', 'info');
    }
  }

  window.addEventListener('error', event => {
    if (byId('create-page-form')) {
      showMessage('The Create Page script encountered an error. Refresh the page; your form entries have not been submitted.', 'error', event.message || 'Page script error');
    }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
