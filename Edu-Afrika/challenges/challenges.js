(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = {
    user:null, password:'', displayName:'Student', examTypes:[], activeExam:null,
    subjects:[], programmes:[], challenge:null, challengeCode:'', currentIndex:0,
    directory:[], directoryHasMore:false, directoryQuery:'', selectedOpponent:null, invitations:[], modalInviteId:null, modalMode:'', popupSeen:new Set(),
    timer:null, poller:null, polling:false, directorySearchTimer:null, deadlineChecking:false, saveTimers:new Map(), pendingSaves:new Map(), saveErrors:new Set(), serverOffsetMs:0, busy:false
  };
  const escapeHtml = (value) => window.FX?.esc ? FX.esc(String(value ?? '')) : String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const showGlobal = (text, kind='error') => {
    const box=$('eca-global-message'); box.textContent=text||''; box.hidden=!text; box.dataset.kind=kind;
  };
  const feedback = (id,text,kind='') => { const box=$(id); if(!box)return; box.textContent=text||''; box.dataset.kind=kind; };
  const setBusy = (id,busy,label='Please wait…') => {
    const button=$(id); if(!button)return;
    if(busy){button.dataset.oldText=button.textContent;button.textContent=label;button.disabled=true;}
    else{button.textContent=button.dataset.oldText||button.textContent;button.disabled=false;delete button.dataset.oldText;}
  };
  async function rpc(name,args={}) {
    if(!window.FX?.client) throw new Error('Frnxup is not connected to Supabase.');
    const {data,error}=await FX.client.rpc(name,args);
    if(error) throw error;
    return data;
  }
  function displayError(error){ return error?.message || 'The request could not be completed. Please try again.'; }
  function subjectName(code){return state.subjects.find(x=>x.code===code)?.name||code||'Subject';}
  function selectedProgramme(){const id=$('eca-programme')?.value||'';return state.programmes.find(p=>p.id===id)||null;}
  function selectedSubjects(){return [...$('eca-subjects').querySelectorAll('input[type="checkbox"]:checked')].map(input=>input.value);}

  async function init(){
    if(!FX?.configured||!FX?.client){showGlobal('Frnxup is not connected to Supabase. Check js/config.js and reload this page.');return;}
    try{
      state.user=await FX.loadUser();
      if(!state.user)return;
      await FX.loadProfile();
      await FX.verifyAccountStatus();
      const profile=FX.profile||{};
      state.displayName=profile.display_name||profile.username||state.user.user_metadata?.display_name||'Student';
      $('eca-user-chip').textContent=state.displayName;
      const portal=await rpc('edu_portal_status');
      if(!portal?.registered){
        $('eca-auth-note').textContent='This Frnxup account has not created an EDU-AFRIKA account yet. Register in the student workspace first.';
        $('eca-password').disabled=true; $('eca-login').hidden=true;
        $('eca-register-link').hidden=false;
      }
      $('eca-auth-panel').hidden=false;
    }catch(error){showGlobal(displayError(error));}
  }

  async function login(){
    const password=$('eca-password').value.trim();
    if(!password){feedback('eca-auth-note','Enter your EDU-AFRIKA password.','error');return;}
    setBusy('eca-login',true,'Verifying student…'); showGlobal('');
    try{
      await rpc('edu_student_login',{p_password:password});
      state.password=password; $('eca-password').value='';
      $('eca-auth-panel').hidden=true; $('eca-app').hidden=false;
      initialiseScheduleInput();
      await Promise.all([loadExams(),loadDirectory('')]);
      await refreshScheduledStart();
      await Promise.all([loadInvitations(false),loadCurrent(false),loadLeaderboard(),loadStats()]);
      startPolling();
    }catch(error){if(state.password){showGlobal(displayError(error));}else{feedback('eca-auth-note',displayError(error),'error');}}
    finally{setBusy('eca-login',false);}
  }

  function toLocalDateTimeValue(date){
    const pad=n=>String(n).padStart(2,'0');
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  function initialiseScheduleInput(){
    const input=$('eca-scheduled-at');if(!input)return;
    const now=new Date();const minMs=Math.ceil((now.getTime()+15*60*1000)/60000)*60000;
    input.min=toLocalDateTimeValue(new Date(minMs));
    input.max=toLocalDateTimeValue(new Date(Math.floor((now.getTime()+30*24*60*60*1000)/60000)*60000));
    input.value=toLocalDateTimeValue(new Date(now.getTime()+60*60*1000));
    updateCreateState();
  }
  async function loadDirectory(search='',append=false){
    if(!state.password)return;
    const query=String(search||'').trim();
    if(!append){state.directory=[];state.directoryHasMore=false;state.directoryQuery=query;$('eca-directory-list').innerHTML='<p class="eca-muted">Loading registered EDU-AFRIKA students…</p>';}
    try{
      const rows=await rpc('edu_challenge_student_directory',{p_password:state.password,p_search:query||null,p_limit:100,p_offset:append?state.directory.length:0});
      const batch=Array.isArray(rows)?rows:[];state.directory=append?state.directory.concat(batch):batch;
      state.directoryHasMore=batch.length===100;renderDirectory();
    }catch(error){$('eca-directory-list').innerHTML=`<p class="eca-error-inline">${escapeHtml(displayError(error))}</p>`;}
  }
  function renderDirectory(){
    const host=$('eca-directory-list');if(!host)return;
    if(!state.directory.length){host.innerHTML='<p class="eca-muted">No matching EDU-AFRIKA students were found. Try another username or name.</p>';return;}
    host.innerHTML=state.directory.map(person=>{
      const isSelected=state.selectedOpponent?.user_id===person.user_id;
      return `<article class="eca-directory-card ${isSelected?'is-selected':''}"><div class="eca-directory-avatar">${escapeHtml((person.username||'S').slice(0,1).toUpperCase())}</div><div class="eca-directory-person"><b>@${escapeHtml(person.username)}</b><span>${escapeHtml(person.display_name||'EDU-AFRIKA Student')}</span></div><span class="eca-friend-badge ${person.is_friend?'is-friend':'is-not-friend'}">${person.is_friend?'FRNXUP FRIEND':'NOT A FRIEND'}</span>${person.is_friend?`<button class="eca-btn ${isSelected?'eca-dark':'eca-outline'}" type="button" data-select-student="${escapeHtml(person.user_id)}">${isSelected?'Selected':'Choose friend'}</button>`:'<span class="eca-friend-note">Connect on Frnxup first</span>'}</article>`;
    }).join('');
    host.querySelectorAll('[data-select-student]').forEach(button=>button.addEventListener('click',()=>{
      const person=state.directory.find(item=>item.user_id===button.dataset.selectStudent);
      if(!person?.is_friend)return;
      state.selectedOpponent=person;
      const chip=$('eca-selected-student');chip.hidden=false;
      chip.innerHTML=`<span>SELECTED OPPONENT</span><b>@${escapeHtml(person.username)}</b><small>${escapeHtml(person.display_name||'EDU-AFRIKA Student')}</small><button id="eca-clear-selected" type="button" aria-label="Remove selected student">×</button>`;
      $('eca-clear-selected').addEventListener('click',()=>{state.selectedOpponent=null;chip.hidden=true;renderDirectory();updateCreateState();});
      renderDirectory();updateCreateState();
    }));
    if(state.directoryHasMore){
      const more=document.createElement('button');more.type='button';more.className='eca-btn eca-outline eca-load-more';more.textContent='Load more students';
      more.addEventListener('click',()=>loadDirectory(state.directoryQuery,true));host.appendChild(more);
    }
  }
  async function loadInvitations(silent=false){
    if(!state.password)return;
    try{
      const result=await rpc('edu_challenge_my_invitations',{p_password:state.password});
      state.invitations=Array.isArray(result?.items)?result.items:[];
      renderInvitations();
      if(state.challenge?.status==='waiting')renderChallenge();
      maybeShowInvitationPopup();
    }catch(error){
      if(!silent)$('eca-invitations-list').innerHTML=`<p class="eca-error-inline">${escapeHtml(displayError(error))}</p>`;
    }
  }
  function formatSchedule(value){
    const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString([], {dateStyle:'medium',timeStyle:'short'}):'Time not available';
  }
  function renderInvitations(){
    const host=$('eca-invitations-list');if(!host)return;
    const items=state.invitations;
    if(!items.length){host.innerHTML='<p class="eca-muted">No quiz invitations yet. Choose a Frnxup friend above to schedule your first challenge.</p>';return;}
    host.innerHTML=items.map(item=>{
      const incoming=item.direction==='incoming';
      const statusLabel=item.status.replaceAll('_',' ').toUpperCase();
      const time=item.status==='reschedule_requested'?item.proposed_at:item.scheduled_at;
      let action='';
      if(incoming&&item.status==='pending')action=`<button class="eca-btn eca-primary" data-open-invite="${item.id}" data-mode="incoming" type="button">Review invitation</button>`;
      else if(!incoming&&item.status==='reschedule_requested')action=`<button class="eca-btn eca-primary" data-open-invite="${item.id}" data-mode="outgoing" type="button">Review new time</button>`;
      else if(item.status==='accepted')action='<span class="eca-invite-confirmed">TIME AGREED</span>';
      else if(item.status==='started')action='<span class="eca-invite-confirmed is-live">CHALLENGE STARTED</span>';
      return `<article class="eca-invitation-row"><div class="eca-invitation-icon">${incoming?'✉':'◷'}</div><div class="eca-invitation-copy"><b>${incoming?'From':'To'} @${escapeHtml(item.other_username||'student')}</b><span>${escapeHtml(item.exam_code)} · ${Number(item.question_count)} questions · ${Number(item.duration_minutes)} min</span><small>${item.status==='reschedule_requested'?'Proposed time: ':'Scheduled: '}${escapeHtml(formatSchedule(time))}</small></div><span class="eca-invitation-status status-${escapeHtml(item.status)}">${escapeHtml(statusLabel)}</span>${action}</article>`;
    }).join('');
    host.querySelectorAll('[data-open-invite]').forEach(button=>button.addEventListener('click',()=>{
      const invite=state.invitations.find(item=>item.id===button.dataset.openInvite);
      if(invite)openInviteModal(invite,button.dataset.mode);
    }));
  }
  function maybeShowInvitationPopup(){
    if(!$('eca-invite-modal').hidden)return;
    const incoming=state.invitations.find(item=>item.direction==='incoming'&&item.status==='pending');
    const proposed=state.invitations.find(item=>item.direction==='outgoing'&&item.status==='reschedule_requested');
    const invite=incoming||proposed;if(!invite)return;
    const key=`${invite.id}:${invite.status}:${invite.proposed_at||''}`;
    if(state.popupSeen?.has(key))return;
    state.popupSeen=state.popupSeen||new Set();state.popupSeen.add(key);
    openInviteModal(invite,incoming?'incoming':'outgoing');
  }
  function openInviteModal(invite,mode){
    state.modalInviteId=invite.id;state.modalMode=mode;
    state.popupSeen=state.popupSeen||new Set();state.popupSeen.add(`${invite.id}:${invite.status}:${invite.proposed_at||''}`);
    const incoming=mode==='incoming';
    $('eca-invite-modal-title').textContent=incoming?'A STUDENT FROM EDU-AFRIKA INVITES YOU ON QUIZ CHALLENGE':'YOUR FRIEND PROPOSED A NEW QUIZ TIME';
    $('eca-invite-modal-body').textContent=incoming?`@${invite.other_username} invited you to compete in EDU-AFRIKA. Accept the invitation or suggest another day and time.`:`@${invite.other_username} suggested a different start time. Confirm the proposed time or keep the original arrangement.`;
    $('eca-invite-modal-meta').innerHTML=`<b>${escapeHtml(invite.exam_code)}</b><span>${Number(invite.question_count)} questions · ${Number(invite.duration_minutes)} minute countdown</span><span>${mode==='outgoing'?'Proposed: '+escapeHtml(formatSchedule(invite.proposed_at)):'Scheduled: '+escapeHtml(formatSchedule(invite.scheduled_at))}</span>`;
    $('eca-reschedule-wrap').hidden=true;
    if(incoming){
      $('eca-invite-modal-actions').innerHTML='<button id="eca-modal-accept" class="eca-btn eca-primary" type="button">Accept challenge</button><button id="eca-modal-open-reschedule" class="eca-btn eca-outline" type="button">Reschedule challenge to other time</button><button id="eca-modal-decline" class="eca-btn eca-danger" type="button">Decline</button>';
      $('eca-modal-accept').addEventListener('click',()=>respondInvitation('accept'));
      $('eca-modal-open-reschedule').addEventListener('click',showRescheduleForm);
      $('eca-modal-decline').addEventListener('click',()=>respondInvitation('decline'));
    }else{
      $('eca-invite-modal-actions').innerHTML='<button id="eca-modal-accept-new" class="eca-btn eca-primary" type="button">Accept proposed time</button><button id="eca-modal-decline-new" class="eca-btn eca-outline" type="button">Keep original time</button>';
      $('eca-modal-accept-new').addEventListener('click',()=>respondInvitation('accept_reschedule'));
      $('eca-modal-decline-new').addEventListener('click',()=>respondInvitation('decline_reschedule'));
    }
    $('eca-invite-modal').hidden=false;
    $('eca-modal-accept')?.focus();
  }
  function showRescheduleForm(){
    const invite=state.invitations.find(item=>item.id===state.modalInviteId);if(!invite)return;
    const now=new Date();const proposed=new Date(Math.max(now.getTime()+24*60*60*1000,new Date(invite.scheduled_at).getTime()+60*60*1000));
    const input=$('eca-reschedule-time');input.min=toLocalDateTimeValue(new Date(Math.ceil((now.getTime()+15*60*1000)/60000)*60000));input.max=toLocalDateTimeValue(new Date(Math.floor((now.getTime()+30*24*60*60*1000)/60000)*60000));input.value=toLocalDateTimeValue(proposed);
    $('eca-reschedule-wrap').hidden=false;
    $('eca-invite-modal-actions').innerHTML='<button id="eca-modal-send-reschedule" class="eca-btn eca-primary" type="button">Send new time proposal</button><button id="eca-modal-back" class="eca-btn eca-outline" type="button">Back</button>';
    $('eca-modal-send-reschedule').addEventListener('click',()=>respondInvitation('reschedule'));
    $('eca-modal-back').addEventListener('click',()=>openInviteModal(invite,'incoming'));
  }
  async function respondInvitation(action){
    const id=state.modalInviteId;if(!id)return;
    const args={p_password:state.password,p_invitation_id:id,p_action:action,p_proposed_at:null};
    if(action==='reschedule'){
      const value=$('eca-reschedule-time').value;const proposed=value?new Date(value):null;
      if(!proposed||!Number.isFinite(proposed.getTime())||proposed.getTime()<Date.now()+15*60*1000||proposed.getTime()>Date.now()+30*24*60*60*1000){showGlobal('Choose another date and time at least 15 minutes from now and within 30 days.');return;}
      args.p_proposed_at=proposed.toISOString();
    }
    const buttons=[...$('eca-invite-modal-actions').querySelectorAll('button')];buttons.forEach(button=>button.disabled=true);
    try{
      const result=await rpc('edu_challenge_respond_invitation',args);
      closeInviteModal();showGlobal(result?.message||'Invitation updated.','success');
      await loadInvitations(false);await loadCurrent(false);
    }catch(error){showGlobal(displayError(error));buttons.forEach(button=>button.disabled=false);}
  }
  function closeInviteModal(){
    $('eca-invite-modal').hidden=true;state.modalInviteId=null;state.modalMode='';
  }

  async function loadExams(){
    const {data,error}=await FX.client.from('edu_exam_types')
      .select('code,name,category,requires_course_selection,course_selection_label,is_active')
      .eq('is_active',true).order('sort_order').order('name');
    if(error)throw error;
    state.examTypes=data||[];
    $('eca-exam').innerHTML='<option value="">Choose an examination</option>'+state.examTypes.map(x=>`<option value="${escapeHtml(x.code)}">${escapeHtml(x.name)} · ${escapeHtml(x.category||'Examination')}</option>`).join('');
    $('eca-subjects').innerHTML='<p class="eca-muted">Choose an examination first.</p>';
    $('eca-exam').addEventListener('change',()=>loadSubjects($('eca-exam').value));
    $('eca-programme').addEventListener('change',()=>loadProgrammeSubjects());
    $('eca-count').addEventListener('change',updateCreateState);
    $('eca-code').addEventListener('input',()=>{
      const raw=$('eca-code').value.replace(/\D/g,'').slice(0,8);
      $('eca-code').value=raw.length>4?`AFRK-${raw.slice(0,4)}-${raw.slice(4)}`:raw?`AFRK-${raw}`:'';
    });
    updateCreateState();
  }

  async function loadSubjects(examCode){
    state.activeExam=state.examTypes.find(x=>x.code===examCode)||null;
    state.subjects=[];state.programmes=[];
    $('eca-subject-count').textContent='0 selected';
    $('eca-create').disabled=true;
    if(!state.activeExam){$('eca-subjects').innerHTML='<p class="eca-muted">Choose an examination first.</p>';$('eca-programme-wrap').hidden=true;return;}
    $('eca-subjects').innerHTML='<p class="eca-muted">Loading approved subjects…</p>';
    try{
      const [subjects,programmes]=await Promise.all([
        rpc('edu_available_subjects',{p_exam_code:examCode,p_programme_id:null}),
        rpc('edu_get_exam_programmes',{p_exam_code:examCode})
      ]);
      state.subjects=Array.isArray(subjects)?subjects:[];
      state.programmes=Array.isArray(programmes)?programmes:[];
      const needsProgramme=!!state.activeExam.requires_course_selection||state.programmes.length>0;
      $('eca-programme-wrap').hidden=!needsProgramme;
      $('eca-programme').innerHTML='<option value="">Choose an approved combination</option>'+state.programmes.map(p=>{
        const label=`${p.name||p.programme_name||p.code}${p.institution_name?` · ${p.institution_name}`:''}${p.syllabus_year?` · ${p.syllabus_year}`:''}`;
        return `<option value="${escapeHtml(p.id)}">${escapeHtml(label)}</option>`;
      }).join('');
      $('eca-programme-hint').textContent=state.programmes.length?'The approved programme controls which subjects are valid for both competitors.':'No approved course combinations are published yet. An administrator must verify and publish one before this exam can be challenged.';
      if(needsProgramme){$('eca-subjects').innerHTML='<p class="eca-muted">Choose your approved course or subject combination first.</p>';}
      else renderSubjectChoices(state.subjects,[]);
    }catch(error){$('eca-subjects').innerHTML=`<p class="eca-error-inline">${escapeHtml(displayError(error))}</p>`;}
    updateCreateState();
  }

  async function loadProgrammeSubjects(){
    const programme=selectedProgramme();
    if(!programme){$('eca-subjects').innerHTML='<p class="eca-muted">Choose your approved course or subject combination first.</p>';updateCreateState();return;}
    $('eca-subjects').innerHTML='<p class="eca-muted">Loading subjects for this combination…</p>';
    try{
      const rows=await rpc('edu_available_subjects',{p_exam_code:state.activeExam.code,p_programme_id:programme.id});
      state.subjects=Array.isArray(rows)?rows:[];
      const required=programme.required_subject_codes||[];
      renderSubjectChoices(state.subjects,required,programme.allowed_subject_codes||[]);
      const rules=programme.selection_rules||{};
      const totalMin=Number(rules.total_min??programme.min_subject_count??1);
      const totalMax=Number(rules.total_max??programme.max_subject_count??12);
      const groupNotes=(Array.isArray(rules.groups)?rules.groups:[]).map(group=>{
        const codes=Array.isArray(group.subject_codes)?group.subject_codes:[];
        const min=Number(group.min_select??0),max=Number(group.max_select??codes.length);
        return `${group.label||'Subject group'}: ${min===max?`choose ${min}`:`choose ${min}–${max}`} from ${codes.join(', ')}`;
      });
      $('eca-programme-hint').textContent=`${programme.instructions||'Select only subjects approved for this combination.'} Choose ${totalMin}–${totalMax} subjects in total.${groupNotes.length?' '+groupNotes.join(' · '):''}`;
      const missing=required.filter(code=>!state.subjects.some(x=>x.code===code&&Number(x.question_count||0)>0));
      if(missing.length)$('eca-programme-hint').textContent=`Required subjects without available questions: ${missing.join(', ')}. Please contact the EDU-AFRIKA administrators. `+$('eca-programme-hint').textContent;
    }catch(error){$('eca-subjects').innerHTML=`<p class="eca-error-inline">${escapeHtml(displayError(error))}</p>`;}
    updateCreateState();
  }

  function renderSubjectChoices(rows,required=[],allowed=[]){
    const filtered=allowed.length?rows.filter(x=>allowed.includes(x.code)):rows;
    if(!filtered.length){$('eca-subjects').innerHTML='<p class="eca-muted">No approved published questions are available for this examination and course combination yet.</p>';return;}
    $('eca-subjects').innerHTML=filtered.map(row=>{
      const isRequired=required.includes(row.code);
      const count=Number(row.question_count||0);
      return `<label class="eca-subject-option ${isRequired?'is-required':''}"><input type="checkbox" value="${escapeHtml(row.code)}" ${isRequired?'checked disabled':''} ${count<=0?'disabled':''}><span><b>${escapeHtml(row.name||row.code)}</b><small>${count.toLocaleString()} approved questions${isRequired?' · REQUIRED':''}</small></span></label>`;
    }).join('');
    $('eca-subjects').querySelectorAll('input').forEach(input=>input.addEventListener('change',updateCreateState));
    updateCreateState();
  }

  function updateCreateState(){
    const picked=selectedSubjects();
    $('eca-subject-count').textContent=`${picked.length} selected`;
    const programmeRequired=!!state.activeExam&&(!!state.activeExam.requires_course_selection||state.programmes.length>0);
    const programOk=!programmeRequired||!!selectedProgramme();
    const when=$('eca-scheduled-at')?.value?new Date($('eca-scheduled-at').value):null;
    const scheduleOk=!!when&&Number.isFinite(when.getTime())&&when.getTime()>=Date.now()+15*60*1000&&when.getTime()<=Date.now()+30*24*60*60*1000;
    $('eca-create').disabled=state.busy||!state.activeExam||picked.length<1||picked.length>12||!programOk||!state.selectedOpponent?.is_friend||!scheduleOk;
  }

  async function createChallenge(){
    const exam=state.activeExam; const subjects=selectedSubjects(); const programme=selectedProgramme();
    const selected=state.selectedOpponent;
    const scheduledInput=$('eca-scheduled-at')?.value||'';
    const scheduledDate=scheduledInput?new Date(scheduledInput):null;
    if(!selected?.is_friend){feedback('eca-create-feedback','Choose an accepted Frnxup friend from the student directory first.','error');return;}
    if(!scheduledDate||!Number.isFinite(scheduledDate.getTime())||scheduledDate.getTime()<Date.now()+15*60*1000||scheduledDate.getTime()>Date.now()+30*24*60*60*1000){feedback('eca-create-feedback','Choose a date and time at least 15 minutes from now and within the next 30 days.','error');return;}
    if(!exam||!subjects.length){feedback('eca-create-feedback','Choose an examination and at least one subject.','error');return;}
    if((exam.requires_course_selection||state.programmes.length>0)&&!programme){feedback('eca-create-feedback','Choose an approved course or subject combination.','error');return;}
    state.busy=true;updateCreateState();setBusy('eca-create',true,'Preparing invitation…');feedback('eca-create-feedback','');
    let prepared=null;
    try{
      prepared=await rpc('edu_challenge_create',{
        p_password:state.password,p_exam_code:exam.code,p_subject_codes:subjects,
        p_question_count:Number($('eca-count').value),p_duration_minutes:Number($('eca-duration').value),
        p_programme_id:programme?.id||null
      });
      const sent=await rpc('edu_challenge_send_invite',{
        p_password:state.password,p_challenge_id:prepared.challenge_id,
        p_opponent_id:selected.user_id,p_scheduled_at:scheduledDate.toISOString()
      });
      state.challengeCode='';
      feedback('eca-create-feedback',`Invitation sent to @${selected.username}. Your friend will receive an on-screen notification.`, 'success');
      await loadInvitations(false);
      await loadCurrent(false);
      $('eca-selected-student').hidden=true;state.selectedOpponent=null;renderDirectory();updateCreateState();
    }catch(error){
      if(prepared?.challenge_id){try{await rpc('edu_challenge_cancel',{p_password:state.password,p_challenge_id:prepared.challenge_id});}catch(_){} }
      feedback('eca-create-feedback',displayError(error),'error');
    }finally{state.busy=false;setBusy('eca-create',false);updateCreateState();}
  }

  async function cancelInvitation(){
    if(!state.challenge||!state.challenge.is_creator||!confirm('Cancel this scheduled quiz invitation? Your friend will be notified.'))return;
    setBusy('eca-cancel-invite',true,'Cancelling…');
    try{
      const invite=state.invitations.find(item=>item.challenge_id===state.challenge.id&&item.direction==='outgoing');
      if(invite)await rpc('edu_challenge_cancel_invitation',{p_password:state.password,p_invitation_id:invite.id});
      else await rpc('edu_challenge_cancel',{p_password:state.password,p_challenge_id:state.challenge.id});
      state.challengeCode='';try{sessionStorage.removeItem(`edu_challenge_code_${state.challenge.id}`);}catch(_){}
      await loadInvitations(false);await loadCurrent(false);
    }catch(error){showGlobal(displayError(error));}
    finally{setBusy('eca-cancel-invite',false);}
  }

  async function joinChallenge(){
    const code=$('eca-code').value.trim().toUpperCase();
    if(!/^AFRK-[0-9]{4}-[0-9]{4}$/.test(code)){feedback('eca-join-feedback','Enter the full code in this format: AFRK-XXXX-XXXX.','error');return;}
    setBusy('eca-join',true,'Checking challenge…');feedback('eca-join-feedback','');
    try{
      const joined=await rpc('edu_challenge_join',{p_password:state.password,p_challenge_code:code});
      if(joined?.ok===false)throw new Error(joined.message||'This challenge could not be accepted.');
      $('eca-code').value='';feedback('eca-join-feedback','Challenge accepted. Your shared countdown has started.','success');
      state.challengeCode='';await loadCurrent(false);
    }catch(error){feedback('eca-join-feedback',displayError(error),'error');}
    finally{setBusy('eca-join',false);}
  }

  async function loadCurrent(silent){
    try{
      const result=await rpc('edu_challenge_current',{p_password:state.password});
      if(result?.server_now){const serverTime=Date.parse(result.server_now);if(Number.isFinite(serverTime))state.serverOffsetMs=serverTime-Date.now();}
      if(!result?.active){state.challenge=null;$('eca-current').hidden=true;return;}
      const next=result.challenge;
      if(!next)return;
      if(!state.challenge||state.challenge.id!==next.id){
        state.challengeCode=state.challengeCode||getStoredCode(next.id);
        state.challenge=next;state.currentIndex=0;renderChallenge();
      }else{
        const before=`${state.challenge.status}|${state.challenge.is_me_submitted}|${state.challenge.creator_submitted}|${state.challenge.opponent_submitted}|${state.challenge.opponent_id}|${state.challenge.winner_id}`;
        const after=`${next.status}|${next.is_me_submitted}|${next.creator_submitted}|${next.opponent_submitted}|${next.opponent_id}|${next.winner_id}`;
        state.challenge=next;
        if(before!==after){renderChallenge();if(['completed','forfeited'].includes(next.status)){void loadLeaderboard();void loadStats();}}
        else if(next.status==='active')updateCountdown();
        else if(!silent)renderChallenge();
      }
      updateStatsFromChallenge(next);
    }catch(error){if(!silent)showGlobal(displayError(error));}
  }
  function getStoredCode(id){try{return sessionStorage.getItem(`edu_challenge_code_${id}`)||'';}catch(_){return '';}}

  function renderChallenge(){
    const c=state.challenge; const host=$('eca-current-host');
    if(!c){$('eca-current').hidden=true;return;}
    $('eca-current').hidden=false;
    if(c.status==='waiting'){
      const invite=state.invitations.find(item=>item.challenge_id===c.id);
      if(!invite){
        const code=state.challengeCode;
        host.innerHTML=`<div class="eca-room-head"><div><span class="eca-eyebrow">CODE-BASED INVITATION</span><h2>Waiting for your challenger</h2><p>Your Frnxup friend can still use the AFRK code for this older invitation.</p></div><span class="eca-status waiting">WAITING</span></div><div class="eca-invite-code"><small>YOUR PRIVATE CHALLENGE CODE</small><strong>${code?escapeHtml(code):'AFRK-••••-••••'}</strong><div>${code?'<button id="eca-copy-code" class="eca-btn eca-outline" type="button">Copy code</button><button id="eca-share-code" class="eca-btn eca-primary" type="button">Share invitation</button>':'<span class="eca-muted">The code is shown only once. If unavailable, cancel this invitation and create a new one.</span>'}</div></div><div class="eca-room-summary"><span>${escapeHtml(c.exam_code)}</span><span>${Number(c.question_count)} questions</span><span>${Number(c.duration_minutes)} minute countdown</span></div><div class="eca-room-actions">${c.is_creator?'<button id="eca-cancel-invite" class="eca-btn eca-danger" type="button">Cancel invitation</button>':''}</div>`;
        $('eca-copy-code')?.addEventListener('click',copyCode);$('eca-share-code')?.addEventListener('click',shareCode);$('eca-cancel-invite')?.addEventListener('click',cancelInvitation);stopTimer();return;
      }
      const scheduled=invite?.scheduled_at?new Date(invite.scheduled_at).toLocaleString():'';
      const statusText=invite?.status==='accepted'?'The challenge is confirmed. It starts automatically at the agreed time.':invite?.status==='reschedule_requested'?(invite.direction==='outgoing'?'Your friend suggested a different time. Review it in Quiz invitations & schedules.':'Your proposed new time is awaiting confirmation.'):(invite?.direction==='incoming'?'You received this invitation. Accept it or suggest another time in the notification below.':'Invitation sent. Waiting for your friend to accept or suggest another time.');
      const target=invite?.other_username?`@${invite.other_username}`:'your invited friend';
      host.innerHTML=`<div class="eca-room-head"><div><span class="eca-eyebrow">SCHEDULED QUIZ CHALLENGE</span><h2>Challenge with ${escapeHtml(target)}</h2><p>${escapeHtml(statusText)}</p></div><span class="eca-status waiting">${escapeHtml((invite?.status||'waiting').replaceAll('_',' ').toUpperCase())}</span></div>
        <div class="eca-invite-code"><small>AGREED QUIZ START TIME</small><strong class="eca-scheduled-display">${scheduled?escapeHtml(scheduled):'Waiting for invitation details'}</strong><div><span class="eca-muted">Both students will see the same server-controlled countdown when the scheduled start time arrives.</span></div></div>
        <div class="eca-room-summary"><span>${escapeHtml(c.exam_code)}</span><span>${Number(c.question_count)} questions</span><span>${Number(c.duration_minutes)} minute countdown</span>${invite?`<span>${escapeHtml(invite.status.replaceAll('_',' '))}</span>`:''}</div>
        <div class="eca-room-actions">${c.is_creator?'<button id="eca-cancel-invite" class="eca-btn eca-danger" type="button">Cancel invitation</button>':''}</div>`;
      $('eca-cancel-invite')?.addEventListener('click',cancelInvitation);
      stopTimer();
    }else if(c.status==='active'){
      renderMatch();
      startCountdown();
    }else if(c.status==='completed'||c.status==='forfeited'){
      renderResult();stopTimer();
      state.challengeCode='';try{sessionStorage.removeItem(`edu_challenge_code_${c.id}`);}catch(_){}
    }else if(c.status==='expired'||c.status==='cancelled'){
      host.innerHTML=`<div class="eca-result-banner neutral"><span>⌛</span><div><h2>Challenge ${c.status}</h2><p>This invitation is no longer active. Create a new challenge or enter another student's code.</p></div></div>`;
      stopTimer();
    }
  }

  async function copyCode(){
    if(!state.challengeCode)return;
    try{await navigator.clipboard.writeText(state.challengeCode);feedback('eca-create-feedback','Challenge code copied.','success');}
    catch(_){window.prompt('Copy your challenge code:',state.challengeCode);}
  }
  async function shareCode(){
    if(!state.challengeCode)return;
    const text=`Join my EDU-AFRIKA exam challenge on Frnxup. Enter this code in the Challenge Arena: ${state.challengeCode}`;
    if(navigator.share){try{await navigator.share({title:'EDU-AFRIKA Challenge',text,url:location.href});}catch(error){if(error?.name!=='AbortError')await copyCode();}}
    else await copyCode();
  }

  function renderMatch(){
    const c=state.challenge;const qs=Array.isArray(c.questions)?c.questions:[];
    const host=$('eca-current-host');
    if(!qs.length){host.innerHTML='<p class="eca-muted">Loading the challenge questions…</p>';return;}
    state.currentIndex=Math.min(state.currentIndex,qs.length-1);
    const submitted=!!c.is_me_submitted;
    host.innerHTML=`<div class="eca-room-head"><div><span class="eca-eyebrow">LIVE HEAD-TO-HEAD</span><h2>${escapeHtml(c.exam_code)} challenge</h2><p>You are competing against <b>${escapeHtml(c.opponent_name)}</b>.</p></div><div class="eca-live-count"><small>TIME LEFT</small><strong id="eca-live-timer">--:--</strong></div></div>
      <div class="eca-match-strip"><span>${Number(c.question_count)} questions</span><span>${Number(c.duration_minutes)} minutes</span><span>${submitted?'Your answers submitted':'Your answers auto-save'}</span><span>${c.creator_submitted||c.opponent_submitted?'One player has submitted':''}</span></div>
      <div class="eca-match-grid"><aside class="eca-question-nav"><b>Questions</b><div id="eca-question-nav">${qs.map((q,i)=>`<button type="button" data-index="${i}" class="${i===state.currentIndex?'is-current':''} ${String(q.answer||'').trim()?'is-answered':''}">${i+1}</button>`).join('')}</div><small>Green = answered</small></aside>
        <div class="eca-question-stage"><div class="eca-question-meta"><span id="eca-question-position"></span><span id="eca-question-mark"></span></div><div id="eca-question-card" class="eca-question-card"></div><div class="eca-question-controls"><button id="eca-prev" class="eca-btn eca-outline" type="button">← Previous</button><button id="eca-next" class="eca-btn eca-primary" type="button">Next →</button></div>
        <div class="eca-submit-row"><span id="eca-answer-count"></span><button id="eca-submit" class="eca-btn eca-submit" type="button" ${submitted?'disabled':''}>${submitted?'Answers submitted ✓':'Submit my answers'}</button></div><p id="eca-save-note" class="eca-feedback" aria-live="polite"></p></div></div>
      ${submitted?'<div class="eca-wait-note">Your answers are locked. You will see the final score when your opponent submits or the countdown ends.</div>':'<div class="eca-warning-note">You can give up at any time. Giving up immediately awards the win to your opponent, even if your score is higher.</div>'}
      <div class="eca-forfeit-row"><span>Leaving or closing this page does not automatically count as giving up. Use the button below to forfeit.</span><button id="eca-forfeit" class="eca-btn eca-danger" type="button">Give up / Forfeit</button></div>`;
    host.querySelectorAll('#eca-question-nav button').forEach(btn=>btn.addEventListener('click',()=>{flushPending();state.currentIndex=Number(btn.dataset.index);renderQuestion();}));
    $('eca-prev').addEventListener('click',()=>{flushPending();state.currentIndex=Math.max(0,state.currentIndex-1);renderQuestion();});
    $('eca-next').addEventListener('click',()=>{flushPending();state.currentIndex=Math.min(qs.length-1,state.currentIndex+1);renderQuestion();});
    $('eca-submit').addEventListener('click',submitAnswers);
    $('eca-forfeit').addEventListener('click',forfeitChallenge);
    renderQuestion();updateCountdown();
  }

  function renderQuestion(){
    const c=state.challenge;const qs=Array.isArray(c?.questions)?c.questions:[];const q=qs[state.currentIndex];if(!q)return;
    $('eca-question-position').textContent=`Question ${state.currentIndex+1} of ${qs.length}`;
    $('eca-question-mark').textContent=`${Number(q.marks)||1} ${Number(q.marks)===1?'mark':'marks'}`;
    let answers='';
    if(q.question_type==='mcq'){
      const opts=Array.isArray(q.options)?q.options:[];
      answers=opts.map((option,index)=>{
        const key=typeof option==='string'?String.fromCharCode(65+index):(option.key||option.id||String.fromCharCode(65+index));
        const text=typeof option==='string'?option:option.text;
        return `<label class="eca-answer"><input type="radio" name="eca-answer-${escapeHtml(q.id)}" value="${escapeHtml(key)}" ${q.answer===key?'checked':''} ${c.is_me_submitted?'disabled':''}><span><b>${escapeHtml(key)}.</b> ${escapeHtml(text||'')}</span></label>`;
      }).join('');
    }else{
      answers=`<input class="eca-input" id="eca-fill-answer" type="text" maxlength="1000" autocomplete="off" placeholder="Type your answer" value="${escapeHtml(q.answer||'')}" ${c.is_me_submitted?'disabled':''}>`;
    }
    $('eca-question-card').innerHTML=`<span class="eca-subject-label">${escapeHtml(subjectName(q.subject_code))} · ${q.question_type==='mcq'?'MULTIPLE CHOICE':'FILL IN THE GAP'}</span><h3>${escapeHtml(q.question)}</h3><div class="eca-answer-list">${answers}</div>`;
    if(!c.is_me_submitted){
      if(q.question_type==='mcq')$('eca-question-card').querySelectorAll('input[type="radio"]').forEach(input=>input.addEventListener('change',()=>{q.answer=input.value;updateAnswerCount();void saveAnswer(q.id,input.value);}));
      else{
        const input=$('eca-fill-answer');input.addEventListener('input',()=>{q.answer=input.value;scheduleSave(q.id,input.value);updateAnswerCount();});
        input.addEventListener('blur',()=>saveAnswer(q.id,input.value));
      }
    }
    $('eca-prev').disabled=state.currentIndex===0;
    $('eca-next').disabled=state.currentIndex===qs.length-1;
    $('eca-next').textContent=state.currentIndex===qs.length-1?'Last question':'Next →';
    updateAnswerCount();
  }

  function updateAnswerCount(){
    const qs=state.challenge?.questions||[];
    $('eca-answer-count').textContent=`${qs.filter(q=>String(q.answer||'').trim()).length} of ${qs.length} answered`;
    $('eca-question-nav')?.querySelectorAll('button').forEach((btn,i)=>{
      btn.classList.toggle('is-current',i===state.currentIndex);
      btn.classList.toggle('is-answered',!!String(qs[i]?.answer||'').trim());
    });
  }
  function scheduleSave(questionId,answer){
    clearTimeout(state.saveTimers.get(questionId));
    state.saveTimers.set(questionId,setTimeout(()=>saveAnswer(questionId,answer),400));
  }
  async function saveAnswer(questionId,answer){
    if(!state.password||!state.challenge||state.challenge.status!=='active'||state.challenge.is_me_submitted)return;
    clearTimeout(state.saveTimers.get(questionId));state.saveTimers.delete(questionId);
    $('eca-save-note').textContent='Saving…';
    const previous=state.pendingSaves.get(questionId)||Promise.resolve();
    const task=previous.catch(()=>{}).then(()=>rpc('edu_challenge_save_answer',{p_password:state.password,p_challenge_id:state.challenge.id,p_question_id:questionId,p_answer:answer}));
    state.pendingSaves.set(questionId,task);
    try{await task;state.saveErrors.delete(questionId);$('eca-save-note').textContent='Answer saved securely.';}
    catch(error){state.saveErrors.add(questionId);$('eca-save-note').textContent=displayError(error);}
    finally{if(state.pendingSaves.get(questionId)===task)state.pendingSaves.delete(questionId);}
  }
  function flushPending(){
    const q=state.challenge?.questions?.[state.currentIndex];if(!q)return;
    if(state.saveTimers.has(q.id)){clearTimeout(state.saveTimers.get(q.id));state.saveTimers.delete(q.id);void saveAnswer(q.id,q.answer||'');}
  }

  async function submitAnswers(){
    if(!state.challenge)return;
    if(!confirm('Submit and lock your answers? You cannot change them after submission.'))return;
    setBusy('eca-submit',true,'Submitting answers…');
    try{
      const pending=[];
      for(const [questionId,timer] of state.saveTimers.entries()){
        clearTimeout(timer);const question=state.challenge.questions.find(q=>q.id===questionId);
        if(question)pending.push(saveAnswer(questionId,question.answer||''));
      }
      state.saveTimers.clear();
      await Promise.all([...pending,...state.pendingSaves.values()]);
      if(state.saveErrors.size)throw new Error('One or more answers could not be saved. Check your connection and try submitting again.');
      await rpc('edu_challenge_submit',{p_password:state.password,p_challenge_id:state.challenge.id});
      await loadCurrent(false);
    }catch(error){showGlobal(displayError(error));}
    finally{setBusy('eca-submit',false);}
  }

  async function forfeitChallenge(){
    if(!state.challenge)return;
    if(!confirm('Give up this challenge? Your opponent will be declared the winner immediately, even if you currently have more points. You will receive no XP for a forfeited loss.'))return;
    setBusy('eca-forfeit',true,'Recording forfeit…');
    try{await rpc('edu_challenge_forfeit',{p_password:state.password,p_challenge_id:state.challenge.id});await loadCurrent(false);}
    catch(error){showGlobal(displayError(error));}
    finally{setBusy('eca-forfeit',false);}
  }

  function renderResult(){
    const c=state.challenge;const meWon=!!c.i_won;const draw=!!c.is_draw;
    let title=draw?'It is a draw':meWon?'Victory! You won the challenge':'Challenge lost';
    let detail=draw?'Both students finished with the same score. Each receives a draw reward.':meWon?'Your opponent forfeited or you earned the higher score. Your win has been recorded.':'Your opponent earned the win. Use the review of your practice performance to prepare for the next challenge.';
    if(c.result_kind==='forfeit'&&!meWon)detail='You gave up. Your opponent wins automatically, even if your score was higher.';
    if(c.result_kind==='forfeit'&&meWon)detail='Your opponent gave up. You are the winner automatically, regardless of the points on the scoreboard.';
    const reward=c.reward||{};const badges=Array.isArray(reward.badge_codes)?reward.badge_codes:[];
    $('eca-current-host').innerHTML=`<div class="eca-result-banner ${draw?'neutral':meWon?'win':'loss'}"><span>${draw?'🤝':meWon?'🏆':'📘'}</span><div><span class="eca-eyebrow">CHALLENGE RESULT</span><h2>${title}</h2><p>${detail}</p></div></div>
      <div class="eca-final-score"><div><small>YOUR SCORE</small><b>${Number(c.my_score||0).toLocaleString()}</b></div><div class="eca-versus">VS</div><div><small>${escapeHtml(c.opponent_name||'Opponent')}</small><b>${Number(c.opponent_score||0).toLocaleString()}</b></div></div>
      <div class="eca-reward-grid"><div><small>XP EARNED</small><b>+${Number(reward.xp_delta||0)}</b></div><div><small>RATING CHANGE</small><b>${Number(reward.rating_delta||0)>0?'+':''}${Number(reward.rating_delta||0)}</b></div><div><small>CORRECT ANSWERS</small><b>${Number(reward.correct_count||0)}</b></div></div>
      ${badges.length?`<div class="eca-badges"><b>Achievement unlocked</b>${badges.map(b=>`<span>🏅 ${escapeHtml(b.replaceAll('_',' '))}</span>`).join('')}</div>`:''}
      <div class="eca-room-actions"><button id="eca-new-challenge" class="eca-btn eca-primary" type="button">Create another challenge</button><a href="/Edu-Afrika/index.html" class="eca-btn eca-outline">Back to study workspace</a></div>`;
    $('eca-new-challenge').addEventListener('click',()=>{state.challenge=null;state.challengeCode='';$('eca-current').hidden=true;window.scrollTo({top:0,behavior:'smooth'});});
  }

  function startCountdown(){stopTimer();tickTimer();state.timer=setInterval(tickTimer,1000);}
  function stopTimer(){if(state.timer)clearInterval(state.timer);state.timer=null;}
  function tickTimer(){
    const c=state.challenge;if(!c||c.status!=='active')return;
    const target=new Date(c.ends_at).getTime();const remaining=Math.max(0,Math.ceil((target-(Date.now()+state.serverOffsetMs))/1000));
    const minutes=Math.floor(remaining/60).toString().padStart(2,'0');const seconds=(remaining%60).toString().padStart(2,'0');
    const timer=$('eca-live-timer');if(timer){timer.textContent=`${minutes}:${seconds}`;timer.classList.toggle('is-low',remaining<=60);}
    if(remaining<=0&&!state.deadlineChecking){state.deadlineChecking=true;void loadCurrent(true).finally(()=>{state.deadlineChecking=false;});}
  }
  function updateCountdown(){tickTimer();}
  async function refreshScheduledStart(){
    try{await rpc('edu_challenge_start_due',{p_password:state.password});}
    catch(error){if(!String(displayError(error)).includes('function'))console.warn('Scheduled challenge check:',displayError(error));}
  }
  function startPolling(){
    if(state.poller)clearInterval(state.poller);
    state.poller=setInterval(async()=>{
      if(state.polling)return;
      state.polling=true;
      try{await refreshScheduledStart();await Promise.all([loadInvitations(true),loadCurrent(true)]);}
      finally{state.polling=false;}
    },8000);
  }

  function updateStatsFromChallenge(c){if(c?.rating)renderStats(c.rating);}
  function renderStats(stats){
    $('eca-my-stats').innerHTML=`<div><small>CHALLENGE RATING</small><b>${Number(stats.rating||1000).toLocaleString()}</b></div><div><small>TOTAL XP</small><b>${Number(stats.total_xp||0).toLocaleString()}</b></div><div><small>WINS</small><b>${Number(stats.wins||0).toLocaleString()}</b></div><div><small>WIN STREAK</small><b>${Number(stats.win_streak||0).toLocaleString()}</b></div>`;
  }
  async function loadStats(){try{renderStats(await rpc('edu_challenge_my_stats',{p_password:state.password}));}catch(error){showGlobal(displayError(error));}}
  async function loadLeaderboard(){
    try{
      const rows=await rpc('edu_challenge_leaderboard',{p_password:state.password});
      if(!Array.isArray(rows)||!rows.length){$('eca-leaderboard-list').innerHTML='<p class="eca-muted">No challenge victories yet. Create the first match and claim the top spot.</p>';return;}
      $('eca-leaderboard-list').innerHTML=`<div class="eca-board-head"><span>RANK / STUDENT</span><span>RATING</span><span>XP</span><span>W-L-D</span></div>`+rows.map((row,i)=>`<div class="eca-board-row ${row.is_me?'is-me':''}"><div><b class="eca-rank">${i+1}</b><span>${escapeHtml(row.name)}${row.is_me?'<small>YOU</small>':''}</span></div><b>${Number(row.rating||1000).toLocaleString()}</b><b>${Number(row.total_xp||0).toLocaleString()}</b><span>${Number(row.wins||0)}-${Number(row.losses||0)}-${Number(row.draws||0)}</span></div>`).join('');
    }catch(error){$('eca-leaderboard-list').innerHTML=`<p class="eca-error-inline">${escapeHtml(displayError(error))}</p>`;}
  }

  document.addEventListener('DOMContentLoaded',()=>{
    $('eca-login').addEventListener('click',login);
    $('eca-password').addEventListener('keydown',event=>{if(event.key==='Enter')login();});
    $('eca-toggle-password').addEventListener('click',()=>{const input=$('eca-password');input.type=input.type==='password'?'text':'password';$('eca-toggle-password').textContent=input.type==='password'?'Show':'Hide';});
    $('eca-create').addEventListener('click',createChallenge);
    $('eca-join').addEventListener('click',joinChallenge);
    $('eca-refresh-board').addEventListener('click',loadLeaderboard);
    $('eca-refresh-directory').addEventListener('click',()=>loadDirectory($('eca-directory-search').value));
    $('eca-refresh-invitations').addEventListener('click',()=>loadInvitations(false));
    $('eca-directory-search').addEventListener('input',()=>{clearTimeout(state.directorySearchTimer);state.directorySearchTimer=setTimeout(()=>loadDirectory($('eca-directory-search').value),300);});
    $('eca-scheduled-at').addEventListener('input',updateCreateState);
    $('eca-scheduled-at').addEventListener('change',updateCreateState);
    $('eca-invite-modal-close').addEventListener('click',closeInviteModal);
    $('eca-invite-modal').addEventListener('click',event=>{if(event.target.id==='eca-invite-modal')closeInviteModal();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('eca-invite-modal').hidden)closeInviteModal();});
    init();
  });
  window.addEventListener('beforeunload',()=>{stopTimer();if(state.poller)clearInterval(state.poller);});
})();
