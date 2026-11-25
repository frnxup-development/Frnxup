-- EDU-AFRIKA intelligent engine migration Part 5/7: transactional exam start, course validation and globally unique question allocation.
-- Run after the previous numbered migration. Execute this file by itself.

drop function if exists public.edu_start_exam(text,text,text[],text[],integer);
drop function if exists public.edu_start_exam(text,text,text[],text[],integer,boolean);
drop function if exists public.edu_start_exam(text,text,text[],text[],integer,boolean,uuid,text);

create or replace function public.edu_start_exam(
  p_password text,
  p_exam_code text,
  p_subject_codes text[],
  p_types text[],
  p_question_count integer,
  p_question_timer_enabled boolean,
  p_programme_id uuid,
  p_exam_mode text,
  p_topic_code text
)
returns jsonb
language plpgsql security definer set search_path=public,auth,extensions as $$
declare
  v_user uuid:=auth.uid();
  v_hash text;
  v_exam public.edu_exam_types%rowtype;
  v_programme public.edu_exam_programmes%rowtype;
  v_group jsonb;
  v_group_subjects text[];
  v_seen_group_subjects text[]:='{}';
  v_group_min integer;
  v_group_max integer;
  v_group_count integer;
  v_total_min integer;
  v_total_max integer;
  v_subject text;
  v_subject_count integer;
  v_requested integer;
  v_allocation_target integer;
  v_format text;
  v_duration integer;
  v_per integer;
  v_remainder integer;
  v_position integer:=0;
  v_subject_target integer;
  v_easy_target integer;
  v_medium_target integer;
  v_hard_target integer;
  v_easy_pct numeric:=30;
  v_medium_pct numeric:=50;
  v_hard_pct numeric:=20;
  v_weight numeric:=0;
  v_weight_total numeric:=0;
  v_q record;
  v_inserted integer;
  v_attempt uuid;
  v_total numeric(9,2);
  v_questions jsonb;
  v_question_set_hash text;
  v_seed text:=gen_random_uuid()::text;
  v_reused integer:=0;
  v_allocation_note text:='Questions were selected from the unused approved question bank and shuffled.';
  v_recent_count integer;
begin
  if v_user is null then raise exception 'Sign in to Frnxup to continue.'; end if;
  if not public.edu_is_active_frnxup_member() then raise exception 'Your Frnxup account is not active.'; end if;
  select password_hash into v_hash from public.edu_students where user_id=v_user;
  if v_hash is null or crypt(coalesce(p_password,''),v_hash)<>v_hash then raise exception 'Enter the correct EDU-AFRIKA password.'; end if;

  select * into v_exam from public.edu_exam_types where code=upper(p_exam_code) and is_active;
  if not found then raise exception 'This examination is not currently available.'; end if;
  if p_subject_codes is null or cardinality(p_subject_codes)<1 or cardinality(p_subject_codes)>12 then raise exception 'Select the required subjects for this examination (maximum 12).'; end if;
  if cardinality(p_subject_codes)<>(select count(distinct x) from unnest(p_subject_codes) x) then raise exception 'A subject has been selected more than once.'; end if;
  if p_types is null or cardinality(p_types)<1 or not (p_types <@ array['mcq','fill_gap']::text[]) then raise exception 'Choose multiple-choice, fill-in-the-gap or both question types.'; end if;
  if cardinality(p_types)<>(select count(distinct x) from unnest(p_types) x) then raise exception 'A question format has been selected more than once.'; end if;
  if coalesce(p_exam_mode,'practice') not in ('practice','timed','mock','revision','challenge') then raise exception 'Choose a valid examination mode.'; end if;
  if coalesce(p_exam_mode,'practice')='revision' and nullif(btrim(p_topic_code),'') is null then raise exception 'Choose a topic for Revision Mode.'; end if;
  if nullif(btrim(p_topic_code),'') is not null and coalesce(p_exam_mode,'practice')<>'revision' then raise exception 'A topic filter can only be used in Revision Mode.'; end if;
  if exists(select 1 from unnest(p_subject_codes) as u(code) where not exists(select 1 from public.edu_subjects s where s.code=u.code and s.is_active)) then raise exception 'One or more selected subjects are unavailable.'; end if;

  if (v_exam.requires_course_selection or exists(select 1 from public.edu_exam_programmes where exam_code=upper(p_exam_code) and is_active and is_verified)) and p_programme_id is null then
    raise exception 'Choose an approved course, stream, trade or subject combination before starting this examination.';
  end if;
  if p_programme_id is not null then
    select * into v_programme from public.edu_exam_programmes
      where id=p_programme_id and exam_code=upper(p_exam_code) and is_active and is_verified;
    if not found then raise exception 'This course / subject combination is not currently approved.'; end if;
    if not (v_programme.required_subject_codes <@ p_subject_codes) then raise exception 'Your selection is missing one or more required subjects for this course combination.'; end if;
    if not (p_subject_codes <@ v_programme.allowed_subject_codes) then raise exception 'One or more selected subjects are outside this course combination.'; end if;
    v_total_min:=coalesce(nullif(v_programme.selection_rules->>'total_min','')::integer,v_programme.min_subject_count);
    v_total_max:=coalesce(nullif(v_programme.selection_rules->>'total_max','')::integer,v_programme.max_subject_count);
    if cardinality(p_subject_codes)<v_total_min or cardinality(p_subject_codes)>v_total_max then
      raise exception 'Select between % and % subjects for this combination.',v_total_min,v_total_max;
    end if;
    if jsonb_typeof(v_programme.selection_rules->'groups')='array' then
      for v_group in select value from jsonb_array_elements(v_programme.selection_rules->'groups') loop
        v_group_subjects:=array(select jsonb_array_elements_text(coalesce(v_group->'subject_codes','[]'::jsonb)));
        v_group_min:=greatest(0,coalesce(nullif(v_group->>'min_select','')::integer,0));
        v_group_max:=greatest(v_group_min,coalesce(nullif(v_group->>'max_select','')::integer,cardinality(v_group_subjects)));
        if v_group_subjects && v_seen_group_subjects then
          raise exception 'This examination combination has overlapping subject groups. Ask an administrator to correct it.';
        end if;
        if not (v_group_subjects <@ v_programme.allowed_subject_codes) then
          raise exception 'This examination combination contains a subject group outside its allowed subjects. Ask an administrator to correct it.';
        end if;
        select count(*) into v_group_count from unnest(p_subject_codes) selected(code) where selected.code=any(v_group_subjects);
        if v_group_count<v_group_min or v_group_count>v_group_max then
          raise exception 'For %, select between % and % subjects. You currently selected %.',coalesce(v_group->>'label','this subject group'),v_group_min,v_group_max,v_group_count;
        end if;
        if cardinality(v_group_subjects)<>(select count(distinct code) from unnest(v_group_subjects) as g(code)) then
          raise exception 'A subject appears more than once inside a subject group. Ask an administrator to correct it.';
        end if;
        v_seen_group_subjects:=v_seen_group_subjects||v_group_subjects;
      end loop;
      if cardinality(v_seen_group_subjects)>0 and cardinality(v_seen_group_subjects)<>cardinality(v_programme.allowed_subject_codes) then
        raise exception 'Every allowed subject must belong to exactly one configured subject group. Ask an administrator to correct the combination.';
      end if;
    end if;
  end if;

  v_requested:=greatest(cardinality(p_subject_codes),least(coalesce(p_question_count,v_exam.default_question_count),400));
  v_subject_count:=cardinality(p_subject_codes);
  if exists(select 1 from public.edu_exam_attempts where student_id=v_user and status='in_progress') then
    raise exception 'You already have an unfinished examination. Resume or submit it before starting another test.';
  end if;
  foreach v_subject in array p_subject_codes loop
    if not exists(select 1 from public.edu_questions q where q.is_active and q.review_status='published' and upper(p_exam_code)=any(q.exam_codes) and q.subject_code=v_subject and q.question_type=any(p_types)
      and (cardinality(coalesce(q.programme_ids,'{}'::uuid[]))=0 or (p_programme_id is not null and p_programme_id=any(q.programme_ids)))) then
      raise exception 'No approved published questions are available for subject % in this examination yet.',v_subject;
    end if;
  end loop;

  -- Serialize every start across the global EDU-AFRIKA question pool. This prevents
  -- two students on different exam pages reserving the same fresh content.
  perform pg_advisory_xact_lock(hashtextextended('EDU-AFRIKA|GLOBAL-QUESTION-POOL',0));

  v_duration:=case when coalesce(p_question_timer_enabled,true)
    then greatest(v_exam.duration_minutes,least(480,ceil(v_requested*0.5)::integer+10)) else 480 end;
  begin
    insert into public.edu_exam_attempts(
      student_id,exam_code,subject_codes,requested_question_count,duration_minutes,
      question_timer_enabled,question_timer_seconds,programme_id,programme_name_snapshot,exam_mode,revision_topic_code,status)
    values(v_user,upper(p_exam_code),p_subject_codes,v_requested,v_duration,
      coalesce(p_question_timer_enabled,true),30,p_programme_id,coalesce(v_programme.programme_name,''),coalesce(p_exam_mode,'practice'),coalesce(nullif(btrim(p_topic_code),''),''),'in_progress')
    returning id into v_attempt;
  exception when unique_violation then
    raise exception 'You already have an unfinished examination. Resume or submit it before starting another test.';
  end;

  -- When both formats are selected and the paper has at least two questions,
  -- reserve one never-issued MCQ and one never-issued fill-gap item first. The
  -- remaining slots are filled by subject/difficulty blueprints below.
  v_allocation_target:=v_requested;
  if 'mcq'=any(p_types) and 'fill_gap'=any(p_types) and v_requested>=2 then
    foreach v_format in array array['mcq','fill_gap']::text[] loop
      select q.* into v_q
      from public.edu_questions q
      where q.is_active and q.review_status='published' and upper(p_exam_code)=any(q.exam_codes)
        and q.subject_code=any(p_subject_codes) and q.question_type=v_format
        and (cardinality(coalesce(q.programme_ids,'{}'::uuid[]))=0 or (p_programme_id is not null and p_programme_id=any(q.programme_ids)))
        and (nullif(btrim(p_topic_code),'') is null or q.topic_code=btrim(p_topic_code))
        and not exists(select 1 from public.edu_question_deliveries d where d.question_fingerprint=q.duplicate_hash or d.question_id=q.id)
        and not exists(select 1 from public.edu_attempt_items prior where prior.attempt_id=v_attempt and (prior.question_fingerprint=q.duplicate_hash or prior.question_id=q.id))
      order by md5(q.id::text||v_seed)
      limit 1;
      if not found then
        raise exception 'Both question formats were selected, but there is no never-issued % question available for this examination and course combination.',v_format;
      end if;
      insert into public.edu_attempt_items(attempt_id,question_id,question_order,question_text,question_fingerprint,subject_code,topic_code,question_type,options,correct_answer,accepted_answers,explanation,marks)
      values(v_attempt,v_q.id,(select count(*)+1 from public.edu_attempt_items where attempt_id=v_attempt),v_q.question_text,v_q.duplicate_hash,v_q.subject_code,v_q.topic_code,v_q.question_type,v_q.options,v_q.correct_answer,v_q.accepted_answers,v_q.explanation,v_q.marks);
      v_allocation_target:=v_allocation_target-1;
    end loop;
  end if;

  v_per:=v_allocation_target / v_subject_count;
  v_remainder:=v_allocation_target % v_subject_count;
  select coalesce(sum(coalesce(w.subject_share_percent,0)),0) into v_weight_total
  from unnest(p_subject_codes) as selected(code)
  left join lateral (
    select b.subject_share_percent
    from public.edu_exam_blueprints b
    where b.exam_code=upper(p_exam_code) and b.subject_code=selected.code
      and ((p_programme_id is not null and b.programme_id=p_programme_id) or b.programme_id is null)
    order by (b.programme_id is not null) desc
    limit 1
  ) w on true;
  foreach v_subject in array p_subject_codes loop
    v_position:=v_position+1;
    if v_weight_total>0 then
      select coalesce(subject_share_percent,0) into v_weight
        from public.edu_exam_blueprints
        where exam_code=upper(p_exam_code) and subject_code=v_subject
          and (programme_id=p_programme_id or programme_id is null)
        order by (programme_id is not null) desc limit 1;
      v_subject_target:=floor(v_allocation_target*coalesce(v_weight,0)/v_weight_total)::integer;
    else
      v_subject_target:=v_per + case when v_position<=v_remainder then 1 else 0 end;
    end if;
    select easy_percent,medium_percent,hard_percent into v_easy_pct,v_medium_pct,v_hard_pct
      from public.edu_exam_blueprints
      where exam_code=upper(p_exam_code) and subject_code=v_subject
        and (programme_id=p_programme_id or programme_id is null)
      order by (programme_id is not null) desc limit 1;
    v_easy_pct:=coalesce(v_easy_pct,30); v_medium_pct:=coalesce(v_medium_pct,50); v_hard_pct:=coalesce(v_hard_pct,20);
    if coalesce(p_exam_mode,'practice')='challenge' then v_easy_pct:=10; v_medium_pct:=25; v_hard_pct:=65; end if;
    v_easy_target:=floor(v_subject_target*v_easy_pct/100)::integer;
    v_medium_target:=floor(v_subject_target*v_medium_pct/100)::integer;
    v_hard_target:=greatest(0,v_subject_target-v_easy_target-v_medium_target);

    for v_q in
      select candidate.*
      from (
        select distinct on (q.duplicate_hash) q.*
        from public.edu_questions q
        where q.is_active and q.review_status='published' and upper(p_exam_code)=any(q.exam_codes)
        and q.subject_code=v_subject and q.question_type=any(p_types) and q.difficulty='easy'
        and (cardinality(coalesce(q.programme_ids,'{}'::uuid[]))=0 or (p_programme_id is not null and p_programme_id=any(q.programme_ids)))
        and (nullif(btrim(p_topic_code),'') is null or q.topic_code=btrim(p_topic_code))
        and not exists(select 1 from public.edu_question_deliveries used where used.question_fingerprint=q.duplicate_hash or used.question_id=q.id)
        and not exists(select 1 from public.edu_attempt_items prior where prior.attempt_id=v_attempt and (prior.question_fingerprint=q.duplicate_hash or prior.question_id=q.id))
        order by q.duplicate_hash,md5(q.id::text||v_seed)
      ) candidate
      order by md5(candidate.id::text||v_seed)
      limit v_easy_target
    loop
      insert into public.edu_attempt_items(attempt_id,question_id,question_order,question_text,question_fingerprint,subject_code,topic_code,question_type,options,correct_answer,accepted_answers,explanation,marks)
      values(v_attempt,v_q.id,(select count(*)+1 from public.edu_attempt_items where attempt_id=v_attempt),v_q.question_text,v_q.duplicate_hash,v_q.subject_code,v_q.topic_code,v_q.question_type,v_q.options,v_q.correct_answer,v_q.accepted_answers,v_q.explanation,v_q.marks);
    end loop;

    for v_q in
      select candidate.*
      from (
        select distinct on (q.duplicate_hash) q.*
        from public.edu_questions q
        where q.is_active and q.review_status='published' and upper(p_exam_code)=any(q.exam_codes)
        and q.subject_code=v_subject and q.question_type=any(p_types) and q.difficulty='medium'
        and (cardinality(coalesce(q.programme_ids,'{}'::uuid[]))=0 or (p_programme_id is not null and p_programme_id=any(q.programme_ids)))
        and (nullif(btrim(p_topic_code),'') is null or q.topic_code=btrim(p_topic_code))
        and not exists(select 1 from public.edu_question_deliveries used where used.question_fingerprint=q.duplicate_hash or used.question_id=q.id)
        and not exists(select 1 from public.edu_attempt_items prior where prior.attempt_id=v_attempt and (prior.question_fingerprint=q.duplicate_hash or prior.question_id=q.id))
        order by q.duplicate_hash,md5(q.id::text||v_seed)
      ) candidate
      order by md5(candidate.id::text||v_seed)
      limit v_medium_target
    loop
      insert into public.edu_attempt_items(attempt_id,question_id,question_order,question_text,question_fingerprint,subject_code,topic_code,question_type,options,correct_answer,accepted_answers,explanation,marks)
      values(v_attempt,v_q.id,(select count(*)+1 from public.edu_attempt_items where attempt_id=v_attempt),v_q.question_text,v_q.duplicate_hash,v_q.subject_code,v_q.topic_code,v_q.question_type,v_q.options,v_q.correct_answer,v_q.accepted_answers,v_q.explanation,v_q.marks);
    end loop;

    for v_q in
      select candidate.*
      from (
        select distinct on (q.duplicate_hash) q.*
        from public.edu_questions q
        where q.is_active and q.review_status='published' and upper(p_exam_code)=any(q.exam_codes)
        and q.subject_code=v_subject and q.question_type=any(p_types) and q.difficulty='hard'
        and (cardinality(coalesce(q.programme_ids,'{}'::uuid[]))=0 or (p_programme_id is not null and p_programme_id=any(q.programme_ids)))
        and (nullif(btrim(p_topic_code),'') is null or q.topic_code=btrim(p_topic_code))
        and not exists(select 1 from public.edu_question_deliveries used where used.question_fingerprint=q.duplicate_hash or used.question_id=q.id)
        and not exists(select 1 from public.edu_attempt_items prior where prior.attempt_id=v_attempt and (prior.question_fingerprint=q.duplicate_hash or prior.question_id=q.id))
        order by q.duplicate_hash,md5(q.id::text||v_seed)
      ) candidate
      order by md5(candidate.id::text||v_seed)
      limit v_hard_target
    loop
      insert into public.edu_attempt_items(attempt_id,question_id,question_order,question_text,question_fingerprint,subject_code,topic_code,question_type,options,correct_answer,accepted_answers,explanation,marks)
      values(v_attempt,v_q.id,(select count(*)+1 from public.edu_attempt_items where attempt_id=v_attempt),v_q.question_text,v_q.duplicate_hash,v_q.subject_code,v_q.topic_code,v_q.question_type,v_q.options,v_q.correct_answer,v_q.accepted_answers,v_q.explanation,v_q.marks);
    end loop;
  end loop;

  -- Fill a difficulty-mix shortfall from the remaining never-issued questions in the
  -- selected subjects. Normalized question content previously issued anywhere in EDU-AFRIKA is never reused.
  select count(*) into v_inserted from public.edu_attempt_items where attempt_id=v_attempt;
  if v_inserted<v_requested then
    for v_q in
      select candidate.*
      from (
        select distinct on (q.duplicate_hash) q.*
        from public.edu_questions q
        where q.is_active and q.review_status='published' and upper(p_exam_code)=any(q.exam_codes)
        and q.subject_code=any(p_subject_codes) and q.question_type=any(p_types)
        and (cardinality(coalesce(q.programme_ids,'{}'::uuid[]))=0 or (p_programme_id is not null and p_programme_id=any(q.programme_ids)))
        and (nullif(btrim(p_topic_code),'') is null or q.topic_code=btrim(p_topic_code))
        and not exists(select 1 from public.edu_attempt_items i where i.attempt_id=v_attempt and i.question_id=q.id)
        and not exists(select 1 from public.edu_question_deliveries used where used.question_fingerprint=q.duplicate_hash or used.question_id=q.id)
        and not exists(select 1 from public.edu_attempt_items prior where prior.attempt_id=v_attempt and (prior.question_fingerprint=q.duplicate_hash or prior.question_id=q.id))
        order by q.duplicate_hash,md5(q.id::text||v_seed)
      ) candidate
      order by md5(candidate.id::text||v_seed)
      limit greatest(v_requested-v_inserted,0)
    loop
      insert into public.edu_attempt_items(attempt_id,question_id,question_order,question_text,question_fingerprint,subject_code,topic_code,question_type,options,correct_answer,accepted_answers,explanation,marks)
      values(v_attempt,v_q.id,(select count(*)+1 from public.edu_attempt_items where attempt_id=v_attempt),v_q.question_text,v_q.duplicate_hash,v_q.subject_code,v_q.topic_code,v_q.question_type,v_q.options,v_q.correct_answer,v_q.accepted_answers,v_q.explanation,v_q.marks);
    end loop;
  end if;

  select count(*),coalesce(sum(marks),0) into v_inserted,v_total
  from public.edu_attempt_items where attempt_id=v_attempt;
  if v_inserted=0 then raise exception 'There are no approved questions for this course / subject combination.'; end if;
  if v_inserted<v_requested then
    raise exception 'Only % never-issued unique question(s) remain across EDU-AFRIKA for this subject combination; you requested %. EDU-AFRIKA does not reissue question content to another attempt. Reduce the question count or ask an administrator to publish more approved questions.',v_inserted,v_requested;
  end if;

  -- Sort-independent fingerprint prevents two candidates from receiving the exact
  -- same complete question set for the same examination. A conflict fails safely.
  select encode(digest(string_agg(question_id::text,',' order by question_id::text),'sha256'),'hex')
    into v_question_set_hash
  from public.edu_attempt_items where attempt_id=v_attempt and question_id is not null;
  if exists(select 1 from public.edu_exam_attempts a where a.exam_code=upper(p_exam_code) and a.question_set_hash=v_question_set_hash) then
    delete from public.edu_attempt_items where attempt_id=v_attempt;
    delete from public.edu_exam_attempts where id=v_attempt;
    raise exception 'This exact paper has already been assigned to another student. Please generate again with a different question count or subject combination. The question bank may need more unique questions.';
  end if;

  v_reused:=0;
  update public.edu_exam_attempts
    set question_count=v_inserted,total_marks=v_total,question_set_hash=v_question_set_hash,reused_question_count=v_reused
    where id=v_attempt;

  insert into public.edu_question_deliveries(attempt_id,question_id,question_fingerprint,student_id,exam_code,programme_id)
  select v_attempt,i.question_id,i.question_fingerprint,v_user,upper(p_exam_code),p_programme_id
  from public.edu_attempt_items i
  where i.attempt_id=v_attempt and i.question_id is not null;

  if v_reused=0 then
    v_allocation_note:='Every question in this paper is being issued for the first time in this examination. No question content has been issued in another attempt.';
  else
    v_allocation_note:=format('%s question(s) had to be reused because the current approved question bank is smaller than the requested paper. Add more approved questions to reduce overlap.',v_reused);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'order',i.question_order,'question',i.question_text,'subject_code',i.subject_code,'topic_code',i.topic_code,'question_type',i.question_type,'options',i.options,'marks',i.marks,'answer',i.student_answer) order by i.question_order),'[]'::jsonb)
    into v_questions from public.edu_attempt_items i where i.attempt_id=v_attempt;
  return jsonb_build_object(
    'ok',true,'attempt_id',v_attempt,'exam_code',upper(p_exam_code),'programme_id',p_programme_id,
    'programme_name',coalesce(v_programme.programme_name,''),'exam_mode',coalesce(p_exam_mode,'practice'),'topic_code',coalesce(nullif(btrim(p_topic_code),''),''),
    'duration_minutes',v_duration,'question_timer_enabled',coalesce(p_question_timer_enabled,true),
    'question_timer_seconds',30,'question_count',v_inserted,'requested_question_count',v_requested,
    'total_marks',v_total,'started_at',now(),'questions',v_questions,
    'reused_question_count',v_reused,'allocation_note',v_allocation_note,'question_set_hash',v_question_set_hash
  );
end;
$$;

revoke all on function public.edu_start_exam(text,text,text[],text[],integer,boolean,uuid,text,text) from public,anon;
grant execute on function public.edu_start_exam(text,text,text[],text[],integer,boolean,uuid,text,text) to authenticated;
revoke all on function public.edu_get_exam_programmes(text) from public,anon;
grant execute on function public.edu_get_exam_programmes(text) to authenticated;
