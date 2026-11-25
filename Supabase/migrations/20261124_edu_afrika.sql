-- EDU-AFRIKA: secure student accounts, exam catalogue, question automation and scoring.
-- Run this migration once in the Frnxup Supabase SQL Editor.
-- Student accounts are tied to a confirmed Frnxup email. The EDU password is stored as a hash.

create extension if not exists pgcrypto;

create table if not exists public.edu_exam_types (
  code text primary key check (code ~ '^[A-Z0-9_]{2,32}$'),
  name text not null,
  category text not null check (category in ('Nigerian examination','International examination','Professional / certification')),
  duration_minutes integer not null default 60 check (duration_minutes between 5 and 480),
  default_question_count integer not null default 20 check (default_question_count between 1 and 100),
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.edu_exam_types(code,name,category,duration_minutes,default_question_count,sort_order) values
 ('JAMB','JAMB (UTME)','Nigerian examination',180,40,1),
 ('WAEC','WAEC (WASSCE)','Nigerian examination',180,40,2),
 ('NECO','NECO (SSCE)','Nigerian examination',180,40,3),
 ('NABTEB','NABTEB','Nigerian examination',180,40,4),
 ('POST_UTME','Post-UTME','Nigerian examination',60,30,5),
 ('ICAN','ICAN (Institute of Chartered Accountants of Nigeria)','Professional / certification',180,40,20),
 ('ACCA','ACCA (Association of Chartered Certified Accountants)','International examination',180,40,21),
 ('CFA','CFA (Chartered Financial Analyst)','International examination',180,40,22),
 ('CIMA','CIMA (Chartered Institute of Management Accountants)','International examination',120,40,23),
 ('CIPM','CIPM (Chartered Institute of Personnel Management of Nigeria)','Professional / certification',120,40,24),
 ('CPA','CPA (Certified Public Accountant)','International examination',180,40,25),
 ('FRM','FRM (Financial Risk Manager)','International examination',120,40,26),
 ('IELTS','IELTS','International examination',60,40,27),
 ('TOEFL','TOEFL iBT','International examination',120,40,28),
 ('SAT','SAT','International examination',120,40,29),
 ('ACT','ACT','International examination',180,40,30),
 ('GRE','GRE General Test','International examination',120,40,31),
 ('GMAT','GMAT Focus Edition','International examination',135,40,32),
 ('LSAT','LSAT','International examination',210,40,33),
 ('MCAT','MCAT','International examination',450,50,34),
 ('USMLE','USMLE','Professional / certification',240,40,35),
 ('PLAB','PLAB','Professional / certification',180,40,36),
 ('NCLEX','NCLEX-RN','Professional / certification',180,40,37),
 ('PMP','PMP (Project Management Professional)','Professional / certification',180,40,38),
 ('PRINCE2','PRINCE2','Professional / certification',150,40,39),
 ('CISSP','CISSP','Professional / certification',180,40,40),
 ('CCNA','Cisco CCNA','Professional / certification',120,40,41),
 ('COMPTIA_A','CompTIA A+','Professional / certification',90,40,42),
 ('AWS_CERT','AWS Certification','Professional / certification',130,40,43),
 ('CAMBRIDGE_IGCSE','Cambridge IGCSE','International examination',120,40,44),
 ('A_LEVEL','GCE A-Level','International examination',120,40,45),
 ('IB_DIPLOMA','International Baccalaureate (IB)','International examination',120,40,46),
 ('GCSE','GCSE','International examination',120,40,47),
 ('SCRUM','Professional Scrum (PSM)','Professional / certification',60,40,48),
 ('PTE','PTE Academic','International examination',120,40,49),
 ('DUOLINGO_ENGLISH','Duolingo English Test','International examination',60,40,50),
 ('OET','Occupational English Test (OET)','International examination',180,40,51),
 ('CAMBRIDGE_C1','Cambridge English C1 Advanced','International examination',120,40,52),
 ('CAMBRIDGE_C2','Cambridge English C2 Proficiency','International examination',120,40,53),
 ('AP','Advanced Placement (AP)','International examination',120,40,54),
 ('LNAT','LNAT (Law National Aptitude Test)','International examination',135,40,55),
 ('UCAT','UCAT (University Clinical Aptitude Test)','International examination',120,40,56),
 ('GED','GED High School Equivalency','International examination',115,40,57),
 ('TOEIC','TOEIC','International examination',120,40,58),
 ('GRE_SUBJECT','GRE Subject Tests','International examination',150,40,59)
on conflict (code) do update set name=excluded.name, category=excluded.category, sort_order=excluded.sort_order;

create table if not exists public.edu_subjects (
  code text primary key check (code ~ '^[A-Z0-9_]{2,32}$'),
  name text not null unique,
  category text not null default 'General',
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

insert into public.edu_subjects(code,name,category,sort_order) values
 ('ENGLISH','English Language','Languages',1),
 ('MATHEMATICS','Mathematics','Sciences',2),
 ('BIOLOGY','Biology','Sciences',3),
 ('CHEMISTRY','Chemistry','Sciences',4),
 ('PHYSICS','Physics','Sciences',5),
 ('FURTHER_MATHS','Further Mathematics','Sciences',6),
 ('AGRIC_SCIENCE','Agricultural Science','Sciences',7),
 ('COMPUTER_STUDIES','Computer Studies / ICT','Technology',8),
 ('DATA_PROCESSING','Data Processing','Technology',9),
 ('ECONOMICS','Economics','Commercial',10),
 ('COMMERCE','Commerce','Commercial',11),
 ('ACCOUNTING','Financial Accounting','Commercial',12),
 ('BUSINESS_STUDIES','Business Studies','Commercial',13),
 ('GOVERNMENT','Government','Arts & Humanities',14),
 ('LITERATURE','Literature in English','Arts & Humanities',15),
 ('GEOGRAPHY','Geography','Arts & Humanities',16),
 ('HISTORY','History','Arts & Humanities',17),
 ('CIVIC_EDUCATION','Civic Education','General',18),
 ('CRS','Christian Religious Studies','Religious Studies',19),
 ('IRS','Islamic Religious Studies','Religious Studies',20),
 ('YORUBA','Yoruba','Languages',21),
 ('IGBO','Igbo','Languages',22),
 ('HAUSA','Hausa','Languages',23),
 ('FRENCH','French','Languages',24),
 ('TECH_DRAWING','Technical Drawing','Technical',25),
 ('HOME_ECONOMICS','Home Economics','Technical',26),
 ('FOOD_NUTRITION','Food & Nutrition','Technical',27),
 ('GENERAL_PAPER','General Paper','General',28),
 ('VERBAL_REASONING','Verbal Reasoning','Aptitude',29),
 ('QUANT_REASONING','Quantitative Reasoning','Aptitude',30),
 ('LOGICAL_REASONING','Logical Reasoning','Aptitude',31),
 ('ACCOUNTING_PRACTICE','Accounting Practice','Professional',32),
 ('AUDIT_ASSURANCE','Audit & Assurance','Professional',33),
 ('TAXATION','Taxation','Professional',34),
 ('FINANCIAL_REPORTING','Financial Reporting','Professional',35),
 ('MANAGEMENT','Management','Professional',36),
 ('PROJECT_MANAGEMENT','Project Management','Professional',37),
 ('ENGLISH_GRAMMAR','English Grammar & Usage','Languages',38),
 ('READING_COMPREHENSION','Reading Comprehension','Languages',39),
 ('GENERAL_KNOWLEDGE','General Knowledge','General',40)
on conflict (code) do nothing;

create table if not exists public.edu_students (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text not null default 'EDU-AFRIKA Student',
  password_hash text not null,
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.edu_questions (
  id uuid primary key default gen_random_uuid(),
  question_text text not null check (char_length(question_text) between 5 and 5000),
  subject_code text not null references public.edu_subjects(code),
  exam_codes text[] not null check (cardinality(exam_codes) > 0),
  question_type text not null check (question_type in ('mcq','fill_gap')),
  options jsonb not null default '[]'::jsonb,
  correct_answer text not null check (char_length(correct_answer) between 1 and 1000),
  accepted_answers text[] not null default '{}',
  explanation text not null default '' check (char_length(explanation) <= 3000),
  marks numeric(6,2) not null default 1 check (marks > 0 and marks <= 100),
  difficulty text not null default 'medium' check (difficulty in ('easy','medium','hard')),
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint edu_mcq_options_check check (question_type <> 'mcq' or (jsonb_typeof(options)='array' and jsonb_array_length(options)>=2)),
  constraint edu_fill_options_check check (question_type <> 'fill_gap' or options='[]'::jsonb)
);
create index if not exists edu_questions_exam_subject_active_idx on public.edu_questions using gin(exam_codes) where is_active=true;
create index if not exists edu_questions_subject_active_idx on public.edu_questions(subject_code,is_active,question_type);

create table if not exists public.edu_exam_attempts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.edu_students(user_id) on delete cascade,
  exam_code text not null references public.edu_exam_types(code),
  subject_codes text[] not null,
  requested_question_count integer not null check (requested_question_count between 1 and 100),
  question_count integer not null default 0,
  duration_minutes integer not null,
  total_marks numeric(9,2) not null default 0,
  earned_marks numeric(9,2),
  status text not null default 'in_progress' check (status in ('in_progress','submitted','time_up')),
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists edu_exam_attempts_student_recent_idx on public.edu_exam_attempts(student_id,created_at desc);
-- Prevent two tabs/devices from creating concurrent unfinished exams for one student.
create unique index if not exists edu_one_active_attempt_per_student_idx on public.edu_exam_attempts(student_id) where status='in_progress';

create table if not exists public.edu_attempt_items (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.edu_exam_attempts(id) on delete cascade,
  question_id uuid references public.edu_questions(id) on delete set null,
  question_order integer not null,
  question_text text not null,
  subject_code text not null,
  question_type text not null check (question_type in ('mcq','fill_gap')),
  options jsonb not null default '[]'::jsonb,
  correct_answer text not null,
  accepted_answers text[] not null default '{}',
  explanation text not null default '',
  marks numeric(6,2) not null default 1,
  student_answer text,
  awarded_marks numeric(6,2) not null default 0,
  is_correct boolean,
  unique(attempt_id,question_order)
);
create index if not exists edu_attempt_items_attempt_order_idx on public.edu_attempt_items(attempt_id,question_order);

alter table public.edu_exam_types enable row level security;
alter table public.edu_subjects enable row level security;
alter table public.edu_students enable row level security;
alter table public.edu_questions enable row level security;
alter table public.edu_exam_attempts enable row level security;
alter table public.edu_attempt_items enable row level security;

drop policy if exists edu_exam_types_read_active on public.edu_exam_types;
create policy edu_exam_types_read_active on public.edu_exam_types for select to authenticated using (is_active or public.is_admin());
drop policy if exists edu_exam_types_admin_manage on public.edu_exam_types;
create policy edu_exam_types_admin_manage on public.edu_exam_types for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists edu_subjects_read_active on public.edu_subjects;
create policy edu_subjects_read_active on public.edu_subjects for select to authenticated using (is_active or public.is_admin());
drop policy if exists edu_subjects_admin_manage on public.edu_subjects;
create policy edu_subjects_admin_manage on public.edu_subjects for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists edu_students_admin_read on public.edu_students;
create policy edu_students_admin_read on public.edu_students for select to authenticated using (public.is_admin());
drop policy if exists edu_questions_admin_read on public.edu_questions;
create policy edu_questions_admin_read on public.edu_questions for select to authenticated using (public.is_admin());
drop policy if exists edu_questions_admin_insert on public.edu_questions;
create policy edu_questions_admin_insert on public.edu_questions for insert to authenticated with check (public.is_admin() and created_by=auth.uid());
drop policy if exists edu_questions_admin_update on public.edu_questions;
create policy edu_questions_admin_update on public.edu_questions for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists edu_questions_admin_delete on public.edu_questions;
create policy edu_questions_admin_delete on public.edu_questions for delete to authenticated using (public.is_admin());
drop policy if exists edu_exam_attempts_admin_read on public.edu_exam_attempts;
create policy edu_exam_attempts_admin_read on public.edu_exam_attempts for select to authenticated using (public.is_admin());
drop policy if exists edu_attempt_items_admin_read on public.edu_attempt_items;
create policy edu_attempt_items_admin_read on public.edu_attempt_items for select to authenticated using (public.is_admin());

-- The student row, password hash, answer keys and attempt snapshots are intentionally
-- not granted for direct member reads. All member operations use the RPCs below.
revoke all on table public.edu_exam_types, public.edu_subjects, public.edu_students, public.edu_questions, public.edu_exam_attempts, public.edu_attempt_items from anon, authenticated;
grant select on public.edu_exam_types, public.edu_subjects to authenticated;
grant select, insert, update, delete on public.edu_questions to authenticated;
grant select on public.edu_exam_attempts, public.edu_attempt_items to authenticated;

create or replace function public.edu_make_password()
returns text language plpgsql volatile security definer set search_path=public,extensions as $$
declare v_letters constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'; v_digits constant text := '23456789'; v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; v_password text := ''; v_index integer;
begin
  -- Guarantee at least one letter and one number in every generated 12-character password.
  v_password := substr(v_letters,1+(get_byte(gen_random_bytes(1),0)%length(v_letters)),1) || substr(v_digits,1+(get_byte(gen_random_bytes(1),0)%length(v_digits)),1);
  for v_index in 3..12 loop
    v_password := v_password || substr(v_alphabet, 1 + (get_byte(gen_random_bytes(1),0) % length(v_alphabet)), 1);
  end loop;
  return v_password;
end;
$$;

create or replace function public.edu_is_active_frnxup_member()
returns boolean language sql stable security definer set search_path=public,auth as $$
  select auth.uid() is not null and exists(select 1 from public.profiles where id=auth.uid() and account_status='active')
$$;

create or replace function public.edu_portal_status()
returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare v_user uuid := auth.uid(); v_email text; v_name text; v_exists boolean;
begin
  if v_user is null then raise exception 'Sign in to your Frnxup account to continue.'; end if;
  select email into v_email from auth.users where id=v_user;
  select coalesce(display_name,username,'EDU-AFRIKA Student') into v_name from public.profiles where id=v_user and account_status='active';
  if v_name is null then raise exception 'Your Frnxup account is not active.'; end if;
  select exists(select 1 from public.edu_students where user_id=v_user) into v_exists;
  return jsonb_build_object('registered',v_exists,'email',v_email,'display_name',v_name);
end;
$$;

create or replace function public.edu_register_student()
returns jsonb language plpgsql security definer set search_path=public,auth,extensions as $$
declare v_user uuid := auth.uid(); v_email text; v_confirmed timestamptz; v_name text; v_password text;
begin
  if v_user is null then raise exception 'Sign in to your Frnxup account first.'; end if;
  select email,email_confirmed_at into v_email,v_confirmed from auth.users where id=v_user;
  if v_email is null or v_confirmed is null then raise exception 'Verify your Frnxup email address before creating an EDU-AFRIKA account.'; end if;
  select coalesce(display_name,username,'EDU-AFRIKA Student') into v_name from public.profiles where id=v_user and account_status='active';
  if v_name is null then raise exception 'Your Frnxup account is not active.'; end if;
  if exists(select 1 from public.edu_students where user_id=v_user) then raise exception 'An EDU-AFRIKA account already exists. Sign in with your EDU password.'; end if;
  v_password := public.edu_make_password();
  insert into public.edu_students(user_id,email,display_name,password_hash)
  values(v_user,lower(v_email),v_name,crypt(v_password,gen_salt('bf')));
  return jsonb_build_object('ok',true,'password',v_password,'email',v_email,'display_name',v_name);
end;
$$;

create or replace function public.edu_student_login(p_password text)
returns jsonb language plpgsql security definer set search_path=public,auth,extensions as $$
declare v_user uuid := auth.uid(); v_hash text; v_email text;
begin
  if v_user is null then raise exception 'Sign in to your Frnxup account first.'; end if;
  if not public.edu_is_active_frnxup_member() then raise exception 'Your Frnxup account is not active.'; end if;
  if p_password is null or length(p_password)<8 then raise exception 'Enter your 12-character EDU-AFRIKA password.'; end if;
  select password_hash,email into v_hash,v_email from public.edu_students where user_id=v_user;
  if v_hash is null or crypt(p_password,v_hash)<>v_hash then raise exception 'The EDU-AFRIKA password is incorrect.'; end if;
  update public.edu_students set last_login_at=now(),updated_at=now(),email=lower((select email from auth.users where id=v_user)) where user_id=v_user;
  return jsonb_build_object('ok',true,'email',v_email);
end;
$$;

create or replace function public.edu_recover_password()
returns jsonb language plpgsql security definer set search_path=public,auth,extensions as $$
declare v_user uuid := auth.uid(); v_email text; v_confirmed timestamptz; v_password text;
begin
  if v_user is null then raise exception 'Sign in to your Frnxup account first.'; end if;
  if not public.edu_is_active_frnxup_member() then raise exception 'Your Frnxup account is not active.'; end if;
  select email,email_confirmed_at into v_email,v_confirmed from auth.users where id=v_user;
  if v_email is null or v_confirmed is null then raise exception 'A verified Frnxup email is required to reset your EDU password.'; end if;
  if not exists(select 1 from public.edu_students where user_id=v_user) then raise exception 'No EDU-AFRIKA account was found for this Frnxup account.'; end if;
  v_password := public.edu_make_password();
  update public.edu_students set password_hash=crypt(v_password,gen_salt('bf')),email=lower(v_email),updated_at=now() where user_id=v_user;
  return jsonb_build_object('ok',true,'password',v_password,'email',v_email);
end;
$$;

create or replace function public.edu_available_subjects(p_exam_code text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to Frnxup to continue.'; end if;
  if not public.edu_is_active_frnxup_member() then raise exception 'Your Frnxup account is not active.'; end if;
  if not exists(select 1 from public.edu_exam_types where code=upper(p_exam_code) and is_active) then raise exception 'This examination is not currently available.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('code',s.code,'name',s.name,'question_count',q.cnt) order by s.sort_order,s.name),'[]'::jsonb)
  into v_result
  from public.edu_subjects s
  join (select subject_code,count(*)::integer cnt from public.edu_questions where is_active and upper(p_exam_code)=any(exam_codes) group by subject_code) q on q.subject_code=s.code
  where s.is_active;
  return v_result;
end;
$$;

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

revoke all on function public.edu_make_password() from public,anon,authenticated;
revoke all on function public.edu_is_active_frnxup_member() from public,anon,authenticated;
revoke all on function public.edu_portal_status() from public,anon;
revoke all on function public.edu_register_student() from public,anon;
revoke all on function public.edu_student_login(text) from public,anon;
revoke all on function public.edu_recover_password() from public,anon;
revoke all on function public.edu_available_subjects(text) from public,anon;
revoke all on function public.edu_start_exam(text,text,text[],text[],integer) from public,anon;
revoke all on function public.edu_get_active_attempt(text) from public,anon;
revoke all on function public.edu_save_answer(text,uuid,text) from public,anon;
revoke all on function public.edu_submit_exam(text,uuid,jsonb) from public,anon;
revoke all on function public.edu_get_student_history(text) from public,anon;
revoke all on function public.edu_admin_summary() from public,anon;

grant execute on function public.edu_portal_status() to authenticated;
grant execute on function public.edu_register_student() to authenticated;
grant execute on function public.edu_student_login(text) to authenticated;
grant execute on function public.edu_recover_password() to authenticated;
grant execute on function public.edu_available_subjects(text) to authenticated;
grant execute on function public.edu_start_exam(text,text,text[],text[],integer) to authenticated;
grant execute on function public.edu_get_active_attempt(text) to authenticated;
grant execute on function public.edu_save_answer(text,uuid,text) to authenticated;
grant execute on function public.edu_submit_exam(text,uuid,jsonb) to authenticated;
grant execute on function public.edu_get_student_history(text) to authenticated;
grant execute on function public.edu_admin_summary() to authenticated;

comment on table public.edu_questions is 'Administrator-authored question bank used by EDU-AFRIKA to assemble randomized student tests.';
comment on table public.edu_attempt_items is 'Private exam snapshots and answer keys; member access is only through protected scoring RPCs.';
