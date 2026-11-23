-- Frnxup appeal reference numbers, public status lookup and controlled recovery.
-- Apply after 20261123_account_ban_and_appeals.sql and 20261123_appeal_access_tickets.sql.

alter table public.account_appeals
  add column if not exists reference_number text;

-- Existing workflow values are migrated to clearer public-facing lifecycle values.
alter table public.account_appeals drop constraint if exists account_appeals_status_check;
alter table public.account_appeals drop constraint if exists account_appeals_status_valid;
update public.account_appeals set status='rejected' where status='upheld';
update public.account_appeals set status='reactivated' where status='reinstated';
alter table public.account_appeals
  add constraint account_appeals_status_valid
  check (status in ('pending','rejected','approved','reactivated'));

create unique index if not exists account_appeals_reference_number_uidx
  on public.account_appeals(reference_number)
  where reference_number is not null;

comment on column public.account_appeals.reference_number is
  'Random public tracking reference in FRN-XXX-XXX-XXX format. It is not an authentication credential.';

-- Rate-limit reference/status recovery attempts without storing raw email, username,
-- reference number, or IP address. Only a SHA-256 lookup key is retained.
create table if not exists public.account_appeal_lookup_limits (
  key_hash text primary key check (key_hash ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  updated_at timestamptz not null default now()
);
alter table public.account_appeal_lookup_limits enable row level security;
revoke all on public.account_appeal_lookup_limits from public, anon, authenticated;
grant all on public.account_appeal_lookup_limits to service_role;

create or replace function public.consume_account_appeal_lookup_quota(
  p_key_hash text,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts integer;
begin
  if p_key_hash is null or p_key_hash !~ '^[a-f0-9]{64}$' then
    return false;
  end if;

  insert into public.account_appeal_lookup_limits as current_limit
    (key_hash, window_started_at, attempts, updated_at)
  values (p_key_hash, p_now, 1, p_now)
  on conflict (key_hash) do update
    set window_started_at = case
          when current_limit.window_started_at < p_now - interval '15 minutes' then p_now
          else current_limit.window_started_at
        end,
        attempts = case
          when current_limit.window_started_at < p_now - interval '15 minutes' then 1
          else current_limit.attempts + 1
        end,
        updated_at = p_now
  returning attempts into v_attempts;

  return v_attempts <= 6;
end;
$$;
revoke all on function public.consume_account_appeal_lookup_quota(text,timestamptz) from public, anon, authenticated;
grant execute on function public.consume_account_appeal_lookup_quota(text,timestamptz) to service_role;

comment on function public.consume_account_appeal_lookup_quota(text,timestamptz) is
  'Service-role-only 6-attempt-per-15-minute quota for public appeal status and reference recovery requests.';
