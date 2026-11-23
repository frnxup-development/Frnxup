(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = value => FX.esc(value);
  const pageUrl = page => `${location.origin}/Pages/view.html?slug=${encodeURIComponent(page.slug)}`;
  const loadingTimeoutMs = 15000;

  function withTimeout(promise, label = 'The request') {
    let timer;
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} is taking too long. Check your connection and try again.`)), loadingTimeoutMs);
      })
    ]).finally(() => clearTimeout(timer));
  }

  function showError(host, error, retry) {
    if (!host) return;
    FXStates.fail(host, typeof error === 'string' ? new Error(error) : error, { retry, title: 'Could not load this Pages section' });
  }

  async function requireMember() {
    if (!FX.client) throw new Error('Frnxup is not connected to Supabase. Check the site configuration.');
    const user = await withTimeout(FX.loadUser(), 'Signing in');
    if (!user) {
      FX.showAuthNotice('Sign in to create and manage your Pages.');
      throw new Error('Please sign in to continue.');
    }
    return user;
  }

  async function getFollowerCount(page) {
    if (page.follower_count_visible === false && page.owner_user_id !== FX.user?.id) return null;
    try {
      const { data, error } = await withTimeout(FX.client.rpc('frnxup_page_follower_count', { p_page_id: page.id }), 'Loading follower count');
      return error ? null : Number(data || 0);
    } catch (_) { return null; }
  }

  async function buildPageCard(page, mode) {
    const [avatar, cover, count] = await Promise.all([
      page.avatar_path ? FX.mediaUrl(page.avatar_path) : Promise.resolve(''),
      page.cover_path ? FX.mediaUrl(page.cover_path) : Promise.resolve(''),
      getFollowerCount(page)
    ]);
    const avatarMarkup = avatar ? `<img src="${esc(avatar)}" alt="${esc(page.name)} profile picture" loading="lazy">` : `<span>${esc((page.name || 'F').slice(0, 1).toUpperCase())}</span>`;
    const countText = count === null ? 'Follower count hidden' : `${count.toLocaleString()} followers`;
    const coverStyle = cover ? `style="background-image:url('${esc(cover)}')"` : '';
    let actions = '';
    if (mode === 'owned') {
      actions = `<div class="page-mini-actions"><button class="page-switch" type="button" data-switch-page="${esc(page.id)}">Switch to Page</button><a class="page-manage" href="/Pages/dashboard.html?id=${encodeURIComponent(page.id)}">Manage Page</a><a class="page-open-public" href="${esc(pageUrl(page))}">View public Page</a></div>`;
    } else {
      actions = `<div class="page-mini-actions"><a class="page-switch" href="${esc(pageUrl(page))}">Open Page</a><button class="page-manage" type="button" data-unfollow-page="${esc(page.id)}">Unfollow</button></div>`;
    }
    return `<article class="page-mini-card"><div class="page-mini-cover" ${coverStyle}></div><div class="page-mini-body"><div class="page-avatar">${avatarMarkup}</div><div class="page-mini-copy"><b>${esc(page.name)}</b><small>${esc(page.category || 'Frnxup Page')} · ${countText}</small></div></div>${actions}</article>`;
  }

  async function renderOwnedPages() {
    const host = $('#owned-pages');
    if (!host) return;
    if (host.dataset.fxHasContent !== 'true') FXStates.loading(host, { title: 'Loading your Pages', message: 'Checking Pages you own.' });
    try {
      await requireMember();
      const result = await withTimeout(FX.client.from('frnxup_pages').select('*').eq('owner_user_id', FX.user.id).neq('status', 'removed').order('created_at', { ascending: false }), 'Loading your Pages');
      if (result.error) throw result.error;
      const pages = result.data || [];
      if (!pages.length) { FXStates.empty(host, { title: 'You have not created a Page yet', message: 'Create a public identity for your brand, business or community.' }); return; }
      host.innerHTML = (await Promise.all(pages.map(page => buildPageCard(page, 'owned')))).join('');FXStates.loaded(host);
      host.querySelectorAll('[data-switch-page]').forEach(button => button.addEventListener('click', () => {
        FX.setActivePage(button.dataset.switchPage);
        location.href = `/Pages/dashboard.html?id=${encodeURIComponent(button.dataset.switchPage)}`;
      }));
    } catch (error) {
      showError(host, error, renderOwnedPages);
    }
  }

  async function renderInvitations() {
    const host = $('#page-invitations');
    if (!host) return;
    if (host.dataset.fxHasContent !== 'true') FXStates.loading(host, { title: 'Loading Page invitations', message: 'Checking invitations sent to your account.' });
    try {
      await requireMember();
      const { data, error } = await withTimeout(FX.client.from('frnxup_page_invitations')
        .select('id,status,created_at,page:frnxup_pages!frnxup_page_invitations_page_id_fkey(id,name,slug,category,avatar_path,cover_path,owner_user_id,follower_count_visible)')
        .eq('invited_user_id', FX.user.id).eq('status', 'pending').order('created_at', { ascending: false }), 'Loading invitations');
      if (error) throw error;
      if (!data?.length) { FXStates.empty(host, { title: 'No pending invitations', message: 'When someone invites you to follow their Page, it will appear here.' }); return; }
      const cards = await Promise.all(data.map(async invite => {
        const page = invite.page || {};
        const avatar = page.avatar_path ? await FX.mediaUrl(page.avatar_path) : '';
        const photo = avatar ? `<img src="${esc(avatar)}" alt="" loading="lazy">` : `<span>${esc((page.name || 'F').slice(0,1).toUpperCase())}</span>`;
        return `<article class="page-mini-card page-invite-card"><div class="page-mini-body"><div class="page-avatar">${photo}</div><div class="page-mini-copy"><b>${esc(page.name || 'Frnxup Page')}</b><small>${esc(page.category || 'Frnxup Page')} · Invited ${esc(FX.relative(invite.created_at))}</small></div></div><p class="page-invite-copy">You have been invited to follow this Page.</p><div class="page-mini-actions"><button class="page-switch" type="button" data-accept-invite="${esc(invite.id)}">Accept invitation</button><button class="page-manage" type="button" data-decline-invite="${esc(invite.id)}">Decline</button></div></article>`;
      }));
      host.innerHTML = cards.join('');FXStates.loaded(host);
      host.querySelectorAll('[data-accept-invite]').forEach(button => button.addEventListener('click', () => respondToInvitation(button.dataset.acceptInvite, 'accepted', button)));
      host.querySelectorAll('[data-decline-invite]').forEach(button => button.addEventListener('click', () => respondToInvitation(button.dataset.declineInvite, 'declined', button)));
    } catch (error) {
      showError(host, error, renderInvitations);
    }
  }

  async function respondToInvitation(invitationId, status, button) {
    if (!['accepted', 'declined'].includes(status)) return;
    button.disabled = true;
    try {
      const { data, error } = await withTimeout(
        FX.client.rpc('frnxup_respond_page_invitation', {
          p_invitation_id: invitationId,
          p_response: status
        }),
        'Updating invitation'
      );
      if (error) throw error;
      if (data !== true && data !== 'true') throw new Error('The invitation response was not confirmed. Refresh and check your invitations.');
      FX.toast(status === 'accepted'
        ? 'Invitation accepted. The Page is now in your Followed Pages.'
        : 'Invitation declined.');
      await renderInvitations();
    } catch (error) {
      button.disabled = false;
      showError($('#page-invitations'), error, renderInvitations);
    }
  }

  async function renderFollowedPages() {
    const host = $('#followed-pages');
    if (!host) return;
    FXStates.loading(host, { title: 'Loading followed Pages', message: 'Checking the Pages you follow.' });
    try {
      await requireMember();
      const { data, error } = await withTimeout(FX.client.from('frnxup_page_followers')
        .select('page_id,created_at,page:frnxup_pages!frnxup_page_followers_page_id_fkey(id,name,slug,category,avatar_path,cover_path,owner_user_id,follower_count_visible,status)')
        .eq('user_id', FX.user.id).order('created_at', { ascending: false }), 'Loading followed Pages');
      if (error) throw error;
      const pages = (data || []).map(row => row.page).filter(page => page && page.status === 'active');
      if (!pages.length) {
        FXStates.empty(host, { title: 'You are not following any Pages yet', message: 'Accept an invitation or follow a Page when you visit it.' });
        return;
      }
      host.innerHTML = (await Promise.all(pages.map(page => buildPageCard(page, 'followed')))).join('');FXStates.loaded(host);
      host.querySelectorAll('[data-unfollow-page]').forEach(button => button.addEventListener('click', () => unfollowPage(button.dataset.unfollowPage, button)));
    } catch (error) {
      showError(host, error, renderFollowedPages);
    }
  }

  async function unfollowPage(pageId, button) {
    if (!confirm('Unfollow this Page? You can follow it again later.')) return;
    button.disabled = true;
    try {
      const { error } = await FX.client.from('frnxup_page_followers').delete().eq('page_id', pageId).eq('user_id', FX.user.id);
      if (error) throw error;
      FX.toast('You unfollowed this Page.');
      await renderFollowedPages();
    } catch (error) {
      button.disabled = false;
      FX.toast(error.message || 'Could not unfollow this Page.');
    }
  }

  function setupSlug() {
    const name = $('#new-page-name');
    const slug = $('#new-page-slug');
    if (!name || !slug) return;
    name.addEventListener('input', () => {
      if (slug.dataset.edited === 'true') return;
      slug.value = name.value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    });
    slug.addEventListener('input', () => {
      slug.dataset.edited = 'true';
      slug.value = slug.value.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-{2,}/g, '-').slice(0, 40);
    });
  }

  function setCreateMessage(message, kind = 'info') {
    const host = $('#create-page-message');
    if (!host) return;
    host.textContent = message;
    host.classList.remove('is-error', 'is-success', 'is-info');
    host.classList.add(kind === 'error' ? 'is-error' : kind === 'success' ? 'is-success' : 'is-info');
  }

  function explainCreateError(error) {
    const code = error?.code || '';
    const text = String(error?.message || error || 'Your Page could not be created.');
    if (code === '23505') return 'That personalized Page link is already in use. Choose another link.';
    if (code === '42501') return 'Supabase denied Page creation. Run the included Pages SQL migration and confirm that your account is active.';
    if (code === '23514') return 'One of the Page details does not meet the database requirements. Check the name and link format.';
    if (code === '42P01' || /relation .* does not exist/i.test(text)) return 'The Pages database tables are missing. Run the included Supabase Pages migration, then try again.';
    if (code === 'PGRST202' || /frnxup_create_page.*(not found|schema cache)/i.test(text)) return 'The Page-creation database function is not installed yet. Run the included Supabase Pages migration, wait for it to finish, and try again.';
    if (/Invalid API key|JWT|not authenticated|session/i.test(text)) return 'Your Frnxup sign-in session could not be verified. Sign in again, then retry. Your form details have been kept.';
    return text;
  }

  function setupCreatePage() {
    const form = $('#create-page-form');
    if (!form) return;
    const button = $('#create-page-submit');
    const nameInput = $('#new-page-name');
    const slugInput = $('#new-page-slug');
    const categoryInput = $('#new-page-category');
    const aboutInput = $('#new-page-about');
    if (!button || !nameInput || !slugInput || !categoryInput || !aboutInput) {
      setCreateMessage('The Page form is incomplete. Refresh the page or reinstall the Pages update.', 'error');
      return;
    }

    // Attach immediately. Do not wait for an auth/network request; otherwise the
    // browser may perform a normal form submit and clear the member's entries.
    setupSlug();
    let submitting = false;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      event.stopPropagation();
      if (submitting) return;

      const name = nameInput.value.trim();
      const slug = slugInput.value.trim().toLowerCase();
      const category = categoryInput.value || 'Other';
      const about = aboutInput.value.trim();

      if (name.length < 2 || name.length > 80) {
        setCreateMessage('Page name must contain between 2 and 80 characters.', 'error');
        nameInput.focus();
        return;
      }
      if (!/^[a-z0-9-]{3,40}$/.test(slug)) {
        setCreateMessage('Page link must be 3–40 characters using lowercase letters, numbers and hyphens only.', 'error');
        slugInput.focus();
        return;
      }
      if (about.length > 3000) {
        setCreateMessage('Description must be 3,000 characters or fewer.', 'error');
        aboutInput.focus();
        return;
      }

      submitting = true;
      FXStates.clearUpload('#create-page-message');
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = 'Creating…';
      setCreateMessage('Checking your sign-in and creating your Page…');

      try {
        if (!window.FX?.client) throw new Error('Frnxup is not connected to Supabase. Check the site configuration.');
        const user = await withTimeout(FX.loadUser(), 'Verifying your sign-in');
        if (!user?.id) {
          FX.showAuthNotice('Sign in to create and manage your Pages.');
          throw new Error('Please sign in to continue. Your form details have been kept.');
        }

        // The RPC validates ownership/account status and inserts the Page in the
        // database. The form is never reset on error.
        const { data, error } = await withTimeout(FX.client.rpc('frnxup_create_page', {
          p_name: name,
          p_slug: slug,
          p_category: category,
          p_about: about
        }), 'Saving your Page');
        if (error) throw error;
        const created = Array.isArray(data) ? data[0] : data;
        const pageId = created?.id || created?.page_id || (typeof created === 'string' ? created : null);
        if (!pageId) throw new Error('Frnxup did not confirm the new Page ID. Your entries have been kept. Open Your Pages to check whether it was saved before trying again.');

        FX.setActivePage(pageId);
        setCreateMessage('Your Page has been created successfully. Opening its dashboard…', 'success');
        button.textContent = 'Created';
        setTimeout(() => { location.assign(`/Pages/dashboard.html?id=${encodeURIComponent(pageId)}`); }, 450);
      } catch (error) {
        setCreateMessage(explainCreateError(error), 'error');
        FXStates.failInline($('#create-page-message'), error, { retry: () => form.requestSubmit(), title: 'Page creation could not be completed', message: explainCreateError(error) });
        submitting = false;
        button.disabled = false;
        button.removeAttribute('aria-busy');
        button.textContent = 'Create Page';
      }
    });

    // Preflight auth status after the handler is already live. This only informs
    // the user; submission still performs its own fresh session check.
    requireMember().then(() => {
      if (!submitting) setCreateMessage('Your Page details are ready.');
    }).catch(error => {
      if (!submitting) setCreateMessage(`${error.message || 'Sign in is required.'} You can complete the form; your entries will remain here.`, 'error');
    });
  }

  async function boot() {
    const path = location.pathname.toLowerCase();
    if (path.endsWith('/pages/create.html')) setupCreatePage();
    else if (path.endsWith('/pages/invitations.html')) await renderInvitations();
    else if (path.endsWith('/pages/followed.html')) await renderFollowedPages();
    else if (path.endsWith('/pages/index.html') || path.endsWith('/pages/')) await renderOwnedPages();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot().catch(error => window.FX?.toast?.(error.message)), { once: true });
  else boot().catch(error => window.FX?.toast?.(error.message));
})();
