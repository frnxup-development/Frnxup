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

