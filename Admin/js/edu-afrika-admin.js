(() => {
  const $ = id => document.getElementById(id);
  let exams = [], subjects = [], questions = [], programmes = [], blueprints = [], topics = [], topicExamMappings = [], aiDrafts = [];
  let questionPage = 0, questionTotal = 0;
  const questionPageSize = 50;
  const esc = value => FX.esc(value ?? '');
  function notify(text) {
    const toast = $('edu-admin-toast');
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove('show'), 3600);
  }
  function feedback(id, text, good=false) {
    const node = $(id);
    if (!node) return;
    node.textContent = text || '';
    node.style.color = good ? '#a8f0c2' : '#ffb6b6';
  }
  function setBusy(button,busy,label='Saving…') {
    if (!button) return;
    if (busy) { button.dataset.oldText=button.textContent;button.textContent=label;button.disabled=true; }
    else { button.textContent=button.dataset.oldText||button.textContent;button.disabled=false;delete button.dataset.oldText; }
  }
  function examLabel(code) { return exams.find(x=>x.code===code)?.name || code; }
  function subjectLabel(code) { return subjects.find(x=>x.code===code)?.name || code; }
  function optionsHTML(rows, valueKey, labelKey, placeholder) {
    return `<option value="">${esc(placeholder)}</option>` + rows.map(x=>`<option value="${esc(x[valueKey])}">${esc(x[labelKey])}</option>`).join('');
  }
  function selectedValues(select) { return [...select.selectedOptions].map(x=>x.value); }

  async function loadCatalogs() {
    const [examResult,subjectResult] = await Promise.all([
      FX.client.from('edu_exam_types').select('code,name,category,is_active,duration_minutes,default_question_count,logo_url,requires_course_selection,course_selection_label').order('sort_order').order('name'),
      FX.client.from('edu_subjects').select('code,name,category,is_active').order('sort_order').order('name')
    ]);
    if (examResult.error) throw examResult.error;
    if (subjectResult.error) throw subjectResult.error;
    exams = examResult.data || [];
    subjects = subjectResult.data || [];
    const activeSubjects = subjects.filter(x=>x.is_active);
    $('edu-question-subject').innerHTML = optionsHTML(activeSubjects,'code','name','Select subject');
    $('edu-ai-subject').innerHTML = optionsHTML(activeSubjects,'code','name','Choose a subject or use bulk selection');
    $('edu-ai-bulk-subjects').innerHTML = activeSubjects.map(x=>`<option value="${esc(x.code)}">${esc(x.name)} · ${esc(x.code)}</option>`).join('');
    $('edu-blueprint-subject').innerHTML = optionsHTML(activeSubjects,'code','name','Choose subject');
    const examOptions = exams.filter(x=>x.is_active);
    $('edu-logo-exam').innerHTML = optionsHTML(exams,'code','name','Choose an examination');
    $('edu-coverage-exam').innerHTML = optionsHTML(examOptions,'code','name','Choose an examination');
    if (examOptions.length) $('edu-coverage-exam').value = examOptions[0].code;
    $('edu-programme-exam').innerHTML = optionsHTML(examOptions,'code','name','Choose examination');
    $('edu-ai-exam').innerHTML = optionsHTML(examOptions,'code','name','Choose examination');
    $('edu-blueprint-exam').innerHTML = optionsHTML(examOptions,'code','name','Choose examination');
    $('edu-exam-checks').innerHTML = ['Nigerian examination','International examination','Professional / certification'].map(category => {
      const group = exams.filter(x=>x.category===category);
      if (!group.length) return '';
      return `<div class="edu-exam-category"><b>${esc(category)}</b>${group.map(x=>`<label><input type="checkbox" value="${esc(x.code)}" ${x.is_active?'':'disabled'}><span>${esc(x.name)}${x.is_active?'':' (inactive)'}</span></label>`).join('')}</div>`;
    }).join('');
    $('edu-programme-required').innerHTML = activeSubjects.map(x=>`<option value="${esc(x.code)}">${esc(x.name)}</option>`).join('');
    $('edu-topic-subject').innerHTML = optionsHTML(activeSubjects,'code','name','Choose subject');
    $('edu-ai-topic').innerHTML = '<option value="">Any topic / balanced subject coverage</option>'; 
    $('edu-programme-allowed').innerHTML = activeSubjects.map(x=>`<option value="${esc(x.code)}">${esc(x.name)}</option>`).join('');
    refreshBlueprintProgrammeOptions();
  }

  async function loadStats() {
    let {data,error} = await FX.client.rpc('edu_admin_analytics');
    if (error) {
      const fallback = await FX.client.rpc('edu_admin_summary');
      if (fallback.error) throw fallback.error;
      data = fallback.data || {};
    }
    const entries = [
      ['Students',data?.students,'EDU-AFRIKA registrations'],
      ['Question bank',data?.questions,'All stored questions'],
      ['Published',data?.published_questions ?? data?.active_questions,'Available to students'],
      ['Awaiting review',data?.pending_review,'Drafts and imported items'],
      ['AI drafts',data?.ai_drafts,'AI-assisted practice items'],
      ['Programmes',data?.published_programmes ?? data?.programmes,'Verified course / module paths'],
      ['Active exams',data?.active_attempts,'Currently in progress'],
      ['Question reports',data?.open_reports,'Awaiting administrator review'],
      ['Questions issued',data?.question_deliveries,'Questions reserved for candidate attempts'],
      ['Unused unique questions',data?.unused_questions,'Never-issued question content']
    ];
    entries.splice(8,0,['Topics',data?.topics,'Syllabus and revision topics']);
    $('edu-admin-stats').innerHTML = entries.map(([label,value,caption])=>`<article><small>${esc(label)}</small><b>${Number(value||0).toLocaleString()}</b><span>${esc(caption)}</span></article>`).join('');
  }

  async function loadCoverage() {
    const examCode=$('edu-coverage-exam')?.value;
    const host=$('edu-coverage-table');
    if(!host){console.warn('[EDU-AFRIKA] Question coverage panel is not present in this page version.');return;}
    if(!examCode){host.innerHTML='<p class="edu-admin-empty">Choose an examination to inspect its question supply.</p>';return;}
    host.innerHTML='<p class="edu-admin-empty">Loading live question coverage…</p>';
    try{
      const {data,error}=await FX.client.rpc('edu_admin_question_coverage',{p_exam_code:examCode});
      if(error)throw error;
      const rows=Array.isArray(data)?data:[];
      if(!rows.length){host.innerHTML='<p class="edu-admin-empty">No coverage records were returned. Check that the latest EDU-AFRIKA SQL migrations have been installed.</p>';return;}
      host.innerHTML=`<table class="admin-table"><thead><tr><th>Course / combination</th><th>Subject</th><th>Published unique</th><th>Never issued</th><th>Supply status</th></tr></thead><tbody>${rows.map(r=>{
        const unused=Number(r.unused_count)||0;const published=Number(r.published_count)||0;
        const status=!r.programme_verified?['Draft · verify first','is-empty']:!r.programme_active?['Verified · unpublished','is-empty']:unused>=400?['400+ available','is-ready']:unused>=100?['Building pool','is-building']:unused>0?['Limited supply','is-low']:['Needs questions','is-empty'];
        return `<tr><td>${esc(r.programme_name||'General question pool')}<small>${r.programme_verified?'Verified':'Not verified'} · ${r.programme_active?'Published':'Not published'}</small></td><td><b>${esc(r.subject_name||r.subject_code)}</b><small>${esc(r.subject_code)}</small></td><td>${published.toLocaleString()}</td><td><b>${unused.toLocaleString()}</b></td><td><span class="edu-coverage-status ${status[1]}">${status[0]}</span></td></tr>`;
      }).join('')}</tbody></table>`;
    }catch(error){host.innerHTML=`<p class="edu-admin-empty">Coverage could not be loaded: ${esc(error.message||'Unknown error')}. Run the latest EDU-AFRIKA reporting migration (part 03).</p>`;}
  }

  async function loadPerformanceAnalytics() {
    // Performance analytics is an optional reporting panel. An unavailable RPC or
    // older cached page must never prevent the core EDU-AFRIKA setup from loading.
    const totalsHost = $('edu-performance-totals');
    const examsHost = $('edu-performance-exams');
    const subjectsHost = $('edu-performance-subjects');
    const dailyHost = $('edu-performance-daily');
    try {
      const {data,error}=await FX.client.rpc('edu_admin_performance_analytics');
      if(error)throw error;
      const totals=data?.totals||{};
      const entries=[
        ['Students',totals.students],
        ['Completed attempts',totals.completed_attempts],
        ['Average score',totals.average_score==null?'—':`${Number(totals.average_score).toFixed(1)}%`],
        ['Open question reports',totals.open_question_reports]
      ];
      if (totalsHost) totalsHost.innerHTML=entries.map(([label,value])=>`<article><small>${esc(label)}</small><b>${esc(value??0)}</b></article>`).join('');
      const examsRows=Array.isArray(data?.exams)?data.exams:[];
      if (examsHost) examsHost.innerHTML=examsRows.length?`<table class="admin-table"><thead><tr><th>Examination</th><th>Completed</th><th>Average score</th></tr></thead><tbody>${examsRows.map(x=>`<tr><td>${esc(x.exam_name||x.exam_code)}</td><td>${Number(x.attempts||0).toLocaleString()}</td><td><b>${x.average_score==null?'—':`${Number(x.average_score).toFixed(1)}%`}</b></td></tr>`).join('')}</tbody></table>`:'<p class="edu-admin-empty">Completed examinations will appear here.</p>';
      const subjectRows=Array.isArray(data?.subjects)?data.subjects:[];
      if (subjectsHost) subjectsHost.innerHTML=subjectRows.length?`<table class="admin-table"><thead><tr><th>Subject</th><th>Answered</th><th>Correct</th><th>Accuracy</th></tr></thead><tbody>${subjectRows.map(x=>`<tr><td>${esc(x.subject_name||x.subject_code)}</td><td>${Number(x.answered||0).toLocaleString()}</td><td>${Number(x.correct||0).toLocaleString()}</td><td><b>${x.accuracy==null?'—':`${Number(x.accuracy).toFixed(1)}%`}</b></td></tr>`).join('')}</tbody></table>`:'<p class="edu-admin-empty">Subject accuracy will appear after students complete tests.</p>';
      const dailyRows=Array.isArray(data?.daily)?data.daily:[];
      if (dailyHost) dailyHost.innerHTML=dailyRows.length?`<table class="admin-table"><thead><tr><th>Date</th><th>Completed</th><th>Average score</th></tr></thead><tbody>${dailyRows.map(x=>`<tr><td>${esc(x.day)}</td><td>${Number(x.attempts||0).toLocaleString()}</td><td>${x.average_score==null?'—':`${Number(x.average_score).toFixed(1)}%`}</td></tr>`).join('')}</tbody></table>`:'<p class="edu-admin-empty">No completed examinations in the last 30 days.</p>';
    } catch(error) {
      if (totalsHost) totalsHost.innerHTML=`<p class="edu-admin-empty">Performance analytics unavailable: ${esc(error.message||'Apply the EDU-AFRIKA scoring & analytics migration (part 07).')}</p>`;
      [examsHost,subjectsHost,dailyHost].forEach(node=>{ if(node) node.innerHTML=''; });
      console.warn('[EDU-AFRIKA] Performance analytics are unavailable; core setup will continue.', error);
    }
  }

  async function fetchQuestions() {
    const search=($('edu-bank-search').value||'').trim().replace(/[(),%]/g,' ');
    const type=$('edu-bank-type').value, active=$('edu-bank-status').value;
    const review=$('edu-bank-review').value, source=$('edu-bank-source')?.value||'';
    let query=FX.client.from('edu_questions').select('id,question_text,subject_code,exam_codes,question_type,options,correct_answer,accepted_answers,explanation,marks,difficulty,is_active,review_status,source_type,source_year,source_reference,topic_code,programme_ids,ai_syllabus_mapping_id,ai_syllabus_verification_status,created_at',{count:'exact'})
      .order('created_at',{ascending:false});
    if(search) query=query.or(`question_text.ilike.%${search}%,subject_code.ilike.%${search}%,topic_code.ilike.%${search}%,source_reference.ilike.%${search}%`);
    if(type)query=query.eq('question_type',type);
    if(active!=='')query=query.eq('is_active',active==='true');
    if(review)query=query.eq('review_status',review);
    if(source)query=query.eq('source_type',source);
    const from=questionPage*questionPageSize;
    const {data,error,count}=await query.range(from,from+questionPageSize-1);
    if(error)throw error;
    questions=data||[]; questionTotal=Number(count||0);
    renderQuestions();
  }
  function renderQuestions() {
    const pageCount=Math.max(1,Math.ceil(questionTotal/questionPageSize));
    questionPage=Math.min(questionPage,pageCount-1);
    $('edu-bank-count').textContent=`${questionTotal.toLocaleString()} MATCHING QUESTIONS`;
    if(!questions.length){$('edu-question-table').innerHTML='<p class="edu-admin-empty">No questions match these filters. Add a question or adjust your search.</p>';return;}
    const rows=questions.map(q=>{
      const short=(q.question_text||'').length>125?q.question_text.slice(0,122)+'…':q.question_text;
      const examNames=(q.exam_codes||[]).map(examLabel).join(', ');
      const status=`<span class="edu-admin-status ${q.review_status==='published'&&q.is_active?'':'is-off'}">${esc((q.review_status||'draft').toUpperCase())}${q.is_active?' · ACTIVE':''}</span>`;
      const isAiDraft=q.source_type==='ai_draft';
      const stageAction=isAiDraft
        ? q.review_status==='review' ? `<button type="button" data-edu-action="approve" data-id="${esc(q.id)}">Approve (inactive)</button>`
          : q.review_status==='approved' ? `<button type="button" data-edu-action="approve" data-id="${esc(q.id)}">Publish</button>`
          : q.review_status==='published' ? `<button type="button" data-edu-action="unpublish" data-id="${esc(q.id)}">Unpublish</button>` : ''
        : q.review_status==='published' ? `<button type="button" data-edu-action="unpublish" data-id="${esc(q.id)}">Unpublish</button>` : `<button type="button" data-edu-action="approve" data-id="${esc(q.id)}">Approve</button>`;
      return `<tr><td class="edu-question-cell"><b>${esc(short)}</b><small>${esc(q.difficulty)} · ${esc(q.question_type==='mcq'?'Multiple choice':'Fill in the gap')} · ${esc(q.source_type||'admin_authored')} ${q.source_year?'· '+esc(q.source_year):''}</small></td><td>${esc(subjectLabel(q.subject_code))}<small>${esc(q.topic_code||'')}</small></td><td>${(q.programme_ids||[]).length?esc((q.programme_ids||[]).map(id=>programmes.find(p=>p.id===id)?.programme_name||'Programme').join(', ')):'General'}</td><td>${esc(examNames)}</td><td>${Number(q.marks).toLocaleString()}</td><td>${status}</td><td><div class="edu-row-actions"><button type="button" data-edu-action="edit" data-id="${esc(q.id)}">Edit</button>${stageAction}${isAiDraft?'':`<button type="button" data-edu-action="toggle" data-id="${esc(q.id)}">${q.is_active?'Deactivate':'Activate'}</button>`}<button type="button" class="is-danger" data-edu-action="delete" data-id="${esc(q.id)}">Delete</button></div></td></tr>`;
    }).join('');
    const first=questionTotal?questionPage*questionPageSize+1:0, last=Math.min(questionTotal,(questionPage+1)*questionPageSize);
    $('edu-question-table').innerHTML=`<table class="admin-table"><thead><tr><th>Question</th><th>Subject / topic</th><th>Course scope</th><th>Examination(s)</th><th>Marks</th><th>Review status</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table><div class="edu-pagination"><span>Showing ${first}–${last} of ${questionTotal} · Page ${questionPage+1} of ${pageCount}</span><button type="button" id="edu-question-prev-page" ${questionPage===0?'disabled':''}>Previous</button><button type="button" id="edu-question-next-page" ${questionPage>=pageCount-1?'disabled':''}>Next</button></div>`;
    $('edu-question-prev-page')?.addEventListener('click',()=>{questionPage=Math.max(0,questionPage-1);fetchQuestions().catch(error=>notify(error.message));});
    $('edu-question-next-page')?.addEventListener('click',()=>{questionPage=Math.min(pageCount-1,questionPage+1);fetchQuestions().catch(error=>notify(error.message));});
  }

  function refreshQuestionTopicOptions(selected='') {
    const subject=$('edu-question-subject')?.value;
    const available=topics.filter(t=>t.subject_code===subject);
    $('edu-question-topic').innerHTML='<option value="">No topic selected</option>'+available.map(t=>`<option value="${esc(t.topic_code)}" ${t.is_active?'':'disabled'}>${esc(t.topic_name)}${t.syllabus_year?` · ${t.syllabus_year}`:''}${t.is_active?'':' · inactive'}</option>`).join('');
    if(selected && available.some(t=>t.topic_code===selected)) $('edu-question-topic').value=selected;
  }
  function refreshAITopicOptions(selected='') {
    const subject=$('edu-ai-subject')?.value;
    const exam=$('edu-ai-exam')?.value;
    const mappedIds=new Set(topicExamMappings.filter(m=>m.exam_code===exam&&m.is_active).map(m=>m.topic_id));
    const list=topics.filter(t=>t.subject_code===subject&&t.is_active&&(!exam||mappedIds.has(t.id)));
    $('edu-ai-topic').innerHTML='<option value="">Any mapped topic / balanced subject coverage</option>'+list.map(t=>`<option value="${esc(t.topic_code)}">${esc(t.topic_name)}${t.syllabus_year?` · ${t.syllabus_year}`:''}</option>`).join('');
    if(selected && list.some(t=>t.topic_code===selected))$('edu-ai-topic').value=selected;
  }
  async function loadExamTopicMappings() {
    const exam=$('edu-ai-exam')?.value;
    if(!exam){topicExamMappings=[];refreshAITopicOptions('');return;}
    // Load only the selected examination's mappings to stay below PostgREST row caps.
    const {data,error}=await FX.client.from('edu_subject_topic_exam_map')
      .select('id,topic_id,subject_code,exam_code,syllabus_year,is_active,verification_status')
      .eq('exam_code',exam).eq('is_active',true).limit(1000);
    if(error)throw error;
    topicExamMappings=data||[];
    refreshAITopicOptions('');
  }
  async function loadTopics() {
    const {data,error}=await FX.client.from('edu_subject_topics')
      .select('id,subject_code,topic_code,topic_name,syllabus_year,is_active,created_at,topic_description,learning_outcomes,source_status,source_reference')
      .order('subject_code').order('topic_name').limit(1000);
    if(error)throw error;
    topics=data||[];
    await loadExamTopicMappings();
    $('edu-topic-table').innerHTML=topics.length?`<table class="admin-table"><thead><tr><th>Subject</th><th>Topic</th><th>Year</th><th>Source status</th><th>Status</th><th>Action</th></tr></thead><tbody>${topics.map(t=>`<tr><td>${esc(subjectLabel(t.subject_code))}</td><td><b>${esc(t.topic_name)}</b><small>${esc(t.topic_code)}${t.topic_description?`<br>${esc(t.topic_description)}`:''}</small></td><td>${t.syllabus_year||'Any year'}</td><td>${esc(t.source_status||'draft')}</td><td><span class="edu-admin-status ${t.is_active?'':'is-off'}">${t.is_active?'ACTIVE':'INACTIVE'}</span></td><td><div class="edu-row-actions"><button type="button" data-topic-action="edit" data-id="${esc(t.id)}">Edit</button><button type="button" data-topic-action="toggle" data-id="${esc(t.id)}">${t.is_active?'Deactivate':'Activate'}</button></div></td></tr>`).join('')}</tbody></table>`:'<p class="edu-admin-empty">No subject topics yet. Use the bulk CSV import or add topics above.</p>';
    refreshQuestionTopicOptions($('edu-question-topic').value);
    refreshAITopicOptions($('edu-ai-topic').value);
  }
  function resetTopicForm() {
    $('edu-topic-form').reset(); $('edu-topic-id').value=''; $('edu-topic-active').checked=true;
    $('edu-topic-save').textContent='Save topic'; $('edu-topic-cancel').hidden=true; feedback('edu-topic-feedback','');
  }
  function editTopic(id) {
    const t=topics.find(x=>x.id===id); if(!t)return;
    $('edu-topic-id').value=t.id; $('edu-topic-subject').value=t.subject_code; $('edu-topic-code').value=t.topic_code;
    $('edu-topic-name').value=t.topic_name; $('edu-topic-year').value=t.syllabus_year||''; $('edu-topic-active').checked=!!t.is_active; $('edu-topic-description').value=t.topic_description||''; $('edu-topic-outcomes').value=Array.isArray(t.learning_outcomes)?t.learning_outcomes.join('\n'):'';
    $('edu-topic-save').textContent='Update topic'; $('edu-topic-cancel').hidden=false; $('edu-topic-form').scrollIntoView({behavior:'smooth',block:'start'});
  }
  async function saveTopic(event) {
    event.preventDefault();
    const subject=$('edu-topic-subject').value;
    const code=$('edu-topic-code').value.trim().toUpperCase().replace(/[^A-Z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,80);
    const name=$('edu-topic-name').value.trim();
    if(!subject||!code||!name){feedback('edu-topic-feedback','Choose a subject and enter a topic code and name.');return;}
    const payload={subject_code:subject,topic_code:code,topic_name:name,syllabus_year:Number($('edu-topic-year').value)||2026,is_active:$('edu-topic-active').checked,topic_description:$('edu-topic-description').value.trim(),learning_outcomes:$('edu-topic-outcomes').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).slice(0,20),source_status:'draft',source_reference:'Administrator-maintained EDU-AFRIKA topic outline; verify against current official syllabus',updated_at:new Date().toISOString()};
    const id=$('edu-topic-id').value; const button=$('edu-topic-save'); setBusy(button,true,id?'Updating…':'Saving…');
    try{
      const result=id?await FX.client.from('edu_subject_topics').update(payload).eq('id',id):await FX.client.from('edu_subject_topics').insert(payload);
      if(result.error)throw result.error;
      if(id){
        const {error:mappingError}=await FX.client.from('edu_subject_topic_exam_map').update({subject_code:subject,verification_status:'draft',review_note:'Topic content or subject was edited. Re-check this topic against the selected examination syllabus before re-verifying.',updated_at:new Date().toISOString()}).eq('topic_id',id);
        if(mappingError)throw mappingError;
      }
      resetTopicForm(); await loadTopics(); feedback('edu-topic-feedback',id?'Topic updated. Existing examination mappings were returned to Draft for re-verification.':'Topic saved. You can now map it to examination destinations.',true); notify('Subject topic saved.');
    }catch(error){feedback('edu-topic-feedback',error.message||'Could not save topic.');}
    finally{setBusy(button,false);}
  }
  async function topicAction(event) {
    const button=event.target.closest('[data-topic-action]'); if(!button)return;
    const topic=topics.find(t=>t.id===button.dataset.id); if(!topic)return;
    if(button.dataset.topicAction==='edit'){editTopic(topic.id);return;}
    button.disabled=true;
    try{
      const nextActive=!topic.is_active;
      const {error}=await FX.client.from('edu_subject_topics').update({is_active:nextActive,updated_at:new Date().toISOString()}).eq('id',topic.id);
      if(error)throw error;
      if(!nextActive){
        const {error:mappingError}=await FX.client.from('edu_subject_topic_exam_map').update({is_active:false,verification_status:'draft',review_note:'Topic deactivated. Re-enable and re-verify each examination mapping before generation or publication.',updated_at:new Date().toISOString()}).eq('topic_id',topic.id);
        if(mappingError)throw mappingError;
      }
      await loadTopics(); notify(topic.is_active?'Topic deactivated and all examination mappings disabled.':'Topic activated. Re-enable suitable examination mappings in the Syllabus Manager.');
    }catch(error){notify(error.message||'Could not update topic.');}finally{button.disabled=false;}
  }

  function toggleQuestionFields() {
    const mcq = $('edu-question-type').value==='mcq';
    $('edu-mcq-fields').hidden = !mcq;
    $('edu-fill-fields').hidden = mcq;
    $('edu-correct-mcq').required = mcq;
    $('edu-correct-fill').required = !mcq;
  }
  function resetQuestionForm() {
    $('edu-question-form').reset();
    $('edu-question-id').value='';
    $('edu-question-marks').value='1';
    $('edu-question-difficulty').value='medium';
    $('edu-question-active').checked=true;
    $('edu-question-type').value='mcq';
    refreshQuestionTopicOptions('');
    $('edu-question-source-type').value='admin_authored';
    $('edu-question-form-heading').textContent='＋ Add question to the question bank';
    $('edu-question-save').textContent='Save question';
    $('edu-question-cancel').hidden=true;
    $('edu-exam-checks').querySelectorAll('input[type=checkbox]').forEach(input=>input.checked=false);
    refreshQuestionProgrammeOptions();
    toggleQuestionFields();
    feedback('edu-question-feedback','');
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
    $('edu-question-active').checked=!!q.is_active && q.review_status==='published';
    refreshQuestionTopicOptions(q.topic_code||'');
    $('edu-exam-checks').querySelectorAll('input[type=checkbox]').forEach(input=>input.checked=(q.exam_codes||[]).includes(input.value));
    refreshQuestionProgrammeOptions(q.programme_ids||[]);
    $('edu-question-source-type').value=q.source_type||'admin_authored';
    $('edu-question-year').value=q.source_year||'';
    $('edu-question-source-reference').value=q.source_reference||'';
    ['A','B','C','D'].forEach(key=>{const option=(q.options||[]).find(x=>(x.key||x.id)===key);$(`edu-option-${key.toLowerCase()}`).value=option?.text||'';});
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
    if(!subject||!examCodes.length||!prompt){feedback('edu-question-feedback','Select a subject, at least one examination and enter a question.');return;}
    let options=[],correct='';
    if(type==='mcq'){
      options=['A','B','C','D'].map(key=>({key,text:$(`edu-option-${key.toLowerCase()}`).value.trim()})).filter(x=>x.text);
      correct=$('edu-correct-mcq').value;
      if(options.length<2){feedback('edu-question-feedback','A multiple-choice question needs at least two answer options.');return;}
      if(!options.some(x=>x.key===correct)){feedback('edu-question-feedback','The correct option must be one of the options you entered.');return;}
      if(options.length!==4){feedback('edu-question-feedback','Use all four options for a standard MCQ.');return;}
    }else{
      correct=$('edu-correct-fill').value.trim();
      if(!correct){feedback('edu-question-feedback','Enter the correct fill-in answer.');return;}
    }
    const publish=$('edu-question-active').checked;
    const existingQuestion=id?questions.find(x=>x.id===id):null;
    const isAiDraft=existingQuestion?.source_type==='ai_draft';
    const payload={question_text:prompt,subject_code:subject,exam_codes:examCodes,question_type:type,options,correct_answer:correct,accepted_answers:type==='fill_gap'?$('edu-accepted-fill').value.split('|').map(x=>x.trim()).filter(Boolean):[],explanation:$('edu-question-explanation').value.trim(),marks:Number($('edu-question-marks').value),difficulty:$('edu-question-difficulty').value,is_active:isAiDraft?false:publish,review_status:isAiDraft?'review':publish?'published':'draft',source_type:isAiDraft?'ai_draft':$('edu-question-source-type').value,source_year:Number($('edu-question-year').value)||null,source_reference:$('edu-question-source-reference').value.trim(),topic_code:$('edu-question-topic').value.trim(),programme_ids:selectedValues($('edu-question-programmes')),updated_at:new Date().toISOString(),...(isAiDraft?{ai_reviewed_by:null,ai_reviewed_at:null}:{})};
    if(!Number.isFinite(payload.marks)||payload.marks<=0){feedback('edu-question-feedback','Enter a valid mark value greater than zero.');return;}
    const button=$('edu-question-save');setBusy(button,true,id?'Updating…':'Saving…');feedback('edu-question-feedback','');
    try{
      let result;
      if(id) result=await FX.client.from('edu_questions').update(payload).eq('id',id);
      else result=await FX.client.from('edu_questions').insert({...payload,created_by:FX.user.id});
      if(result.error)throw result.error;
      resetQuestionForm();
      await Promise.all([fetchQuestions(),loadStats()]);
      feedback('edu-question-feedback',id?'Question updated successfully.':'Question added to the bank.',true);
      if(isAiDraft) window.dispatchEvent(new CustomEvent('eduAiReviewUpdated'));
      notify(id?'Question updated.':'Question added to the question bank.');
    }catch(error){feedback('edu-question-feedback',error.message||'The question could not be saved.');}
    finally{setBusy(button,false);}
  }

  async function tableAction(event) {
    const button=event.target.closest('[data-edu-action]');
    if(!button)return;
    const q=questions.find(x=>x.id===button.dataset.id);
    if(!q)return;
    const action=button.dataset.eduAction;
    if(action==='edit'){editQuestion(q.id);return;}
    if(action==='delete'&&!confirm('Permanently delete this question from the EDU-AFRIKA question bank? Existing attempt snapshots remain available.'))return;
    button.disabled=true;
    try{
      let payload;
      if(action==='toggle') payload={is_active:!q.is_active,updated_at:new Date().toISOString()};
      else if(action==='approve'&&q.source_type==='ai_draft'&&q.review_status==='approved'){
        if(!q.ai_syllabus_mapping_id)throw new Error('This AI draft has no linked examination-topic mapping. Re-generate it after mapping the topic.');
        const {data:mapping,error:mappingError}=await FX.client.from('edu_subject_topic_exam_map').select('is_active,verification_status').eq('id',q.ai_syllabus_mapping_id).maybeSingle();
        if(mappingError)throw mappingError;
        if(!mapping?.is_active||mapping.verification_status==='draft')throw new Error('Publishing is blocked until this topic-to-examination mapping is active and marked Reviewed or Official source verified in the Syllabus Manager.');
        payload={review_status:'published',is_active:true,ai_reviewed_by:FX.user.id,ai_reviewed_at:new Date().toISOString(),updated_at:new Date().toISOString()};
      }
      else if(action==='approve') payload=q.source_type==='ai_draft'&&q.review_status==='review'
        ? {review_status:'approved',is_active:false,ai_reviewed_by:FX.user.id,ai_reviewed_at:new Date().toISOString(),updated_at:new Date().toISOString()}
        : {review_status:'published',is_active:true,ai_reviewed_by:q.source_type==='ai_draft'?FX.user.id:undefined,ai_reviewed_at:q.source_type==='ai_draft'?new Date().toISOString():undefined,updated_at:new Date().toISOString()};
      else if(action==='unpublish') payload={review_status:'approved',is_active:false,updated_at:new Date().toISOString()};
      let result;
      if(action==='delete') result=await FX.client.from('edu_questions').delete().eq('id',q.id);
      else result=await FX.client.from('edu_questions').update(payload).eq('id',q.id);
      if(result.error)throw result.error;
      await Promise.all([fetchQuestions(),loadStats()]);
      if(q.source_type==='ai_draft') window.dispatchEvent(new CustomEvent('eduAiReviewUpdated'));
      notify(action==='delete'?'Question deleted.':action==='approve'?(q.source_type==='ai_draft'&&q.review_status==='review'?'AI draft approved and kept inactive.': 'Question approved and published.'):action==='unpublish'?'Question removed from student delivery.':`Question ${q.is_active?'deactivated':'activated'}.`);
    }catch(error){notify(error.message||'Unable to update this question.');}
    finally{button.disabled=false;}
  }

  async function uploadExamLogo(event) {
    event.preventDefault();
    const code=$('edu-logo-exam').value;
    const file=$('edu-logo-file').files?.[0];
    const node=$('edu-logo-feedback');
    if(!code||!file||!$('edu-logo-confirm').checked){node.textContent='Choose an exam, logo file and confirm approved use.';return;}
    if(file.size>2*1024*1024){node.textContent='Logo file must be 2 MB or smaller.';return;}
    const allowed={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/svg+xml':'svg'};
    const ext=allowed[file.type];
    if(!ext){node.textContent='Use PNG, JPG, WEBP or SVG.';return;}
    const button=$('edu-logo-upload');setBusy(button,true,'Uploading…');node.textContent='';
    try{
      const path=`${code}/official-logo.${ext}`;
      const {error:uploadError}=await FX.client.storage.from('edu-afrika-exam-logos').upload(path,file,{upsert:true,contentType:file.type,cacheControl:'3600'});
      if(uploadError)throw uploadError;
      const {data}=FX.client.storage.from('edu-afrika-exam-logos').getPublicUrl(path);
      const {error:updateError}=await FX.client.from('edu_exam_types').update({logo_url:data.publicUrl,updated_at:new Date().toISOString()}).eq('code',code);
      if(updateError)throw updateError;
      node.textContent='Official logo uploaded. The dedicated exam page now uses this file.';
      notify('Exam logo uploaded successfully.');
      await loadCatalogs();
    }catch(error){node.textContent=error.message||'Logo upload failed. Run the EDU-AFRIKA logo migration and try again.';}
    finally{setBusy(button,false);}
  }

  // Course / subject-combination manager --------------------------------------
  function refreshQuestionProgrammeOptions(selected=[]) {
    const questionSelect=$('edu-question-programmes');
    const aiSelect=$('edu-ai-programme');
    const examCodes=[...$('edu-exam-checks').querySelectorAll('input[type=checkbox]:checked')].map(x=>x.value);
    const eligible=programmes.filter(p=>!examCodes.length||examCodes.includes(p.exam_code));
    if(questionSelect){
      questionSelect.innerHTML=eligible.map(p=>`<option value="${esc(p.id)}">${esc(examLabel(p.exam_code))} · ${esc(p.programme_name)}${p.institution_name?' · '+esc(p.institution_name):''}</option>`).join('');
      [...questionSelect.options].forEach(o=>o.selected=selected.includes(o.value));
    }
    if(aiSelect){
      const exam=$('edu-ai-exam')?.value;
      const rows=programmes.filter(p=>p.exam_code===exam);
      aiSelect.innerHTML='<option value="">General question · all combinations</option>'+rows.map(p=>`<option value="${esc(p.id)}">${esc(p.programme_name)}${p.institution_name?' · '+esc(p.institution_name):''}</option>`).join('');
    }
  }

  async function loadProgrammes() {
    const {data,error}=await FX.client.from('edu_exam_programmes').select('*').order('exam_code').order('programme_name');
    if(error)throw error;
    programmes=data||[];
    refreshQuestionProgrammeOptions();
    $('edu-programme-table').innerHTML=programmes.length?`<table class="admin-table"><thead><tr><th>Examination</th><th>Programme / institution</th><th>Subjects</th><th>Status</th><th>Actions</th></tr></thead><tbody>${programmes.map(p=>`<tr><td>${esc(examLabel(p.exam_code))}</td><td><b>${esc(p.programme_name)}</b><small>${esc(p.institution_name||p.programme_type)} · ${esc(p.programme_code)}</small></td><td>${(p.required_subject_codes||[]).map(subjectLabel).map(esc).join(', ')||'No fixed subjects'}<small>${(p.allowed_subject_codes||[]).length} allowed · ${p.min_subject_count}–${p.max_subject_count}${(p.selection_rules?.groups||[]).length?' · '+(p.selection_rules.groups||[]).length+' subject groups':''}</small></td><td><span class="edu-admin-status ${p.is_active&&p.is_verified?'':'is-off'}">${p.is_verified?'VERIFIED':'DRAFT'}${p.is_active?' · LIVE':''}</span></td><td><div class="edu-row-actions"><button type="button" data-programme-action="edit" data-id="${esc(p.id)}">Edit</button><button type="button" data-programme-action="toggle" data-id="${esc(p.id)}">${p.is_active?'Unpublish':'Publish'}</button><button type="button" class="is-danger" data-programme-action="delete" data-id="${esc(p.id)}">Delete</button></div></td></tr>`).join('')}</tbody></table>`:'<p class="edu-admin-empty">No course combinations configured. Add one above.</p>';
    refreshBlueprintProgrammeOptions();
  }
  function resetProgrammeForm() {
    $('edu-programme-form').reset(); $('edu-programme-id').value='';
    $('edu-programme-min').value='1'; $('edu-programme-max').value='4';
    $('edu-programme-verified').checked=false; $('edu-programme-active').checked=false;
    $('edu-programme-required').selectedIndex=-1; $('edu-programme-allowed').selectedIndex=-1; $('edu-programme-rules').value='';
    $('edu-programme-save').textContent='Save course combination'; $('edu-programme-cancel').hidden=true;
    feedback('edu-programme-feedback','');
  }
  function editProgramme(id) {
    const p=programmes.find(x=>x.id===id); if(!p)return;
    $('edu-programme-id').value=p.id; $('edu-programme-exam').value=p.exam_code;
    $('edu-programme-code').value=p.programme_code; $('edu-programme-name').value=p.programme_name;
    $('edu-programme-type').value=p.programme_type; $('edu-programme-institution').value=p.institution_name||'';
    $('edu-programme-year').value=p.syllabus_year||''; $('edu-programme-min').value=p.min_subject_count;
    $('edu-programme-max').value=p.max_subject_count; $('edu-programme-instructions').value=p.instructions||''; $('edu-programme-rules').value=p.selection_rules&&Object.keys(p.selection_rules).length?JSON.stringify(p.selection_rules,null,2):'';
    $('edu-programme-source').value=p.source_url||''; $('edu-programme-verification').value=p.verification_note||'';
    const req=new Set(p.required_subject_codes||[]),allowed=new Set(p.allowed_subject_codes||[]);
    [...$('edu-programme-required').options].forEach(o=>o.selected=req.has(o.value));
    [...$('edu-programme-allowed').options].forEach(o=>o.selected=allowed.has(o.value));
    $('edu-programme-verified').checked=!!p.is_verified; $('edu-programme-active').checked=!!p.is_active;
    $('edu-programme-save').textContent='Update course combination'; $('edu-programme-cancel').hidden=false;
    $('edu-programme-form').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function normalizeSelectionRules(raw, allowed, minSubjects, maxSubjects) {
    if (!String(raw||'').trim()) return {groups:[]};
    let rules;
    try { rules=JSON.parse(raw); } catch (_) { throw new Error('Subject-group rules must be valid JSON.'); }
    if (!rules || Array.isArray(rules) || typeof rules!=='object') throw new Error('Subject-group rules must be a JSON object.');
    if (rules.groups!==undefined && !Array.isArray(rules.groups)) throw new Error('The selection_rules groups property must be an array.');
    const totalMin=rules.total_min===undefined?minSubjects:Number(rules.total_min);
    const totalMax=rules.total_max===undefined?maxSubjects:Number(rules.total_max);
    if (!Number.isInteger(totalMin)||!Number.isInteger(totalMax)||totalMin<minSubjects||totalMax>maxSubjects||totalMax<totalMin) throw new Error(`Subject-group total_min/total_max must fit the programme limits (${minSubjects}–${maxSubjects}).`);
    const seen=new Set();
    const groups=(rules.groups||[]).map((g,i)=>{
      const label=String(g?.label||'').trim();
      const key=String(g?.key||`group_${i+1}`).trim().toUpperCase().replace(/[^A-Z0-9_]/g,'_');
      const codes=Array.isArray(g?.subject_codes)?g.subject_codes.map(x=>String(x).trim().toUpperCase()):[];
      const low=Number(g?.min_select??0),high=Number(g?.max_select??codes.length);
      if(!label||!codes.length||new Set(codes).size!==codes.length)throw new Error(`Subject group ${i+1} needs a label and unique subject codes.`);
      if(!Number.isInteger(low)||!Number.isInteger(high)||low<0||high<low||high>codes.length)throw new Error(`Check min_select/max_select for subject group “${label}”.`);
      for(const code of codes){if(!allowed.includes(code))throw new Error(`Subject ${code} in group “${label}” is not in the allowed-subject list.`);if(seen.has(code))throw new Error(`Subject ${code} appears in more than one subject group. Group lists must not overlap.`);seen.add(code);}
      return {key,label,subject_codes:codes,min_select:low,max_select:high};
    });
    if(groups.length && seen.size!==allowed.length) throw new Error('When subject groups are used, every allowed subject must appear in exactly one group.');
    if(new Set(allowed).size!==allowed.length) throw new Error('The allowed-subject list contains duplicate subject codes.');
    return {total_min:totalMin,total_max:totalMax,groups};
  }

  async function saveProgramme(event) {
    event.preventDefault();
    const required=selectedValues($('edu-programme-required'));
    const allowed=selectedValues($('edu-programme-allowed'));
    const min=Number($('edu-programme-min').value),max=Number($('edu-programme-max').value);
    if(!required.every(x=>allowed.includes(x))){feedback('edu-programme-feedback','Every required subject must also be in the allowed-subject list.');return;}
    if(!allowed.length||min<1||max<min||max>12||min>allowed.length){feedback('edu-programme-feedback','Check subject lists and min/max subject limits.');return;}
    const verified=$('edu-programme-verified').checked;
    const active=$('edu-programme-active').checked;
    const examCode=$('edu-programme-exam').value;
    const institution=$('edu-programme-institution').value.trim();
    const sourceUrl=$('edu-programme-source').value.trim();
    const verificationNote=$('edu-programme-verification').value.trim();
    const syllabusYear=Number($('edu-programme-year').value)||null;
    if(active&&!verified){feedback('edu-programme-feedback','A combination must be verified before it can be published to students.');return;}
    if(verified&&(!sourceUrl||!verificationNote)){feedback('edu-programme-feedback','Add the official source URL and a verification note before marking this combination verified.');return;}
    if(verified&&['JAMB','POST_UTME'].includes(examCode)&&!institution){feedback('edu-programme-feedback','JAMB and Post-UTME combinations must be verified for a named institution.');return;}
    if(verified&&['JAMB','WAEC','NECO','NABTEB'].includes(examCode)&&!syllabusYear){feedback('edu-programme-feedback','Add the examination / syllabus year before verifying this combination.');return;}
    let selectionRules; try { selectionRules=normalizeSelectionRules($('edu-programme-rules').value,allowed,min,max); } catch(error) { feedback('edu-programme-feedback',error.message); return; }
    const payload={exam_code:examCode,programme_code:$('edu-programme-code').value.trim().toUpperCase().replace(/[^A-Z0-9_]/g,'_'),programme_name:$('edu-programme-name').value.trim(),programme_type:$('edu-programme-type').value,institution_name:institution,syllabus_year:syllabusYear,required_subject_codes:required,allowed_subject_codes:allowed,min_subject_count:min,max_subject_count:max,instructions:$('edu-programme-instructions').value.trim(),selection_rules:selectionRules,source_url:sourceUrl,verification_note:verificationNote,is_verified:verified,is_active:active,updated_at:new Date().toISOString()};
    const id=$('edu-programme-id').value; const button=$('edu-programme-save'); setBusy(button,true,id?'Updating…':'Saving…');
    try{
      const result=id?await FX.client.from('edu_exam_programmes').update(payload).eq('id',id):await FX.client.from('edu_exam_programmes').insert({...payload,created_by:FX.user.id});
      if(result.error)throw result.error;
      resetProgrammeForm(); await Promise.all([loadProgrammes(),loadStats()]);
      feedback('edu-programme-feedback','Course combination saved.',true); notify('Course / subject combination saved.');
    }catch(error){feedback('edu-programme-feedback',error.message||'Could not save programme.');}
    finally{setBusy(button,false);}
  }
  async function programmeAction(event) {
    const button=event.target.closest('[data-programme-action]'); if(!button)return;
    const p=programmes.find(x=>x.id===button.dataset.id); if(!p)return;
    const action=button.dataset.programmeAction;
    if(action==='edit'){editProgramme(p.id);return;}
    if(action==='toggle'&&!p.is_active&&!p.is_verified){notify('This combination is not verified yet. Edit it, confirm the official source and mark it verified before publishing.');return;}
    if(action==='delete'&&!confirm('Delete this course combination? Existing attempts keep their saved course snapshot, but questions scoped to this programme will no longer be served. Unpublishing is safer than deleting.'))return;
    button.disabled=true;
    try{
      let result;
      if(action==='delete')result=await FX.client.from('edu_exam_programmes').delete().eq('id',p.id);
      else result=await FX.client.from('edu_exam_programmes').update({is_active:!p.is_active,updated_at:new Date().toISOString()}).eq('id',p.id);
      if(result.error)throw result.error;
      await loadProgrammes(); notify(action==='delete'?'Course combination deleted.':`Course combination ${p.is_active?'unpublished':'published'}.`);
    }catch(error){notify(error.message||'Unable to update course combination.');}
    finally{button.disabled=false;}
  }

  // AI question generation ----------------------------------------------------
  async function generateAIDrafts(event) {
    event.preventDefault();
    const exam=exams.find(x=>x.code===$('edu-ai-exam').value);
    if(!exam){feedback('edu-ai-feedback','Choose an examination destination.');return;}
    const bulkCodes=selectedValues($('edu-ai-bulk-subjects')).filter(Boolean);
    const subjectCodes=bulkCodes.length?bulkCodes:[$('edu-ai-subject').value].filter(Boolean);
    if(!subjectCodes.length){feedback('edu-ai-feedback','Choose one subject or select one or more bulk subject destinations.');return;}
    if(subjectCodes.length>10){feedback('edu-ai-feedback','Select no more than 10 subjects per bulk generation run.');return;}
    const providerCode=$('edu-ai-provider-select')?.value;
    if(!providerCode){feedback('edu-ai-feedback','Select an AI provider in Step 1 and save its API configuration.');return;}
    const count=Number($('edu-ai-count').value);
    if(!Number.isInteger(count)||count<1||count>100){feedback('edu-ai-feedback','Generate between 1 and 100 questions per selected subject.');return;}
    const selectedProgrammeId=$('edu-ai-programme').value||null;
    const selectedProgramme=programmes.find(p=>p.id===selectedProgrammeId)||null;
    const button=$('edu-ai-generate'); setBusy(button,true,'Generating destination batches…');
    feedback('edu-ai-feedback',''); $('edu-ai-preview').hidden=true;
    const results=[];
    try{
      for(let index=0;index<subjectCodes.length;index++){
        const subject=subjects.find(x=>x.code===subjectCodes[index]);
        if(!subject||!subject.is_active)throw new Error(`Subject destination ${subjectCodes[index]} is missing or inactive.`);
        const chosenTopic=subjectCodes.length===1?topics.find(t=>t.subject_code===subject.code&&t.topic_code===$('edu-ai-topic').value):null;
        feedback('edu-ai-feedback',`Generating ${subject.name} · destination ${index+1} of ${subjectCodes.length}…`);
        let staffSessionToken=null;try{staffSessionToken=sessionStorage.getItem('frnxup_admin_staff_session')}catch(_){}
        const {data,error}=await FX.client.functions.invoke('edu-afrika-generate-questions',{body:{
          action:'generate',staff_session_token:staffSessionToken,provider_code:providerCode,exam_code:exam.code,exam_name:exam.name,
          subject_code:subject.code,subject_name:subject.name,topic_code:chosenTopic?.topic_code||'',
          topic_name:chosenTopic?.topic_name||'',programme_id:selectedProgrammeId,
          programme_name:selectedProgramme?.programme_name||'',count,format:$('edu-ai-format').value,
          difficulty:$('edu-ai-difficulty').value,syllabus_year:Number($('edu-ai-year').value)||null,
          second_pass_check:$('edu-ai-second-pass').checked
        }});
        if(error){
          let message=error.message||'AI generation failed.';
          try{const payload=await error.context?.json?.();if(payload?.error)message=payload.error;}catch(_){}
          throw new Error(`${subject.name}: ${message}`);
        }
        if(data?.error)throw new Error(`${subject.name}: ${data.error}`);
        results.push({...data,subject_name:subject.name});
      }
      const accepted=results.reduce((sum,x)=>sum+Number(x.accepted||0),0);
      const duplicates=results.reduce((sum,x)=>sum+Number(x.duplicate_count||0),0);
      const invalid=results.reduce((sum,x)=>sum+Number(x.invalid_count||0),0);
      const tokens=results.reduce((sum,x)=>sum+Number(x.input_tokens||0)+Number(x.output_tokens||0),0);
      const preview=results.map(r=>{
        const samples=(r.questions||[]).map(q=>`<details class="edu-ai-preview-question"><summary>${esc(q.question_text)}</summary><div class="edu-ai-preview-question-body"><p>${esc(q.options?.map(o=>`${o.key}. ${o.text}`).join(' · ')||'Fill in the gap')}</p><small>Topic: ${esc(q.topic_code||'—')} · ${esc(q.difficulty||'')}</small><small>Syllabus mapping: ${esc((q.ai_syllabus_verification_status||'draft').replace(/_/g,' ').toUpperCase())}${q.ai_syllabus_source_url?` · <a href="${esc(q.ai_syllabus_source_url)}" target="_blank" rel="noopener noreferrer">Source ↗</a>`:''}</small><small>Proposed answer: ${esc(q.correct_answer)} · Flags: ${esc((q.ai_quality_flags||[]).join(', '))}</small></div></details>`).join('');
        const stats=`${Number(r.accepted||0)} saved for review · ${Number(r.duplicate_count||0)} duplicates blocked · ${Number(r.invalid_count||0)} invalid · ${Number(r.generated||0)} returned`;
        return `<details class="edu-ai-destination-result"><summary><span><b>${esc(r.subject_name)} · ${esc(r.exam_code)} ${r.programme_id?'· programme destination':''}</b><small>${stats} · ${esc(r.status||'')}</small></span><span class="edu-compact-view-hint">View batch ⌄</span></summary><div class="edu-ai-destination-body">${samples||'<small>No sample questions were accepted for this destination.</small>'}<small>Batch ID: ${esc(r.batch_id||'—')}</small></div></details>`;
      }).join('');
      $('edu-ai-preview').innerHTML=`<div class="edu-preview-head"><b>Bulk generation completed · ${accepted.toLocaleString()} draft(s) saved</b><span>${results.length} destination batch(es) · ${tokens.toLocaleString()} reported tokens</span></div>${preview}<small>Every accepted question is saved as an inactive AI draft. The review centre must approve and then publish it before students can receive it.</small>`;
      $('edu-ai-preview').hidden=false;
      feedback('edu-ai-feedback',`${accepted} drafts saved across ${results.length} destination(s). ${duplicates} exact duplicates blocked; ${invalid} rows failed validation.`,true);
      window.dispatchEvent(new CustomEvent('eduAiBatchCreated',{detail:results}));
    }catch(error){feedback('edu-ai-feedback',error.message||'AI generation failed. Check the Edge Function deployment, encryption secret, provider configuration and provider quota.');}
    finally{setBusy(button,false);}
  }
  // CSV bulk import -----------------------------------------------------------
  function parseCSV(text) {
    const rows=[];let row=[],cell='',quoted=false;
    for(let i=0;i<text.length;i++){
      const c=text[i],next=text[i+1];
      if(c==='"'&&quoted&&next==='"'){cell+='"';i++;}
      else if(c==='"'){quoted=!quoted;}
      else if(c===','&&!quoted){row.push(cell);cell='';}
      else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&next==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';}
      else cell+=c;
    }
    row.push(cell);if(row.some(x=>x.trim()))rows.push(row);
    if(rows.length<2)return [];
    const headers=rows.shift().map(x=>x.trim().toLowerCase());
    return rows.map(values=>Object.fromEntries(headers.map((h,i)=>[h,(values[i]||'').trim()])));
  }
  function listValue(value) { return String(value||'').split(/[;|]/).map(x=>x.trim().toUpperCase()).filter(Boolean); }

  async function importProgrammesCSV(event) {
    event.preventDefault();
    const file=$('edu-programme-import-file').files?.[0]; if(!file){feedback('edu-programme-import-feedback','Choose a programme CSV file.');return;}
    if(file.size>5*1024*1024){feedback('edu-programme-import-feedback','Programme CSV must be 5 MB or smaller.');return;}
    const button=$('edu-programme-import-button');setBusy(button,true,'Validating…');feedback('edu-programme-import-feedback','');
    try {
      const rows=parseCSV(await file.text()); if(!rows.length)throw new Error('The file is empty or missing a header row.');
      const examSet=new Set(exams.map(x=>x.code)); const subjectSet=new Set(subjects.map(x=>x.code));
      const accepted=[],errors=[],seen=new Set();
      const existingKeys=new Set(programmes.map(p=>[p.exam_code,p.programme_code,p.institution_name||''].join('|')));
      rows.forEach((r,index)=>{
        const line=index+2,exam=String(r.exam_code||'').trim().toUpperCase(),code=String(r.programme_code||'').trim().toUpperCase().replace(/[^A-Z0-9_]+/g,'_'),name=String(r.programme_name||'').trim();
        const type=String(r.programme_type||'course').trim().toLowerCase();
        const required=listValue(r.required_subject_codes),allowed=listValue(r.allowed_subject_codes);
        const min=Number(r.min_subject_count||1),max=Number(r.max_subject_count||4),institution=String(r.institution_name||'').trim();
        const key=[exam,code,institution].join('|');
        if(!examSet.has(exam)||!code||!name){errors.push(`Line ${line}: unknown exam or missing programme code/name.`);return;}
        if(!['course','stream','trade','module','level','specialization','track'].includes(type)){errors.push(`Line ${line}: invalid programme_type.`);return;}
        if(!allowed.length||new Set(allowed).size!==allowed.length||required.some(x=>!allowed.includes(x))||allowed.some(x=>!subjectSet.has(x))){errors.push(`Line ${line}: allowed subjects must be valid subject codes and include every required subject.`);return;}
        if(!Number.isInteger(min)||!Number.isInteger(max)||min<1||max<min||max>12||min>allowed.length){errors.push(`Line ${line}: invalid subject count limits.`);return;}
        if(seen.has(key)){errors.push(`Line ${line}: duplicate programme in this file.`);return;}seen.add(key);
        if(existingKeys.has(key)){errors.push(`Line ${line}: this programme already exists. Edit the existing row instead of importing over its verification status.`);return;}
        let selectionRules; try { selectionRules=normalizeSelectionRules(r.selection_rules||'',allowed,min,max); } catch(error) { errors.push(`Line ${line}: ${error.message}`); return; }
        accepted.push({exam_code:exam,programme_code:code,programme_name:name,programme_type:type,institution_name:institution,syllabus_year:Number(r.syllabus_year)||null,required_subject_codes:required,allowed_subject_codes:allowed,min_subject_count:min,max_subject_count:max,instructions:String(r.instructions||'').slice(0,1200),selection_rules:selectionRules,source_url:String(r.source_url||'').slice(0,500),verification_note:String(r.verification_note||'Imported as an unverified draft. Confirm current official rules before publishing.').slice(0,1000),is_verified:false,is_active:false,created_by:FX.user.id,updated_at:new Date().toISOString()});
      });
      if(!accepted.length)throw new Error(`No valid combinations to import. ${errors.slice(0,4).join(' · ')}`);
      for(let i=0;i<accepted.length;i+=100){const {error}=await FX.client.from('edu_exam_programmes').insert(accepted.slice(i,i+100));if(error)throw error;}
      const summary=`Imported ${accepted.length} course combinations as unpublished drafts; ${rows.length-accepted.length} row(s) skipped.`;
      $('edu-programme-import-preview').innerHTML=`<b>${esc(summary)}</b>${errors.length?`<ul>${errors.slice(0,20).map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'<p>No validation errors.</p>'}`;$('edu-programme-import-preview').hidden=false;
      feedback('edu-programme-import-feedback',summary,true);await Promise.all([loadProgrammes(),loadStats()]);notify(summary);
    }catch(error){feedback('edu-programme-import-feedback',error.message||'Programme import failed.');}
    finally{setBusy(button,false);}
  }
  function downloadProgrammeTemplate(){
    const headers=['exam_code','programme_code','programme_name','programme_type','institution_name','syllabus_year','required_subject_codes','allowed_subject_codes','min_subject_count','max_subject_count','instructions','selection_rules','source_url','verification_note'];
    const sample=['JAMB','COMPUTER_SCIENCE_UNI_X','Computer Science','course','Example University',2027,'ENGLISH;MATHEMATICS;PHYSICS;CHEMISTRY','ENGLISH;MATHEMATICS;PHYSICS;CHEMISTRY',4,4,'Verify against current official course/institution rules before publishing.','{}','https://eligibility.jamb.gov.ng/','Draft only; pending official verification.'];
    const csv=[headers,sample].map(row=>row.map(x=>`"${String(x).replace(/"/g,'""')}"`).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='edu-afrika-programme-import-template.csv';a.click();URL.revokeObjectURL(url);
  }




  async function importCSV(event) {
    event.preventDefault();
    const file=$('edu-import-file').files?.[0];if(!file){feedback('edu-import-feedback','Choose a CSV file.');return;}
    if(file.size>10*1024*1024){feedback('edu-import-feedback','CSV file must be 10 MB or smaller.');return;}
    const button=$('edu-import-button');setBusy(button,true,'Validating CSV…');feedback('edu-import-feedback','');
    try{
      const rows=parseCSV(await file.text());if(!rows.length)throw new Error('The CSV is empty or missing a header row.');
      const subjectSet=new Set(subjects.map(x=>x.code));const examSet=new Set(exams.map(x=>x.code));
      const existing=new Set(questions.map(q=>`${q.subject_code}|${q.question_text.trim().toLowerCase().replace(/\s+/g,' ')}`));
      const seen=new Set(existing);const accepted=[],errors=[];
      rows.forEach((r,index)=>{
        const line=index+2;const subject=String(r.subject_code||'').toUpperCase();const examCodes=listValue(r.exam_codes);const programmeCodes=listValue(r.programme_codes);const type=String(r.question_type||'mcq').toLowerCase();const prompt=String(r.question_text||'').trim();
        if(!subjectSet.has(subject)){errors.push(`Line ${line}: unknown subject ${subject||'(empty)'}`);return;}
        if(!examCodes.length||examCodes.some(x=>!examSet.has(x))){errors.push(`Line ${line}: unknown or missing exam code`);return;}
        if(!['mcq','fill_gap'].includes(type)||prompt.length<5){errors.push(`Line ${line}: invalid question format or text`);return;}
        const duplicateKey=`${subject}|${prompt.toLowerCase().replace(/\s+/g,' ')}`;
        if(seen.has(duplicateKey)){errors.push(`Line ${line}: duplicate question skipped`);return;}seen.add(duplicateKey);
        let options=[],correct=String(r.correct_answer||'').trim();
        if(type==='mcq'){
          options=['A','B','C','D'].map(key=>({key,text:String(r[`option_${key.toLowerCase()}`]||'').trim()})).filter(x=>x.text);
          if(options.length<2||!options.some(x=>x.key===correct.toUpperCase())){errors.push(`Line ${line}: MCQ needs at least two options and a correct option key`);return;}
          correct=correct.toUpperCase();
        }else if(!correct){errors.push(`Line ${line}: fill-in question is missing its correct answer`);return;}
        const source=['past_question','adapted_practice','admin_authored'].includes(r.source_type)?r.source_type:'bulk_import';
        const scopedProgrammes=programmeCodes.length?programmes.filter(p=>examCodes.includes(p.exam_code)&&programmeCodes.includes(p.programme_code)):[];
        const missingProgrammeCodes=programmeCodes.filter(code=>!scopedProgrammes.some(p=>p.programme_code===code));
        if(missingProgrammeCodes.length){errors.push(`Line ${line}: unknown programme code(s) for the selected examination(s): ${missingProgrammeCodes.join(', ')}`);return;}
        accepted.push({question_text:prompt,subject_code:subject,exam_codes:examCodes,question_type:type,options: type==='mcq'?options:[],correct_answer:correct,accepted_answers:type==='fill_gap'?listValue(r.accepted_answers):[],explanation:String(r.explanation||'').slice(0,3000),marks:Math.max(.25,Math.min(100,Number(r.marks)||1)),difficulty:['easy','medium','hard'].includes(String(r.difficulty||'').toLowerCase())?String(r.difficulty).toLowerCase():'medium',topic_code:String(r.topic_code||'').slice(0,120),programme_ids:[...new Set(scopedProgrammes.map(p=>p.id))],source_type:source,source_year:Number(r.source_year)||null,source_reference:String(r.source_reference||$('edu-import-note').value||'').slice(0,500),is_active:false,review_status:'review',created_by:FX.user.id});
      });
      if(!accepted.length)throw new Error(`No valid rows to import. ${errors.slice(0,4).join(' · ')}`);
      for(let i=0;i<accepted.length;i+=100){const {error}=await FX.client.from('edu_questions').insert(accepted.slice(i,i+100));if(error)throw error;}
      await FX.client.from('edu_question_imports').insert({uploaded_by:FX.user.id,file_name:file.name,import_type:'csv',total_rows:rows.length,accepted_rows:accepted.length,rejected_rows:rows.length-accepted.length,status:'completed',details:{errors:errors.slice(0,100),note:$('edu-import-note').value}});
      const summary=`Imported ${accepted.length} questions to review; ${rows.length-accepted.length} row(s) skipped.`;
      feedback('edu-import-feedback',summary,true);
      $('edu-import-preview').innerHTML=`<b>${esc(summary)}</b>${errors.length?`<ul>${errors.slice(0,15).map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'<p>No row validation errors.</p>'}`;
      $('edu-import-preview').hidden=false;
      await Promise.all([fetchQuestions(),loadStats()]);notify(summary);
    }catch(error){feedback('edu-import-feedback',error.message||'CSV import failed.');}
    finally{setBusy(button,false);}
  }
  function downloadTemplate() {
    const headers=['exam_codes','subject_code','question_type','question_text','option_a','option_b','option_c','option_d','correct_answer','accepted_answers','explanation','marks','difficulty','topic_code','programme_codes','source_type','source_year','source_reference'];
    const sample=['JAMB;WAEC','MATHEMATICS','mcq','What is 2 + 2?','3','4','5','6','B','','The sum of two and two is four.','1','easy','Arithmetic','','admin_authored','2026','Original practice sample'];
    const csv=[headers,sample].map(row=>row.map(x=>`"${String(x).replace(/"/g,'""')}"`).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='edu-afrika-question-import-template.csv';a.click();URL.revokeObjectURL(url);
  }

  // Blueprint and report administration --------------------------------------
  function refreshBlueprintProgrammeOptions() {
    const exam=$('edu-blueprint-exam')?.value;
    const rows=programmes.filter(p=>!exam||p.exam_code===exam);
    if($('edu-blueprint-programme'))$('edu-blueprint-programme').innerHTML='<option value="">General exam blueprint</option>'+rows.map(p=>`<option value="${esc(p.id)}">${esc(p.programme_name)}${p.institution_name?' · '+esc(p.institution_name):''}</option>`).join('');
  }
  async function loadBlueprints() {
    const {data,error}=await FX.client.from('edu_exam_blueprints').select('*').order('exam_code').order('subject_code');if(error)throw error;blueprints=data||[];
    $('edu-blueprint-table').innerHTML=blueprints.length?`<table class="admin-table"><thead><tr><th>Exam / combination</th><th>Subject</th><th>Difficulty mix</th><th>Subject share</th></tr></thead><tbody>${blueprints.map(b=>{const p=programmes.find(x=>x.id===b.programme_id);return `<tr><td>${esc(examLabel(b.exam_code))}<small>${esc(p?.programme_name||'General')}</small></td><td>${esc(subjectLabel(b.subject_code))}</td><td>Easy ${b.easy_percent}% · Intermediate ${b.medium_percent}% · Advanced ${b.hard_percent}%</td><td>${Number(b.subject_share_percent)}%</td></tr>`}).join('')}</tbody></table>`:'<p class="edu-admin-empty">No custom blueprints. The engine uses equal subject weighting and a 30/50/20 difficulty mix by default.</p>';
  }
  async function saveBlueprint(event) {
    event.preventDefault();
    const exam=$('edu-blueprint-exam').value,programme=$('edu-blueprint-programme').value||null,subject=$('edu-blueprint-subject').value;
    const easy=Number($('edu-blueprint-easy').value),medium=Number($('edu-blueprint-medium').value),hard=Number($('edu-blueprint-hard').value),share=Number($('edu-blueprint-share').value);
    if(!exam||!subject||easy+medium+hard!==100){feedback('edu-blueprint-feedback','Choose an exam and subject. Difficulty percentages must add up to exactly 100.');return;}
    const payload={exam_code:exam,programme_id:programme,subject_code:subject,easy_percent:easy,medium_percent:medium,hard_percent:hard,subject_share_percent:share,updated_by:FX.user.id,updated_at:new Date().toISOString()};
    let query=FX.client.from('edu_exam_blueprints').select('id').eq('exam_code',exam).eq('subject_code',subject);
    query=programme?query.eq('programme_id',programme):query.is('programme_id',null);
    const {data:existing,error:findError}=await query.maybeSingle();if(findError){feedback('edu-blueprint-feedback',findError.message);return;}
    const result=existing?await FX.client.from('edu_exam_blueprints').update(payload).eq('id',existing.id):await FX.client.from('edu_exam_blueprints').insert(payload);
    if(result.error){feedback('edu-blueprint-feedback',result.error.message);return;}
    feedback('edu-blueprint-feedback','Blueprint saved. The exam engine will use this difficulty mix and subject share.',true);notify('Examination blueprint saved.');await loadBlueprints();
  }
  async function loadReports() {
    const {data,error}=await FX.client.from('edu_question_reports').select('id,attempt_item_id,reported_by,reason,details,status,admin_note,created_at').order('created_at',{ascending:false}).limit(300);
    if(error)throw error;
    const rows=data||[];$('edu-report-count').textContent=`${rows.length} REPORTS`;
    $('edu-report-table').innerHTML=rows.length?`<table class="admin-table"><thead><tr><th>Reason</th><th>Details</th><th>Status</th><th>Reported</th><th>Action</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.reason)}</td><td>${esc(r.details||'No extra details')}<small>Question: ${esc(r.attempt_item_id)}</small></td><td>${esc(r.status)}</td><td>${new Date(r.created_at).toLocaleDateString()}</td><td><select data-report-status="${esc(r.id)}"><option value="open" ${r.status==='open'?'selected':''}>Open</option><option value="reviewing" ${r.status==='reviewing'?'selected':''}>Reviewing</option><option value="resolved" ${r.status==='resolved'?'selected':''}>Resolved</option><option value="dismissed" ${r.status==='dismissed'?'selected':''}>Dismissed</option></select><button type="button" data-report-save="${esc(r.id)}">Save</button></td></tr>`).join('')}</tbody></table>`:'<p class="edu-admin-empty">No student question reports yet.</p>';
  }
  async function saveReportStatus(event) {
    const button=event.target.closest('[data-report-save]');if(!button)return;
    const id=button.dataset.reportSave;const status=document.querySelector(`[data-report-status="${CSS.escape(id)}"]`)?.value||'open';button.disabled=true;
    try{const {error}=await FX.client.from('edu_question_reports').update({status,reviewed_by:FX.user.id,reviewed_at:new Date().toISOString()}).eq('id',id);if(error)throw error;notify('Question report status updated.');await Promise.all([loadReports(),loadStats()]);}
    catch(error){notify(error.message||'Could not update report.');}finally{button.disabled=false;}
  }

  window.initEduAfrikaAdmin = async function(){
    try{
      await loadCatalogs();
      await loadTopics();
      await Promise.all([loadProgrammes(),loadStats(),fetchQuestions()]);
      await Promise.all([loadBlueprints(),loadReports(),loadCoverage(),loadPerformanceAnalytics()]);
      $('edu-question-type').addEventListener('change',toggleQuestionFields);
      $('edu-question-subject').addEventListener('change',()=>refreshQuestionTopicOptions(''));
      $('edu-exam-checks').addEventListener('change',()=>refreshQuestionProgrammeOptions(selectedValues($('edu-question-programmes'))));
      $('edu-ai-exam').addEventListener('change',()=>{refreshQuestionProgrammeOptions();loadExamTopicMappings().catch(error=>notify(error.message||'Could not load exam topic mappings.'));});
      $('edu-ai-subject').addEventListener('change',()=>refreshAITopicOptions(''));
      $('edu-topic-form').addEventListener('submit',saveTopic);
      $('edu-topic-cancel').addEventListener('click',resetTopicForm);
      $('edu-topic-table').addEventListener('click',topicAction);
      $('edu-logo-form').addEventListener('submit',uploadExamLogo);
      $('edu-question-form').addEventListener('submit',saveQuestion);
      $('edu-question-cancel').addEventListener('click',resetQuestionForm);
      $('edu-question-table').addEventListener('click',tableAction);
      $('edu-bank-search-button').addEventListener('click',()=>{questionPage=0;fetchQuestions().catch(error=>notify(error.message));});
      $('edu-bank-search').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();questionPage=0;fetchQuestions().catch(error=>notify(error.message));}});
      ['edu-bank-type','edu-bank-status','edu-bank-review','edu-bank-source'].forEach(id=>$(id).addEventListener('change',()=>{questionPage=0;fetchQuestions().catch(error=>notify(error.message));}));
      $('edu-programme-form').addEventListener('submit',saveProgramme);
      $('edu-programme-cancel').addEventListener('click',resetProgrammeForm);
      $('edu-programme-table').addEventListener('click',programmeAction);
      $('edu-programme-import-form').addEventListener('submit',importProgrammesCSV);
      $('edu-coverage-exam').addEventListener('change',loadCoverage);
      $('edu-coverage-refresh').addEventListener('click',loadCoverage);
      $('edu-programme-template').addEventListener('click',downloadProgrammeTemplate);
      $('edu-ai-form').addEventListener('submit',generateAIDrafts);
      $('edu-import-form').addEventListener('submit',importCSV);
      $('edu-download-template').addEventListener('click',downloadTemplate);
      $('edu-blueprint-form').addEventListener('submit',saveBlueprint);
      $('edu-blueprint-exam').addEventListener('change',refreshBlueprintProgrammeOptions);
      $('edu-report-table').addEventListener('click',saveReportStatus);
      toggleQuestionFields();
    }catch(error){
      const target=$('edu-question-table');
      if(target)target.innerHTML=`<div class="edu-admin-empty">EDU-AFRIKA setup could not be loaded: ${esc(error.message)}<br><br>Run the base EDU-AFRIKA migration, exam-upgrade migration, then intelligent-engine SQL files 01, 02 and 03 in order, then refresh this page.</div>`;
      const stats=$('edu-admin-stats');if(stats)stats.innerHTML='<article><small>Setup required</small><b>!</b><span>Run the EDU-AFRIKA database migrations in Supabase.</span></article>';
      throw error;
    }
  };
  window.refreshEduAfrikaAdmin = async function(){await Promise.all([loadStats(),fetchQuestions(),loadProgrammes(),loadBlueprints(),loadReports(),loadTopics(),loadCoverage(),loadPerformanceAnalytics()]);notify('EDU-AFRIKA data refreshed.');};
})();
