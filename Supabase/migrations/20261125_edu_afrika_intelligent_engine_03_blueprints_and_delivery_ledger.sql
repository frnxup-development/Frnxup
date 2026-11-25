-- EDU-AFRIKA intelligent engine migration Part 3/7: exam blueprints, question fingerprints and historical delivery ledger.
-- Run after the previous numbered migration. Execute this file by itself.

-- Examination blueprints: subject weighting and difficulty mix
-- -----------------------------------------------------------------------------
create table if not exists public.edu_exam_blueprints (
  id uuid primary key default gen_random_uuid(),
  exam_code text not null references public.edu_exam_types(code) on delete cascade,
  programme_id uuid references public.edu_exam_programmes(id) on delete cascade,
  subject_code text not null references public.edu_subjects(code) on delete cascade,
  subject_share_percent numeric(5,2) not null default 0 check (subject_share_percent between 0 and 100),
  easy_percent numeric(5,2) not null default 30 check (easy_percent between 0 and 100),
  medium_percent numeric(5,2) not null default 50 check (medium_percent between 0 and 100),
  hard_percent numeric(5,2) not null default 20 check (hard_percent between 0 and 100),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint edu_exam_blueprints_difficulty_total check (easy_percent+medium_percent+hard_percent=100)
);
create unique index if not exists edu_exam_blueprints_scope_idx
  on public.edu_exam_blueprints(exam_code,coalesce(programme_id,'00000000-0000-0000-0000-000000000000'::uuid),subject_code);
alter table public.edu_exam_blueprints enable row level security;
drop policy if exists edu_exam_blueprints_admin_all on public.edu_exam_blueprints;
create policy edu_exam_blueprints_admin_all on public.edu_exam_blueprints for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.edu_exam_blueprints from anon,authenticated;
grant select,insert,update,delete on public.edu_exam_blueprints to authenticated;

-- -----------------------------------------------------------------------------
-- Attempt metadata and globally unique question-delivery ledger
-- -----------------------------------------------------------------------------
alter table public.edu_attempt_items
  add column if not exists topic_code text not null default '',
  add column if not exists timer_started_at timestamptz,
  add column if not exists timer_expires_at timestamptz,
  add column if not exists question_fingerprint text;
update public.edu_attempt_items
set question_fingerprint=public.edu_question_fingerprint(question_text)
where question_fingerprint is null;
alter table public.edu_attempt_items alter column question_fingerprint set not null;
create index if not exists edu_attempt_items_question_fingerprint_idx on public.edu_attempt_items(question_fingerprint);
create or replace function public.edu_set_attempt_item_fingerprint()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.question_fingerprint is null then
    new.question_fingerprint:=public.edu_question_fingerprint(new.question_text);
  end if;
  return new;
end;
$$;
drop trigger if exists edu_attempt_items_fingerprint_trigger on public.edu_attempt_items;
create trigger edu_attempt_items_fingerprint_trigger
before insert or update of question_text on public.edu_attempt_items
for each row execute function public.edu_set_attempt_item_fingerprint();

alter table public.edu_exam_attempts
  add column if not exists programme_id uuid references public.edu_exam_programmes(id) on delete set null,
  add column if not exists programme_name_snapshot text not null default '',
  add column if not exists exam_mode text not null default 'practice',
  add column if not exists question_set_hash text,
  add column if not exists reused_question_count integer not null default 0,
  add column if not exists revision_topic_code text not null default '';

alter table public.edu_exam_attempts drop constraint if exists edu_exam_attempts_exam_mode_check;
alter table public.edu_exam_attempts add constraint edu_exam_attempts_exam_mode_check
  check (exam_mode in ('practice','timed','mock','revision','challenge'));
create unique index if not exists edu_exam_attempts_unique_paper_idx
  on public.edu_exam_attempts(exam_code,question_set_hash) where question_set_hash is not null;

create table if not exists public.edu_question_deliveries (
  id bigserial primary key,
  attempt_id uuid references public.edu_exam_attempts(id) on delete set null,
  question_id uuid references public.edu_questions(id) on delete set null,
  question_fingerprint text not null,
  student_id uuid references public.edu_students(user_id) on delete set null,
  exam_code text not null references public.edu_exam_types(code),
  programme_id uuid references public.edu_exam_programmes(id) on delete set null,
  delivered_at timestamptz not null default now(),
  unique(attempt_id,question_id)
);
create unique index if not exists edu_question_delivery_fingerprint_once_idx on public.edu_question_deliveries(question_fingerprint);
create index if not exists edu_question_deliveries_question_recent_idx on public.edu_question_deliveries(question_id,delivered_at desc);
create index if not exists edu_question_deliveries_exam_recent_idx on public.edu_question_deliveries(exam_code,delivered_at desc);
create index if not exists edu_question_deliveries_student_recent_idx on public.edu_question_deliveries(student_id,delivered_at desc);

-- Backfill historical attempts before enabling the one-time delivery rule. This is
-- essential: a question seen before this upgrade must not become eligible again.
-- Use the stored attempt snapshot so this also works when the original bank row was
-- edited or removed after a student received it. Only one ledger row is needed for
-- each normalized fingerprint because the unique index is global.
insert into public.edu_question_deliveries(
  attempt_id,question_id,question_fingerprint,student_id,exam_code,programme_id,delivered_at
)
select distinct on (coalesce(i.question_fingerprint,public.edu_question_fingerprint(i.question_text)))
  a.id,i.question_id,coalesce(i.question_fingerprint,public.edu_question_fingerprint(i.question_text)),a.student_id,
  a.exam_code,nullif(to_jsonb(a)->>'programme_id','')::uuid,a.started_at
from public.edu_attempt_items i
join public.edu_exam_attempts a on a.id=i.attempt_id
where nullif(btrim(i.question_text),'') is not null
order by coalesce(i.question_fingerprint,public.edu_question_fingerprint(i.question_text)),a.started_at,i.id
on conflict (question_fingerprint) do nothing;

-- Also reserve the current content version for any bank question that appeared in an
-- earlier attempt, in case an administrator edited the question after delivery.
insert into public.edu_question_deliveries(
  attempt_id,question_id,question_fingerprint,student_id,exam_code,programme_id,delivered_at
)
select distinct on (q.duplicate_hash)
  a.id,q.id,q.duplicate_hash,a.student_id,a.exam_code,nullif(to_jsonb(a)->>'programme_id','')::uuid,a.started_at
from public.edu_attempt_items i
join public.edu_exam_attempts a on a.id=i.attempt_id
join public.edu_questions q on q.id=i.question_id
where q.duplicate_hash is not null
order by q.duplicate_hash,a.started_at,i.id
on conflict (question_fingerprint) do nothing;

alter table public.edu_question_deliveries enable row level security;
drop policy if exists edu_question_deliveries_admin_read on public.edu_question_deliveries;
create policy edu_question_deliveries_admin_read on public.edu_question_deliveries for select to authenticated using (public.is_admin());
revoke all on public.edu_question_deliveries from anon,authenticated;
grant select on public.edu_question_deliveries to authenticated;

create table if not exists public.edu_question_reports (
  id uuid primary key default gen_random_uuid(),
  attempt_item_id uuid not null references public.edu_attempt_items(id) on delete cascade,
  reported_by uuid not null references public.edu_students(user_id) on delete cascade,
  reason text not null check (reason in ('wrong_answer','ambiguous','typo','out_of_syllabus','duplicate','other')),
  details text not null default '',
  status text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  admin_note text not null default '',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(attempt_item_id,reported_by)
);
alter table public.edu_question_reports enable row level security;
drop policy if exists edu_question_reports_admin_read on public.edu_question_reports;
create policy edu_question_reports_admin_read on public.edu_question_reports for select to authenticated using (public.is_admin());
drop policy if exists edu_question_reports_admin_update on public.edu_question_reports;
create policy edu_question_reports_admin_update on public.edu_question_reports for update to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.edu_question_reports from anon,authenticated;
grant select,update on public.edu_question_reports to authenticated;

-- -----------------------------------------------------------------------------
