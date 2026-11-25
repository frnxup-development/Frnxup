-- EDU-AFRIKA intelligent engine migration Part 6/7: subject/topic lookup, timer, answer saving and attempt resume RPCs.
-- Run after the previous numbered migration. Execute this file by itself.

drop function if exists public.edu_available_subjects(text);
create or replace function public.edu_available_subjects(p_exam_code text,p_programme_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to Frnxup to continue.'; end if;
  if not public.edu_is_active_frnxup_member() then raise exception 'Your Frnxup account is not active.'; end if;
  if not exists(select 1 from public.edu_exam_types where code=upper(p_exam_code) and is_active) then raise exception 'This examination is not currently available.'; end if;
  if p_programme_id is not null and not exists(select 1 from public.edu_exam_programmes where id=p_programme_id and exam_code=upper(p_exam_code) and is_active and is_verified) then
    raise exception 'This course / subject combination is not currently approved.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'code',s.code,'name',s.name,'question_count',q.cnt,'unused_question_count',q.unused_cnt
  ) order by s.sort_order,s.name),'[]'::jsonb)
  into v_result
  from public.edu_subjects s
  join (
    select q.subject_code,count(distinct q.duplicate_hash)::integer cnt,
      count(distinct q.duplicate_hash) filter(where not exists(
        select 1 from public.edu_question_deliveries d where d.question_fingerprint=q.duplicate_hash or d.question_id=q.id
      ))::integer unused_cnt
    from public.edu_questions q
    where q.is_active and q.review_status='published' and upper(p_exam_code)=any(q.exam_codes)
      and (cardinality(coalesce(q.programme_ids,'{}'::uuid[]))=0 or (p_programme_id is not null and p_programme_id=any(q.programme_ids)))
    group by q.subject_code
  ) q on q.subject_code=s.code
  where s.is_active;
  return v_result;
end;
$$;
revoke all on function public.edu_available_subjects(text,uuid) from public,anon;
grant execute on function public.edu_available_subjects(text,uuid) to authenticated;

drop function if exists public.edu_available_topics(text,text[]);
create or replace function public.edu_available_topics(p_exam_code text,p_subject_codes text[],p_programme_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to Frnxup to continue.'; end if;
  if not public.edu_is_active_frnxup_member() then raise exception 'Your Frnxup account is not active.'; end if;
  if not exists(select 1 from public.edu_exam_types where code=upper(p_exam_code) and is_active) then raise exception 'This examination is not currently available.'; end if;
  if p_programme_id is not null and not exists(select 1 from public.edu_exam_programmes where id=p_programme_id and exam_code=upper(p_exam_code) and is_active and is_verified) then
    raise exception 'This course / subject combination is not currently approved.';
  end if;
  if p_subject_codes is null or cardinality(p_subject_codes)=0 then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'topic_code',t.topic_code,'topic_name',coalesce(st.topic_name,t.topic_code),
    'question_count',t.question_count,'unused_question_count',t.unused_question_count
  ) order by coalesce(st.topic_name,t.topic_code)),'[]'::jsonb)
  into v_result
  from (
    select q.topic_code,count(distinct q.duplicate_hash)::integer question_count,
      count(distinct q.duplicate_hash) filter(where not exists(
        select 1 from public.edu_question_deliveries d where d.question_fingerprint=q.duplicate_hash or d.question_id=q.id
      ))::integer unused_question_count
    from public.edu_questions q
    where q.is_active and q.review_status='published' and upper(p_exam_code)=any(q.exam_codes)
      and q.subject_code=any(p_subject_codes) and nullif(btrim(q.topic_code),'') is not null
      and (cardinality(coalesce(q.programme_ids,'{}'::uuid[]))=0 or (p_programme_id is not null and p_programme_id=any(q.programme_ids)))
    group by q.topic_code
  ) t
  left join (select topic_code,min(topic_name) topic_name from public.edu_subject_topics where is_active group by topic_code) st
    on st.topic_code=t.topic_code
  where t.unused_question_count>0;
  return v_result;
end;
$$;
revoke all on function public.edu_available_topics(text,text[],uuid) from public,anon;
grant execute on function public.edu_available_topics(text,text[],uuid) to authenticated;

-- Server-authoritative per-question deadlines. A question receives its 30-second
-- deadline the first time it is opened; revisiting it never resets the clock.
create or replace function public.edu_open_question(p_password text,p_attempt_item_id uuid)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare
  v_user uuid:=auth.uid(); v_hash text; v_attempt public.edu_exam_attempts%rowtype;
  v_item public.edu_attempt_items%rowtype; v_now timestamptz:=clock_timestamp();
begin
  if v_user is null or not public.edu_is_active_frnxup_member() then raise exception 'Your active Frnxup account is required.'; end if;
  select password_hash into v_hash from public.edu_students where user_id=v_user;
  if v_hash is null or crypt(coalesce(p_password,''),v_hash)<>v_hash then raise exception 'Your EDU-AFRIKA session is no longer valid.'; end if;
  select * into v_attempt from public.edu_exam_attempts where id=(select attempt_id from public.edu_attempt_items where id=p_attempt_item_id) and student_id=v_user for update;
  if not found or v_attempt.status<>'in_progress' then raise exception 'This examination is no longer active.'; end if;
  if v_now>v_attempt.started_at+(v_attempt.duration_minutes||' minutes')::interval then raise exception 'The examination time has ended.'; end if;
  select * into v_item from public.edu_attempt_items where id=p_attempt_item_id and attempt_id=v_attempt.id for update;
  if not found then raise exception 'This question does not belong to your examination.'; end if;
  if v_attempt.question_timer_enabled then
    if v_item.timer_started_at is null then
      update public.edu_attempt_items set timer_started_at=v_now,timer_expires_at=v_now+make_interval(secs=>v_attempt.question_timer_seconds)
      where id=v_item.id returning * into v_item;
    end if;
  end if;
  return jsonb_build_object('ok',true,'timer_enabled',v_attempt.question_timer_enabled,
    'seconds',v_attempt.question_timer_seconds,'started_at',v_item.timer_started_at,
    'expires_at',v_item.timer_expires_at,'server_now',v_now);
end;
$$;
revoke all on function public.edu_open_question(text,uuid) from public,anon;
grant execute on function public.edu_open_question(text,uuid) to authenticated;

create or replace function public.edu_save_answer(p_password text,p_attempt_item_id uuid,p_answer text)
returns jsonb language plpgsql security definer set search_path=public,auth,extensions as $$
declare
  v_user uuid:=auth.uid(); v_hash text; v_attempt public.edu_exam_attempts%rowtype;
  v_item public.edu_attempt_items%rowtype; v_now timestamptz:=clock_timestamp();
begin
  if v_user is null or not public.edu_is_active_frnxup_member() then raise exception 'Your active Frnxup account is required.'; end if;
  select password_hash into v_hash from public.edu_students where user_id=v_user;
  if v_hash is null or crypt(coalesce(p_password,''),v_hash)<>v_hash then raise exception 'Your EDU-AFRIKA session is no longer valid.'; end if;
  select a.* into v_attempt from public.edu_exam_attempts a join public.edu_attempt_items i on i.attempt_id=a.id
    where i.id=p_attempt_item_id and a.student_id=v_user and a.status='in_progress' for update of a,i;
  if not found then raise exception 'This exam has ended. Submit your answers or start a new exam.'; end if;
  if v_now>v_attempt.started_at+(v_attempt.duration_minutes||' minutes')::interval then raise exception 'The examination time has ended.'; end if;
  select * into v_item from public.edu_attempt_items where id=p_attempt_item_id;
  if v_attempt.question_timer_enabled then
    if v_item.timer_expires_at is null then raise exception 'Open this question before saving an answer.'; end if;
    if v_now>v_item.timer_expires_at then raise exception 'This question time has elapsed. EDU-AFRIKA has moved on.'; end if;
  end if;
  update public.edu_attempt_items set student_answer=left(coalesce(p_answer,''),1000) where id=p_attempt_item_id;
  return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.edu_save_answer(text,uuid,text) from public,anon;
grant execute on function public.edu_save_answer(text,uuid,text) to authenticated;

create or replace function public.edu_get_active_attempt(p_password text)
returns jsonb language plpgsql security definer set search_path=public,auth,extensions as $$
declare v_user uuid:=auth.uid(); v_hash text; v_attempt public.edu_exam_attempts%rowtype; v_questions jsonb;
begin
  if v_user is null or not public.edu_is_active_frnxup_member() then raise exception 'Your active Frnxup account is required.'; end if;
  select password_hash into v_hash from public.edu_students where user_id=v_user;
  if v_hash is null or crypt(coalesce(p_password,''),v_hash)<>v_hash then raise exception 'Enter the correct EDU-AFRIKA password.'; end if;
  select * into v_attempt from public.edu_exam_attempts where student_id=v_user and status='in_progress' order by started_at desc limit 1;
  if not found then return jsonb_build_object('active',false); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'order',i.question_order,'question',i.question_text,'subject_code',i.subject_code,'topic_code',i.topic_code,'question_type',i.question_type,'options',i.options,'marks',i.marks,'answer',i.student_answer) order by i.question_order),'[]'::jsonb)
  into v_questions from public.edu_attempt_items i where i.attempt_id=v_attempt.id;
  return jsonb_build_object('active',true,'attempt_id',v_attempt.id,'exam_code',v_attempt.exam_code,'programme_id',v_attempt.programme_id,'programme_name',v_attempt.programme_name_snapshot,'exam_mode',v_attempt.exam_mode,'topic_code',v_attempt.revision_topic_code,'subject_codes',v_attempt.subject_codes,'duration_minutes',v_attempt.duration_minutes,'question_timer_enabled',v_attempt.question_timer_enabled,'question_timer_seconds',v_attempt.question_timer_seconds,'question_count',v_attempt.question_count,'total_marks',v_attempt.total_marks,'started_at',v_attempt.started_at,'questions',v_questions);
end;
$$;
revoke all on function public.edu_get_active_attempt(text) from public,anon;
grant execute on function public.edu_get_active_attempt(text) to authenticated;

-- -----------------------------------------------------------------------------
