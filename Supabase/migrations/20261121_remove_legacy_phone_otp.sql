-- FRNXUP: remove the previously deployed mandatory phone/SMS verification gate.
-- Run this once in the Supabase SQL Editor if the old phone OTP migration was applied.
-- This restores the original permission helpers from Supabase/schema.sql and removes
-- the old restrictive policies, phone OTP records, trigger and SMS proof functions.
begin;

-- Remove table-level restrictive policies that required a verified phone session.
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','profile_details','profile_locations','post_polls','poll_votes',
    'friend_requests','friendships','user_blocks','posts','post_comments',
    'comment_reactions','post_reactions','bookmarks','statuses','conversations',
    'conversation_members','messages','message_receipts','rooms','room_members',
    'room_messages','notifications','reports','verification_requests',
    'account_appeals','admin_audit_logs'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists phone_verified_gate on public.%I', t);
    end if;
  end loop;
end $$;

drop policy if exists frnxup_phone_verified_storage_gate on storage.objects;

-- Remove phone OTP helpers and proof tables after their policies have gone.
drop function if exists public.frnxup_prepare_phone_otp(uuid,uuid,text);
drop function if exists public.frnxup_verify_phone_otp(uuid,uuid,text);

-- Remove the phone-change uniqueness trigger introduced with the OTP feature.
drop trigger if exists frnxup_auth_phone_change_guard on auth.users;
drop function if exists public.frnxup_auth_phone_change_guard();
drop index if exists auth.frnxup_auth_users_phone_change_unique_idx;

-- Restore the core account/role checks to the definitions in Supabase/schema.sql.
create or replace function public.user_is_active(p_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path=public
as $$
  select exists(
    select 1 from public.profiles
    where id=p_id and account_status='active'
      and (not public.site_setting_enabled('maintenance_mode',false) or role in ('admin','owner'))
  )
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','owner') and account_status='active') $$;

create or replace function public.is_moderator()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.profiles where id=auth.uid() and role in ('moderator','admin','owner') and account_status='active') $$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='owner' and account_status='active') $$;

create or replace function public.has_mutual_friend(a uuid,b uuid)
returns boolean language sql stable security definer set search_path=public
as $$
  select exists(
    select 1 from public.friendships f1 join public.friendships f2
    on (case when f1.user_a=a then f1.user_b else f1.user_a end)=
       (case when f2.user_a=b then f2.user_b else f2.user_a end)
    where a in (f1.user_a,f1.user_b) and b in (f2.user_a,f2.user_b)
  )
$$;

create or replace function public.are_friends(a uuid,b uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.friendships where user_a=least(a,b) and user_b=greatest(a,b)) $$;

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
  where p.id<>auth.uid() and p.account_status='active' and p.profile_visibility='public' and (p.friend_request_policy='everyone' or public.has_mutual_friend(auth.uid(),p.id))
   and not public.are_friends(auth.uid(),p.id)
   and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=p.id) or (b.blocker_id=p.id and b.blocked_id=auth.uid()))
   and not exists(select 1 from public.friend_requests r where r.status='pending' and ((r.sender_id=auth.uid() and r.receiver_id=p.id) or (r.sender_id=p.id and r.receiver_id=auth.uid())))
 )
 select id,username,display_name,mutual_count,shared_count from candidates
 order by shared_count desc,mutual_count desc,id limit greatest(1,least(coalesce(p_limit,24),50));
$$;

create or replace function public.frnxup_poll_results(p_post_ids uuid[])
returns table(post_id uuid,option_index integer,option_label text,vote_count bigint,expires_at timestamptz)
language sql stable security definer set search_path=public
as $$
 select pp.post_id,g.idx,(pp.options->>g.idx),count(v.id),pp.expires_at
 from public.post_polls pp
 join public.posts p on p.id=pp.post_id
 cross join lateral generate_series(0,jsonb_array_length(pp.options)-1) as g(idx)
 left join public.poll_votes v on v.post_id=pp.post_id and v.option_index=g.idx
 where pp.post_id=any(coalesce(p_post_ids,'{}'::uuid[])) and p.status='published'
  and (p.user_id=auth.uid() or p.visibility='public' or (p.visibility='friends' and public.are_friends(auth.uid(),p.user_id)))
  and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=p.user_id) or (b.blocker_id=p.user_id and b.blocked_id=auth.uid()))
 group by pp.post_id,g.idx,pp.options,pp.expires_at
 order by pp.post_id,g.idx;
$$;

create or replace function public.frnxup_profile_friends(p_profile_id uuid)
returns table(id uuid,username text,display_name text)
language sql stable security definer set search_path=public
as $$
  select p.id,p.username,p.display_name
  from public.friendships f
  join public.profiles owner_profile on owner_profile.id=p_profile_id
  join public.profiles p on p.id=case when f.user_a=p_profile_id then f.user_b else f.user_a end
  where p_profile_id in (f.user_a,f.user_b) and p.account_status='active'
    and (
      auth.uid()=p_profile_id
      or (owner_profile.profile_visibility='public' and owner_profile.friends_visibility='public')
      or (owner_profile.profile_visibility in ('public','friends') and owner_profile.friends_visibility in ('public','friends') and public.are_friends(auth.uid(),p_profile_id))
    )
    and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=p.id) or (b.blocker_id=p.id and b.blocked_id=auth.uid()))
  order by p.display_name,p.username limit 200;
$$;

create or replace function public.is_conversation_member(p_conversation uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.conversation_members where conversation_id=p_conversation and user_id=auth.uid()) $$;

create or replace function public.is_room_member(p_room uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.room_members where room_id=p_room and user_id=auth.uid() and status='active') $$;

create or replace function public.is_room_moderator(p_room uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.room_members where room_id=p_room and user_id=auth.uid() and status='active' and role in ('owner','moderator')) $$;

-- Remove the old proof function and its storage tables after all app helpers
-- that referenced it have been restored to their original definitions.
drop function if exists public.user_phone_verified(uuid);
drop table if exists public.phone_otp_challenges;
drop table if exists public.phone_verified_sessions;

commit;
