-- Separate Frnxup administrator/moderator credentials and short-lived staff sessions.
-- Apply this migration in the SAME Supabase project used by Frnxup.

create table if not exists public.admin_staff_accounts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  staff_id varchar(10) not null unique check (staff_id ~ '^[0-9]{10}$'),
  role text not null check (role in ('owner','admin','moderator')),
  status text not null default 'pending' check (status in ('pending','active','disabled')),
  password_salt text,
  password_hash text,
  created_by uuid references public.profiles(id) on delete set null,
  registered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'active' and password_salt is not null and password_hash is not null)
      or (status <> 'active'))
);

create index if not exists admin_staff_accounts_role_idx
  on public.admin_staff_accounts(role, status);

create table if not exists public.admin_staff_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists admin_staff_sessions_user_expiry_idx
  on public.admin_staff_sessions(user_id, expires_at);

alter table public.admin_staff_accounts enable row level security;
alter table public.admin_staff_sessions enable row level security;

-- These tables contain credential hashes and session token hashes. Browser roles
-- receive no access; only the Edge Function's service role may read or modify them.
revoke all on public.admin_staff_accounts from anon, authenticated;
revoke all on public.admin_staff_sessions from anon, authenticated;
grant select, insert, update, delete on public.admin_staff_accounts to service_role;
grant select, insert, update, delete on public.admin_staff_sessions to service_role;

comment on table public.admin_staff_accounts is
  'Private second-factor credentials for Frnxup admin/moderator accounts; passwords are PBKDF2 hashes and never exposed to browser clients.';
comment on table public.admin_staff_sessions is
  'Private hashed short-lived staff sessions issued after Frnxup authentication plus staff-password verification.';


create table if not exists public.admin_staff_login_attempts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.admin_staff_login_attempts enable row level security;
revoke all on public.admin_staff_login_attempts from anon, authenticated;
grant select, insert, update, delete on public.admin_staff_login_attempts to service_role;
