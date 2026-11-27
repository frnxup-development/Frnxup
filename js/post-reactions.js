/* Facebook-style post reactions: tap Like, hover/long-press for reaction choices. */
(() => {
  'use strict';
  const REACTIONS = [
    {key:'like', emoji:'👍', label:'Like'},
    {key:'love', emoji:'❤️', label:'Love'},
    {key:'laugh', emoji:'😂', label:'Haha'},
    {key:'wow', emoji:'😮', label:'Wow'},
    {key:'sad', emoji:'😢', label:'Sad'},
    {key:'angry', emoji:'😡', label:'Angry'},
    {key:'support', emoji:'🤗', label:'Support'}
  ];
  const byKey = key => REACTIONS.find(item => item.key === key) || null;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const formatCount = value => Number(value || 0) >= 1000000 ? `${(Number(value) / 1000000).toFixed(1).replace(/\.0$/, '')}M` : Number(value || 0) >= 1000 ? `${(Number(value) / 1000).toFixed(1).replace(/\.0$/, '')}K` : String(Number(value || 0));

  function summaryMarkup(rows, commentCount, postId) {
    const counts = new Map();
    (rows || []).forEach(row => counts.set(row.reaction, (counts.get(row.reaction) || 0) + 1));
    const total = (rows || []).length;
    const ordered = REACTIONS.filter(item => counts.has(item.key)).sort((a,b) => counts.get(b.key) - counts.get(a.key)).slice(0,3);
    const icons = ordered.map(item => `<span class="fx-post-reaction-badge" title="${item.label}">${item.emoji}</span>`).join('');
    return `<div class="fx-post-engagement-summary" data-fx-post-reaction-summary data-comment-count="${Number(commentCount)||0}">
      <div class="fx-post-reaction-total" aria-label="${total} reactions">${total ? `<span class="fx-post-reaction-stack">${icons}</span><b>${formatCount(total)}</b>` : '<span class="fx-post-no-reactions">Be the first to react</span>'}</div>
      <button type="button" class="fx-post-comments-count" data-comment="${esc(postId)}">${formatCount(commentCount)} ${Number(commentCount) === 1 ? 'comment' : 'comments'}</button>
    </div>`;
  }

  function markup(postId, rows = [], commentCount = 0) {
    const own = (rows || []).find(row => row.user_id === window.FX?.user?.id)?.reaction || '';
    const active = byKey(own);
    return `${summaryMarkup(rows, commentCount, postId)}
      <div class="post-actions fx-post-actions-v4">
        <div class="fx-post-react-wrap">
          <button type="button" class="fx-post-react-button ${active ? 'active' : ''}" data-fx-post-reaction-button="${esc(postId)}" aria-haspopup="true" aria-expanded="false">
            <span class="fx-post-react-current" aria-hidden="true">${active?.emoji || '👍'}</span><span class="fx-post-react-label">${active?.label || 'Like'}</span>
          </button>
          <div class="fx-post-reaction-tray" role="group" aria-label="Choose a reaction" hidden>
            ${REACTIONS.map(item => `<button type="button" class="fx-post-reaction-choice ${own === item.key ? 'selected' : ''}" data-fx-post-reaction-choice="${item.key}" data-post-id="${esc(postId)}" title="${item.label}" aria-label="${item.label}" aria-pressed="${own === item.key ? 'true' : 'false'}">${item.emoji}</button>`).join('')}
          </div>
        </div>
        <button type="button" data-comment="${esc(postId)}">▢ <span>Comment</span></button>
        <button type="button" data-share="${esc(postId)}">↗ <span>Share</span></button>
        <button type="button" data-send="${esc(postId)}">➤ <span>Send</span></button>
      </div>`;
  }

  function closeTrays(except) {
    document.querySelectorAll('.fx-post-react-wrap').forEach(wrap => {
      if (wrap === except) return;
      const tray = wrap.querySelector('.fx-post-reaction-tray');
      const button = wrap.querySelector('[data-fx-post-reaction-button]');
      if (tray) tray.hidden = true;
      if (button) button.setAttribute('aria-expanded', 'false');
      wrap.classList.remove('tray-open');
    });
  }
  function openTray(wrap) {
    if (!wrap) return;
    closeTrays(wrap);
    const tray = wrap.querySelector('.fx-post-reaction-tray');
    const button = wrap.querySelector('[data-fx-post-reaction-button]');
    if (tray) tray.hidden = false;
    if (button) button.setAttribute('aria-expanded', 'true');
    wrap.classList.add('tray-open');
  }
  function renderUpdated(card, rows) {
    if (!card) return;
    const current = rows.find(row => row.user_id === window.FX?.user?.id)?.reaction || '';
    card.dataset.myReaction = current;
    const reactionButton = card.querySelector('[data-fx-post-reaction-button]');
    if (reactionButton) {
      const item = byKey(current);
      reactionButton.classList.toggle('active', !!item);
      reactionButton.querySelector('.fx-post-react-current').textContent = item?.emoji || '👍';
      reactionButton.querySelector('.fx-post-react-label').textContent = item?.label || 'Like';
      reactionButton.querySelectorAll('[data-fx-post-reaction-choice]').forEach(choice => {
        const selected = choice.dataset.fxPostReactionChoice === current;
        choice.classList.toggle('selected', selected);
        choice.setAttribute('aria-pressed', String(selected));
      });
    }
    const summary = card.querySelector('[data-fx-post-reaction-summary]');
    if (summary) {
      const commentCount = Number(summary.dataset.commentCount || 0);
      summary.outerHTML = summaryMarkup(rows, commentCount, card.dataset.post || reactionButton?.dataset.fxPostReactionButton || '');
    }
  }

  async function setReaction(postId, key, card, toggleSame = true) {
    const FX = window.FX;
    if (!FX?.user) {
      location.href = '/Auth/index.html?next=' + encodeURIComponent(location.pathname + location.search);
      return;
    }
    if (!FX.client) return FX.toast('Reactions are not available right now.');
    const current = card?.dataset.myReaction || '';
    const desired = key === current && toggleSame ? '' : key;
    const buttons = card?.querySelectorAll('[data-fx-post-reaction-button], [data-fx-post-reaction-choice]') || [];
    buttons.forEach(button => { button.disabled = true; });
    try {
      if (current) {
        const {error} = await FX.client.from('post_reactions').delete().eq('post_id', postId).eq('user_id', FX.user.id);
        if (error) throw error;
      }
      if (desired) {
        const {error} = await FX.client.from('post_reactions').insert({post_id: postId, user_id: FX.user.id, reaction: desired});
        if (error) {
          // Keep the previous reaction if the replacement insert is rejected.
          if (current) await FX.client.from('post_reactions').insert({post_id: postId, user_id: FX.user.id, reaction: current});
          throw error;
        }
      }
      const {data, error} = await FX.client.from('post_reactions').select('user_id,reaction').eq('post_id', postId);
      if (error) throw error;
      renderUpdated(card, data || []);
    } catch (error) {
      FX.toast(error?.message || 'Your reaction could not be saved.');
    } finally {
      buttons.forEach(button => { button.disabled = false; });
    }
  }

  let hoverTimer = null, closeTimer = null, longPressTimer = null;
  let longPressButton = null;
  document.addEventListener('pointerover', event => {
    if (event.pointerType === 'touch') return;
    const button = event.target.closest?.('[data-fx-post-reaction-button]');
    if (!button) return;
    clearTimeout(closeTimer);
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => openTray(button.closest('.fx-post-react-wrap')), 360);
  });
  document.addEventListener('pointerout', event => {
    const wrap = event.target.closest?.('.fx-post-react-wrap');
    if (!wrap || wrap.contains(event.relatedTarget)) return;
    clearTimeout(hoverTimer);
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => { if (!wrap.matches(':hover')) closeTrays(); }, 240);
  });
  document.addEventListener('pointerdown', event => {
    const button = event.target.closest?.('[data-fx-post-reaction-button]');
    if (!button || event.pointerType !== 'touch') return;
    clearTimeout(longPressTimer);
    longPressButton = button;
    longPressTimer = setTimeout(() => {
      button.dataset.suppressReactionClick = '1';
      openTray(button.closest('.fx-post-react-wrap'));
    }, 520);
  }, {passive: true});
  const cancelLongPress = () => { clearTimeout(longPressTimer); longPressTimer = null; longPressButton = null; };
  document.addEventListener('pointerup', cancelLongPress, {passive: true});
  document.addEventListener('pointercancel', cancelLongPress, {passive: true});

  document.addEventListener('click', async event => {
    const choice = event.target.closest('[data-fx-post-reaction-choice]');
    if (choice) {
      event.preventDefault(); event.stopPropagation();
      const card = choice.closest('[data-post]');
      await setReaction(choice.dataset.postId, choice.dataset.fxPostReactionChoice, card, true);
      closeTrays();
      return;
    }
    const button = event.target.closest('[data-fx-post-reaction-button]');
    if (button) {
      event.preventDefault(); event.stopPropagation();
      if (button.dataset.suppressReactionClick) { delete button.dataset.suppressReactionClick; return; }
      const card = button.closest('[data-post]');
      await setReaction(button.dataset.fxPostReactionButton, 'like', card, true);
      closeTrays();
      return;
    }
    if (!event.target.closest('.fx-post-react-wrap')) closeTrays();
  });

  window.FXPostReactions = {REACTIONS, markup, setReaction, summaryMarkup};
})();
