-- EDU-AFRIKA intelligent engine migration Part 7/7: secure scoring, reports and student/admin analytics.
-- Run after the previous numbered migration. Execute this file by itself.

-- Student reporting + analytics
-- -----------------------------------------------------------------------------
create or replace function public.edu_submit_exam(p_password text,p_attempt_id uuid,p_answers jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public,auth,extensions as $$
declare
  v_user uuid:=auth.uid(); v_hash text; v_attempt public.edu_exam_attempts%rowtype; v_item public.edu_attempt_items%rowtype;
  v_answer text; v_correct boolean; v_earned numeric(9,2); v_total numeric(9,2); v_review jsonb; v_status text;
begin
  if v_user is null or not public.edu_is_active_frnxup_member() then raise exception 'Your active Frnxup account is required.'; end if;
  select password_hash into v_hash from public.edu_students where user_id=v_user;
  if v_hash is null or crypt(coalesce(p_password,''),v_hash)<>v_hash then raise exception 'Your EDU-AFRIKA session is no longer valid.'; end if;
  select * into v_attempt from public.edu_exam_attempts where id=p_attempt_id and student_id=v_user for update;
  if not found then raise exception 'Exam attempt not found.'; end if;
  if v_attempt.status<>'in_progress' then raise exception 'This exam has already been submitted.'; end if;
  for v_item in select * from public.edu_attempt_items where attempt_id=p_attempt_id order by question_order loop
    if v_attempt.question_timer_enabled then
      if v_item.timer_expires_at is not null and now()<=v_item.timer_expires_at then
        v_answer:=coalesce(nullif(p_answers->>(v_item.id::text),''),v_item.student_answer,'');
      else
        v_answer:=coalesce(v_item.student_answer,'');
      end if;
    else
      v_answer:=coalesce(nullif(p_answers->>(v_item.id::text),''),v_item.student_answer,'');
    end if;
    if v_item.question_type='mcq' then
      v_correct:=upper(trim(v_answer))=upper(trim(v_item.correct_answer));
    else
      v_correct:=lower(regexp_replace(trim(v_answer),'\s+',' ','g'))=lower(regexp_replace(trim(v_item.correct_answer),'\s+',' ','g'))
        or exists(select 1 from unnest(v_item.accepted_answers) a where lower(regexp_replace(trim(a),'\s+',' ','g'))=lower(regexp_replace(trim(v_answer),'\s+',' ','g')));
    end if;
    update public.edu_attempt_items set student_answer=nullif(v_answer,''),is_correct=(case when v_answer='' then false else v_correct end),awarded_marks=case when v_answer<>'' and v_correct then marks else 0 end where id=v_item.id;
  end loop;
  select coalesce(sum(awarded_marks),0),coalesce(sum(marks),0) into v_earned,v_total from public.edu_attempt_items where attempt_id=p_attempt_id;
  v_status:=case when now()>v_attempt.started_at+(v_attempt.duration_minutes||' minutes')::interval then 'time_up' else 'submitted' end;
  update public.edu_exam_attempts set earned_marks=v_earned,total_marks=v_total,status=v_status,submitted_at=now() where id=p_attempt_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'subject_code',subject_code,'topic_code',topic_code,'question',question_text,'question_type',question_type,
    'your_answer',coalesce(student_answer,''),'correct_answer',correct_answer,'is_correct',is_correct,
    'marks_awarded',awarded_marks,'marks',marks,'explanation',explanation
  ) order by question_order),'[]'::jsonb)
  into v_review from public.edu_attempt_items where attempt_id=p_attempt_id;
  return jsonb_build_object('ok',true,'status',v_status,'exam_code',v_attempt.exam_code,
    'programme_name',v_attempt.programme_name_snapshot,'exam_mode',v_attempt.exam_mode,'topic_code',v_attempt.revision_topic_code,
    'earned_marks',v_earned,'total_marks',v_total,'percentage',case when v_total=0 then 0 else round((v_earned/v_total)*100,2) end,
    'question_count',v_attempt.question_count,'review',v_review);
end;
$$;
revoke all on function public.edu_submit_exam(text,uuid,jsonb) from public,anon;
grant execute on function public.edu_submit_exam(text,uuid,jsonb) to authenticated;

create or replace function public.edu_report_question(p_password text,p_attempt_item_id uuid,p_reason text,p_details text default '')
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_user uuid:=auth.uid(); v_hash text;
begin
  if v_user is null or not public.edu_is_active_frnxup_member() then raise exception 'Your active Frnxup account is required.'; end if;
  select password_hash into v_hash from public.edu_students where user_id=v_user;
  if v_hash is null or crypt(coalesce(p_password,''),v_hash)<>v_hash then raise exception 'Enter the correct EDU-AFRIKA password.'; end if;
  if p_reason not in ('wrong_answer','ambiguous','typo','out_of_syllabus','duplicate','other') then raise exception 'Choose a valid question report reason.'; end if;
  if not exists(select 1 from public.edu_attempt_items i join public.edu_exam_attempts a on a.id=i.attempt_id where i.id=p_attempt_item_id and a.student_id=v_user) then raise exception 'This question is not part of your examination history.'; end if;
  insert into public.edu_question_reports(attempt_item_id,reported_by,reason,details)
  values(p_attempt_item_id,v_user,p_reason,left(coalesce(p_details,''),1200))
  on conflict (attempt_item_id,reported_by) do update set reason=excluded.reason,details=excluded.details,status='open',created_at=now();
  return jsonb_build_object('ok',true);
end;
$$;

create or replace function public.edu_get_student_analytics(p_password text)
returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare v_user uuid:=auth.uid(); v_hash text; v_result jsonb;
begin
  if v_user is null or not public.edu_is_active_frnxup_member() then raise exception 'Your active Frnxup account is required.'; end if;
  select password_hash into v_hash from public.edu_students where user_id=v_user;
  if v_hash is null or crypt(coalesce(p_password,''),v_hash)<>v_hash then raise exception 'Enter the correct EDU-AFRIKA password.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('subject_code',x.subject_code,'attempted',x.attempted,'correct',x.correct,'accuracy',case when x.attempted=0 then 0 else round(x.correct::numeric/x.attempted*100,1) end) order by x.accuracy desc),'[]'::jsonb)
    into v_result
  from (
    select i.subject_code,count(*)::integer attempted,count(*) filter(where i.is_correct is true)::integer correct,
      case when count(*)=0 then 0 else count(*) filter(where i.is_correct is true)::numeric/count(*) end accuracy
    from public.edu_attempt_items i join public.edu_exam_attempts a on a.id=i.attempt_id
    where a.student_id=v_user and a.status in ('submitted','time_up')
    group by i.subject_code
  ) x;
  return v_result;
end;
$$;



create or replace function public.edu_get_student_topic_analytics(p_password text)
returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare v_user uuid:=auth.uid(); v_hash text; v_result jsonb;
begin
  if v_user is null or not public.edu_is_active_frnxup_member() then raise exception 'Your active Frnxup account is required.'; end if;
  select password_hash into v_hash from public.edu_students where user_id=v_user;
  if v_hash is null or crypt(coalesce(p_password,''),v_hash)<>v_hash then raise exception 'Enter the correct EDU-AFRIKA password.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'subject_code',x.subject_code,'topic_code',x.topic_code,'topic_name',coalesce(t.topic_name,x.topic_code),
    'attempted',x.attempted,'correct',x.correct,
    'accuracy',case when x.attempted=0 then 0 else round(x.correct::numeric/x.attempted*100,1) end
  ) order by x.accuracy desc,x.attempted desc),'[]'::jsonb)
  into v_result
  from (
    select i.subject_code,i.topic_code,count(*)::integer attempted,
      count(*) filter(where i.is_correct is true)::integer correct,
      case when count(*)=0 then 0 else count(*) filter(where i.is_correct is true)::numeric/count(*) end accuracy
    from public.edu_attempt_items i join public.edu_exam_attempts a on a.id=i.attempt_id
    where a.student_id=v_user and a.status in ('submitted','time_up') and nullif(i.topic_code,'') is not null
    group by i.subject_code,i.topic_code
  ) x
  left join (select subject_code,topic_code,min(topic_name) topic_name from public.edu_subject_topics group by subject_code,topic_code) t
    on t.subject_code=x.subject_code and t.topic_code=x.topic_code;
  return v_result;
end;
$$;

create or replace function public.edu_admin_question_coverage(p_exam_code text default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access required.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'exam_code',x.exam_code,'exam_name',x.exam_name,
    'programme_id',x.programme_id,'programme_name',x.programme_name,
    'programme_active',x.programme_active,'programme_verified',x.programme_verified,
    'subject_code',x.subject_code,'subject_name',x.subject_name,
    'published_count',x.published_count,'unused_count',x.unused_count,
    'issued_count',greatest(x.published_count-x.unused_count,0)
  ) order by x.programme_name,x.subject_name),'[]'::jsonb)
  into v_result
  from (
    select e.code exam_code,e.name exam_name,p.id programme_id,
      coalesce(p.programme_name,'General question pool') programme_name,
      coalesce(p.is_active,true) programme_active,coalesce(p.is_verified,true) programme_verified,
      s.code subject_code,s.name subject_name,
      count(distinct q.duplicate_hash)::integer published_count,
      count(distinct q.duplicate_hash) filter(where not exists(
        select 1 from public.edu_question_deliveries d where d.question_fingerprint=q.duplicate_hash or d.question_id=q.id
      ))::integer unused_count
    from public.edu_exam_types e
    cross join public.edu_subjects s
    left join lateral (
      select ep.id,ep.programme_name,ep.is_active,ep.is_verified
      from public.edu_exam_programmes ep
      where ep.exam_code=e.code
      union all
      select null::uuid,'General question pool',true,true
      where not exists(select 1 from public.edu_exam_programmes ep where ep.exam_code=e.code)
    ) p on true
    left join public.edu_questions q on q.is_active and q.review_status='published'
      and e.code=any(q.exam_codes) and q.subject_code=s.code
      and (cardinality(coalesce(q.programme_ids,'{}'::uuid[]))=0 or (p.id is not null and p.id=any(q.programme_ids)))
    where e.is_active and s.is_active and (p_exam_code is null or e.code=upper(p_exam_code))
    group by e.code,e.name,p.id,p.programme_name,p.is_active,p.is_verified,s.code,s.name
  ) x;
  return v_result;
end;
$$;
revoke all on function public.edu_admin_question_coverage(text) from public,anon;
grant execute on function public.edu_admin_question_coverage(text) to authenticated;

create or replace function public.edu_admin_performance_analytics()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_exams jsonb; v_subjects jsonb; v_daily jsonb; v_totals jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access required.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'exam_code',x.exam_code,'exam_name',x.exam_name,'attempts',x.attempts,'average_score',x.average_score
  ) order by x.attempts desc,x.exam_name),'[]'::jsonb)
  into v_exams
  from (
    select a.exam_code,e.name exam_name,count(*)::integer attempts,
      round(avg(case when a.total_marks>0 then a.earned_marks/a.total_marks*100 end),1) average_score
    from public.edu_exam_attempts a join public.edu_exam_types e on e.code=a.exam_code
    where a.status in ('submitted','time_up')
    group by a.exam_code,e.name
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
    'subject_code',x.subject_code,'subject_name',x.subject_name,'answered',x.answered,
    'correct',x.correct,'incorrect',x.incorrect,'accuracy',x.accuracy
  ) order by x.accuracy asc,x.answered desc),'[]'::jsonb)
  into v_subjects
  from (
    select i.subject_code,s.name subject_name,count(*)::integer answered,
      count(*) filter(where i.is_correct is true)::integer correct,
      count(*) filter(where i.is_correct is false)::integer incorrect,
      round(100.0*count(*) filter(where i.is_correct is true)/nullif(count(*),0),1) accuracy
    from public.edu_attempt_items i
    join public.edu_exam_attempts a on a.id=i.attempt_id
    join public.edu_subjects s on s.code=i.subject_code
    where a.status in ('submitted','time_up')
    group by i.subject_code,s.name
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
    'day',x.day,'attempts',x.attempts,'average_score',x.average_score
  ) order by x.day),'[]'::jsonb)
  into v_daily
  from (
    select a.submitted_at::date day,count(*)::integer attempts,
      round(avg(case when a.total_marks>0 then a.earned_marks/a.total_marks*100 end),1) average_score
    from public.edu_exam_attempts a
    where a.status in ('submitted','time_up') and a.submitted_at>=current_date-29
    group by a.submitted_at::date
  ) x;

  select jsonb_build_object(
    'students',(select count(*) from public.edu_students),
    'completed_attempts',(select count(*) from public.edu_exam_attempts where status in ('submitted','time_up')),
    'average_score',(
      select round(avg(case when total_marks>0 then earned_marks/total_marks*100 end),1)
      from public.edu_exam_attempts where status in ('submitted','time_up')
    ),
    'open_question_reports',(select count(*) from public.edu_question_reports where status='open')
  ) into v_totals;

  return jsonb_build_object('totals',v_totals,'exams',v_exams,'subjects',v_subjects,'daily',v_daily);
end;
$$;
revoke all on function public.edu_admin_performance_analytics() from public,anon;
grant execute on function public.edu_admin_performance_analytics() to authenticated;

create or replace function public.edu_admin_analytics()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access required.'; end if;
  select jsonb_build_object(
    'students',(select count(*) from public.edu_students),
    'questions',(select count(*) from public.edu_questions),
    'published_questions',(select count(*) from public.edu_questions where is_active and review_status='published'),
    'pending_review',(select count(*) from public.edu_questions where review_status in ('draft','review','approved')),
    'ai_drafts',(select count(*) from public.edu_questions where source_type='ai_draft'),
    'programmes',(select count(*) from public.edu_exam_programmes),
    'topics',(select count(*) from public.edu_subject_topics),
    'published_programmes',(select count(*) from public.edu_exam_programmes where is_active and is_verified),
    'attempts',(select count(*) from public.edu_exam_attempts),
    'active_attempts',(select count(*) from public.edu_exam_attempts where status='in_progress'),
    'open_reports',(select count(*) from public.edu_question_reports where status='open'),
    'imports',(select count(*) from public.edu_question_imports),
    'question_deliveries',(select count(*) from public.edu_question_deliveries),
    'unused_questions',(select count(distinct q.duplicate_hash) from public.edu_questions q where q.is_active and q.review_status='published' and not exists(select 1 from public.edu_question_deliveries d where d.question_fingerprint=q.duplicate_hash or d.question_id=q.id))
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.edu_report_question(text,uuid,text,text) from public,anon;
revoke all on function public.edu_get_student_analytics(text) from public,anon;
revoke all on function public.edu_get_student_topic_analytics(text) from public,anon;
revoke all on function public.edu_admin_analytics() from public,anon;
grant execute on function public.edu_report_question(text,uuid,text,text) to authenticated;
grant execute on function public.edu_get_student_analytics(text) to authenticated;
grant execute on function public.edu_get_student_topic_analytics(text) to authenticated;
grant execute on function public.edu_admin_analytics() to authenticated;

-- Admins moderate drafts and keep import/report records; students never directly
-- query question answers, the question history ledger, or the reporting queue.
comment on table public.edu_exam_programmes is 'Administrator-managed course, stream, module and subject-combination rules. Only verified active records are visible to students.';
comment on table public.edu_question_deliveries is 'Tracks question delivery by attempt. The normalized question-content fingerprint is unique globally, so content cannot be reissued in any exam or after its source row, student or attempt is deleted.';
comment on column public.edu_questions.programme_ids is 'Optional course/stream/trade/module scope. Empty means the question is shared across all combinations that use its subject; populated means it is only eligible for the listed approved programmes.';
comment on column public.edu_exam_attempts.question_set_hash is 'Sort-independent fingerprint; unique per exam to prevent the same complete paper being assigned twice.';
comment on column public.edu_questions.review_status is 'Moderation lifecycle. Only published active questions are eligible for student examinations.';
