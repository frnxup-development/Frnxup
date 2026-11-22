-- Repair Frnxup staff IDs when admin_staff_accounts.staff_id was created
-- with an incompatible type (for example UUID) by an earlier database setup.
-- Run this in the SAME Supabase project used by Frnxup.

create table if not exists public.admin_staff_accounts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  staff_id text not null,
  role text not null check (role in ('owner','admin','moderator')),
  status text not null default 'pending' check (status in ('pending','active','disabled')),
  password_salt text,
  password_hash text,
  created_by uuid references public.profiles(id) on delete set null,
  registered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_staff_accounts
  add column if not exists staff_id text;

-- Remove old CHECK constraints that were defined against staff_id before
-- normalizing its type. Other table constraints are left untouched.
do $repair_staff_id_type$
declare
  constraint_row record;
  staff_row record;
  candidate text;
begin
  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'public.admin_staff_accounts'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%staff_id%'
  loop
    execute format('alter table public.admin_staff_accounts drop constraint %I', constraint_row.conname);
  end loop;

  -- Convert the existing type explicitly to text first. UUID values can be
  -- represented as text here and safely replaced below with fresh 10-digit IDs.
  alter table public.admin_staff_accounts
    alter column staff_id type text using staff_id::text;

  -- Preserve existing valid 10-digit IDs. Replace NULL, UUID, and all other
  -- incompatible legacy values with a unique 10-digit value.
  for staff_row in
    select user_id
    from public.admin_staff_accounts
    where staff_id is null or staff_id !~ '^[0-9]{10}$'
  loop
    loop
      candidate := (floor(random() * 9000000000)::bigint + 1000000000)::text;
      exit when not exists (
        select 1 from public.admin_staff_accounts where staff_id = candidate
      );
    end loop;

    update public.admin_staff_accounts
       set staff_id = candidate,
           updated_at = now()
     where user_id = staff_row.user_id;
  end loop;
end;
$repair_staff_id_type$;

alter table public.admin_staff_accounts
  alter column staff_id type varchar(10) using staff_id::varchar(10),
  alter column staff_id set not null;

create unique index if not exists admin_staff_accounts_staff_id_uidx
  on public.admin_staff_accounts(staff_id);

alter table public.admin_staff_accounts
  add constraint admin_staff_accounts_staff_id_format_check
  check (staff_id ~ '^[0-9]{10}$');

alter table public.admin_staff_accounts enable row level security;
revoke all on public.admin_staff_accounts from anon, authenticated;
grant select, insert, update, delete on public.admin_staff_accounts to service_role;

comment on column public.admin_staff_accounts.staff_id is
  'Unique 10-digit administrator/moderator staff code; stored as VARCHAR(10), never as a UUID.';

-- Ensure the other private staff-auth tables used by admin-control are present
-- when this repair is applied after an incomplete earlier setup.
create table if not exists public.admin_staff_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists admin_staff_sessions_user_expiry_idx
  on public.admin_staff_sessions(user_id, expires_at);
alter table public.admin_staff_sessions enable row level security;
revoke all on public.admin_staff_sessions from anon, authenticated;
grant select, insert, update, delete on public.admin_staff_sessions to service_role;

create table if not exists public.admin_staff_login_attempts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.admin_staff_login_attempts enable row level security;
revoke all on public.admin_staff_login_attempts from anon, authenticated;
grant select, insert, update, delete on public.admin_staff_login_attempts to service_role;
