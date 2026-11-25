(() => {
  'use strict';
  const STORAGE_KEY = 'eduAfrikaCompactPanelState.v1';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function readState() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; }
    catch (_) { return {}; }
  }
  function saveState(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
  }
  function slug(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'section';
  }
  function setPanelOpen(panel, open, persist = true) {
    const body = $('.edu-compact-panel-body', panel);
    const button = $('.edu-compact-toggle', panel);
    if (!body || !button) return;
    body.hidden = !open;
    panel.classList.toggle('is-compact-open', open);
    button.setAttribute('aria-expanded', String(open));
    button.textContent = open ? '− Collapse' : '+ Expand';
    button.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} ${panel.dataset.panelTitle || 'section'}`);
    if (persist) {
      const state = readState();
      state[panel.dataset.panelKey] = open;
      saveState(state);
    }
  }
  function preparePanel(panel, state) {
    if (panel.dataset.compactReady === 'true') return;
    const heading = $(':scope > .panel-head', panel);
    if (!heading) return;
    const title = $('h2', heading)?.textContent?.trim() || 'EDU-AFRIKA section';
    const key = panel.id || `edu-panel-${slug(title)}`;
    panel.id = key;
    panel.dataset.panelKey = key;
    panel.dataset.panelTitle = title;

    const body = document.createElement('div');
    body.className = 'edu-compact-panel-body';
    [...panel.children].forEach(child => {
      if (child !== heading) body.appendChild(child);
    });
    panel.appendChild(body);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'edu-compact-toggle';
    toggle.setAttribute('aria-controls', `${key}-body`);
    body.id = `${key}-body`;
    toggle.addEventListener('click', () => setPanelOpen(panel, body.hidden));
    heading.appendChild(toggle);

    panel.classList.add('edu-compact-panel');
    panel.dataset.compactReady = 'true';
    const defaultOpen = panel.classList.contains('edu-ai-production-panel') || panel.classList.contains('edu-ai-review-panel');
    const open = Object.prototype.hasOwnProperty.call(state, key) ? !!state[key] : defaultOpen;
    setPanelOpen(panel, open, false);
  }

  function wrapInDetails(node, title, className) {
    if (!node || node.parentElement?.classList.contains('edu-compact-subsection')) return null;
    const details = document.createElement('details');
    details.className = `edu-compact-subsection ${className || ''}`.trim();
    const summary = document.createElement('summary');
    summary.textContent = title;
    node.parentNode.insertBefore(details, node);
    details.appendChild(summary);
    details.appendChild(node);
    return details;
  }
  function prepareAiSubsections() {
    const provider = $('.edu-ai-provider-config');
    if (provider) wrapInDetails(provider, '⚙ AI provider settings · keys, model, limits and connection test', 'edu-compact-provider-settings');

    const directoryHead = $('.edu-ai-directory-head');
    const directory = $('#edu-ai-provider-directory');
    if (directoryHead && directory && !directory.parentElement?.classList.contains('edu-compact-subsection')) {
      const details = document.createElement('details');
      details.className = 'edu-compact-subsection edu-compact-provider-directory';
      const summary = document.createElement('summary');
      summary.textContent = 'Browse the AI provider directory · 20 options';
      directoryHead.parentNode.insertBefore(details, directoryHead);
      details.appendChild(summary);
      details.appendChild(directoryHead);
      details.appendChild(directory);
    }
  }

  function insertToolbar() {
    const main = $('.admin-main');
    const header = $(':scope > header', main);
    if (!main || !header || $('#edu-compact-toolbar')) return;
    const toolbar = document.createElement('nav');
    toolbar.id = 'edu-compact-toolbar';
    toolbar.className = 'edu-compact-toolbar';
    toolbar.setAttribute('aria-label', 'EDU-AFRIKA quick navigation and view controls');
    toolbar.innerHTML = `
      <div class="edu-compact-toolbar-label"><b>SMART VIEW</b><span>Collapse sections to keep the workspace tidy.</span></div>
      <div class="edu-compact-toolbar-actions">
        <button type="button" data-edu-panels="expand">Expand all</button>
        <button type="button" data-edu-panels="collapse">Collapse all</button>
        <a href="#edu-ai-form">＋ Generate</a>
        <a href="#edu-ai-review-queue">✓ Review drafts</a>
        <a href="#edu-topic-form">▤ Syllabus topics</a>
      </div>`;
    header.insertAdjacentElement('afterend', toolbar);
    toolbar.addEventListener('click', event => {
      const action = event.target.closest('[data-edu-panels]');
      if (action) {
        const open = action.dataset.eduPanels === 'expand';
        const panels = $$('.edu-compact-panel', main);
        panels.forEach(panel => setPanelOpen(panel, open));
        return;
      }
      const link = event.target.closest('a[href^="#"]');
      if (!link) return;
      const target = $(link.getAttribute('href'));
      const panel = target?.closest('.edu-compact-panel');
      if (panel) setPanelOpen(panel, true);
      if (target) setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
    });
  }

  function bindEditExpansion() {
    document.addEventListener('click', event => {
      const action = event.target.closest('[data-ai-review-action="edit"]');
      if (!action) return;
      const form = $('#edu-question-form');
      const panel = form?.closest('.edu-compact-panel');
      if (panel) setPanelOpen(panel, true);
    });
  }

  function init() {
    const main = $('.admin-main');
    if (!main) return;
    const state = readState();
    $$('.admin-main > section.admin-panel').forEach(panel => preparePanel(panel, state));
    insertToolbar();
    prepareAiSubsections();
    bindEditExpansion();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
