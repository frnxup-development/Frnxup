-- Frnxup account enforcement, permanent-ban identity lock and private account appeals.
-- Apply this migration once in the Supabase SQL Editor before deploying the updated Edge Functions.

-- Extend account states without changing existing active/suspended records.
alter table public.profiles drop constraint if exists profiles_account_status_check;
alter table public.profiles
  add constraint profiles_account_status_check
  check (account_status in ('active','suspended','banned'));

-- Hashes preserve only the login identifiers needed to prevent a permanently
-- banned member from re-registering after an administrator deletes the account.
create table if not exists public.banned_account_identities (
  identity_type text not null check (identity_type in ('email','phone','username')),
  identity_hash text not null check (identity_hash ~ '^[a-f0-9]{64}$'),
  source_user_id uuid,
  created_at timestamptz not null default now(),
  primary key (identity_type, identity_hash)
);
alter table public.banned_account_identities enable row level security;
revoke all on public.banned_account_identities from anon, authenticated;
grant all on public.banned_account_identities to service_role;

-- Reject new Auth users whose email, phone or requested Frnxup username matches
-- an identity retained from a permanently banned account.
create or replace function public.frnxup_prevent_banned_identity_signup()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  email_hash text;
  phone_hash text;
  username_hash text;
begin
  if nullif(btrim(new.email), '') is not null then
    email_hash := encode(digest(lower(btrim(new.email)), 'sha256'), 'hex');
  end if;
  if nullif(btrim(new.phone), '') is not null then
    phone_hash := encode(digest(regexp_replace(btrim(new.phone), '[^0-9+]', '', 'g'), 'sha256'), 'hex');
  end if;
  if nullif(btrim(coalesce(new.raw_user_meta_data, '{}'::jsonb)->>'username'), '') is not null then
    username_hash := encode(digest(lower(btrim(new.raw_user_meta_data->>'username')), 'sha256'), 'hex');
  end if;

  if (email_hash is not null and exists(select 1 from public.banned_account_identities where identity_type='email' and identity_hash=email_hash))
     or (phone_hash is not null and exists(select 1 from public.banned_account_identities where identity_type='phone' and identity_hash=phone_hash))
     or (username_hash is not null and exists(select 1 from public.banned_account_identities where identity_type='username' and identity_hash=username_hash)) then
    raise exception using
      errcode = '23505',
      message = 'This email, phone number or username is associated with an account permanently banned from Frnxup.';
  end if;
  return new;
end;
$$;
revoke all on function public.frnxup_prevent_banned_identity_signup() from public, anon, authenticated;
drop trigger if exists frnxup_block_banned_identity_signup on auth.users;
create trigger frnxup_block_banned_identity_signup
before insert on auth.users
for each row execute function public.frnxup_prevent_banned_identity_signup();

-- Additional appeal fields. The object paths point to a PRIVATE storage bucket;
-- they are never public URLs and can only be converted to short-lived signed URLs by admin-control.
alter table public.account_appeals
  add column if not exists contact_email text,
  add column if not exists evidence_paths jsonb not null default '[]'::jsonb,
  add column if not exists review_note text,
  add column if not exists reviewed_at timestamptz;
create index if not exists account_appeals_user_created_idx
  on public.account_appeals(user_id, created_at desc);

-- Appeals are created through the authenticated account-appeal Edge Function only.
drop policy if exists appeals_own_insert on public.account_appeals;

-- One private bucket for appeal evidence. No anon/authenticated storage policies are added.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'account-appeals',
  'account-appeals',
  false,
  5242880,
  array['image/jpeg','image/png','image/webp','application/pdf']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = excluded.allowed_mime_types;

-- Account access gate deliberately checks only account_status. The older user_is_active()
-- helper also considers maintenance mode; using that helper here would block all ordinary
-- members during planned maintenance instead of only suspended/banned accounts.
drop function if exists public.frnxup_account_is_enabled(uuid);
create or replace function public.frnxup_account_is_enabled()
returns boolean
language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.profiles where id=auth.uid() and account_status='active') $$;
revoke all on function public.frnxup_account_is_enabled() from public, anon;
grant execute on function public.frnxup_account_is_enabled() to authenticated, service_role;

-- A restrictive policy is combined with the existing table policies using AND.
-- This denies all normal application-table access to suspended/banned sessions,
-- even when a member still holds an old, unexpired Supabase JWT. Profiles are
-- excluded so the client can read its own status and explain the restriction;
-- account_appeals is excluded so a verified restricted member can view their own
-- appeal status. Site settings are public configuration and contain no member data.
do $$
declare t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relkind='r'
      and c.relrowsecurity
      and c.relname not in ('profiles','account_appeals','site_settings','banned_account_identities')
  loop
    execute format('drop policy if exists frnxup_active_account_gate on public.%I', t.relname);
    execute format(
      'create policy frnxup_active_account_gate on public.%I as restrictive for all to authenticated using (public.frnxup_account_is_enabled()) with check (public.frnxup_account_is_enabled())',
      t.relname
    );
  end loop;
end $$;

comment on table public.banned_account_identities is
  'Server-only SHA-256 hashes of email, phone and username identifiers retained to prevent re-registration after a permanent Frnxup ban.';
comment on column public.account_appeals.evidence_paths is
  'Private storage object paths; admins receive short-lived signed URLs through the admin-control Edge Function.';

-- A restricted member may read only their own profile status so the login UI
-- can display the correct reason. They may not update any profile field until active.
drop policy if exists frnxup_profile_status_read_gate on public.profiles;
create policy frnxup_profile_status_read_gate on public.profiles
  as restrictive for select to authenticated
  using (id = auth.uid() or public.frnxup_account_is_enabled());
drop policy if exists frnxup_profile_update_gate on public.profiles;
create policy frnxup_profile_update_gate on public.profiles
  as restrictive for update to authenticated
  using (public.frnxup_account_is_enabled())
  with check (public.frnxup_account_is_enabled());
drop policy if exists frnxup_profile_insert_gate on public.profiles;
create policy frnxup_profile_insert_gate on public.profiles
  as restrictive for insert to authenticated
  with check (public.frnxup_account_is_enabled());


-- SECURITY DEFINER helpers bypass table RLS, so they must explicitly apply the same
-- account-status rule for authenticated restricted members. Anonymous public lookups
-- keep their existing behavior where the original function allowed it.
create or replace function public.frnxup_friend_suggestions(p_limit integer default 24)
returns table(id uuid,username text,display_name text,mutual_friends bigint,shared_interests bigint)
language sql stable security definer set search_path=public
as $$
 with me as (select interests from public.profile_details where profile_id=auth.uid()),
 candidates as (
  select p.id,p.username,p.display_name,
   (select count(*) from public.friendships f1 join public.friendships f2 on
      (case when f1.user_a=auth.uid() then f1.user_b else f1.user_a end)=
      (case when f2.user_a=p.id then f2.user_b else f2.user_a end)
    where auth.uid() in (f1.user_a,f1.user_b) and p.id in (f2.user_a,f2.user_b)) as mutual_count,
   case when d.details_visibility='public' then (select count(*) from unnest(coalesce(d.interests,'{}'::text[])) i where i=any(coalesce((select interests from me),'{}'::text[]))) else 0 end as shared_count
  from public.profiles p left join public.profile_details d on d.profile_id=p.id
  where public.frnxup_account_is_enabled()
   and p.id<>auth.uid() and p.account_status='active' and p.profile_visibility='public' and (p.friend_request_policy='everyone' or public.has_mutual_friend(auth.uid(),p.id))
   and not public.are_friends(auth.uid(),p.id)
   and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=p.id) or (b.blocker_id=p.id and b.blocked_id=auth.uid()))
   and not exists(select 1 from public.friend_requests r where r.status='pending' and ((r.sender_id=auth.uid() and r.receiver_id=p.id) or (r.sender_id=p.id and r.receiver_id=auth.uid())))
 )
 select id,username,display_name,mutual_count,shared_count from candidates
 order by shared_count desc,mutual_count desc,id limit greatest(1,least(coalesce(p_limit,24),50));
$$;

create or replace function public.frnxup_profile_friends(p_profile_id uuid)
returns table(id uuid,username text,display_name text)
language sql stable security definer set search_path=public
as $$
 select p.id,p.username,p.display_name
 from public.friendships f
 join public.profiles owner_profile on owner_profile.id=p_profile_id
 join public.profiles p on p.id=case when f.user_a=p_profile_id then f.user_b else f.user_a end
 where p_profile_id in (f.user_a,f.user_b)
  and (auth.uid() is null or public.frnxup_account_is_enabled())
  and p.account_status='active'
  and (auth.uid()=p_profile_id
    or (owner_profile.profile_visibility='public' and owner_profile.friends_visibility='public')
    or (owner_profile.profile_visibility in ('public','friends') and owner_profile.friends_visibility in ('public','friends') and public.are_friends(auth.uid(),p_profile_id)))
  and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=p.id) or (b.blocker_id=p.id and b.blocked_id=auth.uid()))
 order by p.display_name,p.username limit 200;
$$;

create or replace function public.frnxup_poll_results(p_post_ids uuid[])
returns table(post_id uuid,option_index integer,option_label text,vote_count bigint,expires_at timestamptz)
language sql stable security definer set search_path=public
as $$
 select pp.post_id,g.idx,(pp.options->>g.idx),count(v.id),pp.expires_at
 from public.post_polls pp join public.posts p on p.id=pp.post_id
 cross join lateral generate_series(0,jsonb_array_length(pp.options)-1) as g(idx)
 left join public.poll_votes v on v.post_id=pp.post_id and v.option_index=g.idx
 where pp.post_id=any(coalesce(p_post_ids,'{}'::uuid[])) and p.status='published'
  and (auth.uid() is null or public.frnxup_account_is_enabled())
  and (p.user_id=auth.uid() or p.visibility='public' or (p.visibility='friends' and public.are_friends(auth.uid(),p.user_id)))
  and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=p.user_id) or (b.blocker_id=p.user_id and b.blocked_id=auth.uid()))
 group by pp.post_id,g.idx,pp.options,pp.expires_at order by pp.post_id,g.idx;
$$;

create or replace function public.frnxup_log_activity(
 p_action text,p_entity_type text default null,p_entity_id text default null,p_details jsonb default '{}'::jsonb
) returns boolean language plpgsql security definer set search_path=public
as $$
declare safe_action text:=lower(coalesce(p_action,''));
begin
 if auth.uid() is null or not public.frnxup_account_is_enabled() then return false; end if;
 if safe_action not in ('page_view','search','profile_view','sign_in','sign_out','interaction') then raise exception 'Unsupported activity type'; end if;
 insert into public.site_activity_logs(actor_id,action,entity_type,entity_id,details)
 values(auth.uid(),safe_action,left(p_entity_type,48),left(p_entity_id,160),
  case when jsonb_typeof(p_details)='object' then p_details-'password'-'token'-'email'-'phone' else '{}'::jsonb end);
 return true;
end $$;

create or replace function public.frnxup_page_follower_count(p_page_id uuid)
returns bigint language plpgsql stable security definer set search_path=public
as $$ declare visible boolean; owner_id uuid; total bigint; begin
 if auth.uid() is not null and not public.frnxup_account_is_enabled() then return null; end if;
 select follower_count_visible,owner_user_id into visible,owner_id from public.frnxup_pages where id=p_page_id and status='active';
 if not found then return null; end if;
 if not coalesce(visible,false) and owner_id is distinct from auth.uid() then return null; end if;
 select count(*) into total from public.frnxup_page_followers where page_id=p_page_id;
 return total;
end $$;

create or replace function public.is_conversation_member(p_conversation uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select public.frnxup_account_is_enabled() and exists(select 1 from public.conversation_members where conversation_id=p_conversation and user_id=auth.uid()) $$;
create or replace function public.is_room_member(p_room uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select public.frnxup_account_is_enabled() and exists(select 1 from public.room_members where room_id=p_room and user_id=auth.uid() and status='active') $$;
create or replace function public.is_room_moderator(p_room uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select public.frnxup_account_is_enabled() and exists(select 1 from public.room_members where room_id=p_room and user_id=auth.uid() and status='active' and role in ('owner','moderator')) $$;


-- Storage is outside the public schema, so apply a matching restriction there too.
-- Banned/suspended sessions cannot upload or retrieve private member media; service-role
-- appeal uploads and five-minute admin-signed evidence links continue to work.
drop policy if exists frnxup_active_account_storage_gate on storage.objects;
create policy frnxup_active_account_storage_gate on storage.objects
  as restrictive for all to authenticated
  using (public.frnxup_account_is_enabled())
  with check (public.frnxup_account_is_enabled());

create or replace function public.are_friends(a uuid,b uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select (auth.uid() is null or public.frnxup_account_is_enabled())
 and exists(select 1 from public.friendships where user_a=least(a,b) and user_b=greatest(a,b)) $$;

create or replace function public.frnxup_owns_page(p_page_id uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select public.frnxup_account_is_enabled()
 and exists(select 1 from public.frnxup_pages p where p.id=p_page_id and p.owner_user_id=auth.uid()) $$;

create or replace function public.frnxup_is_page_follower(p_page_id uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select public.frnxup_account_is_enabled()
 and exists(select 1 from public.frnxup_page_followers f where f.page_id=p_page_id and f.user_id=auth.uid()) $$;
