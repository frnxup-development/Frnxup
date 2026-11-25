-- EDU-AFRIKA AI Question Production Centre
-- Run this migration once in Supabase SQL Editor.
-- Provider API keys are encrypted by the Edge Function. This table intentionally
-- has no authenticated/anon policies; only the Edge Function service role can read it.

begin;

create table if not exists public.edu_ai_provider_configs (
  provider_code text primary key,
  provider_name text not null,
  api_base_url text not null,
  model text not null,
  api_key_ciphertext text not null,
  api_key_iv text not null,
  account_id text not null default '',
  provider_options jsonb not null default '{}'::jsonb,
  is_enabled boolean not null default true,
  key_last_four text not null default '',
  input_cost_per_million numeric(12,6) check (input_cost_per_million is null or input_cost_per_million >= 0),
  output_cost_per_million numeric(12,6) check (output_cost_per_million is null or output_cost_per_million >= 0),
  daily_batch_limit integer check (daily_batch_limit is null or daily_batch_limit >= 1),
  daily_question_limit integer check (daily_question_limit is null or daily_question_limit >= 1),
  last_tested_at timestamptz,
  last_test_status text not null default 'not_tested' check (last_test_status in ('not_tested','success','failed')),
  last_test_message text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.edu_ai_provider_configs enable row level security;
revoke all on public.edu_ai_provider_configs from anon, authenticated;
grant all on public.edu_ai_provider_configs to service_role;

create table if not exists public.edu_ai_generation_batches (
  id uuid primary key default gen_random_uuid(),
  provider_code text not null,
  provider_name text not null,
  model text not null,
  exam_code text not null,
  subject_code text not null,
  programme_id uuid references public.edu_exam_programmes(id) on delete set null,
  topic_code text not null default '',
  syllabus_year integer,
  requested_count integer not null default 0 check (requested_count between 0 and 100),
  generated_count integer not null default 0,
  accepted_count integer not null default 0,
  duplicate_count integer not null default 0,
  invalid_count integer not null default 0,
  status text not null default 'queued' check (status in ('queued','generating','completed','partial','failed')),
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  total_tokens bigint not null default 0,
  estimated_cost_usd numeric(12,6),
  duration_ms integer,
  quality_summary jsonb not null default '{}'::jsonb,
  error_message text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists edu_ai_generation_batches_created_idx
  on public.edu_ai_generation_batches(created_at desc);
create index if not exists edu_ai_generation_batches_destination_idx
  on public.edu_ai_generation_batches(exam_code,subject_code,created_at desc);

-- Unique exact-content reservations serialize concurrent AI generation runs.
-- A claim survives question deletion, protecting the global no-repeat policy.
create table if not exists public.edu_ai_question_fingerprint_claims (
  question_fingerprint text primary key check (length(question_fingerprint)=64),
  batch_id uuid references public.edu_ai_generation_batches(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.edu_ai_question_fingerprint_claims enable row level security;
revoke all on public.edu_ai_question_fingerprint_claims from anon, authenticated;
grant all on public.edu_ai_question_fingerprint_claims to service_role;
comment on table public.edu_ai_question_fingerprint_claims is
  'Immutable SHA-256 claims for AI-generated EDU-AFRIKA question text; prevents concurrent and future exact duplicates independently of the student delivery ledger.';

alter table public.edu_ai_generation_batches enable row level security;
drop policy if exists edu_ai_generation_batches_admin_read on public.edu_ai_generation_batches;
create policy edu_ai_generation_batches_admin_read
  on public.edu_ai_generation_batches for select to authenticated
  using (public.is_admin());
revoke all on public.edu_ai_generation_batches from anon, authenticated;
grant select on public.edu_ai_generation_batches to authenticated;
grant all on public.edu_ai_generation_batches to service_role;

alter table public.edu_questions
  add column if not exists ai_batch_id uuid references public.edu_ai_generation_batches(id) on delete set null,
  add column if not exists ai_provider_code text,
  add column if not exists ai_model text,
  add column if not exists ai_quality_flags jsonb not null default '[]'::jsonb,
  add column if not exists ai_quality_score numeric(5,2),
  add column if not exists ai_reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists ai_reviewed_at timestamptz;

create index if not exists edu_questions_ai_batch_idx on public.edu_questions(ai_batch_id);
create index if not exists edu_questions_ai_review_queue_idx
  on public.edu_questions(review_status,created_at desc)
  where source_type='ai_draft';

comment on table public.edu_ai_provider_configs is
  'Encrypted AI provider API credentials and model configuration for EDU-AFRIKA. Plain API keys are never stored or returned.';
comment on table public.edu_ai_generation_batches is
  'Audit and usage history for AI question generation jobs, including bulk subject destinations.';
comment on column public.edu_questions.ai_quality_flags is
  'Automated structural and duplicate checks. Human academic review is still required before publication.';
comment on column public.edu_questions.ai_quality_score is
  'Reserved for a future calibrated quality rubric. Current AI checks use explicit flags; no unvalidated numerical score is assigned.';

commit;

notify pgrst, 'reload schema';
