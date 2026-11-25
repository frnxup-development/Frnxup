(() => {
  const $ = (id) => document.getElementById(id);
  const state = { user:null, email:'', name:'Student', password:'', exams:[], subjects:[], questions:[], attempt:null, currentIndex:0, timer:null, saveTimers:new Map(), examTypes:[], history:[] };
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
    await checkActiveAttempt();
  }

  async function loadCatalog() {
    const [examResult] = await Promise.all([
      FX.client.from('edu_exam_types').select('code,name,category,duration_minutes,default_question_count').eq('is_active',true).order('sort_order').order('name')
    ]);
    if (examResult.error) throw examResult.error;
    state.examTypes = examResult.data || [];
    const select = $('edu-exam-type');
    select.innerHTML = '<option value="">Choose your examination</option>' + state.examTypes.map(x => `<option value="${FX.esc(x.code)}">${FX.esc(x.name)} · ${FX.esc(x.category)}</option>`).join('');
    $('edu-subject-list').innerHTML = '<p class="edu-muted">Choose an examination to view subjects with approved questions.</p>';
    $('edu-exam-meta').textContent = `${state.examTypes.length} examination options are available.`;
  }

  async function loadSubjects(examCode) {
    const host = $('edu-subject-list');
    host.innerHTML = '<p class="edu-muted">Loading eligible subjects…</p>';
    state.subjects = [];
    $('edu-subject-count').textContent = '0 selected';
    $('edu-start-button').disabled = true;
    const exam = state.examTypes.find(x => x.code === examCode);
    if (!examCode || !exam) { host.innerHTML = '<p class="edu-muted">Choose an examination to view subjects.</p>'; $('edu-exam-meta').textContent=''; return; }
    try {
      const available = await rpc('edu_available_subjects', {p_exam_code:examCode});
      state.subjects = Array.isArray(available) ? available : [];
      $('edu-exam-meta').textContent = `${exam.category} · ${exam.duration_minutes} minutes · ${exam.default_question_count} questions recommended`;
      if (!state.subjects.length) {
        host.innerHTML = '<p class="edu-muted">No approved questions have been added for this examination yet. Please check again after the EDU-AFRIKA administrators publish the subject question bank.</p>';
        return;
      }
      host.innerHTML = state.subjects.map(subject => `<label class="edu-subject-option"><input type="checkbox" value="${FX.esc(subject.code)}"><span>${FX.esc(subject.name)}<small>${Number(subject.question_count)||0} question${Number(subject.question_count)===1?'':'s'} available</small></span></label>`).join('');
      host.querySelectorAll('input').forEach(input => input.addEventListener('change', updateSelection));
      $('edu-question-count').value = String(exam.default_question_count <= 50 ? (exam.default_question_count <= 10 ? 10 : exam.default_question_count <= 20 ? 20 : exam.default_question_count <= 30 ? 30 : 40) : 50);
      applyStudyPath();
    } catch (error) {
      host.innerHTML = `<p class="edu-muted">${FX.esc(errText(error))}</p>`;
    }
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
    const path = $('edu-study-path').value;
    const suggested = recommendations[path] || [];
    const available = $('edu-subject-list').querySelectorAll('input[type="checkbox"]');
    available.forEach(input => { input.checked = suggested.includes(input.value); });
    updateSelection();
  }
  function updateSelection() {
    const selected = selectedSubjects();
    const mcq = $('edu-type-mcq').checked;
    const gap = $('edu-type-gap').checked;
    $('edu-subject-count').textContent = `${selected.length} selected`;
    $('edu-start-button').disabled = !!state.pendingAttempt || !selected.length || selected.length > 8 || (!mcq && !gap) || !state.password;
    $('edu-selection-message').textContent = selected.length > 8 ? 'Select no more than eight subjects for one test.' : (!mcq && !gap ? 'Choose at least one question format.' : '');
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

  async function startExam() {
    const selected = selectedSubjects();
    const types = [$('edu-type-mcq').checked?'mcq':null,$('edu-type-gap').checked?'fill_gap':null].filter(Boolean);
    const count = Number($('edu-question-count').value || 20);
    if (!selected.length || selected.length > 8) { $('edu-selection-message').textContent = 'Select between one and eight subjects.'; return; }
    if (!types.length) { $('edu-selection-message').textContent = 'Choose at least one question format.'; return; }
    const button = $('edu-start-button');
    setBusy(button, true, 'Building your test…');
    $('edu-selection-message').textContent = '';
    try {
      const data = await rpc('edu_start_exam', {p_password:state.password,p_exam_code:$('edu-exam-type').value,p_subject_codes:selected,p_types:types,p_question_count:count});
      if (!data?.questions?.length) throw new Error('The question bank returned an empty examination.');
      if (Number(data.question_count) < count) toast(`Only ${data.question_count} approved questions are currently available. Your test has been adjusted.`);
      launchAttempt(data);
    } catch (error) { $('edu-selection-message').textContent = errText(error); }
    finally { setBusy(button, false); updateSelection(); }
  }

  function launchAttempt(data) {
    state.attempt = data;
    state.questions = (data.questions || []).map(q => ({...q, answer:q.answer || ''}));
    state.currentIndex = 0;
    $('edu-resume-banner').hidden = true;
    $('edu-workspace').hidden = true;
    $('edu-result-view').hidden = true;
    $('edu-exam-view').hidden = false;
    $('edu-exam-heading').textContent = examName(data.exam_code);
    $('edu-exam-subheading').textContent = `${data.question_count} questions · ${Number(data.total_marks).toFixed(2).replace(/\.00$/,'')} total marks · ${data.duration_minutes} minutes`;
    renderQuestionNav();
    renderCurrentQuestion();
    startTimer(data.started_at, data.duration_minutes);
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

  async function saveAnswer(questionId, answer) {
    if (!state.password || !questionId) return;
    $('edu-save-state').textContent = 'Saving answer…';
    try {
      await rpc('edu_save_answer',{p_password:state.password,p_attempt_item_id:questionId,p_answer:answer});
      $('edu-save-state').textContent = 'Answers are being saved automatically.';
      $('edu-save-state').classList.add('edu-save-note');
    } catch (error) {
      $('edu-save-state').textContent = errText(error);
      $('edu-save-state').classList.remove('edu-save-note');
    }
  }

  function goToQuestion(index) {
    if (index < 0 || index >= state.questions.length) return;
    state.currentIndex = index;
    renderQuestionNav();
    renderCurrentQuestion();
  }

  function startTimer(startedAt, durationMinutes) {
    clearInterval(state.timer);
    const start = new Date(startedAt).getTime();
    const expiry = start + Number(durationMinutes)*60000;
    const tick = () => {
      const seconds = Math.max(0,Math.floor((expiry-Date.now())/1000));
      const minutes = String(Math.floor(seconds/60)).padStart(2,'0');
      const rem = String(seconds%60).padStart(2,'0');
      $('edu-timer-value').textContent = `${minutes}:${rem}`;
      $('edu-timer-value').parentElement.classList.toggle('is-low',seconds<=300);
      if (seconds<=0) { clearInterval(state.timer); toast('Time is up. Your answers are being submitted.'); submitExam(true); }
    };
    tick();
    state.timer = setInterval(tick,1000);
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
    state.submitting = true;
    if (!auto && !confirm('Submit this examination now? You will not be able to change your answers after submission.')) return;
    const button = $('edu-submit-exam');
    if (button) setBusy(button,true,'Submitting…');
    clearInterval(state.timer);
    const answers = Object.fromEntries(state.questions.map(q => [q.id,String(q.answer||'')]));
    try {
      const data = await rpc('edu_submit_exam',{p_password:state.password,p_attempt_id:state.attempt.attempt_id,p_answers:answers});
      showResult(data);
      await loadHistory();
    } catch (error) {
      message(errText(error));
      clearInterval(state.timer);
      if (auto && button) button.disabled=false;
    } finally { state.submitting = false; if (button) setBusy(button,false); }
  }

  function showResult(data) {
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
    $('edu-review-list').innerHTML = review.map((item,index) => `<article class="edu-review-item"><h4>${index+1}. ${FX.esc(item.question)}</h4><p class="${item.is_correct?'is-correct':'is-wrong'}">${item.is_correct?'✓ Correct':'✕ Not correct'} · ${Number(item.marks_awarded||0)} / ${Number(item.marks||0)} marks</p><p><b>Your answer:</b> ${FX.esc(item.your_answer || 'No answer')}</p><p><b>Correct answer:</b> ${FX.esc(item.correct_answer || '')}</p>${item.explanation?`<p><b>Explanation:</b> ${FX.esc(item.explanation)}</p>`:''}</article>`).join('') || '<p class="edu-muted">No answer review is available for this attempt.</p>';
    state.attempt = null;
    state.questions = [];
    window.scrollTo({top:0,behavior:'smooth'});
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
    $('edu-create-account').addEventListener('click',createAccount);
    $('edu-login-button').addEventListener('click',login);
    $('edu-login-password').addEventListener('keydown',event=>{if(event.key==='Enter')login()});
    $('edu-recover-button').addEventListener('click',recoverPassword);
    $('edu-toggle-password').addEventListener('click',()=>{const input=$('edu-login-password');const showPassword=input.type==='password';input.type=showPassword?'text':'password';$('edu-toggle-password').textContent=showPassword?'Hide':'Show'});
    $('edu-password-saved').addEventListener('change',()=>{$('edu-continue-issued').disabled=!$('edu-password-saved').checked});
    $('edu-copy-password').addEventListener('click',copyIssuedPassword);
    $('edu-continue-issued').addEventListener('click',async()=>{if(!$('edu-password-saved').checked)return;try{await unlockWorkspace()}catch(error){message(errText(error))}});
    $('edu-exam-type').addEventListener('change',event=>loadSubjects(event.target.value));
    $('edu-study-path').addEventListener('change',applyStudyPath);
    $('edu-subject-list').addEventListener('change',updateSelection);
    $('edu-type-mcq').addEventListener('change',updateSelection);
    $('edu-type-gap').addEventListener('change',updateSelection);
    $('edu-question-count').addEventListener('change',updateSelection);
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
