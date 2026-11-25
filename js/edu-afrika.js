(() => {
  const $ = (id) => document.getElementById(id);
  const state = { user:null, email:'', name:'Student', password:'', exams:[], subjects:[], programmes:[], activeExam:null, programmeRequired:false, requiredMissing:[], questions:[], attempt:null, currentIndex:0, timer:null, timerEnabled:true, autoAdvancing:false, timerVersion:0, saveTimers:new Map(), examTypes:[], history:[], topicKey:'', topics:[] }; 
  const sections = ['edu-loading','edu-create-panel','edu-login-panel','edu-password-issued','edu-workspace','edu-exam-view','edu-result-view'];
  const show = (id) => { sections.forEach(key => { if ($(key)) $(key).hidden = key !== id; }); };
  const errText = (error) => error?.message || 'The request could not be completed. Please try again.';
  function message(text, kind='error') {
    const box = $('edu-error');
    box.textContent = text || '';
    box.hidden = !text;
    box.dataset.kind = kind;
  }
  function toast(text) {
    const box = $('edu-toast');
    box.textContent = text;
    box.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => box.classList.remove('show'), 3000);
  }
  async function rpc(name, args={}) {
    if (!window.FX?.client) throw new Error('Frnxup is not connected to Supabase.');
    const { data, error } = await FX.client.rpc(name, args);
    if (error) throw error;
    return data;
  }
  function setBusy(button, busy, label='Please wait…') {
    if (!button) return;
    if (busy) { button.dataset.originalLabel = button.textContent; button.textContent = label; button.disabled = true; }
    else { button.textContent = button.dataset.originalLabel || button.textContent; button.disabled = false; delete button.dataset.originalLabel; }
  }
  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(+date) ? '' : date.toLocaleDateString([], {day:'numeric',month:'short',year:'numeric'});
  }
  function examName(code) { return state.examTypes.find(x => x.code === code)?.name || code || 'Practice test'; }
  function subjectName(code) { return state.subjects.find(x => x.code === code)?.name || code; }
  function hideMessageSoon() { setTimeout(() => message(''), 4200); }

  async function init() {
    show('edu-loading');
    message('');
    if (window.__frnxupAuthGateTimer) clearTimeout(window.__frnxupAuthGateTimer);
    if (!FX?.configured || !FX?.client) {
      show('edu-login-panel');
      $('edu-login-panel').hidden = true;
      message('Frnxup is not connected to Supabase. Check the public settings in js/config.js and reload this page.');
      return;
    }
    state.user = await FX.loadUser();
    if (!state.user) return; // core.js sends signed-out visitors to the Frnxup sign-in page.
    await FX.loadProfile();
    await FX.verifyAccountStatus();
    state.email = state.user.email || '';
    state.name = FX.profile?.display_name || FX.profile?.username || state.user.user_metadata?.display_name || 'Student';
    $('edu-top-email').textContent = state.email;
    $('edu-create-email').value = state.email;
    $('edu-login-email').value = state.email;
    try {
      const status = await rpc('edu_portal_status');
      state.name = status?.display_name || state.name;
      $('edu-student-name').textContent = state.name;
      $('edu-top-email').textContent = status?.email || state.email;
      if (status?.registered) {
        show('edu-login-panel');
        $('edu-login-password').focus();
      } else {
        show('edu-create-panel');
      }
    } catch (error) {
      show('edu-create-panel');
      message(errText(error));
      hideMessageSoon();
    }
  }

  function displayIssuedPassword(password) {
    if (!password) throw new Error('The password could not be generated. Please try again.');
    state.password = password; // Kept in memory only; never written to localStorage/sessionStorage.
    $('edu-issued-password-value').textContent = password;
    $('edu-password-saved').checked = false;
    $('edu-continue-issued').disabled = true;
    $('edu-copy-password').textContent = 'Copy';
    message('');
    show('edu-password-issued');
  }

  async function createAccount() {
    const button = $('edu-create-account');
    if (!$('edu-confirm-account').checked) { message('Please confirm that you will save the one-time password before creating your account.'); return; }
    setBusy(button, true, 'Creating account…');
    message('');
    try {
      const data = await rpc('edu_register_student');
      displayIssuedPassword(data?.password);
      toast('Your EDU-AFRIKA account has been created.');
    } catch (error) { message(errText(error)); }
    finally { setBusy(button, false); }
  }

  async function login() {
    const button = $('edu-login-button');
    const password = $('edu-login-password').value.trim();
    if (!password) { message('Enter your EDU-AFRIKA password.'); return; }
    setBusy(button, true, 'Signing in…');
    message('');
    try {
      await rpc('edu_student_login', {p_password:password});
      state.password = password;
      $('edu-login-password').value = '';
      await unlockWorkspace();
      toast('You are signed in to EDU-AFRIKA.');
    } catch (error) { message(errText(error)); }
    finally { setBusy(button, false); }
  }

  async function recoverPassword() {
    if (!confirm('Generate a new EDU-AFRIKA password for the Frnxup account that is currently signed in? Your old EDU password will stop working.')) return;
    const button = $('edu-recover-button');
    setBusy(button, true, 'Generating password…');
    message('');
    try {
      const data = await rpc('edu_recover_password');
      displayIssuedPassword(data?.password);
      toast('A new EDU-AFRIKA password has been generated.');
    } catch (error) { message(errText(error)); }
    finally { setBusy(button, false); }
  }

  async function unlockWorkspace() {
    message('');
    show('edu-workspace');
    $('edu-student-name').textContent = state.name;
    $('edu-top-email').textContent = state.email;
    await loadCatalog();
    await loadHistory();
    await loadStudentAnalytics();
    await checkActiveAttempt();
  }

  async function loadCatalog() {
    const [examResult] = await Promise.all([
      FX.client.from('edu_exam_types').select('code,name,category,duration_minutes,default_question_count,requires_course_selection,course_selection_label').eq('is_active',true).order('sort_order').order('name')
    ]);
    if (examResult.error) throw examResult.error;
    state.examTypes = examResult.data || [];
    const select = $('edu-exam-type');
    select.innerHTML = '<option value="">Choose your examination</option>' + state.examTypes.map(x => `<option value="${FX.esc(x.code)}">${FX.esc(x.name)} · ${FX.esc(x.category)}</option>`).join('');
    $('edu-subject-list').innerHTML = '<p class="edu-muted">Choose an examination to view subjects with approved questions.</p>';
    $('edu-exam-meta').textContent = `${state.examTypes.length} examination options are available.`;
    const requestedExam = (new URLSearchParams(location.search).get('exam') || '').toUpperCase();
    if (requestedExam && state.examTypes.some(x => x.code === requestedExam)) {
      select.value = requestedExam;
      await loadSubjects(requestedExam);
    }
    updateExamPageLink();
    loadRevisionTopics();
  }

  async function loadSubjects(examCode) {
    const host = $('edu-subject-list');
    host.innerHTML = '<p class="edu-muted">Loading eligible subjects and course combinations…</p>';
    state.subjects = [];
    state.programmes = [];
    state.topicKey = ''; state.topics = [];
    if ($('edu-revision-topic')) $('edu-revision-topic').innerHTML = '<option value="">Choose a topic</option>';
    if ($('edu-revision-topic-wrap')) $('edu-revision-topic-wrap').hidden = $('edu-exam-mode')?.value !== 'revision';
    state.activeExam = state.examTypes.find(x => x.code === examCode) || null;
    state.programmeRequired = !!state.activeExam?.requires_course_selection;
    state.requiredMissing = [];
    $('edu-subject-count').textContent = '0 selected';
    $('edu-start-button').disabled = true;
    const exam = state.activeExam;
    if (!examCode || !exam) {
      host.innerHTML = '<p class="edu-muted">Choose an examination to view subjects.</p>';
      $('edu-exam-meta').textContent='';
      $('edu-programme-wrap').hidden = true;
      $('edu-manual-path-wrap').hidden = false;
      return;
    }
    try {
      const [available, programmeRows] = await Promise.all([
        rpc('edu_available_subjects', {p_exam_code:examCode,p_programme_id:null}),
        rpc('edu_get_exam_programmes', {p_exam_code:examCode})
      ]);
      state.subjects = Array.isArray(available) ? available : [];
      state.programmes = Array.isArray(programmeRows) ? programmeRows : [];
      $('edu-exam-meta').textContent = `${exam.category} · ${exam.duration_minutes} minutes · Up to 400 questions`;
      const needsCombination = state.programmeRequired || state.programmes.length > 0;
      $('edu-programme-wrap').hidden = !needsCombination;
      $('edu-manual-path-wrap').hidden = needsCombination;
      if (needsCombination) {
        $('edu-programme-label').textContent = exam.course_selection_label || 'Course / subject combination';
        $('edu-programme-select').innerHTML = '<option value="">Choose your course / combination</option>' + state.programmes.map(p => {
          const label = `${p.name}${p.institution_name ? ` · ${p.institution_name}` : ''}${p.syllabus_year ? ` · ${p.syllabus_year}` : ''}`;
          return `<option value="${FX.esc(p.id)}">${FX.esc(label)}</option>`;
        }).join('');
        $('edu-programme-select').value = '';
        $('edu-programme-help').textContent = state.programmes.length
          ? 'Your selected programme controls the allowed subject combination. Required subjects are locked; optional subjects can be selected where permitted.'
          : 'No verified course combinations have been published for this examination yet. An EDU-AFRIKA administrator must verify and publish the combinations before students can start.';
        host.innerHTML = '<p class="edu-muted">Choose your course / subject combination first. The matching subjects will appear here.</p>';
        $('edu-study-path').value = '';
      } else {
        $('edu-programme-select').innerHTML = '<option value="">Choose your course / combination</option>';
        if (!state.subjects.length) {
          host.innerHTML = '<p class="edu-muted">No published questions are available for this examination yet. Please check again after the EDU-AFRIKA administrators publish the subject question bank.</p>';
        } else {
          host.innerHTML = state.subjects.map(subject => `<label class="edu-subject-option"><input type="checkbox" value="${FX.esc(subject.code)}" ${Number(subject.unused_question_count||0)<=0?'disabled':''}><span>${FX.esc(subject.name)}<small>${Number(subject.question_count)||0} approved · ${Number(subject.unused_question_count)||0} never-issued</small></span></label>`).join('');
          host.querySelectorAll('input').forEach(input => input.addEventListener('change', updateSelection));
          applyStudyPath();
        }
      }
      $('edu-question-count').value = String(Math.min(400, Math.max(10, Number(exam.default_question_count || 20))));
      updateExamPageLink();
      updateSelection();
      loadRevisionTopics();
    } catch (error) {
      host.innerHTML = `<p class="edu-muted">${FX.esc(errText(error))}</p>`;
      $('edu-programme-wrap').hidden = true;
      $('edu-manual-path-wrap').hidden = false;
    }
  }

  function selectedProgramme() {
    const id = $('edu-programme-select')?.value || '';
    return state.programmes.find(p => p.id === id) || null;
  }

  async function renderProgrammeSubjects() {
    const programme = selectedProgramme();
    const host = $('edu-subject-list');
    state.requiredMissing = [];
    if (!programme) {
      host.innerHTML = '<p class="edu-muted">Choose your course / subject combination first.</p>';
      $('edu-programme-help').textContent = state.programmes.length
        ? 'Your selected programme controls the allowed subject combination.'
        : 'No verified course combinations have been published for this examination yet.';
      updateSelection();
      return;
    }
    host.innerHTML = '<p class="edu-muted">Loading questions for your selected course combination…</p>';
    try {
      const scopedRows = await rpc('edu_available_subjects', {p_exam_code:state.activeExam.code,p_programme_id:programme.id});
      if (selectedProgramme()?.id !== programme.id) return;
      state.subjects = Array.isArray(scopedRows) ? scopedRows : [];
    } catch (error) { host.innerHTML = `<p class="edu-muted">${FX.esc(errText(error))}</p>`; return; }
    const availableMap = new Map(state.subjects.map(x => [x.code, x]));
    const required = new Set(programme.required_subject_codes || []);
    const allowed = new Set(programme.allowed_subject_codes || []);
    const visible = state.subjects.filter(s => allowed.has(s.code));
    state.requiredMissing = [...required].filter(code => !availableMap.has(code) || Number(availableMap.get(code)?.unused_question_count || 0) <= 0);
    const rules = programme.selection_rules || {};
    const groups = Array.isArray(rules.groups) ? rules.groups : [];
    const renderSubject = subject => {
      const isRequired = required.has(subject.code);
      const count = Number(subject.question_count) || 0;
      const fresh = Number(subject.unused_question_count) || 0;
      return `<label class="edu-subject-option ${isRequired?'is-required':''}"><input type="checkbox" value="${FX.esc(subject.code)}" ${isRequired?'checked disabled':''} ${fresh<=0?'disabled':''}><span>${FX.esc(subject.name)}${isRequired?'<small class="edu-required-tag">REQUIRED</small>':''}<small>${count.toLocaleString()} approved · ${fresh.toLocaleString()} never-issued</small></span></label>`;
    };
    let rows = '';
    const groupedCodes = new Set();
    for (const group of groups) {
      const codes = Array.isArray(group.subject_codes) ? group.subject_codes : [];
      codes.forEach(code=>groupedCodes.add(code));
      const groupSubjects = visible.filter(subject=>codes.includes(subject.code));
      const min = Number(group.min_select||0), max = Number(group.max_select??codes.length);
      rows += `<section class="edu-subject-group"><div><b>${FX.esc(group.label||'Subject group')}</b><small>Choose ${min===max?min:`${min}–${max}`} subject(s) · ${groupSubjects.length} available in this question bank</small></div><div class="edu-subject-group-options">${groupSubjects.map(renderSubject).join('')||'<p class="edu-muted">No unused published questions are currently available in this group.</p>'}</div></section>`;
    }
    const ungrouped = visible.filter(subject=>!groupedCodes.has(subject.code));
    if (ungrouped.length) rows += `${groups.length?'<section class="edu-subject-group"><div><b>Other allowed subjects</b><small>Subject options outside configured groups</small></div>':''}<div class="edu-subject-group-options">${ungrouped.map(renderSubject).join('')}</div>${groups.length?'</section>':''}`;
    if (!groups.length) rows = visible.map(renderSubject).join('');
    host.innerHTML = rows || '<p class="edu-muted">No published questions exist for this course combination yet.</p>';
    host.querySelectorAll('input:not(:disabled)').forEach(input => input.addEventListener('change', updateSelection));
    const rule = `${programme.instructions || 'Select only subjects approved for this combination.'} Subject count: ${programme.min_subject_count}–${programme.max_subject_count}.`;
    $('edu-programme-help').textContent = rule;
    if (state.requiredMissing.length) {
      $('edu-selection-message').textContent = `The question bank is missing required subject(s): ${state.requiredMissing.join(', ')}. Administrators must publish questions for these subjects.`;
    }
    updateSelection();
  }
  function examSlug(code) { return String(code || '').toLowerCase().replace(/_/g, '-'); }
  function updateExamPageLink() {
    const button = $('edu-open-exam-page');
    const code = $('edu-exam-type')?.value;
    if (!button) return;
    button.disabled = !code;
    button.onclick = code ? () => { location.href = `/Edu-Afrika/exams/${examSlug(code)}.html`; } : null;
  }

  function selectedSubjects() { return [...$('edu-subject-list').querySelectorAll('input[type="checkbox"]:checked')].map(input => input.value); }
  function applyStudyPath() {
    const recommendations = {
      SCIENCE_HEALTH:['ENGLISH','MATHEMATICS','BIOLOGY','CHEMISTRY','PHYSICS'],
      ENGINEERING_TECH:['ENGLISH','MATHEMATICS','PHYSICS','CHEMISTRY','FURTHER_MATHS','COMPUTER_STUDIES','TECH_DRAWING'],
      BUSINESS_ACCOUNTING:['ENGLISH','MATHEMATICS','ECONOMICS','COMMERCE','ACCOUNTING','BUSINESS_STUDIES'],
      ARTS_HUMANITIES:['ENGLISH','LITERATURE','GOVERNMENT','HISTORY','GEOGRAPHY','CIVIC_EDUCATION'],
      LAW_SOCIAL:['ENGLISH','LITERATURE','GOVERNMENT','HISTORY','ECONOMICS','CIVIC_EDUCATION'],
      AGRICULTURE:['ENGLISH','MATHEMATICS','BIOLOGY','CHEMISTRY','AGRIC_SCIENCE','GEOGRAPHY'],
      EDUCATION:['ENGLISH','MATHEMATICS','BIOLOGY','GOVERNMENT','LITERATURE','HISTORY'],
      GENERAL:['ENGLISH','MATHEMATICS','GENERAL_KNOWLEDGE']
    };
    const path = $('edu-study-path')?.value;
    const suggested = recommendations[path] || [];
    const available = $('edu-subject-list').querySelectorAll('input[type="checkbox"]');
    available.forEach(input => { input.checked = suggested.includes(input.value); });
    updateSelection();
  }
  async function loadRevisionTopics() {
    const wrap = $('edu-revision-topic-wrap');
    const select = $('edu-revision-topic');
    if (!wrap || !select) return;
    const isRevision = $('edu-exam-mode')?.value === 'revision';
    wrap.hidden = !isRevision;
    if (!isRevision) return;
    const selected = selectedSubjects();
    if (!state.activeExam || !selected.length) {
      state.topicKey = ''; state.topics = [];
      select.innerHTML = '<option value="">Choose subjects first</option>';
      return;
    }
    const key = `${state.activeExam.code}|${selected.slice().sort().join(',')}`;
    if (state.topicKey === key) return;
    state.topicKey = key;
    const previous = select.value;
    select.innerHTML = '<option value="">Loading topics…</option>';
    try {
      const rows = await rpc('edu_available_topics', {p_exam_code:state.activeExam.code,p_subject_codes:selected,p_programme_id:selectedProgramme()?.id || null});
      if (state.topicKey !== key) return;
      state.topics = Array.isArray(rows) ? rows : [];
      select.innerHTML = '<option value="">Choose a topic</option>' + state.topics.map(t => `<option value="${FX.esc(t.topic_code)}">${FX.esc(t.topic_name)} · ${Number(t.unused_question_count||0).toLocaleString()} unused</option>`).join('');
      if (state.topics.some(t => t.topic_code === previous)) select.value = previous;
      if (!state.topics.length) $('edu-selection-message').textContent = 'No unused approved questions are available for these subjects by topic. Ask an administrator to publish more topic-tagged questions.';
      updateSelection();
    } catch (error) {
      if (state.topicKey === key) { state.topicKey = ''; select.innerHTML = '<option value="">Topics could not be loaded</option>'; $('edu-selection-message').textContent = errText(error); }
    }
  }

  function updateSelection() {
    const selected = selectedSubjects();
    const mcq = $('edu-type-mcq').checked;
    const gap = $('edu-type-gap').checked;
    const exam = state.activeExam;
    const programme = selectedProgramme();
    const limit = programme ? Number(programme.max_subject_count || 12) : 12;
    const minimum = programme ? Number(programme.min_subject_count || 1) : 1;
    const needsProgramme = !!exam?.requires_course_selection || state.programmes.length > 0;
    let issue = '';
    if (needsProgramme && !programme) issue = state.programmes.length ? 'Choose your course / subject combination.' : 'This examination is waiting for administrators to verify and publish its course combinations.';
    else if (state.requiredMissing.length) issue = `Required subjects are not available yet: ${state.requiredMissing.join(', ')}.`;
    else if (selected.length < Number(programme?.selection_rules?.total_min ?? minimum) || selected.length > Number(programme?.selection_rules?.total_max ?? limit)) issue = programme ? `Select between ${Number(programme?.selection_rules?.total_min ?? minimum)} and ${Number(programme?.selection_rules?.total_max ?? limit)} subjects for this combination.` : 'Select at least one subject.';
    else if (programme && (programme.selection_rules?.groups||[]).some(group=>{const count=selected.filter(code=>(group.subject_codes||[]).includes(code)).length;return count<Number(group.min_select||0)||count>Number(group.max_select??(group.subject_codes||[]).length);})) {
      const unmet=(programme.selection_rules?.groups||[]).find(group=>{const count=selected.filter(code=>(group.subject_codes||[]).includes(code)).length;return count<Number(group.min_select||0)||count>Number(group.max_select??(group.subject_codes||[]).length);});
      const count=selected.filter(code=>(unmet.subject_codes||[]).includes(code)).length;
      issue=`${unmet.label||'Subject group'}: select between ${Number(unmet.min_select||0)} and ${Number(unmet.max_select??(unmet.subject_codes||[]).length)} subjects. You selected ${count}.`;
    }
    else if (selected.length > 12) issue = 'A maximum of 12 subjects can be selected.';
    else if (!mcq && !gap) issue = 'Choose at least one question format.';
    else if ($('edu-exam-mode')?.value === 'revision' && !$('edu-revision-topic')?.value) issue = state.topics.length ? 'Choose a topic for Revision Mode.' : 'No available topic questions were found for these subjects.';
    else if (selected.some(code => !(Number(state.subjects.find(x=>x.code===code)?.unused_question_count) > 0))) issue = 'One or more selected subjects have no never-issued questions left. Ask an administrator to publish more questions or choose another subject.';
    $('edu-subject-count').textContent = `${selected.length} selected`;
    $('edu-start-button').disabled = !!state.pendingAttempt || !!issue || !state.password || !exam;
    const count = Number($('edu-question-count').value || 20);
    if (count > 400) $('edu-question-count').value = '400';
    updateExamPageLink();
    $('edu-selection-message').textContent = issue;
    if ($('edu-exam-mode')?.value === 'revision') loadRevisionTopics();
  }

  async function checkActiveAttempt() {
    try {
      const data = await rpc('edu_get_active_attempt', {p_password:state.password});
      if (data?.active) {
        $('edu-resume-banner').hidden = false;
        $('edu-resume-caption').textContent = `${examName(data.exam_code)} · ${data.question_count} questions · started ${formatDate(data.started_at)}`;
        state.pendingAttempt = data;
        $('edu-start-button').disabled = true;
        $('edu-selection-message').textContent = 'Resume or submit your unfinished examination before starting another test.';
      } else {
        $('edu-resume-banner').hidden = true;
        state.pendingAttempt = null;
        updateSelection();
      }
    } catch (_) {
      $('edu-resume-banner').hidden = true;
      state.pendingAttempt = null;
      updateSelection();
    }
  }

  async function loadHistory() {
    try {
      const history = await rpc('edu_get_student_history', {p_password:state.password});
      state.history = Array.isArray(history) ? history : [];
      $('edu-attempt-total').textContent = String(state.history.filter(x => x.status !== 'in_progress').length);
      const percentages = state.history.filter(x => x.earned_marks !== null && Number(x.total_marks)>0).map(x => Number(x.earned_marks)/Number(x.total_marks)*100);
      $('edu-best-score').textContent = percentages.length ? `${Math.round(Math.max(...percentages))}%` : '—';
      if (!state.history.length) $('edu-history-list').innerHTML = '<p class="edu-muted">No completed practice tests yet. Start your first test when you are ready.</p>';
      else $('edu-history-list').innerHTML = state.history.slice(0,7).map(item => {
        const pct = item.earned_marks === null || !Number(item.total_marks) ? '—' : `${Math.round(Number(item.earned_marks)/Number(item.total_marks)*100)}%`;
        return `<div class="edu-history-item"><div><b>${FX.esc(examName(item.exam_code))}</b><span>${FX.esc((item.subject_codes||[]).map(subjectName).join(', '))} · ${formatDate(item.started_at)} · ${FX.esc(item.status)}</span></div><strong class="edu-history-score">${pct}</strong></div>`;
      }).join('');
    } catch (error) { $('edu-history-list').innerHTML = `<p class="edu-muted">${FX.esc(errText(error))}</p>`; }
  }

  async function loadStudentAnalytics() {
    const host = $('edu-student-analytics');
    const topicHost = $('edu-topic-analytics');
    if (!host) return;
    try {
      const [rows, topicRows] = await Promise.all([
        rpc('edu_get_student_analytics', {p_password:state.password}),
        rpc('edu_get_student_topic_analytics', {p_password:state.password})
      ]);
      const values = Array.isArray(rows) ? rows : [];
      if (!values.length) host.innerHTML = '<p class="edu-muted">Complete a test to unlock subject analytics.</p>';
      else host.innerHTML = values.map(x => `<div class="edu-analytics-row"><span>${FX.esc(subjectName(x.subject_code))}</span><b>${Number(x.accuracy||0).toFixed(1)}%</b><small>${Number(x.correct||0)} / ${Number(x.attempted||0)} correct</small><i><em style="width:${Math.max(0,Math.min(100,Number(x.accuracy)||0))}%"></em></i></div>`).join('');
      if (topicHost) {
        const topics = Array.isArray(topicRows) ? topicRows : [];
        topicHost.innerHTML = topics.length ? topics.map(x => `<div class="edu-analytics-row"><span>${FX.esc(subjectName(x.subject_code))} · ${FX.esc(x.topic_name||x.topic_code)}</span><b>${Number(x.accuracy||0).toFixed(1)}%</b><small>${Number(x.correct||0)} / ${Number(x.attempted||0)} correct</small><i><em style="width:${Math.max(0,Math.min(100,Number(x.accuracy)||0))}%"></em></i></div>`).join('') : '<p class="edu-muted">Topic analytics will appear after you complete topic-tagged questions.</p>';
      }
    } catch (error) { host.innerHTML = `<p class="edu-muted">${FX.esc(errText(error))}</p>`; if(topicHost)topicHost.innerHTML='<p class="edu-muted">Topic analytics are unavailable until the latest EDU-AFRIKA database migration is installed.</p>'; }
  }

  async function startExam() {
    const selected = selectedSubjects();
    const types = [$('edu-type-mcq').checked?'mcq':null,$('edu-type-gap').checked?'fill_gap':null].filter(Boolean);
    const count = Number($('edu-question-count').value || 20);
    if (!selected.length || selected.length > 12) { $('edu-selection-message').textContent = 'Select between one and twelve subjects, within your exam combination rules.'; return; }
    if (!types.length) { $('edu-selection-message').textContent = 'Choose at least one question format.'; return; }
    const button = $('edu-start-button');
    setBusy(button, true, 'Building your test…');
    $('edu-selection-message').textContent = '';
    try {
      const timerEnabled = $('edu-question-timer-toggle').checked;
      localStorage.setItem('edu-afrika-question-timer', timerEnabled ? 'on' : 'off');
      const data = await rpc('edu_start_exam', {p_password:state.password,p_exam_code:$('edu-exam-type').value,p_subject_codes:selected,p_types:types,p_question_count:Math.min(400, count),p_question_timer_enabled:timerEnabled,p_programme_id:$('edu-programme-select')?.value || null,p_exam_mode:$('edu-exam-mode')?.value || 'practice',p_topic_code:$('edu-exam-mode')?.value === 'revision' ? $('edu-revision-topic')?.value || null : null});
      if (!data?.questions?.length) throw new Error('The question bank returned an empty examination.');
      if (Number(data.question_count) < count) toast(`Only ${data.question_count} questions were allocated for this test.`);
      if (data.allocation_note) toast(data.allocation_note);
      launchAttempt(data);
    } catch (error) { $('edu-selection-message').textContent = errText(error); }
    finally { setBusy(button, false); updateSelection(); }
  }

  function launchAttempt(data) {
    state.attempt = data;
    state.questions = (data.questions || []).map(q => ({...q, answer:q.answer || ''}));
    state.timerEnabled = data.question_timer_enabled !== undefined ? !!data.question_timer_enabled : localStorage.getItem('edu-afrika-question-timer') !== 'off';
    $('edu-question-timer-toggle').checked = state.timerEnabled;
    const savedIndex = Number(localStorage.getItem(`edu-afrika-current-${data.attempt_id}`) || 0);
    state.currentIndex = Math.min(Math.max(0, savedIndex), Math.max(0, state.questions.length - 1));
    $('edu-resume-banner').hidden = true;
    $('edu-workspace').hidden = true;
    $('edu-result-view').hidden = true;
    $('edu-exam-view').hidden = false;
    $('edu-exam-heading').textContent = examName(data.exam_code);
    $('edu-exam-subheading').textContent = `${data.programme_name ? `${data.programme_name} · ` : ''}${data.question_count} questions · ${Number(data.total_marks).toFixed(2).replace(/\.00$/,'')} total marks · ${state.timerEnabled ? '30 seconds per question' : 'question timer OFF'} · ${(data.exam_mode || 'practice').toUpperCase()} MODE`;
    renderQuestionNav();
    renderCurrentQuestion();
    window.scrollTo({top:0,behavior:'smooth'});
  }

  function renderQuestionNav() {
    $('edu-question-numbers').innerHTML = state.questions.map((q,index) => `<button type="button" class="${index===state.currentIndex?'is-current ':''}${q.answer?'is-answered':''}" data-question-index="${index}" aria-label="Go to question ${index+1}">${index+1}</button>`).join('');
    $('edu-question-numbers').querySelectorAll('button').forEach(button => button.addEventListener('click', () => goToQuestion(Number(button.dataset.questionIndex))));
  }

  function renderCurrentQuestion() {
    const q = state.questions[state.currentIndex];
    if (!q) return;
    $('edu-question-position').textContent = `Question ${state.currentIndex+1} of ${state.questions.length}`;
    $('edu-question-mark').textContent = `${Number(q.marks).toLocaleString()} ${Number(q.marks)===1?'mark':'marks'}`;
    const position = Math.round(((state.currentIndex+1)/state.questions.length)*100);
    $('edu-progress-bar').style.width = `${position}%`;
    const typeLabel = q.question_type === 'mcq' ? 'MULTIPLE CHOICE' : 'FILL IN THE GAP';
    let answers = '';
    if (q.question_type === 'mcq') {
      const options = Array.isArray(q.options) ? q.options : [];
      answers = options.map((option,index) => {
        const key = typeof option === 'string' ? String.fromCharCode(65+index) : (option.key || option.id || String.fromCharCode(65+index));
        const text = typeof option === 'string' ? option : option.text;
        return `<label class="edu-answer-option"><input type="radio" name="edu-answer-${FX.esc(q.id)}" value="${FX.esc(key)}" ${q.answer===key?'checked':''}><span><b>${FX.esc(key)}.</b> ${FX.esc(text || '')}</span></label>`;
      }).join('');
    } else {
      answers = `<input class="edu-input edu-fill-input" id="edu-fill-answer" type="text" maxlength="1000" autocomplete="off" placeholder="Type your answer here" value="${FX.esc(q.answer || '')}">`;
    }
    $('edu-question-card').innerHTML = `<span class="edu-question-subject">${FX.esc(subjectName(q.subject_code))} · ${typeLabel}</span><h3>${FX.esc(q.question)}</h3><div class="edu-answer-list">${answers}</div>`;
    if (q.question_type === 'mcq') {
      $('edu-question-card').querySelectorAll('input[type="radio"]').forEach(input => input.addEventListener('change', () => setAnswer(q.id,input.value)));
    } else {
      const input = $('edu-fill-answer');
      let timer;
      input.addEventListener('input', () => { clearTimeout(timer); q.answer = input.value; updateAnsweredState(); timer=setTimeout(() => saveAnswer(q.id,input.value),450); });
      input.addEventListener('blur', () => saveAnswer(q.id,input.value));
    }
    $('edu-question-prev').disabled = state.currentIndex === 0;
    $('edu-question-next').textContent = state.currentIndex === state.questions.length-1 ? 'Last question' : 'Next →';
    $('edu-question-next').disabled = state.currentIndex === state.questions.length-1;
    updateAnsweredState();
    startQuestionTimer();
  }

  function updateAnsweredState() {
    const answered = state.questions.filter(q => String(q.answer || '').trim()).length;
    $('edu-answered-count').textContent = `${answered} of ${state.questions.length} answered`;
    $('edu-question-numbers').querySelectorAll('button').forEach((button,index) => {
      button.classList.toggle('is-current',index===state.currentIndex);
      button.classList.toggle('is-answered',!!String(state.questions[index]?.answer||'').trim());
    });
  }

  function setAnswer(questionId, answer) {
    const q = state.questions.find(x => x.id === questionId);
    if (!q) return;
    q.answer = answer;
    updateAnsweredState();
    saveAnswer(questionId,answer);
  }

  async function saveAnswer(questionId, answer, silent=false) {
    if (!state.password || !questionId) return;
    if (!silent) $('edu-save-state').textContent = 'Saving answer…';
    try {
      await rpc('edu_save_answer',{p_password:state.password,p_attempt_item_id:questionId,p_answer:answer});
      if (!silent) { $('edu-save-state').textContent = 'Answers are being saved automatically.'; $('edu-save-state').classList.add('edu-save-note'); }
    } catch (error) {
      if (!silent) { $('edu-save-state').textContent = errText(error); $('edu-save-state').classList.remove('edu-save-note'); }
    }
  }

  function goToQuestion(index) {
    if (index < 0 || index >= state.questions.length) return;
    state.currentIndex = index;
    try { if (state.attempt?.attempt_id) localStorage.setItem(`edu-afrika-current-${state.attempt.attempt_id}`, String(index)); } catch (_) {}
    renderQuestionNav();
    renderCurrentQuestion();
  }

  function questionTimerKey() {
    const question = state.questions[state.currentIndex];
    return state.attempt && question ? `edu-afrika-timer-${state.attempt.attempt_id}-${question.id}` : '';
  }

  async function startQuestionTimer() {
    clearInterval(state.timer);
    const label = $('edu-timer-label');
    const value = $('edu-timer-value');
    const timerBox = value?.parentElement;
    const question = state.questions[state.currentIndex];
    const version = ++state.timerVersion;
    if (!state.timerEnabled) {
      label.textContent = 'QUESTION TIMER · OFF';
      value.textContent = 'OFF';
      timerBox?.classList.remove('is-low');
      return;
    }
    if (!question || !state.attempt?.attempt_id) return;
    label.textContent = 'QUESTION TIMER · SYNCING';
    value.textContent = '··';
    timerBox?.classList.remove('is-low');
    let timing;
    try {
      timing = await rpc('edu_open_question', {p_password:state.password,p_attempt_item_id:question.id});
    } catch (error) {
      if (version !== state.timerVersion) return;
      label.textContent = 'TIMER SYNC ERROR';
      value.textContent = '—';
      $('edu-save-state').textContent = `Timer could not be verified: ${errText(error)}. Reopen the question or resume the exam.`;
      $('edu-save-state').classList.remove('edu-save-note');
      return;
    }
    if (version !== state.timerVersion || state.questions[state.currentIndex]?.id !== question.id) return;
    if (!timing?.timer_enabled || !timing?.expires_at) {
      label.textContent = 'QUESTION TIMER · OFF';
      value.textContent = 'OFF';
      return;
    }
    const expiresAtServer = Date.parse(timing.expires_at);
    const serverNow = Date.parse(timing.server_now || new Date().toISOString());
    if (!Number.isFinite(expiresAtServer) || !Number.isFinite(serverNow)) {
      label.textContent = 'TIMER SYNC ERROR';
      value.textContent = '—';
      return;
    }
    const expiry = Date.now() + Math.max(0, expiresAtServer - serverNow);
    label.textContent = `QUESTION TIMER · ${Number(timing.seconds || 30)} SEC`;
    const tick = async () => {
      if (version !== state.timerVersion || state.questions[state.currentIndex]?.id !== question.id) { clearInterval(state.timer); return; }
      const seconds = Math.max(0, Math.ceil((expiry - Date.now()) / 1000));
      value.textContent = `00:${String(seconds).padStart(2,'0')}`;
      timerBox?.classList.toggle('is-low', seconds <= 10);
      if (seconds <= 0) {
        clearInterval(state.timer);
        if (state.autoAdvancing) return;
        state.autoAdvancing = true;
        try {
          // The server deadline is authoritative. A save after expiry is rejected;
          // answers previously saved before the deadline remain in the attempt.
          await saveAnswer(question.id, String(question.answer || ''), true);
          if (state.currentIndex < state.questions.length - 1) {
            toast(`Time elapsed. Moving to question ${state.currentIndex + 2}.`);
            state.currentIndex += 1;
            try { localStorage.setItem(`edu-afrika-current-${state.attempt.attempt_id}`, String(state.currentIndex)); } catch (_) {}
            renderQuestionNav();
            renderCurrentQuestion();
          } else {
            toast('The final question time has elapsed. Submitting your examination.');
            await submitExam(true);
          }
        } finally { state.autoAdvancing = false; }
      }
    };
    tick();
    state.timer = setInterval(tick, 250);
  }

  function clearAttemptTimerKeys(attemptId) {
    if (!attemptId) return;
    try {
      const prefix = `edu-afrika-timer-${attemptId}-`;
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && (key.startsWith(prefix) || key === `edu-afrika-current-${attemptId}`)) localStorage.removeItem(key);
      }
    } catch (_) {}
  }

  async function resumeExam() {
    if (!state.pendingAttempt) return;
    try {
      const data = await rpc('edu_get_active_attempt',{p_password:state.password});
      if (!data?.active) { $('edu-resume-banner').hidden=true; toast('There is no unfinished exam to resume.'); return; }
      launchAttempt(data);
    } catch (error) { message(errText(error)); }
  }

  async function submitExam(auto=false) {
    if (!state.attempt?.attempt_id || state.submitting) return;
    if (!auto && !confirm('Submit this examination now? You will not be able to change your answers after submission.')) return;
    state.submitting = true;
    const button = $('edu-submit-exam');
    if (button) setBusy(button,true,'Submitting…');
    clearInterval(state.timer);
    const completedAttemptId = state.attempt.attempt_id;
    const answers = Object.fromEntries(state.questions.map(q => [q.id,String(q.answer||'')]));
    try {
      const data = await rpc('edu_submit_exam',{p_password:state.password,p_attempt_id:state.attempt.attempt_id,p_answers:answers});
      clearAttemptTimerKeys(completedAttemptId);
      showResult(data);
      await loadHistory();
      await loadStudentAnalytics();
    } catch (error) {
      message(errText(error));
      clearInterval(state.timer);
      if (auto && button) button.disabled=false;
    } finally { state.submitting = false; if (button) setBusy(button,false); }
  }

  function showResult(data) {
    state.lastResult = data;
    state.lastExamCode = state.attempt?.exam_code || state.lastExamCode;
    state.lastSubjectCodes = state.attempt?.subject_codes || [];
    $('edu-share-feedback').textContent = '';
    $('edu-workspace').hidden = true;
    $('edu-exam-view').hidden = true;
    $('edu-result-view').hidden = false;
    $('edu-result-percent').textContent = `${Number(data.percentage||0).toFixed(1).replace(/\.0$/,'')}%`;
    $('edu-score-circle').style.setProperty('--score',`${Math.max(0,Math.min(100,Number(data.percentage||0)))}%`);
    $('edu-result-earned').textContent = Number(data.earned_marks||0).toFixed(2).replace(/\.00$/,'');
    $('edu-result-total').textContent = Number(data.total_marks||0).toFixed(2).replace(/\.00$/,'');
    $('edu-result-status').textContent = data.status === 'time_up' ? 'Time up' : 'Submitted';
    $('edu-result-title').textContent = 'Well done. Your result is ready.';
    const review = Array.isArray(data.review) ? data.review : [];
    $('edu-review-list').innerHTML = review.map((item,index) => `<article class="edu-review-item"><h4>${index+1}. ${FX.esc(item.question)}</h4><p class="${item.is_correct?'is-correct':'is-wrong'}">${item.is_correct?'✓ Correct':'✕ Not correct'} · ${Number(item.marks_awarded||0)} / ${Number(item.marks||0)} marks</p><p><b>Your answer:</b> ${FX.esc(item.your_answer || 'No answer')}</p><p><b>Correct answer:</b> ${FX.esc(item.correct_answer || '')}</p>${item.explanation?`<p><b>Explanation:</b> ${FX.esc(item.explanation)}</p>`:''}${item.id?`<details class="edu-report-question"><summary>Report a problem with this question</summary><select data-report-reason="${FX.esc(item.id)}" class="edu-input"><option value="wrong_answer">Answer may be incorrect</option><option value="ambiguous">Question is ambiguous</option><option value="typo">Typographical error</option><option value="out_of_syllabus">Outside the syllabus</option><option value="duplicate">Duplicate question</option><option value="other">Other issue</option></select><textarea data-report-details="${FX.esc(item.id)}" class="edu-input" rows="2" placeholder="Describe the issue (optional)"></textarea><button type="button" class="edu-button edu-button-quiet" data-report-submit="${FX.esc(item.id)}">Send report</button></details>`:''}</article>`).join('') || '<p class="edu-muted">No answer review is available for this attempt.</p>';
    state.attempt = null;
    state.questions = [];
    window.scrollTo({top:0,behavior:'smooth'});
  }

  async function reportQuestion(event) {
    const button = event.target.closest('[data-report-submit]');
    if (!button) return;
    const itemId = button.dataset.reportSubmit;
    const reason = document.querySelector(`[data-report-reason="${CSS.escape(itemId)}"]`)?.value || 'other';
    const details = document.querySelector(`[data-report-details="${CSS.escape(itemId)}"]`)?.value || '';
    setBusy(button,true,'Sending…');
    try {
      await rpc('edu_report_question',{p_password:state.password,p_attempt_item_id:itemId,p_reason:reason,p_details:details});
      button.textContent='Report sent';
      button.disabled=true;
      toast('Thank you. The question has been sent to the EDU-AFRIKA review team.');
    } catch(error) { toast(errText(error)); setBusy(button,false); }
  }

  function scoreShareText() {
    const percentage = $('edu-result-percent').textContent;
    const exam = state.lastResult?.exam_code ? examName(state.lastResult.exam_code) : examName(state.lastExamCode);
    const subjects = (state.lastSubjectCodes || []).map(subjectName).join(', ');
    return `I scored ${percentage} in my ${exam} practice test on EDU-AFRIKA by Frnxup${subjects ? ` (${subjects})` : ''}. Keep practising and keep improving!\nhttps://frnxup.com/Edu-Afrika/index.html`;
  }

  async function shareScoreWithFriends() {
    const button = $('edu-share-friends');
    if (!state.lastResult) { toast('There is no completed score to share.'); return; }
    setBusy(button, true, 'Sharing…');
    $('edu-share-feedback').textContent = '';
    try {
      const body = `🎓 EDU-AFRIKA PRACTICE RESULT\n${state.name} scored ${$('edu-result-percent').textContent} in ${examName(state.lastExamCode)}.\nMarks: ${$('edu-result-earned').textContent} / ${$('edu-result-total').textContent}.\nPractise with EDU-AFRIKA on Frnxup: https://frnxup.com/Edu-Afrika/index.html`;
      const { error } = await FX.client.from('posts').insert({ user_id: state.user.id, body, visibility:'friends', status:'published' });
      if (error) throw error;
      $('edu-share-feedback').textContent = 'Your score has been shared with your Frnxup friends.';
      toast('Score shared with your Frnxup friends.');
    } catch (error) {
      $('edu-share-feedback').textContent = `Could not post to your friends: ${errText(error)}. You can use Share score… instead.`;
    } finally { setBusy(button, false); }
  }

  async function shareScoreExternally() {
    if (!state.lastResult) { toast('There is no completed score to share.'); return; }
    const text = scoreShareText();
    try {
      if (navigator.share) await navigator.share({ title:'My EDU-AFRIKA practice score', text, url:'https://frnxup.com/Edu-Afrika/index.html' });
      else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); toast('Score copied. You can now share it.'); }
      else { window.prompt('Copy your score message:', text); }
    } catch (error) { if (error?.name !== 'AbortError') toast('Sharing could not be opened on this device.'); }
  }

  async function resetFromWorkspace() {
    if (!confirm('Generate a new EDU-AFRIKA password? Your current password will stop working immediately.')) return;
    const button = $('edu-reset-password');
    setBusy(button,true,'Generating…');
    try {
      const data = await rpc('edu_recover_password');
      displayIssuedPassword(data?.password);
    } catch (error) { toast(errText(error)); }
    finally { setBusy(button,false); }
  }

  async function copyIssuedPassword() {
    const password = $('edu-issued-password-value').textContent;
    try {
      await navigator.clipboard.writeText(password);
      $('edu-copy-password').textContent = 'Copied';
      toast('Password copied. Save it somewhere private.');
    } catch (_) {
      const temporary = document.createElement('textarea');
      temporary.value = password; temporary.style.position='fixed'; temporary.style.opacity='0';
      document.body.appendChild(temporary); temporary.select();
      const copied = document.execCommand('copy'); temporary.remove();
      $('edu-copy-password').textContent = copied ? 'Copied' : 'Select & copy';
      toast(copied ? 'Password copied.' : 'Select the password and copy it manually.');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('edu-question-timer-toggle').checked = localStorage.getItem('edu-afrika-question-timer') !== 'off';
    $('edu-create-account').addEventListener('click',createAccount);
    $('edu-login-button').addEventListener('click',login);
    $('edu-login-password').addEventListener('keydown',event=>{if(event.key==='Enter')login()});
    $('edu-recover-button').addEventListener('click',recoverPassword);
    $('edu-toggle-password').addEventListener('click',()=>{const input=$('edu-login-password');const showPassword=input.type==='password';input.type=showPassword?'text':'password';$('edu-toggle-password').textContent=showPassword?'Hide':'Show'});
    $('edu-password-saved').addEventListener('change',()=>{$('edu-continue-issued').disabled=!$('edu-password-saved').checked});
    $('edu-copy-password').addEventListener('click',copyIssuedPassword);
    $('edu-continue-issued').addEventListener('click',async()=>{if(!$('edu-password-saved').checked)return;try{await unlockWorkspace()}catch(error){message(errText(error))}});
    $('edu-exam-type').addEventListener('change',event=>{loadSubjects(event.target.value);updateExamPageLink();state.topicKey='';loadRevisionTopics();});
    $('edu-programme-select').addEventListener('change',()=>{state.topicKey='';state.topics=[];renderProgrammeSubjects();});
    $('edu-open-exam-page').addEventListener('click',updateExamPageLink);
    $('edu-question-timer-toggle').addEventListener('change',event=>localStorage.setItem('edu-afrika-question-timer',event.target.checked?'on':'off'));
    $('edu-share-friends').addEventListener('click',shareScoreWithFriends);
    $('edu-share-externally').addEventListener('click',shareScoreExternally);
    $('edu-study-path').addEventListener('change',applyStudyPath);
    $('edu-review-list').addEventListener('click',reportQuestion);
    $('edu-subject-list').addEventListener('change',updateSelection);
    $('edu-type-mcq').addEventListener('change',updateSelection);
    $('edu-type-gap').addEventListener('change',updateSelection);
    $('edu-question-count').addEventListener('change',updateSelection);
    $('edu-exam-mode').addEventListener('change',()=>{if($('edu-revision-topic-wrap'))$('edu-revision-topic-wrap').hidden=$('edu-exam-mode').value!=='revision';if($('edu-revision-topic'))$('edu-revision-topic').value='';state.topicKey='';state.topics=[];loadRevisionTopics();updateSelection();});
    $('edu-revision-topic').addEventListener('change',updateSelection);
    $('edu-start-button').addEventListener('click',startExam);
    $('edu-resume-button').addEventListener('click',resumeExam);
    $('edu-reset-password').addEventListener('click',resetFromWorkspace);
    $('edu-question-prev').addEventListener('click',()=>goToQuestion(state.currentIndex-1));
    $('edu-question-next').addEventListener('click',()=>goToQuestion(state.currentIndex+1));
    $('edu-submit-exam').addEventListener('click',()=>submitExam(false));
    $('edu-back-workspace').addEventListener('click',async()=>{show('edu-workspace');await loadHistory();await checkActiveAttempt();window.scrollTo({top:0,behavior:'smooth'})});
    init().catch(error=>{show('edu-login-panel');message(errText(error))});
  });
})();
