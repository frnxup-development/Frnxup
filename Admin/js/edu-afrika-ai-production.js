(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => window.FX?.esc ? window.FX.esc(value ?? '') : String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  let providers = [];
  let configs = [];
  let busy = false;
  let publishBusy = false;

  function setFeedback(id, message, good = false) {
    const el = $(id);
    if (el) {
      el.textContent = message || '';
      el.style.color = good ? '#9cf0b6' : '#ffb8b8';
    }
    if (id === 'edu-ai-publish-feedback') {
      const topStatus = $('edu-ai-workflow-status');
      if (topStatus) {
        topStatus.textContent = message || '';
        topStatus.style.color = good ? '#a8f0c2' : '#ffc1a8';
      }
    }
  }
  function setButtonBusy(id, state, label) {
    const el = $(id); if (!el) return;
    if (state) { el.dataset.previousText = el.textContent; el.textContent = label || 'Working…'; el.disabled = true; }
    else { el.textContent = el.dataset.previousText || el.textContent; el.disabled = false; delete el.dataset.previousText; }
  }
  function selectedProvider() { return providers.find(p => p.code === $('edu-ai-provider-select')?.value) || null; }
  function savedConfig(code) { return configs.find(c => c.provider_code === code) || null; }

  async function invoke(payload) {
    if (!window.FX?.client) throw new Error('Frnxup database client is not ready. Refresh the admin page and sign in again.');
    let staffToken = null;
    try { staffToken = sessionStorage.getItem('frnxup_admin_staff_session'); } catch (_) {}
    const { data, error } = await FX.client.functions.invoke('edu-afrika-generate-questions', { body: { ...payload, staff_session_token: staffToken } });
    if (error) {
      let message = error.message || 'The AI service request failed.';
      try { const detail = await error.context?.json?.(); if (detail?.error) message = detail.error; } catch (_) {}
      throw new Error(message);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  function renderProviderDirectory() {
    const host = $('edu-ai-provider-directory');
    if (!host) return;
    if (!providers.length) { host.innerHTML = '<p class="edu-admin-empty">Provider directory is unavailable. Check the Edge Function deployment.</p>'; return; }
    host.innerHTML = providers.map(p => {
      const config = p.config || savedConfig(p.code);
      const tag = p.accessLabel || 'Check provider pricing / account eligibility';
      return `<article class="edu-ai-provider-card"><header><b>${esc(p.name)}</b><span class="edu-ai-provider-tag">${tag}</span></header><p>${esc(p.freeAccess || 'Check provider pricing and eligibility.')}</p><div><a href="${esc(p.keyUrl)}" target="_blank" rel="noopener noreferrer">API key / console ↗</a><a href="${esc(p.website)}" target="_blank" rel="noopener noreferrer">Website ↗</a><a href="${esc(p.docsUrl)}" target="_blank" rel="noopener noreferrer">Docs ↗</a></div><small class="${config?.is_enabled ? 'is-configured' : ''}">${config ? (config.is_enabled ? `Configured · key ending ${esc(config.key_last_four || '••••')}` : 'Saved but disabled') : 'Not configured'}</small><button type="button" data-ai-provider-pick="${esc(p.code)}">${config ? 'Manage provider' : 'Configure provider'}</button></article>`;
    }).join('');
  }

  function showSelectedProvider() {
    const p = selectedProvider();
    if (!p) return;
    const config = p.config || savedConfig(p.code);
    $('edu-ai-provider-model').value = config?.model || p.model || '';
    $('edu-ai-provider-base-url').value = config?.api_base_url || p.baseUrl || '';
    $('edu-ai-provider-key').value = '';
    $('edu-ai-provider-enabled').checked = config ? !!config.is_enabled : true;
    $('edu-ai-input-rate').value = config?.input_cost_per_million ?? '';
    $('edu-ai-output-rate').value = config?.output_cost_per_million ?? '';
    $('edu-ai-daily-batch-limit').value = config?.daily_batch_limit ?? '';
    $('edu-ai-daily-question-limit').value = config?.daily_question_limit ?? '';
    $('edu-ai-cloudflare-account').value = config?.account_id || '';
    $('edu-ai-cloudflare-account-wrap').hidden = p.code !== 'cloudflare';
    $('edu-ai-provider-free-note').textContent = (p.freeAccess || 'Review the provider pricing and account conditions before generating.') + (p.code === 'alibaba' ? ' IMPORTANT: replace YOUR_WORKSPACE_ID in the base URL with your Model Studio workspace ID and use the matching region.' : '');
    const keyLink = $('edu-ai-provider-key-link');
    keyLink.href = p.keyUrl; keyLink.hidden = !p.keyUrl;
    const docsLink = $('edu-ai-provider-docs-link');
    docsLink.href = p.docsUrl; docsLink.hidden = !p.docsUrl;
    $('edu-ai-provider-config-status').textContent = config ? `${config.is_enabled ? 'Enabled' : 'Disabled'} · key ending ${config.key_last_four || '••••'} · test: ${config.last_test_status || 'not tested'}${config.last_test_message ? ' · ' + config.last_test_message : ''}` : 'API key not configured yet.';
    setFeedback('edu-ai-provider-feedback', '');
  }

  async function loadProviders() {
    const select = $('edu-ai-provider-select');
    if (!select) return;
    select.innerHTML = '<option value="">Loading providers…</option>';
    try {
      const data = await invoke({ action: 'list' });
      providers = Array.isArray(data.providers) ? data.providers : [];
      configs = providers.map(p => p.config).filter(Boolean);
      select.innerHTML = '<option value="">Choose an AI provider</option>' + providers.map(p => `<option value="${esc(p.code)}">${esc(p.name)}${p.config ? (p.config.is_enabled ? ' · configured' : ' · disabled') : ' · not configured'}</option>`).join('');
      if (providers.length) {
        const preferred = providers.find(p => p.config?.is_enabled) || providers[0];
        select.value = preferred.code;
        showSelectedProvider();
      }
      renderProviderDirectory();
    } catch (error) {
      select.innerHTML = '<option value="">Provider list could not be loaded</option>';
      $('edu-ai-provider-directory').innerHTML = `<p class="edu-admin-empty">${esc(error.message)}. Deploy the updated <code>edu-afrika-generate-questions</code> Edge Function and apply the AI Production Centre migration.</p>`;
    }
  }

  async function saveProvider() {
    if (busy) return;
    const p = selectedProvider();
    if (!p) { setFeedback('edu-ai-provider-feedback', 'Choose a provider.'); return; }
    busy = true; setButtonBusy('edu-ai-provider-save', true, 'Encrypting and saving…');
    try {
      const result = await invoke({
        action: 'save_provider', provider_code: p.code,
        model: $('edu-ai-provider-model').value.trim(),
        api_base_url: $('edu-ai-provider-base-url').value.trim(),
        api_key: $('edu-ai-provider-key').value.trim(),
        account_id: $('edu-ai-cloudflare-account').value.trim(),
        input_cost_per_million: $('edu-ai-input-rate').value === '' ? null : Number($('edu-ai-input-rate').value),
        output_cost_per_million: $('edu-ai-output-rate').value === '' ? null : Number($('edu-ai-output-rate').value),
        daily_batch_limit: $('edu-ai-daily-batch-limit').value === '' ? null : Number($('edu-ai-daily-batch-limit').value),
        daily_question_limit: $('edu-ai-daily-question-limit').value === '' ? null : Number($('edu-ai-daily-question-limit').value),
        is_enabled: $('edu-ai-provider-enabled').checked,
      });
      $('edu-ai-provider-key').value = '';
      setFeedback('edu-ai-provider-feedback', result.message || 'Provider configuration saved securely.', true);
      await loadProviders();
      $('edu-ai-provider-select').value = p.code;
      showSelectedProvider();
    } catch (error) { setFeedback('edu-ai-provider-feedback', error.message); }
    finally { busy = false; setButtonBusy('edu-ai-provider-save', false); }
  }

  async function testProvider() {
    if (busy) return;
    const p = selectedProvider();
    if (!p) { setFeedback('edu-ai-provider-feedback', 'Choose a provider.'); return; }
    busy = true; setButtonBusy('edu-ai-provider-test', true, 'Testing API connection…');
    try {
      const result = await invoke({ action: 'test_provider', provider_code: p.code });
      setFeedback('edu-ai-provider-feedback', result.message || 'Provider connection succeeded.', true);
      await loadProviders();
      $('edu-ai-provider-select').value = p.code;
      showSelectedProvider();
    } catch (error) { setFeedback('edu-ai-provider-feedback', error.message); await loadProviders(); $('edu-ai-provider-select').value = p.code; showSelectedProvider(); }
    finally { busy = false; setButtonBusy('edu-ai-provider-test', false); }
  }

  function optionText(question) {
    if (!Array.isArray(question.options) || !question.options.length) return 'Fill in the gap';
    return question.options.map(o => `${o.key || ''}. ${o.text || ''}`).join(' · ');
  }
  function applyReviewFilters() {
    const host = $('edu-ai-review-queue');
    if (!host) return;
    const needle = ($('edu-ai-review-search')?.value || '').trim().toLowerCase();
    const status = $('edu-ai-review-filter')?.value || 'all';
    const cards = [...host.querySelectorAll('.edu-ai-review-card')];
    let visible = 0;
    cards.forEach(card => {
      const statusMatch = status === 'all' || card.dataset.reviewStatus === status;
      const searchMatch = !needle || (card.dataset.search || '').includes(needle);
      const show = statusMatch && searchMatch;
      card.hidden = !show;
      if (show) visible++;
    });
    const note = $('edu-ai-review-visible');
    if (note) note.textContent = `${visible} of ${cards.length} draft(s) shown`;
  }

  function isVerifiedSyllabusMapping(mapping) {
    const status = String(mapping?.verification_status || '').toLowerCase();
    return !!mapping?.is_active && ['reviewed', 'official_source_verified'].includes(status);
  }

  function updateBulkPublishButton(hasApprovedItems = true, approvedCount = null) {
    const buttons = [$('edu-ai-publish-approved'), $('edu-ai-publish-approved-top')].filter(Boolean);
    const status = $('edu-ai-workflow-status');
    const label = publishBusy ? 'Publishing…' : `Publish approved to students${Number.isFinite(approvedCount) ? ` (${approvedCount})` : ''}`;
    buttons.forEach(button => {
      button.disabled = publishBusy || !hasApprovedItems;
      button.textContent = label;
      button.title = 'Publishes only approved, inactive AI questions with an active syllabus mapping marked Reviewed or Official source verified.';
    });
    if (status && Number.isFinite(approvedCount)) {
      status.textContent = approvedCount ? `${approvedCount} approved question(s) waiting for publication` : 'No approved questions waiting for publication';
    }
  }

  async function findPublishableApprovedDrafts() {
    const pageSize = 250;
    const candidates = [];
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await FX.client.from('edu_questions')
        .select('id,ai_syllabus_mapping_id,subject_code,exam_codes')
        .eq('source_type', 'ai_draft').eq('review_status', 'approved').eq('is_active', false)
        .order('created_at', { ascending: false }).range(offset, offset + pageSize - 1);
      if (error) throw error;
      const page = data || [];
      candidates.push(...page);
      if (page.length < pageSize) break;
    }
    const publishable = [];
    const mappingPageSize = 150;
    for (let offset = 0; offset < candidates.length; offset += mappingPageSize) {
      const page = candidates.slice(offset, offset + mappingPageSize);
      const mappingIds = [...new Set(page.map(q => q.ai_syllabus_mapping_id).filter(Boolean))];
      let mappings = [];
      if (mappingIds.length) {
        const { data, error } = await FX.client.from('edu_subject_topic_exam_map')
          .select('id,is_active,verification_status').in('id', mappingIds);
        if (error) throw error;
        mappings = data || [];
      }
      const byId = new Map(mappings.map(m => [m.id, m]));
      page.forEach(q => { if (isVerifiedSyllabusMapping(byId.get(q.ai_syllabus_mapping_id))) publishable.push(q); });
    }
    return { totalApproved: candidates.length, eligible: publishable };
  }

  async function publishApprovedDraftsToStudents() {
    const button = $('edu-ai-publish-approved') || $('edu-ai-publish-approved-top');
    const feedbackId = 'edu-ai-publish-feedback';
    if (publishBusy || !button) return;
    publishBusy = true;
    updateBulkPublishButton();
    setFeedback(feedbackId, 'Checking approved drafts and syllabus verification…');
    let published = 0;
    try {
      const { totalApproved, eligible } = await findPublishableApprovedDrafts();
      const skipped = Math.max(0, totalApproved - eligible.length);
      if (!totalApproved) {
        setFeedback(feedbackId, 'There are no approved, unpublished AI drafts to send. Review and approve drafts first.');
        return;
      }
      if (!eligible.length) {
        setFeedback(feedbackId, `${totalApproved} approved draft(s) found, but none has an active Reviewed or Official source verified syllabus mapping. Verify the mapping in Syllabus Manager first.`);
        return;
      }
      const examSummary = [...new Set(eligible.flatMap(q => q.exam_codes || []))].sort().join(', ');
      const confirmed = window.confirm(
        `Publish ${eligible.length} approved question(s) to the EDU-AFRIKA student question bank?\n\n` +
        `${skipped} approved draft(s) will be skipped because their syllabus mapping is missing, inactive or not verified.\n\n` +
        `Examination destinations: ${examSummary || 'As tagged on each question'}.\n\n` +
        `Students will see the newly available subjects/questions when they refresh EDU-AFRIKA. This does not start a live exam or send a push notification.`
      );
      if (!confirmed) {
        setFeedback(feedbackId, 'Publication cancelled. No questions were changed.');
        return;
      }
      const actorId = window.FX?.user?.id || null;
      const batchSize = 100;
      for (let offset = 0; offset < eligible.length; offset += batchSize) {
        const batch = eligible.slice(offset, offset + batchSize).map(q => q.id);
        const now = new Date().toISOString();
        const { error } = await FX.client.from('edu_questions').update({
          review_status: 'published', is_active: true, ai_reviewed_by: actorId,
          ai_reviewed_at: now, updated_at: now
        }).in('id', batch).eq('source_type', 'ai_draft').eq('review_status', 'approved').eq('is_active', false);
        if (error) throw error;
        published += batch.length;
        setFeedback(feedbackId, `Publishing approved questions… ${published} of ${eligible.length} processed.`, true);
      }
      await Promise.all([loadReviewQueue(), loadHistory()]);
      if (typeof window.refreshEduAfrikaAdmin === 'function') window.refreshEduAfrikaAdmin().catch(() => {});
      setFeedback(feedbackId, `Success: ${published} approved question(s) are now active in the student question bank. ${skipped} unverified draft(s) were left unpublished. Students should refresh EDU-AFRIKA to see updated subject availability.`, true);
    } catch (error) {
      setFeedback(feedbackId, `${published} question(s) were published before an error occurred: ${error.message || 'Unable to complete publication'}. Refresh the review queue and run the button again for the remaining approved drafts.`);
    } finally {
      publishBusy = false;
      // Refreshing the queue recalculates the eligible count; retain a safe disabled state if it fails.
      try { await loadReviewQueue(); } catch (_) { updateBulkPublishButton(true); }
    }
  }

  function renderReviewQueue(rows) {
    const host = $('edu-ai-review-queue');
    if (!host) return;
    const reviewCount = rows.filter(q => ['draft','review'].includes(String(q.review_status || '').toLowerCase())).length;
    const approvedCount = rows.filter(q => q.review_status === 'approved').length;
    $('edu-ai-review-count').textContent = `${rows.length} DRAFTS · ${reviewCount} TO APPROVE · ${approvedCount} APPROVED`;
    if (!rows.length) {
      host.innerHTML = '<p class="edu-admin-empty">No AI drafts are waiting for review or publication.</p>';
      const note = $('edu-ai-review-visible'); if (note) note.textContent = '0 drafts';
      updateBulkPublishButton(false, 0);
      return;
    }
    host.innerHTML = rows.map(q => {
      const flags = Array.isArray(q.ai_quality_flags) ? q.ai_quality_flags : [];
      const options = optionText(q);
      const syllabusStatus = String(q.current_syllabus_verification_status || q.ai_syllabus_verification_status || 'draft').replace(/_/g, ' ').toUpperCase();
      const canPublish = !!q.current_syllabus_mapping_active && ['reviewed','official_source_verified'].includes(String(q.current_syllabus_verification_status || '').toLowerCase());
      const sourceCandidate = q.current_syllabus_source_url || q.ai_syllabus_source_url || '';
      const safeSyllabusUrl = /^https?:\/\//i.test(String(sourceCandidate)) ? String(sourceCandidate) : '';
      const syllabusSource = safeSyllabusUrl ? `<a href="${esc(safeSyllabusUrl)}" target="_blank" rel="noopener noreferrer">Open syllabus source ↗</a>` : '<span>No official source URL recorded</span>';
      const exams = (q.exam_codes || []).join(', ');
      const searchable = [q.question_text, q.subject_code, exams, q.topic_code, q.correct_answer, q.ai_provider_code].join(' ').toLowerCase();
      const needsApproval = ['draft','review'].includes(String(q.review_status || '').toLowerCase());
      const quickAction = needsApproval
        ? `<button type="button" class="edu-ai-quick-action" data-ai-review-action="approve" data-id="${esc(q.id)}">Approve question</button>`
        : canPublish
          ? `<button type="button" class="edu-ai-quick-action is-publish" data-ai-review-action="publish" data-id="${esc(q.id)}">Publish to students</button>`
          : `<button type="button" class="edu-ai-quick-action" disabled title="Verify the examination mapping first">Awaiting syllabus verification</button>`;
      const actions = needsApproval
        ? `<button type="button" data-ai-review-action="edit" data-id="${esc(q.id)}">Edit in question bank</button><button type="button" data-ai-review-action="approve" data-id="${esc(q.id)}">Approve question</button><button type="button" class="is-danger" data-ai-review-action="reject" data-id="${esc(q.id)}">Reject</button>`
        : `<button type="button" data-ai-review-action="edit" data-id="${esc(q.id)}">Edit in question bank</button>${canPublish?`<button type="button" data-ai-review-action="publish" data-id="${esc(q.id)}">Publish to students</button>`:'<button type="button" disabled title="Verify the examination mapping first">Awaiting syllabus verification</button>'}<button type="button" class="is-danger" data-ai-review-action="reject" data-id="${esc(q.id)}">Reject</button>`;
      return `<details class="edu-ai-review-card" data-review-status="${esc(q.review_status || 'review')}" data-search="${esc(searchable)}"><summary class="edu-ai-review-summary"><span class="edu-ai-review-summary-main"><span class="edu-ai-review-summary-meta"><span class="edu-admin-status ${q.review_status === 'approved' ? '' : 'is-off'}">${esc((q.review_status || 'review').toUpperCase())}</span><b>${esc(q.subject_code)} · ${esc(exams)}</b><small>${esc(q.topic_code || 'No topic')} · ${esc(q.difficulty || '—')}</small></span><strong>${esc(q.question_text)}</strong></span><span class="edu-ai-review-summary-actions">${quickAction}</span><small class="edu-ai-review-summary-date">${esc(q.ai_provider_code || 'AI')} · ${esc(q.created_at || '')}</small></summary><div class="edu-ai-review-content"><p>${esc(options)}</p><div class="edu-ai-review-answer"><b>Proposed answer: ${esc(q.correct_answer)}</b><span>Explanation: ${esc(q.explanation || 'No explanation supplied')}</span><small>Topic: ${esc(q.topic_code || '—')} · Difficulty: ${esc(q.difficulty || '—')} · Marks: ${Number(q.marks || 0)}</small></div><div class="edu-ai-syllabus-verification"><b>Topic-to-examination mapping: ${esc(syllabusStatus)}</b>${syllabusSource}</div><div class="edu-ai-quality-flags"><b>Quality-control flags</b>${flags.length ? flags.map(flag => `<span>${esc(flag)}</span>`).join('') : '<span>No flags recorded; human review still required.</span>'}</div><footer class="edu-row-actions">${actions}</footer></div></details>`;
    }).join('');
    applyReviewFilters();
    updateBulkPublishButton(approvedCount > 0, approvedCount);
  }

  async function loadReviewQueue() {
    const host = $('edu-ai-review-queue');
    host.innerHTML = '<p class="edu-admin-empty">Loading AI question review queue…</p>';
    const { data, error } = await FX.client.from('edu_questions')
      .select('id,question_text,subject_code,exam_codes,question_type,options,correct_answer,explanation,marks,difficulty,topic_code,review_status,is_active,ai_quality_flags,ai_provider_code,ai_model,ai_syllabus_verification_status,ai_syllabus_source_url,ai_syllabus_mapping_id,created_at')
      .eq('source_type','ai_draft').in('review_status',['draft','review','approved'])
      .order('created_at',{ascending:false}).limit(100);
    if (error) throw error;
    const rows=data||[];
    const mappingIds=[...new Set(rows.map(q=>q.ai_syllabus_mapping_id).filter(Boolean))];
    let mappingRows=[];
    if(mappingIds.length){
      const mappingResult=await FX.client.from('edu_subject_topic_exam_map').select('id,is_active,verification_status,source_url').in('id',mappingIds);
      if(mappingResult.error)throw mappingResult.error;
      mappingRows=mappingResult.data||[];
    }
    const byId=new Map(mappingRows.map(m=>[m.id,m]));
    renderReviewQueue(rows.map(q=>{
      const mapping=byId.get(q.ai_syllabus_mapping_id);
      return {...q,current_syllabus_verification_status:mapping?.verification_status||q.ai_syllabus_verification_status||'draft',current_syllabus_mapping_active:!!mapping?.is_active,current_syllabus_source_url:mapping?.source_url||q.ai_syllabus_source_url||''};
    }));
  }

  function editInQuestionBank(id, text, status) {
    const source = $('edu-bank-source'); const review = $('edu-bank-review'); const search = $('edu-bank-search');
    source.value = 'ai_draft'; review.value = status || 'review'; search.value = text.slice(0, 100);
    $('edu-bank-search-button').click();
    const editor = $('edu-question-form');
    setTimeout(() => {
      const rowButton = document.querySelector(`[data-edu-action="edit"][data-id="${CSS.escape(id)}"]`);
      if (rowButton) rowButton.click();
      else editor.scrollIntoView({behavior:'smooth',block:'start'});
    }, 450);
  }

  async function reviewAction(event) {
    const button = event.target.closest('[data-ai-review-action]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const action = button.dataset.aiReviewAction;
    const id = button.dataset.id;
    const { data: question, error: loadError } = await FX.client.from('edu_questions').select('id,question_text,review_status,ai_syllabus_mapping_id').eq('id',id).single();
    if (loadError) { window.alert(loadError.message); return; }
    if (action === 'edit') { editInQuestionBank(id, question.question_text, question.review_status); return; }
    if(action==='publish'){
      if(!question.ai_syllabus_mapping_id){window.alert('This AI draft has no linked examination-topic mapping. Re-generate it after mapping the topic.');return;}
      const mappingResult=await FX.client.from('edu_subject_topic_exam_map').select('is_active,verification_status').eq('id',question.ai_syllabus_mapping_id).maybeSingle();
      if(mappingResult.error){window.alert(mappingResult.error.message);return;}
      if(!isVerifiedSyllabusMapping(mappingResult.data)){window.alert('Publishing is blocked until this topic-to-examination mapping is active and marked Reviewed or Official source verified in the Syllabus Manager.');return;}
    }
    if (action === 'approve' && !['draft','review'].includes(String(question.review_status || '').toLowerCase())) { window.alert('Only a draft awaiting review can be approved.'); return; }
    if (action === 'approve' && !window.confirm('Approve this question after checking its wording, options, answer and explanation? It will remain inactive until published.')) return;
    if (action === 'publish' && !window.confirm('Publish this approved question to students? It will become active and eligible for future student examinations.')) return;
    if (action === 'reject' && !window.confirm('Reject this AI-generated draft? It will remain in the bank but cannot be delivered to students.')) return;
    button.disabled = true;
    try {
      const actorId = window.FX?.user?.id || null;
      const patch = action === 'approve'
        ? { review_status:'approved', is_active:false, ai_reviewed_by:actorId, ai_reviewed_at:new Date().toISOString(), updated_at:new Date().toISOString() }
        : action === 'publish'
          ? { review_status:'published', is_active:true, ai_reviewed_by:actorId, ai_reviewed_at:new Date().toISOString(), updated_at:new Date().toISOString() }
          : { review_status:'rejected', is_active:false, ai_reviewed_by:actorId, ai_reviewed_at:new Date().toISOString(), updated_at:new Date().toISOString() };
      const { error } = await FX.client.from('edu_questions').update(patch).eq('id',id);
      if (error) throw error;
      await Promise.all([loadReviewQueue(), loadHistory()]);
      if (typeof window.refreshEduAfrikaAdmin === 'function') window.refreshEduAfrikaAdmin().catch(() => {});
      setFeedback('edu-ai-provider-feedback', action === 'publish' ? 'Question published to the student-eligible bank.' : action === 'approve' ? 'Question approved; it remains inactive until separately published.' : 'Question rejected and kept inactive.', true);
    } catch (error) { window.alert(error.message || 'Unable to update this question.'); }
    finally { button.disabled = false; }
  }

  function renderHistory(rows) {
    const host = $('edu-ai-history-table');
    const totalDrafts = rows.reduce((sum,r)=>sum+Number(r.accepted_count||0),0);
    const totalTokens = rows.reduce((sum,r)=>sum+Number(r.total_tokens||0),0);
    const totalDuplicates = rows.reduce((sum,r)=>sum+Number(r.duplicate_count||0),0);
    const pricedRows = rows.filter(r=>r.estimated_cost_usd !== null && r.estimated_cost_usd !== undefined);
    const estimatedCost = pricedRows.reduce((sum,r)=>sum+Number(r.estimated_cost_usd||0),0);
    $('edu-ai-usage-summary').innerHTML = [
      ['Generation batches',rows.length],['Saved drafts',totalDrafts],['Tokens reported',totalTokens.toLocaleString()],['Duplicates blocked',totalDuplicates],['Estimated cost (USD)',pricedRows.length ? '$'+estimatedCost.toFixed(4) : 'Unavailable']
    ].map(([label,value])=>`<article><small>${esc(label)}</small><b>${esc(value)}</b></article>`).join('');
    if (!rows.length) { host.innerHTML = '<p class="edu-admin-empty">No AI generation batches have been recorded yet.</p>'; return; }
    host.innerHTML = `<table class="admin-table"><thead><tr><th>Created</th><th>Provider / model</th><th>Destination</th><th>Requested / accepted</th><th>Duplicates / invalid</th><th>Tokens</th><th>Estimated cost (USD)</th><th>Status</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(new Date(r.created_at).toLocaleString())}<small>Batch ${esc(String(r.id).slice(0,8))}</small></td><td><b>${esc(r.provider_name)}</b><small>${esc(r.model)}</small></td><td>${esc(r.exam_code)}<small>${esc(r.subject_code)}${r.programme_id?' · programme':''}${r.topic_code?' · '+esc(r.topic_code):''}</small></td><td>${Number(r.requested_count||0)} / <b>${Number(r.accepted_count||0)}</b></td><td>${Number(r.duplicate_count||0)} / ${Number(r.invalid_count||0)}</td><td>${Number(r.total_tokens||0).toLocaleString()}<small>Input ${Number(r.input_tokens||0).toLocaleString()} · Output ${Number(r.output_tokens||0).toLocaleString()}</small></td><td>${r.estimated_cost_usd===null||r.estimated_cost_usd===undefined?'Unavailable':'$'+Number(r.estimated_cost_usd).toFixed(6)}</td><td><span class="edu-admin-status ${r.status==='completed'?'':'is-off'}">${esc(String(r.status||'').toUpperCase())}</span>${r.error_message?`<small>${esc(r.error_message)}</small>`:''}</td></tr>`).join('')}</tbody></table>`;
  }

  async function loadHistory() {
    const host = $('edu-ai-history-table');
    host.innerHTML = '<p class="edu-admin-empty">Loading AI generation history…</p>';
    const { data, error } = await FX.client.from('edu_ai_generation_batches')
      .select('id,provider_name,model,exam_code,subject_code,programme_id,topic_code,requested_count,generated_count,accepted_count,duplicate_count,invalid_count,status,input_tokens,output_tokens,total_tokens,duration_ms,estimated_cost_usd,error_message,created_at')
      .order('created_at',{ascending:false}).limit(100);
    if (error) throw error;
    renderHistory(data || []);
  }

  async function refreshAll() {
    const tasks = await Promise.allSettled([loadProviders(),loadReviewQueue(),loadHistory()]);
    const failed = tasks.filter(t => t.status === 'rejected');
    if (failed.length) console.warn('Some EDU-AFRIKA AI production panels could not refresh:', failed.map(x=>x.reason));
  }

  function bind() {
    $('edu-ai-provider-select')?.addEventListener('change',showSelectedProvider);
    $('edu-ai-provider-save')?.addEventListener('click',saveProvider);
    $('edu-ai-provider-test')?.addEventListener('click',testProvider);
    $('edu-ai-provider-directory')?.addEventListener('click',event=>{
      const button=event.target.closest('[data-ai-provider-pick]'); if(!button)return;
      $('edu-ai-provider-select').value=button.dataset.aiProviderPick; showSelectedProvider();
      $('edu-ai-provider-select').scrollIntoView({behavior:'smooth',block:'center'});
    });
    $('edu-ai-review-queue')?.addEventListener('click',reviewAction);
    $('edu-ai-publish-approved')?.addEventListener('click',publishApprovedDraftsToStudents);
    document.addEventListener('click', event => { if (event.target.closest('#edu-ai-publish-approved-top')) publishApprovedDraftsToStudents(); });
    window.addEventListener('eduAiPublishApprovedRequested', publishApprovedDraftsToStudents);
    $('edu-ai-review-search')?.addEventListener('input',applyReviewFilters);
    $('edu-ai-review-filter')?.addEventListener('change',applyReviewFilters);
    $('edu-ai-review-refresh')?.addEventListener('click',()=>loadReviewQueue().catch(e=>setFeedback('edu-ai-provider-feedback',e.message)));
    $('edu-ai-history-refresh')?.addEventListener('click',()=>loadHistory().catch(e=>{ $('edu-ai-history-table').innerHTML=`<p class="edu-admin-empty">${esc(e.message)}</p>`; }));
    $('admin-refresh')?.addEventListener('click',()=>refreshAll());
    window.addEventListener('eduAiBatchCreated',()=>{loadReviewQueue().catch(()=>{});loadHistory().catch(()=>{});});
    window.addEventListener('eduAiReviewUpdated',()=>{loadReviewQueue().catch(()=>{});loadHistory().catch(()=>{});});
  }

  let startAttempts = 0;
  async function start() {
    if (!window.FX?.client) { if (++startAttempts < 40) setTimeout(start, 150); return; }
    try {
      await window.FX.loadUser();
      const access = await window.FX.admin('verify_access');
      if (!access?.ok || !access.staff_session_valid || !['admin','owner'].includes(access.role)) throw new Error('An active Frnxup admin/owner staff session is required.');
      bind(); refreshAll();
    } catch (error) {
      const host = $('edu-ai-provider-directory');
      if (host) host.innerHTML = `<p class="edu-admin-empty">${esc(error.message || 'Admin authentication is required to open the AI Production Centre.')}</p>`;
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
