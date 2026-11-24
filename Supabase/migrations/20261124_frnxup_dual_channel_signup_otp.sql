-- Frnxup dual-channel OTP registration.
-- Each registration receives two independent six-digit codes (email and phone).
-- Codes and password setup tickets are stored only as HMAC digests.
create table if not exists public.frnxup_signup_challenges (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  phone_e164 text not null,
  username text not null,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  country_name text not null,
  email_otp_hash text,
  phone_otp_hash text,
  ip_hash text not null,
  expires_at timestamptz not null,
  attempts smallint not null default 0 check (attempts between 0 and 5),
  verified_at timestamptz,
  ticket_hash text,
  ticket_expires_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.frnxup_signup_challenges enable row level security;
revoke all on public.frnxup_signup_challenges from anon, authenticated;
grant all on public.frnxup_signup_challenges to service_role;
create index if not exists frnxup_signup_email_created_idx on public.frnxup_signup_challenges(email, created_at desc);
create index if not exists frnxup_signup_phone_created_idx on public.frnxup_signup_challenges(phone_e164, created_at desc);
create index if not exists frnxup_signup_ip_created_idx on public.frnxup_signup_challenges(ip_hash, created_at desc);
create unique index if not exists frnxup_signup_ticket_hash_uidx on public.frnxup_signup_challenges(ticket_hash) where ticket_hash is not null;

-- Service-role-only duplicate identity check. auth.users remains inaccessible to browser clients.
create or replace function public.frnxup_signup_identity_exists(p_email text, p_phone text)
returns boolean
language sql
security definer
set search_path = auth, pg_temp
as $$
  select exists (
    select 1 from auth.users u
    where lower(coalesce(u.email,'')) = lower(coalesce(p_email,''))
       or coalesce(u.phone,'') = coalesce(p_phone,'')
  );
$$;
revoke all on function public.frnxup_signup_identity_exists(text,text) from public, anon, authenticated;
grant execute on function public.frnxup_signup_identity_exists(text,text) to service_role;

comment on table public.frnxup_signup_challenges is
  'Private pending Frnxup registrations. Independent email/phone OTP hashes and one-time password-setup tickets; service_role only.';

-- Atomically compare both OTP digests and issue the password-setup ticket.
-- The row lock prevents parallel verification requests from overwriting tickets or bypassing attempts.
create or replace function public.frnxup_verify_signup_codes(
  p_challenge_id uuid,
  p_email_hash text,
  p_phone_hash text,
  p_ticket_hash text,
  p_now timestamptz,
  p_ticket_expires_at timestamptz
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare c public.frnxup_signup_challenges%rowtype;
begin
  select * into c from public.frnxup_signup_challenges where id=p_challenge_id for update;
  if not found or c.consumed_at is not null then return 'invalid'; end if;
  if c.verified_at is not null then return 'already_verified'; end if;
  if c.expires_at <= p_now then return 'expired'; end if;
  if c.attempts >= 5 then return 'too_many'; end if;
  if c.email_otp_hash is distinct from p_email_hash or c.phone_otp_hash is distinct from p_phone_hash then
    update public.frnxup_signup_challenges set attempts=least(attempts+1,5) where id=p_challenge_id;
    return 'incorrect';
  end if;
  update public.frnxup_signup_challenges
     set verified_at=p_now, ticket_hash=p_ticket_hash, ticket_expires_at=p_ticket_expires_at,
         email_otp_hash=null, phone_otp_hash=null
   where id=p_challenge_id;
  return 'verified';
end;
$$;
revoke all on function public.frnxup_verify_signup_codes(uuid,text,text,text,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.frnxup_verify_signup_codes(uuid,text,text,text,timestamptz,timestamptz) to service_role;
