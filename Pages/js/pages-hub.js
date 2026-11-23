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

  function showError(host, message, retry) {
    if (!host) return;
    host.innerHTML = `<div class="pages-empty pages-error"><b>We couldn't load this section.</b><span>${esc(message)}</span>${retry ? '<button type="button" class="pages-retry" id="pages-retry">Try again</button>' : ''}</div>`;
    if (retry) $('#pages-retry', host)?.addEventListener('click', retry, { once: true });
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
    host.innerHTML = '<div class="pages-empty">Loading your Pages…</div>';
    try {
      await requireMember();
      const result = await withTimeout(FX.client.from('frnxup_pages').select('*').eq('owner_user_id', FX.user.id).neq('status', 'removed').order('created_at', { ascending: false }), 'Loading your Pages');
      if (result.error) throw result.error;
      const pages = result.data || [];
      if (!pages.length) {
        host.innerHTML = '<div class="pages-empty pages-empty-action"><b>You have not created a Page yet.</b><span>Create a public identity for your brand, business or community.</span><a class="pages-button primary" href="/Pages/create.html">＋ Create your first Page</a></div>';
        return;
      }
      host.innerHTML = (await Promise.all(pages.map(page => buildPageCard(page, 'owned')))).join('');
      host.querySelectorAll('[data-switch-page]').forEach(button => button.addEventListener('click', () => {
        FX.setActivePage(button.dataset.switchPage);
        location.href = `/Pages/dashboard.html?id=${encodeURIComponent(button.dataset.switchPage)}`;
      }));
    } catch (error) {
      showError(host, error.message || 'An unexpected error occurred.', renderOwnedPages);
    }
  }

  async function renderInvitations() {
    const host = $('#page-invitations');
    if (!host) return;
    host.innerHTML = '<div class="pages-empty">Loading invitations…</div>';
    try {
      await requireMember();
      const { data, error } = await withTimeout(FX.client.from('frnxup_page_invitations')
        .select('id,status,created_at,page:frnxup_pages!frnxup_page_invitations_page_id_fkey(id,name,slug,category,avatar_path,cover_path,owner_user_id,follower_count_visible)')
        .eq('invited_user_id', FX.user.id).eq('status', 'pending').order('created_at', { ascending: false }), 'Loading invitations');
      if (error) throw error;
      if (!data?.length) {
        host.innerHTML = '<div class="pages-empty"><b>No pending invitations.</b><span>When someone invites you to follow their Page, it will appear here.</span></div>';
        return;
      }
      const cards = await Promise.all(data.map(async invite => {
        const page = invite.page || {};
        const avatar = page.avatar_path ? await FX.mediaUrl(page.avatar_path) : '';
        const photo = avatar ? `<img src="${esc(avatar)}" alt="" loading="lazy">` : `<span>${esc((page.name || 'F').slice(0,1).toUpperCase())}</span>`;
        return `<article class="page-mini-card page-invite-card"><div class="page-mini-body"><div class="page-avatar">${photo}</div><div class="page-mini-copy"><b>${esc(page.name || 'Frnxup Page')}</b><small>${esc(page.category || 'Frnxup Page')} · Invited ${esc(FX.relative(invite.created_at))}</small></div></div><p class="page-invite-copy">You have been invited to follow this Page.</p><div class="page-mini-actions"><button class="page-switch" type="button" data-accept-invite="${esc(invite.id)}">Accept invitation</button><button class="page-manage" type="button" data-decline-invite="${esc(invite.id)}">Decline</button></div></article>`;
      }));
      host.innerHTML = cards.join('');
      host.querySelectorAll('[data-accept-invite]').forEach(button => button.addEventListener('click', () => respondToInvitation(button.dataset.acceptInvite, 'accepted', button)));
      host.querySelectorAll('[data-decline-invite]').forEach(button => button.addEventListener('click', () => respondToInvitation(button.dataset.declineInvite, 'declined', button)));
    } catch (error) {
      showError(host, error.message || 'An unexpected error occurred.', renderInvitations);
    }
  }

  async function respondToInvitation(invitationId, status, button) {
    button.disabled = true;
    const card = button.closest('.page-mini-card');
    try {
      const { error } = await FX.client.from('frnxup_page_invitations').update({ status }).eq('id', invitationId).eq('invited_user_id', FX.user.id).eq('status', 'pending');
      if (error) throw error;
      if (status === 'accepted') {
        const { data: invite, error: fetchError } = await FX.client.from('frnxup_page_invitations').select('page_id').eq('id', invitationId).single();
        if (fetchError) throw fetchError;
        const { error: followError } = await FX.client.from('frnxup_page_followers').upsert({ page_id: invite.page_id, user_id: FX.user.id }, { onConflict: 'page_id,user_id' });
        if (followError) throw followError;
        FX.toast('Invitation accepted. The Page is now in your Followed Pages.');
      } else {
        FX.toast('Invitation declined.');
      }
      await renderInvitations();
    } catch (error) {
      button.disabled = false;
      FX.toast(error.message || 'We could not update this invitation.');
    }
  }

  async function renderFollowedPages() {
    const host = $('#followed-pages');
    if (!host) return;
    host.innerHTML = '<div class="pages-empty">Loading followed Pages…</div>';
    try {
      await requireMember();
      const { data, error } = await withTimeout(FX.client.from('frnxup_page_followers')
        .select('page_id,created_at,page:frnxup_pages!frnxup_page_followers_page_id_fkey(id,name,slug,category,avatar_path,cover_path,owner_user_id,follower_count_visible,status)')
        .eq('user_id', FX.user.id).order('created_at', { ascending: false }), 'Loading followed Pages');
      if (error) throw error;
      const pages = (data || []).map(row => row.page).filter(page => page && page.status === 'active');
      if (!pages.length) {
        host.innerHTML = '<div class="pages-empty"><b>You are not following any Pages yet.</b><span>Accept an invitation or follow a Page when you visit it.</span><a class="pages-button primary" href="/index.html">Discover Frnxup</a></div>';
        return;
      }
      host.innerHTML = (await Promise.all(pages.map(page => buildPageCard(page, 'followed')))).join('');
      host.querySelectorAll('[data-unfollow-page]').forEach(button => button.addEventListener('click', () => unfollowPage(button.dataset.unfollowPage, button)));
    } catch (error) {
      showError(host, error.message || 'An unexpected error occurred.', renderFollowedPages);
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

  async function setupCreatePage() {
    const form = $('#create-page-form');
    if (!form) return;
    const message = $('#create-page-message');
    const button = $('#create-page-submit');
    setupSlug();
    try { await requireMember(); }
    catch (error) {
      message.textContent = error.message;
      message.classList.add('is-error');
      return;
    }
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const name = $('#new-page-name').value.trim();
      const slug = $('#new-page-slug').value.trim().toLowerCase();
      const category = $('#new-page-category').value || 'Other';
      const about = $('#new-page-about').value.trim();
      message.classList.remove('is-error', 'is-success');
      if (name.length < 2 || name.length > 80) {
        message.textContent = 'Page name must contain between 2 and 80 characters.';
        message.classList.add('is-error');
        $('#new-page-name').focus();
        return;
      }
      if (!/^[a-z0-9-]{3,40}$/.test(slug)) {
        message.textContent = 'Page link must be 3–40 characters using lowercase letters, numbers and hyphens only.';
        message.classList.add('is-error');
        $('#new-page-slug').focus();
        return;
      }
      if (about.length > 3000) {
        message.textContent = 'Description must be 3,000 characters or fewer.';
        message.classList.add('is-error');
        return;
      }
      button.disabled = true;
      button.textContent = 'Creating…';
      message.textContent = 'Creating your Page…';
      try {
        const { data, error } = await withTimeout(FX.client.from('frnxup_pages').insert({
          owner_user_id: FX.user.id,
          name,
          slug,
          category,
          about
        }).select('id,slug').single(), 'Creating your Page');
        if (error) throw error;
        if (!data?.id) throw new Error('The Page was saved, but Frnxup did not return its Page ID. Refresh Your Pages to check it.');
        FX.setActivePage(data.id);
        message.textContent = 'Your Page has been created. Opening its dashboard…';
        message.classList.add('is-success');
        location.href = `/Pages/dashboard.html?id=${encodeURIComponent(data.id)}`;
      } catch (error) {
        let text = error.message || 'Your Page could not be created.';
        if (error.code === '23505') text = 'That personalized Page link is already in use. Choose another link.';
        else if (error.code === '42501') text = 'Supabase denied Page creation. Check that the Pages SQL migration and frnxup_pages INSERT policy have been applied.';
        else if (error.code === '23514') text = 'One of the Page details does not meet the database requirements. Check the name and link format.';
        message.textContent = text;
        message.classList.add('is-error');
      } finally {
        button.disabled = false;
        button.textContent = 'Create Page';
      }
    });
  }

  async function boot() {
    const path = location.pathname.toLowerCase();
    if (path.endsWith('/pages/create.html')) await setupCreatePage();
    else if (path.endsWith('/pages/invitations.html')) await renderInvitations();
    else if (path.endsWith('/pages/followed.html')) await renderFollowedPages();
    else if (path.endsWith('/pages/index.html') || path.endsWith('/pages/')) await renderOwnedPages();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot().catch(error => FX.toast(error.message)), { once: true });
  else boot().catch(error => FX.toast(error.message));
})();
