-- EDU-AFRIKA exam upgrade: up to 400 questions, per-question timer configuration,
-- public exam-page logo metadata, and administrator-only logo uploads.
-- Run after 20261124_edu_afrika.sql / the four split base migration files.

alter table public.edu_exam_types add column if not exists logo_url text;
alter table public.edu_exam_types drop constraint if exists edu_exam_types_default_question_count_check;
alter table public.edu_exam_types add constraint edu_exam_types_default_question_count_check check (default_question_count between 1 and 400);

alter table public.edu_exam_attempts add column if not exists question_timer_enabled boolean not null default true;
alter table public.edu_exam_attempts add column if not exists question_timer_seconds integer not null default 30;
-- Give any attempt already in progress the new generous fail-safe window.
update public.edu_exam_attempts set duration_minutes=480 where status='in_progress';
alter table public.edu_exam_attempts drop constraint if exists edu_exam_attempts_requested_question_count_check;
alter table public.edu_exam_attempts add constraint edu_exam_attempts_requested_question_count_check check (requested_question_count between 1 and 400);
alter table public.edu_exam_attempts drop constraint if exists edu_exam_attempts_question_timer_seconds_check;
alter table public.edu_exam_attempts add constraint edu_exam_attempts_question_timer_seconds_check check (question_timer_seconds between 5 and 300);

-- Allow signed-out visitors to view only active exam identity data for the individual landing pages.
drop policy if exists edu_exam_types_public_active_read on public.edu_exam_types;
create policy edu_exam_types_public_active_read on public.edu_exam_types for select to anon using (is_active);
grant select on public.edu_exam_types to anon;
-- Existing admin-only ALL policy remains in force. The update grant is column-scoped.
grant update(logo_url,updated_at) on public.edu_exam_types to authenticated;

-- Public bucket for logos, with uploads and changes restricted to Frnxup administrators.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('edu-afrika-exam-logos','edu-afrika-exam-logos',true,2097152,array['image/png','image/jpeg','image/webp','image/svg+xml'])
on conflict (id) do update set public=true,file_size_limit=2097152,allowed_mime_types=array['image/png','image/jpeg','image/webp','image/svg+xml'];

drop policy if exists edu_afrika_exam_logos_public_read on storage.objects;
create policy edu_afrika_exam_logos_public_read on storage.objects for select to public using (bucket_id='edu-afrika-exam-logos');
drop policy if exists edu_afrika_exam_logos_admin_insert on storage.objects;
create policy edu_afrika_exam_logos_admin_insert on storage.objects for insert to authenticated with check (bucket_id='edu-afrika-exam-logos' and public.is_admin());
drop policy if exists edu_afrika_exam_logos_admin_update on storage.objects;
create policy edu_afrika_exam_logos_admin_update on storage.objects for update to authenticated using (bucket_id='edu-afrika-exam-logos' and public.is_admin()) with check (bucket_id='edu-afrika-exam-logos' and public.is_admin());
drop policy if exists edu_afrika_exam_logos_admin_delete on storage.objects;
create policy edu_afrika_exam_logos_admin_delete on storage.objects for delete to authenticated using (bucket_id='edu-afrika-exam-logos' and public.is_admin());

create or replace function public.edu_start_exam(p_password text,p_exam_code text,p_subject_codes text[],p_types text[],p_question_count integer,p_question_timer_enabled boolean)
returns jsonb language plpgsql security definer set search_path=public,auth,extensions as $$
declare
  v_user uuid:=auth.uid(); v_hash text; v_exam public.edu_exam_types%rowtype; v_subject text; v_subject_count integer;
  v_requested integer; v_duration integer; v_per integer; v_remainder integer; v_position integer:=0; v_q record; v_inserted integer;
  v_attempt uuid; v_total numeric(9,2); v_questions jsonb; v_missing_type text; v_replace_id uuid;
begin
  if v_user is null then raise exception 'Sign in to Frnxup to continue.'; end if;
  if not public.edu_is_active_frnxup_member() then raise exception 'Your Frnxup account is not active.'; end if;
  select password_hash into v_hash from public.edu_students where user_id=v_user;
  if v_hash is null or crypt(coalesce(p_password,''),v_hash)<>v_hash then raise exception 'Enter the correct EDU-AFRIKA password.'; end if;
  select * into v_exam from public.edu_exam_types where code=upper(p_exam_code) and is_active;
  if not found then raise exception 'This examination is not currently available.'; end if;
  if p_subject_codes is null or cardinality(p_subject_codes)<1 or cardinality(p_subject_codes)>8 then raise exception 'Select between one and eight subjects.'; end if;
  if p_types is null or cardinality(p_types)<1 or not (p_types <@ array['mcq','fill_gap']::text[]) then raise exception 'Choose multiple-choice, fill-in-the-gap or both question types.'; end if;
  if exists(select 1 from unnest(p_subject_codes) as u(code) where not exists(select 1 from public.edu_subjects s where s.code=u.code and s.is_active)) then raise exception 'One or more selected subjects are unavailable.'; end if;
  v_requested:=greatest(cardinality(p_subject_codes),least(coalesce(p_question_count,v_exam.default_question_count),400));
  -- The timer runs per question in the browser; retain a generous server-side safety limit.
  v_duration:=case when coalesce(p_question_timer_enabled,true) then greatest(v_exam.duration_minutes,least(480,ceil(v_requested*0.5)::integer+10)) else 480 end;
  v_subject_count:=cardinality(p_subject_codes);
  if exists(select 1 from public.edu_exam_attempts where student_id=v_user and status='in_progress') then
    raise exception 'You already have an unfinished examination. Resume or submit it before starting another test.';
  end if;
  foreach v_subject in array p_subject_codes loop
    if not exists(select 1 from public.edu_questions q where q.is_active and upper(p_exam_code)=any(q.exam_codes) and q.subject_code=v_subject and q.question_type=any(p_types)) then
      raise exception 'No active questions are available for subject % in this examination yet.',v_subject;
    end if;
  end loop;
  begin
    insert into public.edu_exam_attempts(student_id,exam_code,subject_codes,requested_question_count,duration_minutes,question_timer_enabled,question_timer_seconds,status)
    values(v_user,upper(p_exam_code),p_subject_codes,v_requested,v_duration,coalesce(p_question_timer_enabled,true),30,'in_progress') returning id into v_attempt;
  exception when unique_violation then
    raise exception 'You already have an unfinished examination. Resume or submit it before starting another test.';
  end;
  v_per:=v_requested / v_subject_count;
  v_remainder:=v_requested % v_subject_count;
  foreach v_subject in array p_subject_codes loop
    v_position:=v_position+1;
    for v_q in
      select q.* from public.edu_questions q
      where q.is_active and upper(p_exam_code)=any(q.exam_codes) and q.subject_code=v_subject and q.question_type=any(p_types)
      order by random() limit (v_per + case when v_position<=v_remainder then 1 else 0 end)
    loop
      insert into public.edu_attempt_items(attempt_id,question_id,question_order,question_text,subject_code,question_type,options,correct_answer,accepted_answers,explanation,marks)
      values(v_attempt,v_q.id,(select count(*)+1 from public.edu_attempt_items where attempt_id=v_attempt),v_q.question_text,v_q.subject_code,v_q.question_type,v_q.options,v_q.correct_answer,v_q.accepted_answers,v_q.explanation,v_q.marks);
    end loop;
  end loop;
  select count(*) into v_inserted from public.edu_attempt_items where attempt_id=v_attempt;
  if v_inserted<v_requested then
    for v_q in
      select q.* from public.edu_questions q
      where q.is_active and upper(p_exam_code)=any(q.exam_codes) and q.subject_code=any(p_subject_codes) and q.question_type=any(p_types)
        and not exists(select 1 from public.edu_attempt_items i where i.attempt_id=v_attempt and i.question_id=q.id)
      order by random() limit greatest(v_requested-v_inserted,0)
    loop
      insert into public.edu_attempt_items(attempt_id,question_id,question_order,question_text,subject_code,question_type,options,correct_answer,accepted_answers,explanation,marks)
      values(v_attempt,v_q.id,(select count(*)+1 from public.edu_attempt_items where attempt_id=v_attempt),v_q.question_text,v_q.subject_code,v_q.question_type,v_q.options,v_q.correct_answer,v_q.accepted_answers,v_q.explanation,v_q.marks);
    end loop;
  end if;

  -- When both formats were selected and the bank contains both, ensure the generated
  -- test includes at least one MCQ and one fill-in-the-gap item (for tests of 2+ questions).
  if cardinality(p_types)=2 and v_requested>=2
     and exists(select 1 from public.edu_questions q where q.is_active and upper(p_exam_code)=any(q.exam_codes) and q.subject_code=any(p_subject_codes) and q.question_type='mcq')
     and exists(select 1 from public.edu_questions q where q.is_active and upper(p_exam_code)=any(q.exam_codes) and q.subject_code=any(p_subject_codes) and q.question_type='fill_gap') then
    foreach v_missing_type in array array['mcq','fill_gap'] loop
      if not exists(select 1 from public.edu_attempt_items i where i.attempt_id=v_attempt and i.question_type=v_missing_type) then
        select q.* into v_q from public.edu_questions q
        where q.is_active and upper(p_exam_code)=any(q.exam_codes) and q.subject_code=any(p_subject_codes) and q.question_type=v_missing_type
          and not exists(select 1 from public.edu_attempt_items i where i.attempt_id=v_attempt and i.question_id=q.id)
        order by random() limit 1;
        if found then
          select count(*) into v_inserted from public.edu_attempt_items where attempt_id=v_attempt;
          if v_inserted<v_requested then
            insert into public.edu_attempt_items(attempt_id,question_id,question_order,question_text,subject_code,question_type,options,correct_answer,accepted_answers,explanation,marks)
            values(v_attempt,v_q.id,v_inserted+1,v_q.question_text,v_q.subject_code,v_q.question_type,v_q.options,v_q.correct_answer,v_q.accepted_answers,v_q.explanation,v_q.marks);
          else
            select i.id into v_replace_id from public.edu_attempt_items i where i.attempt_id=v_attempt order by i.question_order desc limit 1;
            update public.edu_attempt_items set question_id=v_q.id,question_text=v_q.question_text,subject_code=v_q.subject_code,question_type=v_q.question_type,options=v_q.options,correct_answer=v_q.correct_answer,accepted_answers=v_q.accepted_answers,explanation=v_q.explanation,marks=v_q.marks,student_answer=null,awarded_marks=0,is_correct=null where id=v_replace_id;
          end if;
        end if;
      end if;
    end loop;
  end if;

  select count(*),coalesce(sum(marks),0) into v_inserted,v_total from public.edu_attempt_items where attempt_id=v_attempt;
  if v_inserted=0 then raise exception 'There are no questions available for this exam selection.'; end if;
  update public.edu_exam_attempts set question_count=v_inserted,total_marks=v_total where id=v_attempt;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'order',i.question_order,'question',i.question_text,'subject_code',i.subject_code,'question_type',i.question_type,'options',i.options,'marks',i.marks,'answer',i.student_answer) order by i.question_order),'[]'::jsonb)
  into v_questions from public.edu_attempt_items i where i.attempt_id=v_attempt;
  return jsonb_build_object('ok',true,'attempt_id',v_attempt,'exam_code',upper(p_exam_code),'duration_minutes',v_duration,'question_timer_enabled',coalesce(p_question_timer_enabled,true),'question_timer_seconds',30,'question_count',v_inserted,'total_marks',v_total,'started_at',now(),'questions',v_questions);
end;
$$;

create or replace function public.edu_get_active_attempt(p_password text)
returns jsonb language plpgsql security definer set search_path=public,auth,extensions as $$
declare v_user uuid:=auth.uid(); v_hash text; v_attempt public.edu_exam_attempts%rowtype; v_questions jsonb;
begin
  if v_user is null or not public.edu_is_active_frnxup_member() then raise exception 'Your active Frnxup account is required.'; end if;
  select password_hash into v_hash from public.edu_students where user_id=v_user;
  if v_hash is null or crypt(coalesce(p_password,''),v_hash)<>v_hash then raise exception 'Enter the correct EDU-AFRIKA password.'; end if;
  select * into v_attempt from public.edu_exam_attempts where student_id=v_user and status='in_progress' order by started_at desc limit 1;
  if not found then return jsonb_build_object('active',false); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'order',i.question_order,'question',i.question_text,'subject_code',i.subject_code,'question_type',i.question_type,'options',i.options,'marks',i.marks,'answer',i.student_answer) order by i.question_order),'[]'::jsonb)
  into v_questions from public.edu_attempt_items i where i.attempt_id=v_attempt.id;
  return jsonb_build_object('active',true,'attempt_id',v_attempt.id,'exam_code',v_attempt.exam_code,'subject_codes',v_attempt.subject_codes,'duration_minutes',v_attempt.duration_minutes,'question_timer_enabled',v_attempt.question_timer_enabled,'question_timer_seconds',v_attempt.question_timer_seconds,'question_count',v_attempt.question_count,'total_marks',v_attempt.total_marks,'started_at',v_attempt.started_at,'questions',v_questions);
end;
$$;

revoke all on function public.edu_start_exam(text,text,text[],text[],integer) from public,anon,authenticated;
revoke all on function public.edu_start_exam(text,text,text[],text[],integer,boolean) from public,anon;
grant execute on function public.edu_start_exam(text,text,text[],text[],integer,boolean) to authenticated;

comment on column public.edu_exam_types.logo_url is 'Public URL of the official examination body logo uploaded by a Frnxup admin for informational identification.';
comment on column public.edu_exam_attempts.question_timer_enabled is 'Whether the student enabled the 30-second automatic per-question timer for this attempt.';
comment on column public.edu_exam_attempts.question_timer_seconds is 'Per-question countdown seconds; current EDU-AFRIKA default is 30.';
