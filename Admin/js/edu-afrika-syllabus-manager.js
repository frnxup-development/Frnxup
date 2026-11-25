(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => window.FX?.esc ? window.FX.esc(value ?? '') : String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  let exams = [], subjects = [], topics = [], maps = [];
  const yearFor = topic => Number(topic.syllabus_year || 2026);
  function feedback(message, good=false) { const el=$('edu-syllabus-feedback'); if(!el)return; el.textContent=message||''; el.classList.toggle('is-good',!!good); }
  function selectedExam(){ return $('edu-syllabus-exam')?.value || ''; }
  function selectedSubject(){ return $('edu-syllabus-subject')?.value || ''; }
  async function loadBase(){
    const [e,s,t,m]=await Promise.all([
      FX.client.from('edu_exam_types').select('code,name,is_active').order('sort_order').order('name'),
      FX.client.from('edu_subjects').select('code,name,is_active').order('sort_order').order('name'),
      FX.client.from('edu_subject_topics').select('id,subject_code,topic_code,topic_name,syllabus_year,is_active,topic_description,learning_outcomes').order('subject_code').order('topic_name'),
      FX.client.from('edu_subject_topic_exam_map').select('id,topic_id,subject_code,exam_code,syllabus_year,is_active,verification_status,source_title,source_url,review_note').eq('exam_code','WAEC').limit(1000)
    ]);
    for(const r of [e,s,t,m])if(r.error)throw r.error;
    exams=e.data||[];subjects=s.data||[];topics=t.data||[];maps=m.data||[];
    $('edu-syllabus-exam').innerHTML='<option value="">Choose examination</option>'+exams.filter(x=>x.is_active).map(x=>`<option value="${esc(x.code)}">${esc(x.name)}</option>`).join('');
    $('edu-syllabus-subject').innerHTML='<option value="">Choose subject</option>'+subjects.filter(x=>x.is_active).map(x=>`<option value="${esc(x.code)}">${esc(x.name)}</option>`).join('');
    if(exams.some(x=>x.code==='WAEC'&&x.is_active))$('edu-syllabus-exam').value='WAEC';
    if(subjects.some(x=>x.code==='BUSINESS_STUDIES'&&x.is_active))$('edu-syllabus-subject').value='BUSINESS_STUDIES';
    await renderCoverage(); await renderMappings();
  }
  async function refreshMaps(){
    const exam=selectedExam();
    if(!exam){maps=[];return;}
    // Keep the manager working set scoped to one examination, below PostgREST row caps.
    const {data,error}=await FX.client.from('edu_subject_topic_exam_map')
      .select('id,topic_id,subject_code,exam_code,syllabus_year,is_active,verification_status,source_title,source_url,review_note')
      .eq('exam_code',exam).limit(1000);
    if(error)throw error;maps=data||[];
  }
  async function renderCoverage(){
    const exam=selectedExam(), host=$('edu-syllabus-coverage');
    if(!exam){host.innerHTML='<p class="edu-admin-empty">Choose an examination to inspect its topic coverage.</p>';return;}
    const rows=subjects.filter(s=>s.is_active).map(s=>{
      const subjectTopics=topics.filter(t=>t.subject_code===s.code&&t.is_active);
      const mapped=maps.filter(m=>m.exam_code===exam&&m.subject_code===s.code&&m.is_active&&subjectTopics.some(t=>t.id===m.topic_id));
      const reviewed=mapped.filter(m=>m.verification_status==='reviewed').length;
      const official=mapped.filter(m=>m.verification_status==='official_source_verified').length;
      const draft=mapped.filter(m=>m.verification_status==='draft').length;
      return {name:s.name,code:s.code,total:subjectTopics.length,mapped:mapped.length,reviewed,official,draft};
    });
    const covered=rows.filter(r=>r.mapped>0).length;
    const totalTopics=rows.reduce((a,r)=>a+r.total,0), mappedTopics=rows.reduce((a,r)=>a+r.mapped,0);
    host.innerHTML=`<div class="edu-syllabus-summary"><article><small>Subjects in catalogue</small><b>${rows.length}</b></article><article><small>Subjects mapped to ${esc(exam)}</small><b>${covered}</b></article><article><small>Active topics</small><b>${totalTopics.toLocaleString()}</b></article><article><small>Active mappings</small><b>${mappedTopics.toLocaleString()}</b></article></div><div class="table-wrap"><table class="admin-table"><thead><tr><th>Subject</th><th>Topics</th><th>Mapped</th><th>Reviewed</th><th>Official-source verified</th><th>Draft</th></tr></thead><tbody>${rows.map(r=>`<tr><td><b>${esc(r.name)}</b><small>${esc(r.code)}</small></td><td>${r.total}</td><td>${r.mapped}</td><td>${r.reviewed}</td><td>${r.official}</td><td>${r.draft}</td></tr>`).join('')}</tbody></table></div>`;
  }
  async function renderMappings(){
    const exam=selectedExam(), subject=selectedSubject(), host=$('edu-syllabus-map-table');
    if(!exam||!subject){host.innerHTML='<p class="edu-admin-empty">Choose both an examination and a subject to manage topic mappings.</p>';return;}
    const rows=topics.filter(t=>t.subject_code===subject);
    const mapIndex=new Map(maps.filter(m=>m.exam_code===exam&&m.subject_code===subject).map(m=>[`${m.topic_id}:${m.syllabus_year}`,m]));
    if(!rows.length){host.innerHTML='<p class="edu-admin-empty">This subject has no topics yet. Add topics above or import a topic CSV.</p>';return;}
    host.innerHTML=`<table class="admin-table edu-syllabus-map-table"><thead><tr><th>Topic</th><th>Topic active</th><th>Exam mapping active</th><th>Verification</th><th>Official source URL</th><th>Review note</th><th>Save</th></tr></thead><tbody>${rows.map(t=>{
      const y=yearFor(t),m=mapIndex.get(`${t.id}:${y}`);
      return `<tr data-topic-id="${esc(t.id)}" data-year="${y}"><td><b>${esc(t.topic_name)}</b><small>${esc(t.topic_code)} · ${y}</small></td><td><span class="edu-admin-status ${t.is_active?'':'is-off'}">${t.is_active?'ACTIVE':'INACTIVE'}</span></td><td><label class="edu-map-toggle"><input type="checkbox" data-map-active ${m?.is_active?'checked':''} ${t.is_active?'':'disabled'}><span>${m?.is_active?'Mapped':'Not mapped'}</span></label></td><td><select data-map-status><option value="draft" ${(!m||m.verification_status==='draft')?'selected':''}>Draft</option><option value="reviewed" ${m?.verification_status==='reviewed'?'selected':''}>Reviewed</option><option value="official_source_verified" ${m?.verification_status==='official_source_verified'?'selected':''}>Official source verified</option></select></td><td><input data-map-url type="url" maxlength="1000" value="${esc(m?.source_url||'')}" placeholder="Official syllabus URL"></td><td><input data-map-note type="text" maxlength="600" value="${esc(m?.review_note||'')}" placeholder="What was checked / level / notes"></td><td><button type="button" data-map-save class="admin-action action-green">Save</button></td></tr>`;
    }).join('')}</tbody></table><p class="edu-syllabus-hint">Only active topics with active examination mappings are available to the AI generator. “Official source verified” requires an official source URL and a review note.</p>`;
  }
  async function saveMapping(event){
    const button=event.target.closest('[data-map-save]');if(!button)return;
    const row=button.closest('tr'), topic=topics.find(t=>t.id===row.dataset.topicId);if(!topic)return;
    const status=row.querySelector('[data-map-status]').value,sourceUrl=row.querySelector('[data-map-url]').value.trim(),note=row.querySelector('[data-map-note]').value.trim(),active=row.querySelector('[data-map-active]').checked;
    if(sourceUrl&&!/^https?:\/\//i.test(sourceUrl)){feedback('Syllabus source links must use HTTPS or HTTP.');return;}
    if(status==='official_source_verified'&&(!sourceUrl||!note)){feedback('To mark a mapping Official source verified, supply the official syllabus URL and a note describing the exact level/version checked.');return;}
    button.disabled=true;button.textContent='Saving…';
    try{
      const payload={topic_id:topic.id,subject_code:topic.subject_code,exam_code:selectedExam(),syllabus_year:Number(row.dataset.year),is_active:active&&topic.is_active,verification_status:status,source_title:sourceUrl?'Administrator-supplied official syllabus source':'',source_url:sourceUrl,review_note:note,updated_at:new Date().toISOString()};
      const {error}=await FX.client.from('edu_subject_topic_exam_map').upsert(payload,{onConflict:'topic_id,exam_code,syllabus_year'});if(error)throw error;
      await refreshMaps();await renderCoverage();await renderMappings();feedback('Topic mapping saved. AI generation uses active mappings only.',true);
    }catch(error){feedback(error.message||'Could not save examination topic mapping.');}
    finally{button.disabled=false;button.textContent='Save';}
  }
  async function mapAll(){
    const exam=selectedExam(),subject=selectedSubject();if(!exam||!subject){feedback('Choose an examination and subject first.');return;}
    const rows=topics.filter(t=>t.subject_code===subject&&t.is_active);if(!rows.length){feedback('This subject has no active topics to map.');return;}
    if(!confirm(`Map all ${rows.length} active topics for ${subject} to ${exam} as Draft? You can verify or deactivate individual topics afterwards.`))return;
    const payload=rows.map(t=>({topic_id:t.id,subject_code:t.subject_code,exam_code:exam,syllabus_year:yearFor(t),is_active:true,verification_status:'draft',source_title:'',source_url:'',review_note:'Bulk-created baseline mapping; verify against current official syllabus.',updated_at:new Date().toISOString()}));
    try{const {error}=await FX.client.from('edu_subject_topic_exam_map').upsert(payload,{onConflict:'topic_id,exam_code,syllabus_year',ignoreDuplicates:true});if(error)throw error;await refreshMaps();await renderCoverage();await renderMappings();feedback(`Mapped ${rows.length} active topics as Draft. Review each mapping before marking it verified.`,true);}
    catch(error){feedback(error.message||'Bulk mapping failed.');}
  }
  function parseCSV(text){
    const rows=[];let row=[],field='',quoted=false;
    for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;}else if(c==='"')quoted=true;else if(c===','){row.push(field);field='';}else if(c==='\n'){row.push(field);rows.push(row);row=[];field='';}else if(c!=='\r')field+=c;}
    if(field.length||row.length){row.push(field);rows.push(row);}return rows.filter(r=>r.some(x=>String(x).trim()));
  }
  async function importCSV(){
    const file=$('edu-syllabus-csv').files?.[0];if(!file){feedback('Choose a CSV file first.');return;}
    const button=$('edu-syllabus-import');button.disabled=true;button.textContent='Reading CSV…';
    try{
      const parsed=parseCSV(await file.text());if(parsed.length<2)throw new Error('The CSV must contain a header and at least one topic row.');
      const headers=parsed[0].map(x=>x.trim().toLowerCase());const index=key=>headers.indexOf(key);
      for(const key of ['subject_code','topic_code','topic_name'])if(index(key)<0)throw new Error(`Missing required CSV header: ${key}`);
      const validSubjects=new Set(subjects.map(s=>s.code));const payload=[];let skipped=0;
      for(const values of parsed.slice(1)){
        const get=k=>index(k)<0?'':String(values[index(k)]??'').trim();
        const subject=get('subject_code').toUpperCase(),code=get('topic_code').toUpperCase().replace(/[^A-Z0-9]+/g,'_').replace(/^_+|_+$/g,''),name=get('topic_name');
        if(!validSubjects.has(subject)||!code||!name){skipped++;continue;}
        const outcomes=get('learning_outcomes').split('|').map(x=>x.trim()).filter(Boolean);
        payload.push({subject_code:subject,topic_code:code,topic_name:name,syllabus_year:Number(get('syllabus_year'))||2026,topic_description:get('topic_description'),learning_outcomes:outcomes,source_status:'draft',source_reference:'Bulk CSV import; official syllabus alignment not yet verified',is_active:true,updated_at:new Date().toISOString()});
      }
      if(!payload.length)throw new Error('No valid rows found. Check subject_code, topic_code and topic_name.');
      for(let i=0;i<payload.length;i+=200){const {error}=await FX.client.from('edu_subject_topics').upsert(payload.slice(i,i+200),{onConflict:'subject_code,topic_code,syllabus_year',ignoreDuplicates:true});if(error)throw error;}
      await loadBase();feedback(`Imported ${payload.length} topic rows. ${skipped} invalid row(s) skipped. Existing topic records were not overwritten.`,true);
    }catch(error){feedback(error.message||'Topic CSV import failed.');}
    finally{button.disabled=false;button.textContent='Import topic CSV';}
  }
  function downloadTemplate(){
    const rows=[['subject_code','topic_code','topic_name','syllabus_year','topic_description','learning_outcomes'],['BUSINESS_STUDIES','BUSINESS_ENVIRONMENT','Nature, scope and objectives of business','2026','Business context and basic terminology','Define business|Explain its objectives|Apply concepts to examples']];
    const csv=rows.map(r=>r.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='edu-afrika-syllabus-topic-template.csv';a.click();URL.revokeObjectURL(url);
  }
  function init(){
    if(!$('edu-syllabus-exam')||!window.FX?.client)return;
    loadBase().catch(e=>feedback(`Syllabus manager could not load: ${e.message}`));
    $('edu-syllabus-exam').addEventListener('change',()=>{refreshMaps().then(()=>Promise.all([renderCoverage(),renderMappings()])).catch(e=>feedback(e.message));});
    $('edu-syllabus-subject').addEventListener('change',renderMappings);
    $('edu-syllabus-load').addEventListener('click',()=>{refreshMaps().then(()=>Promise.all([renderCoverage(),renderMappings()])).catch(e=>feedback(e.message));});
    $('edu-syllabus-map-all').addEventListener('click',mapAll);
    $('edu-syllabus-map-table').addEventListener('click',saveMapping);
    $('edu-syllabus-import').addEventListener('click',importCSV);
    $('edu-syllabus-template').addEventListener('click',downloadTemplate);
  }
  const originalInit=window.initEduAfrikaAdmin;
  if(typeof originalInit==='function')window.initEduAfrikaAdmin=async function(){await originalInit();init();};
  else document.addEventListener('DOMContentLoaded',()=>{const original=window.initEduAfrikaAdmin;if(typeof original==='function'){window.initEduAfrikaAdmin=async function(){await original();init();};}});
})();
