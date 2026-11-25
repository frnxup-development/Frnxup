(() => {
  const $ = id => document.getElementById(id);
  let exams = [], subjects = [], questions = [];
  const esc = value => FX.esc(value ?? '');
  function notify(text) {
    const toast = $('edu-admin-toast');
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove('show'), 3600);
  }
  function feedback(text, good=false) {
    $('edu-question-feedback').textContent = text || '';
    $('edu-question-feedback').style.color = good ? '#a8f0c2' : '#ffb6b6';
  }
  function setBusy(button,busy,label='Saving…') {
    if (!button) return;
    if (busy) { button.dataset.oldText=button.textContent;button.textContent=label;button.disabled=true; }
    else { button.textContent=button.dataset.oldText||button.textContent;button.disabled=false;delete button.dataset.oldText; }
  }
  function examLabel(code) { return exams.find(x=>x.code===code)?.name || code; }
  function subjectLabel(code) { return subjects.find(x=>x.code===code)?.name || code; }

  async function loadCatalogs() {
    const [examResult,subjectResult] = await Promise.all([
      FX.client.from('edu_exam_types').select('code,name,category,is_active,duration_minutes,default_question_count').order('sort_order').order('name'),
      FX.client.from('edu_subjects').select('code,name,category,is_active').order('sort_order').order('name')
    ]);
    if (examResult.error) throw examResult.error;
    if (subjectResult.error) throw subjectResult.error;
    exams = examResult.data || [];
    subjects = subjectResult.data || [];
    $('edu-question-subject').innerHTML = '<option value="">Select subject</option>' + subjects.filter(x=>x.is_active).map(x=>`<option value="${esc(x.code)}">${esc(x.name)}</option>`).join('');
    const categories = ['Nigerian examination','International examination','Professional / certification'];
    $('edu-exam-checks').innerHTML = categories.map(category => {
      const group = exams.filter(x=>x.category===category);
      if (!group.length) return '';
      return `<div class="edu-exam-category"><b>${esc(category)}</b>${group.map(x=>`<label><input type="checkbox" value="${esc(x.code)}" ${x.is_active?'':'disabled'}><span>${esc(x.name)}${x.is_active?'':' (inactive)'}</span></label>`).join('')}</div>`;
    }).join('');
  }

  async function loadStats() {
    const {data,error} = await FX.client.rpc('edu_admin_summary');
    if (error) throw error;
    const values = [data?.students ?? 0,data?.questions ?? 0,data?.active_questions ?? 0,data?.attempts ?? 0];
    const captions = ['EDU-AFRIKA registrations','All authored questions','Available for test generation','Student examination attempts'];
    $('edu-admin-stats').innerHTML = values.map((value,index)=>`<article><small>${['Student accounts','Question bank','Active questions','Practice attempts'][index]}</small><b>${Number(value).toLocaleString()}</b><span>${captions[index]}</span></article>`).join('');
  }

  async function fetchQuestions() {
    const {data,error} = await FX.client.from('edu_questions').select('id,question_text,subject_code,exam_codes,question_type,options,correct_answer,accepted_answers,explanation,marks,difficulty,is_active,created_at').order('created_at',{ascending:false}).limit(500);
    if (error) throw error;
    questions = data || [];
    renderQuestions();
  }

  function renderQuestions() {
    const search = ($('edu-bank-search').value||'').trim().toLowerCase();
    const type = $('edu-bank-type').value;
    const active = $('edu-bank-status').value;
    const filtered = questions.filter(q=>{
      const text = [q.question_text,q.subject_code,...(q.exam_codes||[])].join(' ').toLowerCase();
      return (!search||text.includes(search))&&(!type||q.question_type===type)&&(active===''||String(!!q.is_active)===active);
    });
    $('edu-bank-count').textContent = `${filtered.length} / ${questions.length} QUESTIONS`;
    if (!filtered.length) { $('edu-question-table').innerHTML = '<p class="edu-admin-empty">No questions match these filters. Add a question above or adjust your search.</p>';return; }
    const rows = filtered.map(q=>{
      const short = (q.question_text||'').length>135 ? q.question_text.slice(0,132)+'…' : q.question_text;
      const examNames = (q.exam_codes||[]).map(examLabel).join(', ');
      const status = q.is_active ? '<span class="edu-admin-status">ACTIVE</span>' : '<span class="edu-admin-status is-off">INACTIVE</span>';
      return `<tr><td class="edu-question-cell"><b>${esc(short)}</b><small>${esc(q.difficulty)} · ${esc(q.question_type==='mcq'?'Multiple choice':'Fill in the gap')}</small></td><td>${esc(subjectLabel(q.subject_code))}</td><td>${esc(examNames)}</td><td>${Number(q.marks).toLocaleString()}</td><td>${status}</td><td><div class="edu-row-actions"><button type="button" data-edu-action="edit" data-id="${esc(q.id)}">Edit</button><button type="button" data-edu-action="toggle" data-id="${esc(q.id)}">${q.is_active?'Deactivate':'Activate'}</button><button type="button" class="is-danger" data-edu-action="delete" data-id="${esc(q.id)}">Delete</button></div></td></tr>`;
    }).join('');
    $('edu-question-table').innerHTML = `<table class="admin-table"><thead><tr><th>Question</th><th>Subject</th><th>Examination(s)</th><th>Marks</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function toggleQuestionFields() {
    const mcq = $('edu-question-type').value==='mcq';
    $('edu-mcq-fields').hidden = !mcq;
    $('edu-fill-fields').hidden = mcq;
    $('edu-correct-mcq').required = mcq;
    $('edu-correct-fill').required = !mcq;
  }

  function resetForm() {
    $('edu-question-form').reset();
    $('edu-question-id').value='';
    $('edu-question-marks').value='1';
    $('edu-question-difficulty').value='medium';
    $('edu-question-active').checked=true;
    $('edu-question-type').value='mcq';
    $('edu-question-form-heading').textContent='＋ Add question to the question bank';
    $('edu-question-save').textContent='Save question';
    $('edu-question-cancel').hidden=true;
    $('edu-exam-checks').querySelectorAll('input[type=checkbox]').forEach(input=>input.checked=false);
    toggleQuestionFields();
    feedback('');
  }

  function editQuestion(id) {
    const q=questions.find(x=>x.id===id);
    if(!q)return;
    $('edu-question-id').value=q.id;
    $('edu-question-type').value=q.question_type;
    $('edu-question-subject').value=q.subject_code;
    $('edu-question-marks').value=q.marks;
    $('edu-question-difficulty').value=q.difficulty;
    $('edu-question-text').value=q.question_text;
    $('edu-question-explanation').value=q.explanation||'';
    $('edu-question-active').checked=!!q.is_active;
    $('edu-exam-checks').querySelectorAll('input[type=checkbox]').forEach(input=>input.checked=(q.exam_codes||[]).includes(input.value));
    ['A','B','C','D'].forEach((key,index)=>{const option=(q.options||[]).find(x=>(x.key||x.id)===key);$(`edu-option-${key.toLowerCase()}`).value=option?.text||'';});
    $('edu-correct-mcq').value=q.correct_answer||'A';
    $('edu-correct-fill').value=q.correct_answer||'';
    $('edu-accepted-fill').value=(q.accepted_answers||[]).join(' | ');
    $('edu-question-form-heading').textContent='✎ Edit question';
    $('edu-question-save').textContent='Update question';
    $('edu-question-cancel').hidden=false;
    toggleQuestionFields();
    $('edu-question-form').scrollIntoView({behavior:'smooth',block:'start'});
  }

  async function saveQuestion(event) {
    event.preventDefault();
    const id=$('edu-question-id').value;
    const type=$('edu-question-type').value;
    const examCodes=[...$('edu-exam-checks').querySelectorAll('input[type=checkbox]:checked')].map(input=>input.value);
    const subject=$('edu-question-subject').value;
    const prompt=$('edu-question-text').value.trim();
    if(!subject||!examCodes.length||!prompt){feedback('Select a subject, at least one examination and enter a question.');return;}
    let options=[],correct='';
    if(type==='mcq'){
      options=['A','B','C','D'].map(key=>({key,text:$(`edu-option-${key.toLowerCase()}`).value.trim()})).filter(x=>x.text);
      correct=$('edu-correct-mcq').value;
      if(options.length<2){feedback('A multiple-choice question needs at least two answer options.');return;}
      if(!options.some(x=>x.key===correct)){feedback('The correct option must be one of the options you entered.');return;}
    }else{
      correct=$('edu-correct-fill').value.trim();
      if(!correct){feedback('Enter the correct fill-in answer.');return;}
    }
    const payload={question_text:prompt,subject_code:subject,exam_codes:examCodes,question_type:type,options,correct_answer:correct,accepted_answers:type==='fill_gap'?$('edu-accepted-fill').value.split('|').map(x=>x.trim()).filter(Boolean):[],explanation:$('edu-question-explanation').value.trim(),marks:Number($('edu-question-marks').value),difficulty:$('edu-question-difficulty').value,is_active:$('edu-question-active').checked,updated_at:new Date().toISOString()};
    if(!Number.isFinite(payload.marks)||payload.marks<=0){feedback('Enter a valid mark value greater than zero.');return;}
    const button=$('edu-question-save');setBusy(button,true,id?'Updating…':'Saving…');feedback('');
    try{
      let result;
      if(id) result=await FX.client.from('edu_questions').update(payload).eq('id',id);
      else result=await FX.client.from('edu_questions').insert({...payload,created_by:FX.user.id});
      if(result.error)throw result.error;
      resetForm();
      await Promise.all([fetchQuestions(),loadStats()]);
      feedback(id?'Question updated successfully.':'Question added to the bank.',true);
      notify(id?'Question updated.':'Question added to the question bank.');
    }catch(error){feedback(error.message||'The question could not be saved.');}
    finally{setBusy(button,false);}
  }

  async function tableAction(event) {
    const button=event.target.closest('[data-edu-action]');
    if(!button)return;
    const q=questions.find(x=>x.id===button.dataset.id);
    if(!q)return;
    const action=button.dataset.eduAction;
    if(action==='edit'){editQuestion(q.id);return;}
    if(action==='delete'&&!confirm('Permanently delete this question from the EDU-AFRIKA question bank? Existing exam attempts keep their saved question snapshots.'))return;
    button.disabled=true;
    try{
      let result;
      if(action==='toggle') result=await FX.client.from('edu_questions').update({is_active:!q.is_active,updated_at:new Date().toISOString()}).eq('id',q.id);
      else if(action==='delete') result=await FX.client.from('edu_questions').delete().eq('id',q.id);
      else return;
      if(result.error)throw result.error;
      await Promise.all([fetchQuestions(),loadStats()]);
      notify(action==='delete'?'Question deleted.':`Question ${q.is_active?'deactivated':'activated'}.`);
    }catch(error){notify(error.message||'Unable to update this question.');}
    finally{button.disabled=false;}
  }

  window.initEduAfrikaAdmin = async function(){
    try{
      await loadCatalogs();
      await Promise.all([loadStats(),fetchQuestions()]);
      $('edu-question-type').addEventListener('change',toggleQuestionFields);
      $('edu-question-form').addEventListener('submit',saveQuestion);
      $('edu-question-cancel').addEventListener('click',resetForm);
      $('edu-question-table').addEventListener('click',tableAction);
      $('edu-bank-search-button').addEventListener('click',renderQuestions);
      $('edu-bank-search').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();renderQuestions();}});
      $('edu-bank-type').addEventListener('change',renderQuestions);
      $('edu-bank-status').addEventListener('change',renderQuestions);
      toggleQuestionFields();
    }catch(error){
      const target=$('edu-question-table');
      if(target)target.innerHTML=`<div class="edu-admin-empty">EDU-AFRIKA setup could not be loaded: ${esc(error.message)}<br><br>Make sure the Supabase migration <b>Supabase/migrations/20261124_edu_afrika.sql</b> has been executed, then refresh this page.</div>`;
      const stats=$('edu-admin-stats');if(stats)stats.innerHTML='<article><small>Setup required</small><b>!</b><span>Run the EDU-AFRIKA database migration in Supabase.</span></article>';
      throw error;
    }
  };
  window.refreshEduAfrikaAdmin = async function(){await Promise.all([loadStats(),fetchQuestions()]);notify('EDU-AFRIKA data refreshed.');};
})();
