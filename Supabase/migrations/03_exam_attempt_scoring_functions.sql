create or replace function public.edu_start_exam(p_password text,p_exam_code text,p_subject_codes text[],p_types text[] default array['mcq','fill_gap'],p_question_count integer default null)
returns jsonb language plpgsql security definer set search_path=public,auth,extensions as $$
declare
  v_user uuid:=auth.uid(); v_hash text; v_exam public.edu_exam_types%rowtype; v_subject text; v_subject_count integer;
  v_requested integer; v_per integer; v_remainder integer; v_position integer:=0; v_q record; v_inserted integer;
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
  v_requested:=greatest(cardinality(p_subject_codes),least(coalesce(p_question_count,v_exam.default_question_count),100));
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
    insert into public.edu_exam_attempts(student_id,exam_code,subject_codes,requested_question_count,duration_minutes,status)
    values(v_user,upper(p_exam_code),p_subject_codes,v_requested,v_exam.duration_minutes,'in_progress') returning id into v_attempt;
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
  return jsonb_build_object('ok',true,'attempt_id',v_attempt,'exam_code',upper(p_exam_code),'duration_minutes',v_exam.duration_minutes,'question_count',v_inserted,'total_marks',v_total,'started_at',now(),'questions',v_questions);
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
  return jsonb_build_object('active',true,'attempt_id',v_attempt.id,'exam_code',v_attempt.exam_code,'subject_codes',v_attempt.subject_codes,'duration_minutes',v_attempt.duration_minutes,'question_count',v_attempt.question_count,'total_marks',v_attempt.total_marks,'started_at',v_attempt.started_at,'questions',v_questions);
end;
$$;

create or replace function public.edu_save_answer(p_password text,p_attempt_item_id uuid,p_answer text)
returns jsonb language plpgsql security definer set search_path=public,auth,extensions as $$
declare v_user uuid:=auth.uid(); v_hash text; v_attempt uuid;
begin
  if v_user is null or not public.edu_is_active_frnxup_member() then raise exception 'Your active Frnxup account is required.'; end if;
  select password_hash into v_hash from public.edu_students where user_id=v_user;
  if v_hash is null or crypt(coalesce(p_password,''),v_hash)<>v_hash then raise exception 'Your EDU-AFRIKA session is no longer valid.'; end if;
  select a.id into v_attempt from public.edu_attempt_items i join public.edu_exam_attempts a on a.id=i.attempt_id
  where i.id=p_attempt_item_id and a.student_id=v_user and a.status='in_progress' and now()<=a.started_at+(a.duration_minutes||' minutes')::interval;
  if v_attempt is null then raise exception 'This exam has ended. Submit your answers or start a new exam.'; end if;
  update public.edu_attempt_items set student_answer=left(coalesce(p_answer,''),1000) where id=p_attempt_item_id;
  return jsonb_build_object('ok',true);
end;
$$;

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
    v_answer:=coalesce(nullif(p_answers->>(v_item.id::text),''),v_item.student_answer,'');
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
  select coalesce(jsonb_agg(jsonb_build_object('question',question_text,'question_type',question_type,'your_answer',coalesce(student_answer,''),'correct_answer',correct_answer,'is_correct',is_correct,'marks_awarded',awarded_marks,'marks',marks,'explanation',explanation) order by question_order),'[]'::jsonb)
  into v_review from public.edu_attempt_items where attempt_id=p_attempt_id;
  return jsonb_build_object('ok',true,'status',v_status,'earned_marks',v_earned,'total_marks',v_total,'percentage',case when v_total=0 then 0 else round((v_earned/v_total)*100,2) end,'review',v_review);
end;
$$;

create or replace function public.edu_get_student_history(p_password text)
returns jsonb language plpgsql security definer set search_path=public,auth,extensions as $$
declare v_user uuid:=auth.uid(); v_hash text; v_result jsonb;
begin
  if v_user is null or not public.edu_is_active_frnxup_member() then raise exception 'Your active Frnxup account is required.'; end if;
  select password_hash into v_hash from public.edu_students where user_id=v_user;
  if v_hash is null or crypt(coalesce(p_password,''),v_hash)<>v_hash then raise exception 'Enter the correct EDU-AFRIKA password.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'exam_code',a.exam_code,'subject_codes',a.subject_codes,'question_count',a.question_count,'total_marks',a.total_marks,'earned_marks',a.earned_marks,'status',a.status,'started_at',a.started_at,'submitted_at',a.submitted_at) order by a.created_at desc),'[]'::jsonb)
  into v_result from (select * from public.edu_exam_attempts where student_id=v_user order by created_at desc limit 15) a;
  return v_result;
end;
$$;

create or replace function public.edu_admin_summary()
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  if not public.is_admin() then raise exception 'Only Frnxup admins can open the EDU-AFRIKA Exam Automation Room.'; end if;
  return jsonb_build_object(
    'students',(select count(*) from public.edu_students),
    'questions',(select count(*) from public.edu_questions),
    'active_questions',(select count(*) from public.edu_questions where is_active),
    'attempts',(select count(*) from public.edu_exam_attempts),
    'active_exams',(select count(*) from public.edu_exam_types where is_active)
  );
end;
$$;
