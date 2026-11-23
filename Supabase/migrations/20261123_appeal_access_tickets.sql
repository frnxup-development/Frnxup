-- Secure one-time appeal access tickets. A ticket is issued only by the
-- username-login Edge Function after valid credentials confirm a suspended account.
create table if not exists public.account_appeal_access_tokens (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create index if not exists account_appeal_access_tokens_user_idx
  on public.account_appeal_access_tokens(user_id, expires_at desc);

alter table public.account_appeal_access_tokens enable row level security;
revoke all on public.account_appeal_access_tokens from public, anon, authenticated;
grant all on public.account_appeal_access_tokens to service_role;

comment on table public.account_appeal_access_tokens is
  'Hashed, short-lived, one-use grants issued only after server-side password verification for a suspended Frnxup account. Raw grant tokens are never stored.';
