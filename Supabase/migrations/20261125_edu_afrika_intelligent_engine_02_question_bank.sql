-- EDU-AFRIKA intelligent engine migration Part 2/7: question moderation, topic metadata and imports.
-- Run after the previous numbered migration. Execute this file by itself.

-- Question bank enrichment, moderation, syllabus topics and imports
-- -----------------------------------------------------------------------------
alter table public.edu_questions
  add column if not exists review_status text not null default 'published',
  add column if not exists source_type text not null default 'admin_authored',
  add column if not exists source_year integer,
  add column if not exists source_reference text not null default '',
  add column if not exists topic_code text not null default '',
  add column if not exists programme_ids uuid[] not null default '{}',
  add column if not exists duplicate_hash text;

alter table public.edu_questions drop constraint if exists edu_questions_review_status_check;
alter table public.edu_questions add constraint edu_questions_review_status_check
  check (review_status in ('draft','review','approved','published','rejected'));
alter table public.edu_questions drop constraint if exists edu_questions_source_type_check;
alter table public.edu_questions add constraint edu_questions_source_type_check
  check (source_type in ('admin_authored','past_question','ai_draft','bulk_import','adapted_practice'));

update public.edu_questions
set review_status = case when is_active then 'published' else 'draft' end
where review_status is null or review_status not in ('draft','review','approved','published','rejected');
create or replace function public.edu_question_fingerprint(p_question_text text)
returns text language sql immutable set search_path=public,extensions as $$
  select encode(digest(lower(regexp_replace(trim(coalesce(p_question_text,'')),'\s+',' ','g')),'sha256'),'hex')
$$;
update public.edu_questions
set duplicate_hash = public.edu_question_fingerprint(question_text)
where duplicate_hash is null;
create or replace function public.edu_set_question_duplicate_hash()
returns trigger language plpgsql set search_path=public,extensions as $$
begin
  new.duplicate_hash:=public.edu_question_fingerprint(new.question_text);
  return new;
end;
$$;
drop trigger if exists edu_questions_duplicate_hash_trigger on public.edu_questions;
create trigger edu_questions_duplicate_hash_trigger
before insert or update of question_text on public.edu_questions
for each row execute function public.edu_set_question_duplicate_hash();
create index if not exists edu_questions_review_status_idx on public.edu_questions(review_status,is_active,created_at desc);
create index if not exists edu_questions_topic_idx on public.edu_questions(subject_code,topic_code,is_active);
create index if not exists edu_questions_programme_ids_gin_idx on public.edu_questions using gin(programme_ids);
create index if not exists edu_questions_duplicate_hash_idx on public.edu_questions(subject_code,duplicate_hash);

create table if not exists public.edu_subject_topics (
  id uuid primary key default gen_random_uuid(),
  subject_code text not null references public.edu_subjects(code) on delete cascade,
  topic_code text not null,
  topic_name text not null,
  syllabus_year integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(subject_code,topic_code,syllabus_year)
);
alter table public.edu_subject_topics enable row level security;
drop policy if exists edu_subject_topics_active_read on public.edu_subject_topics;
create policy edu_subject_topics_active_read on public.edu_subject_topics for select to authenticated using (is_active);
drop policy if exists edu_subject_topics_admin_all on public.edu_subject_topics;
create policy edu_subject_topics_admin_all on public.edu_subject_topics for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.edu_subject_topics from anon,authenticated;
grant select,insert,update,delete on public.edu_subject_topics to authenticated;

create table if not exists public.edu_question_imports (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid references auth.users(id) on delete set null,
  file_name text not null default '',
  import_type text not null default 'csv' check (import_type in ('csv','json','ai_generation')),
  total_rows integer not null default 0,
  accepted_rows integer not null default 0,
  rejected_rows integer not null default 0,
  status text not null default 'completed' check (status in ('processing','completed','failed')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.edu_question_imports enable row level security;
drop policy if exists edu_question_imports_admin_all on public.edu_question_imports;
create policy edu_question_imports_admin_all on public.edu_question_imports for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.edu_question_imports from anon,authenticated;
grant select,insert,update,delete on public.edu_question_imports to authenticated;

-- -----------------------------------------------------------------------------
