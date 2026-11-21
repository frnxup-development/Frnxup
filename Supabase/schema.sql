-- FRNXUP production-oriented starter schema
-- Run this entire file in the SQL Editor of a NEW Supabase project.
-- It is an initial migration: review before applying to an existing database.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[A-Za-z0-9_]{3,24}$'),
  display_name text not null default 'Frnxup member',
  bio text not null default '' check (char_length(bio) <= 300),
  avatar_path text,
  cover_path text,
  role text not null default 'member' check (role in ('member','moderator','admin','owner')),
  account_status text not null default 'active' check (account_status in ('active','suspended')),
  profile_visibility text not null default 'public' check (profile_visibility in ('public','friends','private')),
  friends_visibility text not null default 'friends' check (friends_visibility in ('public','friends','private')),
  friend_request_policy text not null default 'everyone' check (friend_request_policy in ('everyone','friends_of_friends','none')),
  message_policy text not null default 'friends' check (message_policy in ('everyone','friends')),
  online_visibility text not null default 'friends' check (online_visibility in ('everyone','friends','nobody')),
  is_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.profile_details (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  education text, occupation text, birth_date date, interests text[] not null default '{}',
  details_visibility text not null default 'friends' check (details_visibility in ('public','friends','private')),
  updated_at timestamptz not null default now()
);
create table if not exists public.profile_locations (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  city text, state text, country text,
  location_visibility text not null default 'friends' check (location_visibility in ('public','friends','private')),
  updated_at timestamptz not null default now()
);

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friend_requests_not_self check (sender_id <> receiver_id)
);
create unique index if not exists friend_requests_pending_pair_idx on public.friend_requests(sender_id,receiver_id) where status='pending';
create table if not exists public.friendships (
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_a,user_b),
  check(user_a < user_b)
);
create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(blocker_id,blocked_id), check(blocker_id <> blocked_id)
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 5000),
  media_path text,
  media_type text check (media_type in ('image','video') or media_type is null),
  visibility text not null default 'public' check (visibility in ('public','friends','only_me')),
  status text not null default 'published' check (status in ('published','hidden','deleted')),
  location_label text,
  repost_of uuid references public.posts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (body <> '' or media_path is not null)
);
create table if not exists public.post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  media_path text not null unique,
  media_type text not null check (media_type in ('image','video')),
  sort_order smallint not null check (sort_order between 1 and 20),
  created_at timestamptz not null default now(),
  unique(post_id, sort_order)
);
create index if not exists post_media_post_order_idx on public.post_media(post_id, sort_order);
create index if not exists posts_feed_idx on public.posts(status,created_at desc);
create index if not exists posts_repost_of_idx on public.posts(repost_of) where repost_of is not null;

create or replace function public.enforce_post_media_limits()
returns trigger language plpgsql security invoker set search_path = public as $$
declare current_count integer; current_type text;
begin
  select count(*), max(media_type) into current_count, current_type from public.post_media where post_id=new.post_id;
  if current_count >= 20 then raise exception 'A post can contain at most 20 photos.'; end if;
  if current_type is not null and current_type <> new.media_type then raise exception 'Choose photos or one video. Mixed media posts are not supported.'; end if;
  if new.media_type='video' and current_count>0 then raise exception 'A video post can contain only one video.'; end if;
  return new;
end $$;
drop trigger if exists trg_enforce_post_media_limits on public.post_media;
create trigger trg_enforce_post_media_limits before insert on public.post_media for each row execute function public.enforce_post_media_limits();

create table if not exists public.post_polls (
  post_id uuid primary key references public.posts(id) on delete cascade,
  question text not null check(char_length(question) between 3 and 240),
  options jsonb not null check(jsonb_typeof(options)='array' and jsonb_array_length(options) between 2 and 6),
  expires_at timestamptz not null default (now()+interval '7 days'),
  created_at timestamptz not null default now()
);
create table if not exists public.poll_votes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.post_polls(post_id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  option_index integer not null check(option_index between 0 and 5),
  created_at timestamptz not null default now(),
  unique(post_id,user_id)
);
create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  parent_id uuid references public.post_comments(id) on delete set null,
  status text not null default 'published' check (status in ('published','hidden','deleted')),
  created_at timestamptz not null default now()
);
create index if not exists post_comments_thread_order_idx on public.post_comments(post_id,created_at asc,parent_id);
create table if not exists public.comment_reactions (
  comment_id uuid not null references public.post_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null check (reaction in ('like','love','haha','wow','sad','angry','support')),
  created_at timestamptz not null default now(),
  primary key(comment_id,user_id)
);
create index if not exists comment_reactions_comment_idx on public.comment_reactions(comment_id);
create or replace function public.frnxup_validate_comment_parent()
returns trigger language plpgsql security definer set search_path=public
as $$ declare parent_post_id uuid; begin
 if new.parent_id is null then return new; end if;
 select post_id into parent_post_id from public.post_comments where id=new.parent_id;
 if parent_post_id is null or parent_post_id<>new.post_id then raise exception 'A reply must belong to the same post as its parent comment'; end if;
 return new; end $$;
drop trigger if exists frnxup_validate_comment_parent_trigger on public.post_comments;
create trigger frnxup_validate_comment_parent_trigger before insert or update of parent_id,post_id on public.post_comments for each row execute function public.frnxup_validate_comment_parent();
create table if not exists public.post_reactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null default 'like' check (reaction in ('like','love','laugh','wow','sad','support')),
  created_at timestamptz not null default now(), unique(post_id,user_id)
);
create table if not exists public.bookmarks (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(user_id,post_id)
);
create table if not exists public.statuses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  text text not null default '' check (char_length(text) <= 700),
  media_path text,
  media_type text check (media_type in ('image','video') or media_type is null),
  visibility text not null default 'friends' check (visibility in ('public','friends')),
  expires_at timestamptz not null default (now()+interval '24 hours'),
  created_at timestamptz not null default now(), check(text <> '' or media_path is not null)
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('dm','group')),
  title text,
  created_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'active' check(status in ('active','suspended')),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check(role in ('member','admin')),
  joined_at timestamptz not null default now(),
  primary key(conversation_id,user_id)
);
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '' check(char_length(body)<=5000),
  media_path text,
  media_type text check (media_type in ('image','video','audio') or media_type is null),
  reply_to uuid references public.messages(id) on delete set null,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(), check(body <> '' or media_path is not null)
);
create index if not exists messages_conversation_idx on public.messages(conversation_id,created_at);
create table if not exists public.message_receipts (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  delivered_at timestamptz not null default now(),
  read_at timestamptz,
  unique(message_id,user_id)
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check(char_length(name) between 3 and 60),
  description text not null default '' check(char_length(description)<=500),
  category text not null default 'General',
  visibility text not null default 'public' check(visibility in ('public','private')),
  status text not null default 'active' check(status in ('active','suspended')),
  created_by uuid not null references public.profiles(id) on delete cascade,
  member_count integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check(role in ('member','moderator','owner')),
  status text not null default 'active' check(status in ('pending','active','removed','banned')),
  joined_at timestamptz not null default now(),
  primary key(room_id,user_id)
);
create or replace function public.prevent_conversation_member_role_change()
returns trigger language plpgsql set search_path=public
as $$ begin
 if new.role is distinct from old.role and coalesce(auth.role(),'') not in ('service_role','postgres') and current_user<>'postgres' then
  raise exception 'Group administrator roles are controlled by the group creation and administrator workflows';
 end if;
 return new;
end $$;
drop trigger if exists guard_conversation_member_role on public.conversation_members;
create trigger guard_conversation_member_role before update on public.conversation_members for each row execute function public.prevent_conversation_member_role_change();

create table if not exists public.room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check(char_length(body) between 1 and 3000),
  status text not null default 'published' check(status in ('published','hidden','deleted')),
  created_at timestamptz not null default now()
);
create index if not exists room_messages_room_idx on public.room_messages(room_id,created_at);

create or replace function public.prevent_room_member_role_change()
returns trigger language plpgsql set search_path=public
as $$ begin
 if new.role is distinct from old.role and coalesce(auth.role(),'') not in ('service_role','postgres') and current_user<>'postgres' then
  raise exception 'Room owner/moderator roles are controlled by Frnxup administrators';
 end if;
 return new;
end $$;
drop trigger if exists guard_room_member_role on public.room_members;
create trigger guard_room_member_role before update on public.room_members for each row execute function public.prevent_room_member_role_change();

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  type text not null,
  title text not null,
  body text not null default '',
  target_type text,
  target_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check(target_type in ('user','post','comment','room','group','message')),
  target_id uuid not null,
  reason text not null check(char_length(reason) between 3 and 2000),
  status text not null default 'open' check(status in ('open','reviewing','resolved','dismissed')),
  resolution_note text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.verification_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  note text not null default '',
  evidence_path text,
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.account_appeals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check(char_length(reason) between 5 and 3000),
  status text not null default 'pending' check(status in ('pending','upheld','reinstated')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_type text,
  target_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists public.site_activity_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists site_activity_logs_created_idx on public.site_activity_logs(created_at desc);
create index if not exists site_activity_logs_actor_idx on public.site_activity_logs(actor_id,created_at desc);

-- Access helper functions. SECURITY DEFINER avoids RLS recursion when checking roles.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','owner') and account_status='active') $$;
create or replace function public.is_moderator()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.profiles where id=auth.uid() and role in ('moderator','admin','owner') and account_status='active') $$;
create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='owner' and account_status='active') $$;
create or replace function public.site_setting_enabled(p_key text,p_default boolean default true)
returns boolean language sql stable security definer set search_path=public
as $$ select coalesce((select (value #>> '{}')::boolean from public.site_settings where key=p_key),p_default) $$;
create or replace function public.has_mutual_friend(a uuid,b uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.friendships f1 join public.friendships f2 on (case when f1.user_a=a then f1.user_b else f1.user_a end)=(case when f2.user_a=b then f2.user_b else f2.user_a end) where a in (f1.user_a,f1.user_b) and b in (f2.user_a,f2.user_b)) $$;
create or replace function public.user_is_active(p_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.profiles where id=p_id and account_status='active' and (not public.site_setting_enabled('maintenance_mode',false) or role in ('admin','owner'))) $$;
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

create or replace function public.frnxup_profile_friends(p_profile_id uuid)
returns table (
  id uuid,
  username text,
  display_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.username, p.display_name
  from public.friendships as f
  join public.profiles as owner_profile
    on owner_profile.id = p_profile_id
  join public.profiles as p
    on p.id = case
      when f.user_a = p_profile_id then f.user_b
      else f.user_a
    end
  where p_profile_id in (f.user_a, f.user_b)
    and p.account_status = 'active'
    and (
      auth.uid() = p_profile_id
      or (owner_profile.profile_visibility = 'public'
          and owner_profile.friends_visibility = 'public')
      or (owner_profile.profile_visibility in ('public', 'friends')
          and owner_profile.friends_visibility in ('public', 'friends')
          and public.are_friends(auth.uid(), p_profile_id))
    )
    and not exists (
      select 1
      from public.user_blocks as b
      where (b.blocker_id = auth.uid() and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = auth.uid())
    )
  order by p.display_name, p.username
  limit 200;
$$;

create or replace function public.frnxup_vote_poll(p_post_id uuid,p_option_index integer)
returns void language plpgsql security definer set search_path=public
as $$
declare poll_row public.post_polls; post_row public.posts;
begin
 if not public.user_is_active(auth.uid()) or not public.site_setting_enabled('posting_enabled',true) or not public.site_setting_enabled('polls_enabled',true) then raise exception 'Voting is currently unavailable'; end if;
 select * into poll_row from public.post_polls where post_id=p_post_id;
 if not found then raise exception 'Poll not found'; end if;
 if poll_row.expires_at<=now() then raise exception 'This poll has closed'; end if;
 if p_option_index<0 or p_option_index>=jsonb_array_length(poll_row.options) then raise exception 'Invalid poll option'; end if;
 select * into post_row from public.posts p where p.id=p_post_id and p.status='published'
  and (p.user_id=auth.uid() or p.visibility='public' or (p.visibility='friends' and public.are_friends(auth.uid(),p.user_id)))
  and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=p.user_id) or (b.blocker_id=p.user_id and b.blocked_id=auth.uid()));
 if not found then raise exception 'This poll is not available to your account'; end if;
 insert into public.poll_votes(post_id,user_id,option_index) values(p_post_id,auth.uid(),p_option_index)
 on conflict(post_id,user_id) do update set option_index=excluded.option_index,created_at=now();
end $$;

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

create or replace function public.is_conversation_member(p_conversation uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.conversation_members where conversation_id=p_conversation and user_id=auth.uid()) $$;
create or replace function public.is_room_member(p_room uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.room_members where room_id=p_room and user_id=auth.uid() and status='active') $$;
create or replace function public.is_room_moderator(p_room uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.room_members where room_id=p_room and user_id=auth.uid() and status='active' and role in ('owner','moderator')) $$;

-- New account bootstrap. Username is copied from signup metadata; users begin as members only.
create or replace function public.handle_new_frnxup_user()
returns trigger language plpgsql security definer set search_path=public
as $$
declare requested text; candidate text; n integer:=0;
begin
  if not public.site_setting_enabled('registration_enabled',true) or public.site_setting_enabled('maintenance_mode',false) then raise exception 'Frnxup registration is temporarily disabled'; end if;
  requested:=coalesce(nullif(new.raw_user_meta_data->>'username',''),'member_'||substr(replace(new.id::text,'-',''),1,10));
  candidate:=lower(regexp_replace(requested,'[^A-Za-z0-9_]','','g'));
  if char_length(candidate)<3 then candidate:='member_'||substr(replace(new.id::text,'-',''),1,10); end if;
  candidate:=substr(candidate,1,24);
  while exists(select 1 from public.profiles where username=candidate) loop
    n:=n+1; candidate:=substr(candidate,1,18)||'_'||substr(replace(new.id::text,'-',''),1,5)||n::text;
  end loop;
  insert into public.profiles(id,username,display_name) values(new.id,candidate,coalesce(new.raw_user_meta_data->>'display_name',candidate));
  insert into public.profile_details(profile_id) values(new.id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created_frnxup on auth.users;
create trigger on_auth_user_created_frnxup after insert on auth.users for each row execute function public.handle_new_frnxup_user();

create or replace function public.respond_friend_request(p_request_id uuid,p_accept boolean)
returns void language plpgsql security definer set search_path=public
as $$ declare r public.friend_requests;
begin
 if not user_is_active(auth.uid()) then raise exception 'Active account required'; end if;
 select * into r from public.friend_requests where id=p_request_id and receiver_id=auth.uid() and status='pending' for update;
 if not found then raise exception 'Friend request not found or no permission'; end if;
 update public.friend_requests set status=case when p_accept then 'accepted' else 'declined' end,updated_at=now() where id=p_request_id;
 if p_accept then insert into public.friendships(user_a,user_b) values(least(r.sender_id,r.receiver_id),greatest(r.sender_id,r.receiver_id)) on conflict do nothing; end if;
 insert into public.notifications(user_id,actor_id,type,title,body,target_type,target_id) values(r.sender_id,auth.uid(),'friend_request_response',case when p_accept then 'Friend request accepted' else 'Friend request declined' end,'Your friend request received a response.','profile',auth.uid());
end $$;

create or replace function public.create_conversation(p_kind text,p_title text,p_member_ids uuid[])
returns uuid language plpgsql security definer set search_path=public
as $$ declare new_id uuid; unique_ids uuid[]; cnt integer;
begin
 if not user_is_active(auth.uid()) then raise exception 'Active account required'; end if;
 if not site_setting_enabled('messaging_enabled',true) then raise exception 'Messaging is temporarily disabled'; end if;
 if p_kind='group' and not site_setting_enabled('groups_enabled',true) then raise exception 'Group chats are temporarily disabled'; end if;
 if p_kind not in ('dm','group') then raise exception 'Invalid conversation type'; end if;
 select array_agg(distinct x) into unique_ids from unnest(coalesce(p_member_ids,'{}'::uuid[])||auth.uid()) x;
 cnt:=coalesce(array_length(unique_ids,1),0);
 if p_kind='dm' and cnt<>2 then raise exception 'A private chat must have exactly two members'; end if;
 if p_kind='group' and (cnt<2 or cnt>50) then raise exception 'A group must have between 2 and 50 members'; end if;
 if exists(select 1 from unnest(unique_ids) x left join public.profiles p on p.id=x where p.id is null or p.account_status<>'active') then raise exception 'One or more members are unavailable'; end if;
 if exists(select 1 from unnest(unique_ids) x where x<>auth.uid() and exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=x) or (b.blocker_id=x and b.blocked_id=auth.uid()))) then raise exception 'This conversation cannot be started'; end if;
 if exists(select 1 from unnest(unique_ids) x join public.profiles p on p.id=x where x<>auth.uid() and (p.message_policy='friends' or p_kind='group') and not are_friends(auth.uid(),x)) then raise exception 'You must be friends with selected members before starting this conversation'; end if;
 insert into public.conversations(kind,title,created_by) values(p_kind,case when p_kind='group' then coalesce(nullif(p_title,''),'New group') else null end,auth.uid()) returning id into new_id;
 insert into public.conversation_members(conversation_id,user_id,role) select new_id,x,case when x=auth.uid() then 'admin' else 'member' end from unnest(unique_ids) x;
 return new_id;
end $$;

create or replace function public.manage_group_member(p_conversation_id uuid,p_user_id uuid,p_action text)
returns void language plpgsql security definer set search_path=public
as $$ declare c public.conversations; actor_role text;
begin
 if not public.user_is_active(auth.uid()) then raise exception 'Active account required'; end if;
 if not public.site_setting_enabled('groups_enabled',true) then raise exception 'Group chats are temporarily disabled'; end if;
 select * into c from public.conversations where id=p_conversation_id and kind='group' and status='active';
 if not found then raise exception 'Group unavailable'; end if;
 select role into actor_role from public.conversation_members where conversation_id=p_conversation_id and user_id=auth.uid();
 if p_action='add' then
  if actor_role<>'admin' and c.created_by<>auth.uid() then raise exception 'Only group administrators can add members'; end if;
  if not exists(select 1 from public.profiles where id=p_user_id and account_status='active') then raise exception 'Member unavailable'; end if;
  if not public.are_friends(auth.uid(),p_user_id) then raise exception 'You can only add your Frnxup friends to a group'; end if;
  if exists(select 1 from public.user_blocks where (blocker_id=auth.uid() and blocked_id=p_user_id) or (blocker_id=p_user_id and blocked_id=auth.uid())) then raise exception 'This member cannot be added'; end if;
  if (select count(*) from public.conversation_members where conversation_id=p_conversation_id)>=50 then raise exception 'Group member limit reached'; end if;
  insert into public.conversation_members(conversation_id,user_id,role) values(p_conversation_id,p_user_id,'member') on conflict do nothing;
 elsif p_action='remove' then
  if p_user_id<>auth.uid() and actor_role<>'admin' and c.created_by<>auth.uid() then raise exception 'Only group administrators can remove members'; end if;
  if p_user_id=c.created_by then raise exception 'The group creator cannot be removed'; end if;
  delete from public.conversation_members where conversation_id=p_conversation_id and user_id=p_user_id;
 else raise exception 'Invalid group membership action'; end if;
end $$;

create or replace function public.join_room(p_room_id uuid)
returns text language plpgsql security definer set search_path=public
as $$ declare r public.rooms; state text;
begin
 if not user_is_active(auth.uid()) then raise exception 'Active account required'; end if;
 if not site_setting_enabled('rooms_enabled',true) then raise exception 'Rooms are temporarily disabled'; end if;
 select * into r from public.rooms where id=p_room_id and status='active';
 if not found then raise exception 'Room unavailable'; end if;
 select status into state from public.room_members where room_id=p_room_id and user_id=auth.uid();
 if state='banned' then raise exception 'You are not allowed to join this room'; end if;
 if state='active' then return 'active'; end if;
 if state='pending' and r.visibility='private' then return 'pending'; end if;
 state:=case when r.visibility='public' then 'active' else 'pending' end;
 insert into public.room_members(room_id,user_id,status) values(p_room_id,auth.uid(),state)
 on conflict(room_id,user_id) do update set status=excluded.status;
 if state='active' then update public.rooms set member_count=(select count(*) from public.room_members where room_id=p_room_id and status='active') where id=p_room_id; end if;
 return state;
end $$;

create or replace function public.add_room_creator()
returns trigger language plpgsql security definer set search_path=public
as $$ begin insert into public.room_members(room_id,user_id,role,status) values(new.id,new.created_by,'owner','active') on conflict(room_id,user_id) do nothing; return new; end $$;
drop trigger if exists add_room_creator_member on public.rooms;
create trigger add_room_creator_member after insert on public.rooms for each row execute function public.add_room_creator();
create or replace function public.invite_room_member(p_room_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path=public
as $$ begin
 if not public.user_is_active(auth.uid()) then raise exception 'Active account required'; end if;
 if not public.site_setting_enabled('rooms_enabled',true) then raise exception 'Rooms are temporarily disabled'; end if;
 if not (public.is_room_moderator(p_room_id) or public.is_admin()) then raise exception 'Only room moderators can invite members'; end if;
 if not exists(select 1 from public.rooms where id=p_room_id and status='active') then raise exception 'Room unavailable'; end if;
 if not exists(select 1 from public.profiles where id=p_user_id and account_status='active') then raise exception 'Member is unavailable'; end if;
 if exists(select 1 from public.room_members where room_id=p_room_id and user_id=p_user_id and status='banned') then raise exception 'This member is banned from the room'; end if;
 insert into public.room_members(room_id,user_id,role,status) values(p_room_id,p_user_id,'member','active') on conflict(room_id,user_id) do update set role='member',status='active';
end $$;

create or replace function public.refresh_room_count()
returns trigger language plpgsql security definer set search_path=public
as $$ declare rid uuid; begin if TG_OP='DELETE' then rid:=old.room_id; else rid:=new.room_id; end if; update public.rooms set member_count=(select count(*) from public.room_members where room_id=rid and status='active') where id=rid; if TG_OP='DELETE' then return old; else return new; end if; end $$;
drop trigger if exists room_member_count_trigger on public.room_members;
create trigger room_member_count_trigger after insert or update or delete on public.room_members for each row execute function public.refresh_room_count();

create or replace function public.on_frnxup_message()
returns trigger language plpgsql security definer set search_path=public
as $$ begin
 update public.conversations set last_message_at=new.created_at where id=new.conversation_id;
 insert into public.notifications(user_id,actor_id,type,title,body,target_type,target_id)
 select cm.user_id,new.sender_id,'new_message','New message',left(coalesce(new.body,'Shared media'),90),'conversation',new.conversation_id
 from public.conversation_members cm where cm.conversation_id=new.conversation_id and cm.user_id<>new.sender_id;
 insert into public.message_receipts(message_id,user_id) select new.id,cm.user_id from public.conversation_members cm where cm.conversation_id=new.conversation_id and cm.user_id<>new.sender_id on conflict(message_id,user_id) do nothing;
 return new;
end $$;
drop trigger if exists on_frnxup_message_insert on public.messages;
create trigger on_frnxup_message_insert after insert on public.messages for each row execute function public.on_frnxup_message();

create or replace function public.notify_friend_request() returns trigger language plpgsql security definer set search_path=public as $$ begin insert into public.notifications(user_id,actor_id,type,title,body,target_type,target_id) values(new.receiver_id,new.sender_id,'friend_request','New friend request','Someone sent you a friend request.','profile',new.sender_id); return new; end $$;
drop trigger if exists on_friend_request_created on public.friend_requests;
create trigger on_friend_request_created after insert on public.friend_requests for each row execute function public.notify_friend_request();
create or replace function public.notify_post_activity() returns trigger language plpgsql security definer set search_path=public as $$
declare owner_id uuid; note text;
begin
 select user_id into owner_id from public.posts where id=new.post_id;
 if TG_TABLE_NAME='post_comments' then note:=left(new.body,100); else note:='Someone reacted to your post.'; end if;
 if owner_id is not null and owner_id<>new.user_id then
  insert into public.notifications(user_id,actor_id,type,title,body,target_type,target_id)
  values(owner_id,new.user_id,case when TG_TABLE_NAME='post_comments' then 'post_comment' else 'post_reaction' end,case when TG_TABLE_NAME='post_comments' then 'New comment' else 'New reaction' end,note,'post',new.post_id);
 end if;
 return new;
end $$;
drop trigger if exists on_post_comment_activity on public.post_comments;
create trigger on_post_comment_activity after insert on public.post_comments for each row execute function public.notify_post_activity();
drop trigger if exists on_post_reaction_activity on public.post_reactions;
create trigger on_post_reaction_activity after insert on public.post_reactions for each row execute function public.notify_post_activity();

-- RLS enabled on every user-facing table.
do $$ declare t text; begin foreach t in array array['profiles','profile_details','profile_locations','post_media','post_polls','poll_votes','friend_requests','friendships','user_blocks','posts','post_comments','comment_reactions','post_reactions','bookmarks','statuses','conversations','conversation_members','messages','message_receipts','rooms','room_members','room_messages','notifications','reports','verification_requests','account_appeals','site_settings','admin_audit_logs','site_activity_logs'] loop execute format('alter table public.%I enable row level security',t); end loop; end $$;

-- Remove policy definitions so this script can be rerun safely during setup.
do $$ declare r record; begin for r in select schemaname,tablename,policyname from pg_policies where schemaname='public' loop execute format('drop policy if exists %I on %I.%I',r.policyname,r.schemaname,r.tablename); end loop; end $$;

-- Profiles and profile detail access.
create policy profiles_read on public.profiles for select to anon, authenticated using (id=auth.uid() or (account_status='active' and (profile_visibility='public' or (profile_visibility='friends' and are_friends(auth.uid(),id))) and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=id) or (b.blocker_id=id and b.blocked_id=auth.uid()))));
create policy profiles_insert_self on public.profiles for insert to authenticated with check (id=auth.uid() and role='member' and account_status='active');
create policy profiles_update_self on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
create or replace function public.prevent_profile_privilege_changes()
returns trigger language plpgsql set search_path=public
as $$ begin
  if (new.role is distinct from old.role or new.account_status is distinct from old.account_status or new.is_verified is distinct from old.is_verified)
     and coalesce(auth.role(),'') not in ('service_role','postgres') and current_user <> 'postgres' then
    raise exception 'Role, account status and verification are controlled by Frnxup administrators';
  end if;
  new.updated_at:=now();
  return new;
end $$;
drop trigger if exists protect_profile_privileges on public.profiles;
create trigger protect_profile_privileges before update on public.profiles for each row execute function public.prevent_profile_privilege_changes();

create policy profile_details_read on public.profile_details for select to anon, authenticated using(profile_id=auth.uid() or exists(select 1 from public.profiles p where p.id=profile_id and p.account_status='active' and (p.profile_visibility='public' or (p.profile_visibility='friends' and are_friends(auth.uid(),profile_id))) and (details_visibility='public' or (details_visibility='friends' and are_friends(auth.uid(),profile_id))) and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=profile_id) or (b.blocker_id=profile_id and b.blocked_id=auth.uid()))));
create policy profile_details_write on public.profile_details for all to authenticated using(profile_id=auth.uid()) with check(profile_id=auth.uid());
create policy profile_locations_read on public.profile_locations for select to anon, authenticated using(profile_id=auth.uid() or exists(select 1 from public.profiles p where p.id=profile_id and p.account_status='active' and (p.profile_visibility='public' or (p.profile_visibility='friends' and are_friends(auth.uid(),profile_id))) and (location_visibility='public' or (location_visibility='friends' and are_friends(auth.uid(),profile_id))) and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=profile_id) or (b.blocker_id=profile_id and b.blocked_id=auth.uid()))));
create policy profile_locations_write on public.profile_locations for all to authenticated using(profile_id=auth.uid()) with check(profile_id=auth.uid());

-- Friendship, blocks and requests.
create policy friend_requests_read on public.friend_requests for select to authenticated using(sender_id=auth.uid() or receiver_id=auth.uid());
create policy friend_requests_insert on public.friend_requests for insert to authenticated with check(sender_id=auth.uid() and user_is_active(auth.uid()) and site_setting_enabled('friend_requests_enabled',true) and exists(select 1 from public.profiles target where target.id=receiver_id and target.friend_request_policy<>'none' and (target.friend_request_policy='everyone' or has_mutual_friend(auth.uid(),receiver_id))) and not public.are_friends(auth.uid(),receiver_id) and not exists(select 1 from public.friend_requests r where r.status='pending' and ((r.sender_id=auth.uid() and r.receiver_id=receiver_id) or (r.sender_id=receiver_id and r.receiver_id=auth.uid()))) and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=receiver_id) or (b.blocker_id=receiver_id and b.blocked_id=auth.uid())));
create policy friend_requests_delete on public.friend_requests for delete to authenticated using(sender_id=auth.uid() or is_admin());
create policy friendships_read on public.friendships for select to authenticated using(user_a=auth.uid() or user_b=auth.uid() or is_admin());
create policy friendships_delete on public.friendships for delete to authenticated using(user_a=auth.uid() or user_b=auth.uid() or is_admin());
create policy blocks_read on public.user_blocks for select to authenticated using(blocker_id=auth.uid());
create policy blocks_insert on public.user_blocks for insert to authenticated with check(blocker_id=auth.uid());
create policy blocks_delete on public.user_blocks for delete to authenticated using(blocker_id=auth.uid());
create or replace function public.on_user_blocked()
returns trigger language plpgsql security definer set search_path=public
as $$ begin
 delete from public.friendships where user_a=least(new.blocker_id,new.blocked_id) and user_b=greatest(new.blocker_id,new.blocked_id);
 update public.friend_requests set status='cancelled',updated_at=now() where status='pending' and ((sender_id=new.blocker_id and receiver_id=new.blocked_id) or (sender_id=new.blocked_id and receiver_id=new.blocker_id));
 return new;
end $$;
drop trigger if exists on_frnxup_user_blocked on public.user_blocks;
create trigger on_frnxup_user_blocked after insert on public.user_blocks for each row execute function public.on_user_blocked();


-- Feed, posts, comments, reactions, bookmarks and statuses.
create policy posts_read on public.posts for select to anon, authenticated using(status='published' and (user_id=auth.uid() or visibility='public' or (visibility='friends' and are_friends(auth.uid(),user_id))) and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=user_id) or (b.blocker_id=user_id and b.blocked_id=auth.uid())));
create policy post_polls_read on public.post_polls for select to authenticated using(exists(select 1 from public.posts p where p.id=post_id and p.status='published' and (p.user_id=auth.uid() or p.visibility='public' or (p.visibility='friends' and are_friends(auth.uid(),p.user_id))) and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=p.user_id) or (b.blocker_id=p.user_id and b.blocked_id=auth.uid()))));
create policy post_polls_insert_own on public.post_polls for insert to authenticated with check(exists(select 1 from public.posts p where p.id=post_id and p.user_id=auth.uid() and p.status='published') and user_is_active(auth.uid()) and site_setting_enabled('posting_enabled',true) and site_setting_enabled('polls_enabled',true));
create policy poll_votes_read_own on public.poll_votes for select to authenticated using(user_id=auth.uid());
create policy poll_votes_insert_rpc_only on public.poll_votes for insert to authenticated with check(false);
create policy poll_votes_update_rpc_only on public.poll_votes for update to authenticated using(false) with check(false);
create policy poll_votes_delete_own on public.poll_votes for delete to authenticated using(user_id=auth.uid());
create policy posts_insert on public.posts for insert to authenticated with check(user_id=auth.uid() and user_is_active(auth.uid()) and site_setting_enabled('posting_enabled',true));
create policy posts_update_own on public.posts for update to authenticated using(user_id=auth.uid() and status='published' and user_is_active(auth.uid())) with check(user_id=auth.uid() and status='published' and user_is_active(auth.uid()));
create policy posts_delete_own on public.posts for delete to authenticated using(user_id=auth.uid());
create policy post_media_read on public.post_media for select to anon, authenticated using(exists(select 1 from public.posts p where p.id=post_id and p.status='published' and (p.user_id=auth.uid() or p.visibility='public' or (p.visibility='friends' and are_friends(auth.uid(),p.user_id))) and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=p.user_id) or (b.blocker_id=p.user_id and b.blocked_id=auth.uid()))));
create policy post_media_insert_own on public.post_media for insert to authenticated with check(exists(select 1 from public.posts p where p.id=post_id and p.user_id=auth.uid() and p.status='published' and user_is_active(auth.uid()) and site_setting_enabled('posting_enabled',true) and site_setting_enabled('uploads_enabled',true)));
create policy post_media_delete_own on public.post_media for delete to authenticated using(exists(select 1 from public.posts p where p.id=post_id and p.user_id=auth.uid()));
create policy comments_read on public.post_comments for select to anon, authenticated using(status in ('published','deleted') and exists(select 1 from public.posts p where p.id=post_id and p.status='published' and (p.user_id=auth.uid() or p.visibility='public' or (p.visibility='friends' and are_friends(auth.uid(),p.user_id))) and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=p.user_id) or (b.blocker_id=p.user_id and b.blocked_id=auth.uid()))));
create policy comments_insert on public.post_comments for insert to authenticated with check(user_id=auth.uid() and user_is_active(auth.uid()) and site_setting_enabled('posting_enabled',true) and site_setting_enabled('comments_enabled',true) and exists(select 1 from public.posts p where p.id=post_id and p.status='published' and (p.visibility='public' or p.user_id=auth.uid() or (p.visibility='friends' and are_friends(auth.uid(),p.user_id)))));
create policy comments_update on public.post_comments for update to authenticated using(user_id=auth.uid() and status='published' and user_is_active(auth.uid())) with check(user_id=auth.uid() and status in ('published','deleted') and user_is_active(auth.uid()));
create policy comment_reactions_read on public.comment_reactions for select to authenticated using(exists(select 1 from public.post_comments c join public.posts p on p.id=c.post_id where c.id=comment_id and c.status in ('published','deleted') and p.status='published' and (p.user_id=auth.uid() or p.visibility='public' or (p.visibility='friends' and are_friends(auth.uid(),p.user_id)))));
create policy comment_reactions_insert on public.comment_reactions for insert to authenticated with check(user_id=auth.uid() and user_is_active(auth.uid()) and site_setting_enabled('reactions_enabled',true) and exists(select 1 from public.post_comments c where c.id=comment_id and c.status='published'));
create policy comment_reactions_update on public.comment_reactions for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid() and exists(select 1 from public.post_comments c where c.id=comment_id and c.status='published'));
create policy comment_reactions_delete on public.comment_reactions for delete to authenticated using(user_id=auth.uid());
create policy comments_delete on public.post_comments for delete to authenticated using(user_id=auth.uid());
create policy reactions_read on public.post_reactions for select to authenticated using(exists(select 1 from public.posts p where p.id=post_id and p.status='published' and (p.visibility='public' or p.user_id=auth.uid() or (p.visibility='friends' and are_friends(auth.uid(),p.user_id)))));
create policy reactions_insert on public.post_reactions for insert to authenticated with check(user_id=auth.uid() and user_is_active(auth.uid()) and site_setting_enabled('reactions_enabled',true) and site_setting_enabled('posting_enabled',true) and exists(select 1 from public.posts p where p.id=post_id and p.status='published' and (p.user_id=auth.uid() or p.visibility='public' or (p.visibility='friends' and are_friends(auth.uid(),p.user_id)))));
create policy reactions_delete on public.post_reactions for delete to authenticated using(user_id=auth.uid());
create policy bookmarks_own on public.bookmarks for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy statuses_read on public.statuses for select to anon, authenticated using(expires_at>now() and (user_id=auth.uid() or visibility='public' or (visibility='friends' and are_friends(auth.uid(),user_id))) and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=user_id) or (b.blocker_id=user_id and b.blocked_id=auth.uid())));
create policy statuses_insert on public.statuses for insert to authenticated with check(user_id=auth.uid() and user_is_active(auth.uid()) and site_setting_enabled('statuses_enabled',true) and site_setting_enabled('posting_enabled',true));
create policy statuses_owner on public.statuses for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid() and user_is_active(auth.uid()));

-- Conversations and private/group messages. Conversation membership is checked for every read/write.
create policy conversations_read on public.conversations for select to authenticated using(is_conversation_member(id));
create policy conversations_insert on public.conversations for insert to authenticated with check(false); -- create conversations through the validated RPC only
create policy conversation_members_read on public.conversation_members for select to authenticated using(user_id=auth.uid() or is_conversation_member(conversation_id));
create policy conversation_members_insert on public.conversation_members for insert to authenticated with check(false); -- membership is created only by the validated create_conversation RPC
create policy conversation_members_delete on public.conversation_members for delete to authenticated using((user_id=auth.uid() and not exists(select 1 from public.conversations c where c.id=conversation_id and c.created_by=auth.uid())) or exists(select 1 from public.conversations c where c.id=conversation_id and c.created_by=auth.uid() and user_id<>c.created_by));
create policy messages_read on public.messages for select to authenticated using(is_conversation_member(conversation_id) and not exists(select 1 from public.conversation_members cm join public.user_blocks b on ((b.blocker_id=auth.uid() and b.blocked_id=cm.user_id) or (b.blocker_id=cm.user_id and b.blocked_id=auth.uid())) where cm.conversation_id=conversation_id and cm.user_id<>auth.uid()));
create policy messages_insert on public.messages for insert to authenticated with check(sender_id=auth.uid() and is_conversation_member(conversation_id) and exists(select 1 from public.conversations c where c.id=conversation_id and c.status='active' and (c.kind='dm' or site_setting_enabled('groups_enabled',true))) and user_is_active(auth.uid()) and site_setting_enabled('messaging_enabled',true) and not exists(select 1 from public.conversation_members cm join public.user_blocks b on ((b.blocker_id=auth.uid() and b.blocked_id=cm.user_id) or (b.blocker_id=cm.user_id and b.blocked_id=auth.uid())) where cm.conversation_id=conversation_id and cm.user_id<>auth.uid()));
create policy messages_update on public.messages for update to authenticated using(sender_id=auth.uid() and is_conversation_member(conversation_id)) with check(sender_id=auth.uid() and is_conversation_member(conversation_id));
create policy messages_delete on public.messages for delete to authenticated using(sender_id=auth.uid() and is_conversation_member(conversation_id));
create policy message_receipts_read on public.message_receipts for select to authenticated using(user_id=auth.uid() or exists(select 1 from public.messages m where m.id=message_id and m.sender_id=auth.uid()));
create policy message_receipts_insert on public.message_receipts for insert to authenticated with check(user_id=auth.uid() and exists(select 1 from public.messages m where m.id=message_id and m.sender_id<>auth.uid() and is_conversation_member(m.conversation_id)));
create policy message_receipts_update on public.message_receipts for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());

-- Rooms and room chat.
create policy rooms_read on public.rooms for select to anon, authenticated using(status='active' and (visibility='public' or is_room_member(id)));
create policy rooms_create on public.rooms for insert to authenticated with check(created_by=auth.uid() and user_is_active(auth.uid()) and site_setting_enabled('rooms_enabled',true));
create policy rooms_update on public.rooms for update to authenticated using(created_by=auth.uid() or is_moderator()) with check(created_by=auth.uid() or is_moderator());
create policy rooms_delete on public.rooms for delete to authenticated using(created_by=auth.uid() or is_admin());
create policy room_members_read on public.room_members for select to authenticated using(user_id=auth.uid() or is_room_member(room_id));
create policy room_members_join on public.room_members for insert to authenticated with check(user_id=auth.uid() and role='member' and status='pending' and user_is_active(auth.uid()) and site_setting_enabled('rooms_enabled',true));
create policy room_members_update on public.room_members for update to authenticated using(is_room_moderator(room_id) or is_admin()) with check(is_room_moderator(room_id) or is_admin());
create policy room_members_leave on public.room_members for delete to authenticated using((user_id=auth.uid() and role<>'owner') or (is_room_moderator(room_id) and role<>'owner') or is_admin());
create policy room_messages_read on public.room_messages for select to authenticated using(status='published' and is_room_member(room_id));
create policy room_messages_insert on public.room_messages for insert to authenticated with check(user_id=auth.uid() and user_is_active(auth.uid()) and is_room_member(room_id) and site_setting_enabled('rooms_enabled',true));
create policy room_messages_update on public.room_messages for update to authenticated using((user_id=auth.uid() and status='published') or is_room_moderator(room_id) or is_admin()) with check((user_id=auth.uid() and status='published') or is_room_moderator(room_id) or is_admin());

-- Notifications, reports, appeals and verification applications.
create policy notifications_read on public.notifications for select to authenticated using(user_id=auth.uid());
create policy notifications_update on public.notifications for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy reports_insert on public.reports for insert to authenticated with check(reporter_id=auth.uid());
create policy reports_read on public.reports for select to authenticated using(reporter_id=auth.uid() or is_moderator());
create policy reports_update on public.reports for update to authenticated using(is_moderator()) with check(is_moderator());
create policy verification_own_read on public.verification_requests for select to authenticated using(user_id=auth.uid() or is_admin());
create policy verification_own_insert on public.verification_requests for insert to authenticated with check(user_id=auth.uid());
create policy verification_admin_update on public.verification_requests for update to authenticated using(is_admin()) with check(is_admin());
create policy appeals_own_read on public.account_appeals for select to authenticated using(user_id=auth.uid() or is_moderator());
create policy appeals_own_insert on public.account_appeals for insert to authenticated with check(user_id=auth.uid());
create policy appeals_admin_update on public.account_appeals for update to authenticated using(is_admin()) with check(is_admin());
create policy settings_read on public.site_settings for select to anon, authenticated using(true);
grant select on public.site_settings to anon, authenticated;
create policy settings_owner_write on public.site_settings for all to authenticated using(is_owner()) with check(is_owner());
create policy audit_admin_read on public.admin_audit_logs for select to authenticated using(is_admin());
create policy site_activity_admin_read on public.site_activity_logs for select to authenticated using(is_moderator());



-- Central activity stream: authenticated page views plus automatic records for all key data mutations.
create or replace function public.frnxup_log_activity(
  p_action text, p_entity_type text default null, p_entity_id text default null, p_details jsonb default '{}'::jsonb
) returns boolean language plpgsql security definer set search_path=public
as $$
declare safe_action text := lower(coalesce(p_action,''));
begin
  if auth.uid() is null then return false; end if;
  if safe_action not in ('page_view','search','profile_view','sign_in','sign_out','interaction') then
    raise exception 'Unsupported activity type';
  end if;
  insert into public.site_activity_logs(actor_id,action,entity_type,entity_id,details)
  values(auth.uid(),safe_action,left(p_entity_type,48),left(p_entity_id,160),
    case when jsonb_typeof(p_details)='object' then p_details - 'password' - 'token' - 'email' - 'phone' else '{}'::jsonb end);
  return true;
end $$;
revoke all on function public.frnxup_log_activity(text,text,text,jsonb) from public;
grant execute on function public.frnxup_log_activity(text,text,text,jsonb) to authenticated;

create or replace function public.frnxup_capture_activity()
returns trigger language plpgsql security definer set search_path=public
as $$
declare row_data jsonb; actor uuid; entity text; details jsonb := jsonb_build_object('operation',lower(TG_OP)); k text;
begin
  if TG_OP='DELETE' then row_data:=to_jsonb(OLD); else row_data:=to_jsonb(NEW); end if;
  actor:=auth.uid();
  if actor is null and coalesce(auth.role(),'')<>'service_role' then
    actor:=coalesce(nullif(row_data->>'user_id','')::uuid,nullif(row_data->>'sender_id','')::uuid,
      nullif(row_data->>'created_by','')::uuid,nullif(row_data->>'reporter_id','')::uuid,
      nullif(row_data->>'blocker_id','')::uuid,nullif(row_data->>'receiver_id','')::uuid);
    if actor is null and TG_TABLE_NAME='profiles' then actor:=nullif(row_data->>'id','')::uuid; end if;
  end if;
  if actor is null then
    if TG_OP='DELETE' then return OLD; else return NEW; end if;
  end if;
  entity:=coalesce(row_data->>'id',row_data->>'conversation_id',row_data->>'post_id',row_data->>'room_id',row_data->>'profile_id',row_data->>'user_id');
  if row_data ? 'user_a' then entity:=concat_ws(':',row_data->>'user_a',row_data->>'user_b'); end if;
  if row_data ? 'user_id' and row_data ? 'conversation_id' then entity:=concat_ws(':',row_data->>'conversation_id',row_data->>'user_id'); end if;
  if row_data ? 'user_id' and row_data ? 'room_id' then entity:=concat_ws(':',row_data->>'room_id',row_data->>'user_id'); end if;
  foreach k in array array['status','visibility','kind','role','category','type'] loop
    if row_data ? k then details:=details||jsonb_build_object(k,row_data->k); end if;
  end loop;
  insert into public.site_activity_logs(actor_id,action,entity_type,entity_id,details)
  values(actor,lower(TG_TABLE_NAME)||'_'||lower(TG_OP),TG_TABLE_NAME,entity,details);
  if TG_OP='DELETE' then return OLD; else return NEW; end if;
end $$;

-- Track user-generated activity while deliberately excluding message/post body text and credentials.
do $$ declare t text; begin
  foreach t in array array['profiles','profile_details','profile_locations','post_media','friend_requests','friendships','user_blocks','posts','post_polls','poll_votes','post_comments','comment_reactions','post_reactions','bookmarks','statuses','conversations','conversation_members','messages','message_receipts','rooms','room_members','room_messages','notifications','reports','verification_requests','account_appeals'] loop
    execute format('drop trigger if exists frnxup_activity_capture on public.%I',t);
    execute format('create trigger frnxup_activity_capture after insert or update or delete on public.%I for each row execute function public.frnxup_capture_activity()',t);
  end loop;
end $$;

revoke select on public.profiles from anon;
grant select (id,username,display_name,bio,avatar_path,cover_path,profile_visibility,account_status,is_verified,created_at) on public.profiles to anon;
grant select on public.profiles to authenticated;
grant select on public.profile_details, public.profile_locations, public.posts, public.post_media, public.post_comments, public.statuses, public.rooms to anon, authenticated;
grant insert, delete on public.post_media to authenticated;
grant select on public.site_activity_logs to authenticated;

-- Seed essential site-wide switches. Admin dashboard can change these securely via its Edge Function.
insert into public.site_settings(key,value) values
('registration_enabled','true'::jsonb),('posting_enabled','true'::jsonb),('comments_enabled','true'::jsonb),('reactions_enabled','true'::jsonb),('polls_enabled','true'::jsonb),('statuses_enabled','true'::jsonb),('friend_requests_enabled','true'::jsonb),('messaging_enabled','true'::jsonb),('groups_enabled','true'::jsonb),('rooms_enabled','true'::jsonb),('uploads_enabled','true'::jsonb),('maintenance_mode','false'::jsonb)
on conflict(key) do nothing;

-- Private media bucket. Storage policies let users access media referenced by visible posts/statuses/chats.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('frnxup-media','frnxup-media',false,104857600,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','audio/mpeg','audio/mp4','audio/webm','audio/ogg'])
on conflict(id) do update set public=false,file_size_limit=104857600;
drop policy if exists frnxup_media_upload_own on storage.objects;
drop policy if exists frnxup_media_read_allowed on storage.objects;
drop policy if exists frnxup_media_delete_own on storage.objects;
create policy frnxup_media_upload_own on storage.objects for insert to authenticated with check(bucket_id='frnxup-media' and split_part(name,'/',1)=auth.uid()::text and public.site_setting_enabled('uploads_enabled',true));
create policy frnxup_media_read_allowed on storage.objects for select to anon, authenticated using(bucket_id='frnxup-media' and (
 split_part(name,'/',1)=auth.uid()::text or
 exists(select 1 from public.profiles p where (p.avatar_path=name or p.cover_path=name) and (p.id=auth.uid() or p.profile_visibility='public' or (p.profile_visibility='friends' and public.are_friends(auth.uid(),p.id))) and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=p.id) or (b.blocker_id=p.id and b.blocked_id=auth.uid()))) or
 exists(select 1 from public.posts p where p.media_path=name and p.status='published' and (p.visibility='public' or p.user_id=auth.uid() or (p.visibility='friends' and are_friends(auth.uid(),p.user_id))) and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=p.user_id) or (b.blocker_id=p.user_id and b.blocked_id=auth.uid()))) or
 exists(select 1 from public.post_media pm join public.posts p on p.id=pm.post_id where pm.media_path=name and p.status='published' and (p.visibility='public' or p.user_id=auth.uid() or (p.visibility='friends' and are_friends(auth.uid(),p.user_id))) and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=p.user_id) or (b.blocker_id=p.user_id and b.blocked_id=auth.uid()))) or
 exists(select 1 from public.statuses s where s.media_path=name and s.expires_at>now() and (s.user_id=auth.uid() or s.visibility='public' or (s.visibility='friends' and are_friends(auth.uid(),s.user_id))) and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=s.user_id) or (b.blocker_id=s.user_id and b.blocked_id=auth.uid()))) or
 exists(select 1 from public.messages m where m.media_path=name and is_conversation_member(m.conversation_id) and not exists(select 1 from public.conversation_members cm join public.user_blocks b on ((b.blocker_id=auth.uid() and b.blocked_id=cm.user_id) or (b.blocker_id=cm.user_id and b.blocked_id=auth.uid())) where cm.conversation_id=m.conversation_id and cm.user_id<>auth.uid())) or
 exists(select 1 from public.verification_requests v where v.evidence_path=name and is_admin())
));
create policy frnxup_media_delete_own on storage.objects for delete to authenticated using(bucket_id='frnxup-media' and split_part(name,'/',1)=auth.uid()::text);

-- Enable realtime for chat tables in Supabase Realtime publication (ignore if already included).
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.room_messages;
exception when duplicate_object then null; when undefined_object then null; end $$;

grant execute on function public.respond_friend_request(uuid,boolean) to authenticated;
grant execute on function public.create_conversation(text,text,uuid[]) to authenticated;
grant execute on function public.join_room(uuid) to authenticated;
grant execute on function public.manage_group_member(uuid,uuid,text) to authenticated;
grant execute on function public.invite_room_member(uuid,uuid) to authenticated;
grant execute on function public.site_setting_enabled(text,boolean) to anon, authenticated;
grant execute on function public.are_friends(uuid,uuid) to authenticated;
grant execute on function public.frnxup_friend_suggestions(integer) to authenticated;
grant execute on function public.frnxup_profile_friends(uuid) to authenticated;
grant execute on function public.frnxup_vote_poll(uuid,integer) to authenticated;
grant execute on function public.frnxup_poll_results(uuid[]) to authenticated;
grant select,insert,update,delete on public.comment_reactions to authenticated;

-- OWNER BOOTSTRAP: after signing up once, run manually with your own Auth user UUID:
-- update public.profiles set role='owner' where id='YOUR-AUTH-USER-UUID';
-- Never allow self-service role changes. Keep the owner UUID private.


-- Fresh database installs also receive the Pages feature.
-- FRNXUP Pages feature: multiple independently managed public identities per member.
create table if not exists public.frnxup_pages (
 id uuid primary key default gen_random_uuid(),
 owner_user_id uuid not null references public.profiles(id) on delete cascade,
 name text not null check(char_length(name) between 2 and 80),
 slug text not null unique check(slug ~ '^[a-z0-9-]{3,40}$'),
 category text not null default 'Other' check(char_length(category)<=80),
 about text not null default '' check(char_length(about)<=3000),
 avatar_path text,
 cover_path text,
 location text,
 website text,
 follower_count_visible boolean not null default true,
 status text not null default 'active' check(status in ('active','suspended','removed')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists frnxup_pages_owner_idx on public.frnxup_pages(owner_user_id,created_at desc);
create index if not exists frnxup_pages_status_idx on public.frnxup_pages(status,created_at desc);

alter table public.posts add column if not exists page_id uuid references public.frnxup_pages(id) on delete set null;
create index if not exists posts_page_feed_idx on public.posts(page_id,status,created_at desc) where page_id is not null;

create table if not exists public.frnxup_page_followers (
 page_id uuid not null references public.frnxup_pages(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(page_id,user_id)
);
create index if not exists frnxup_page_followers_user_idx on public.frnxup_page_followers(user_id,created_at desc);

create table if not exists public.frnxup_page_invitations (
 id uuid primary key default gen_random_uuid(),
 page_id uuid not null references public.frnxup_pages(id) on delete cascade,
 invited_user_id uuid not null references public.profiles(id) on delete cascade,
 invited_by uuid not null references public.profiles(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','accepted','declined')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(page_id,invited_user_id)
);
create index if not exists frnxup_page_invites_user_idx on public.frnxup_page_invitations(invited_user_id,status,created_at desc);

-- Invitation recipients may only accept or decline their own pending invite.
-- Page owners may re-send a prior invite, but cannot rewrite its identity fields.
create or replace function public.frnxup_guard_page_invitation()
returns trigger language plpgsql set search_path=public as $$
begin
 if new.page_id is distinct from old.page_id
    or new.invited_user_id is distinct from old.invited_user_id
    or new.invited_by is distinct from old.invited_by then
  raise exception 'Page invitation identity fields cannot be changed.';
 end if;
 if auth.uid()=old.invited_user_id then
  if old.status<>'pending' or new.status not in ('accepted','declined') then
   raise exception 'Only a pending invitation can be accepted or declined by its recipient.';
  end if;
 elsif public.frnxup_owns_page(old.page_id) then
  if new.status<>'pending' then
   raise exception 'Only the invited member can respond to a Page invitation.';
  end if;
 else
  raise exception 'You cannot modify this Page invitation.';
 end if;
 new.updated_at:=now();
 return new;
end $$;
drop trigger if exists frnxup_guard_page_invitation_trigger on public.frnxup_page_invitations;
create trigger frnxup_guard_page_invitation_trigger before update on public.frnxup_page_invitations for each row execute function public.frnxup_guard_page_invitation();

create or replace function public.frnxup_owns_page(p_page_id uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.frnxup_pages p where p.id=p_page_id and p.owner_user_id=auth.uid()) $$;
create or replace function public.frnxup_is_page_follower(p_page_id uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.frnxup_page_followers f where f.page_id=p_page_id and f.user_id=auth.uid()) $$;
create or replace function public.frnxup_page_follower_count(p_page_id uuid)
returns bigint language plpgsql stable security definer set search_path=public
as $$ declare visible boolean; owner_id uuid; total bigint; begin
 select follower_count_visible,owner_user_id into visible,owner_id from public.frnxup_pages where id=p_page_id and status='active';
 if not found then return null; end if;
 if not coalesce(visible,false) and owner_id is distinct from auth.uid() then return null; end if;
 select count(*) into total from public.frnxup_page_followers where page_id=p_page_id;
 return total;
end $$;
revoke all on function public.frnxup_owns_page(uuid) from public;
revoke all on function public.frnxup_is_page_follower(uuid) from public;
revoke all on function public.frnxup_page_follower_count(uuid) from public;
grant execute on function public.frnxup_owns_page(uuid) to anon,authenticated;
grant execute on function public.frnxup_is_page_follower(uuid) to anon,authenticated;
grant execute on function public.frnxup_page_follower_count(uuid) to anon,authenticated;

create or replace function public.frnxup_protect_page_fields()
returns trigger language plpgsql set search_path=public as $$
begin
 if new.owner_user_id is distinct from old.owner_user_id then raise exception 'Page ownership cannot be transferred by a page editor.'; end if;
 if new.status is distinct from old.status and coalesce(auth.role(),'') not in ('service_role','postgres') and not public.is_admin() then raise exception 'Only Frnxup administrators can change Page status.'; end if;
 new.updated_at:=now(); return new;
end $$;
drop trigger if exists frnxup_page_protect on public.frnxup_pages;
create trigger frnxup_page_protect before update on public.frnxup_pages for each row execute function public.frnxup_protect_page_fields();

create or replace function public.frnxup_guard_page_post()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.page_id is not null then
  if new.user_id is distinct from auth.uid() then raise exception 'Page posts must be created by the signed-in page owner.'; end if;
  if not exists(select 1 from public.frnxup_pages p where p.id=new.page_id and p.owner_user_id=auth.uid() and p.status='active') then raise exception 'You do not manage this active Frnxup Page.'; end if;
 end if;
 return new;
end $$;
drop trigger if exists frnxup_guard_page_post_trigger on public.posts;
create trigger frnxup_guard_page_post_trigger before insert or update of page_id,user_id on public.posts for each row execute function public.frnxup_guard_page_post();

alter table public.frnxup_pages enable row level security;
alter table public.frnxup_page_followers enable row level security;
alter table public.frnxup_page_invitations enable row level security;

drop policy if exists frnxup_pages_public_read on public.frnxup_pages;
create policy frnxup_pages_public_read on public.frnxup_pages for select to anon,authenticated using(status='active' or owner_user_id=auth.uid() or public.is_moderator());
drop policy if exists frnxup_pages_insert_own on public.frnxup_pages;
create policy frnxup_pages_insert_own on public.frnxup_pages for insert to authenticated with check(owner_user_id=auth.uid() and status='active' and public.user_is_active(auth.uid()));
drop policy if exists frnxup_pages_update_own on public.frnxup_pages;
create policy frnxup_pages_update_own on public.frnxup_pages for update to authenticated using(owner_user_id=auth.uid() and status='active') with check(owner_user_id=auth.uid() and status='active');
drop policy if exists frnxup_pages_delete_own on public.frnxup_pages;
revoke delete on public.frnxup_pages from authenticated;
grant select on public.frnxup_pages to anon,authenticated;
grant insert,update on public.frnxup_pages to authenticated;

drop policy if exists frnxup_page_followers_read on public.frnxup_page_followers;
create policy frnxup_page_followers_read on public.frnxup_page_followers for select to authenticated using(user_id=auth.uid() or public.frnxup_owns_page(page_id) or public.is_moderator());
drop policy if exists frnxup_page_followers_insert on public.frnxup_page_followers;
create policy frnxup_page_followers_insert on public.frnxup_page_followers for insert to authenticated with check(user_id=auth.uid() and not public.frnxup_owns_page(page_id) and exists(select 1 from public.frnxup_pages p where p.id=frnxup_page_followers.page_id and p.status='active') and public.user_is_active(auth.uid()));
drop policy if exists frnxup_page_followers_delete on public.frnxup_page_followers;
create policy frnxup_page_followers_delete on public.frnxup_page_followers for delete to authenticated using(user_id=auth.uid() or public.frnxup_owns_page(page_id) or public.is_moderator());
grant select,insert,delete on public.frnxup_page_followers to authenticated;

drop policy if exists frnxup_page_invites_read on public.frnxup_page_invitations;
create policy frnxup_page_invites_read on public.frnxup_page_invitations for select to authenticated using(invited_user_id=auth.uid() or public.frnxup_owns_page(page_id) or public.is_moderator());
drop policy if exists frnxup_page_invites_insert on public.frnxup_page_invitations;
create policy frnxup_page_invites_insert on public.frnxup_page_invitations for insert to authenticated with check(invited_by=auth.uid() and public.frnxup_owns_page(page_id) and invited_user_id<>auth.uid());
drop policy if exists frnxup_page_invites_update on public.frnxup_page_invitations;
create policy frnxup_page_invites_update on public.frnxup_page_invitations for update to authenticated using(invited_user_id=auth.uid() or public.frnxup_owns_page(page_id)) with check(invited_user_id=auth.uid() or public.frnxup_owns_page(page_id));
grant select,insert,update on public.frnxup_page_invitations to authenticated;

-- Page posts use the member's account as the actor, but the Page as the public identity.
drop policy if exists posts_read on public.posts;
create policy posts_read on public.posts for select to anon,authenticated using(
 status='published' and (
  (page_id is null and (user_id=auth.uid() or visibility='public' or (visibility='friends' and public.are_friends(auth.uid(),user_id))) and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=user_id) or (b.blocker_id=user_id and b.blocked_id=auth.uid())))
  or (page_id is not null and exists(select 1 from public.frnxup_pages p where p.id=page_id and p.status='active' and (visibility='public' or p.owner_user_id=auth.uid() or public.frnxup_is_page_follower(p.id))))
 )
);
drop policy if exists posts_insert on public.posts;
create policy posts_insert on public.posts for insert to authenticated with check(user_id=auth.uid() and user_is_active(auth.uid()) and site_setting_enabled('posting_enabled',true) and (page_id is null or public.frnxup_owns_page(page_id)));
drop policy if exists posts_update_own on public.posts;
create policy posts_update_own on public.posts for update to authenticated using(user_id=auth.uid() and status='published' and (page_id is null or public.frnxup_owns_page(page_id)) and user_is_active(auth.uid())) with check(user_id=auth.uid() and status='published' and (page_id is null or public.frnxup_owns_page(page_id)) and user_is_active(auth.uid()));
drop policy if exists posts_delete_own on public.posts;
create policy posts_delete_own on public.posts for delete to authenticated using(user_id=auth.uid() and (page_id is null or public.frnxup_owns_page(page_id)));

-- Page avatar and cover media are visible with an active public Page.
drop policy if exists frnxup_page_media_read on storage.objects;
create policy frnxup_page_media_read on storage.objects for select to anon,authenticated using(bucket_id='frnxup-media' and exists(select 1 from public.frnxup_pages p where (p.avatar_path=name or p.cover_path=name) and p.status='active'));

-- Notify page owner when a new follower arrives.
create or replace function public.frnxup_notify_page_follow()
returns trigger language plpgsql security definer set search_path=public as $$
declare owner_id uuid; page_name text;
begin
 select owner_user_id,name into owner_id,page_name from public.frnxup_pages where id=new.page_id;
 if owner_id is not null and owner_id<>new.user_id then
  insert into public.notifications(user_id,actor_id,type,title,body,target_type,target_id)
  values(owner_id,new.user_id,'page_follow','New Page follower',coalesce((select display_name from public.profiles where id=new.user_id),'Someone')||' followed '||coalesce(page_name,'your Page'),'page',new.page_id);
 end if;
 return new;
end $$;
drop trigger if exists frnxup_page_follow_notify on public.frnxup_page_followers;
create trigger frnxup_page_follow_notify after insert on public.frnxup_page_followers for each row execute function public.frnxup_notify_page_follow();

-- Extend shared activity capture so page follower rows point to the Page, and
-- the page id is retained as safe metadata for Page-post actions.
create or replace function public.frnxup_capture_activity()
returns trigger language plpgsql security definer set search_path=public
as $$
declare row_data jsonb; actor uuid; entity text; details jsonb := jsonb_build_object('operation',lower(TG_OP)); k text;
begin
 if TG_OP='DELETE' then row_data:=to_jsonb(OLD); else row_data:=to_jsonb(NEW); end if;
 actor:=auth.uid();
 if actor is null and coalesce(auth.role(),'')<>'service_role' then
  actor:=coalesce(nullif(row_data->>'user_id','')::uuid,nullif(row_data->>'sender_id','')::uuid,
    nullif(row_data->>'created_by','')::uuid,nullif(row_data->>'owner_user_id','')::uuid,
    nullif(row_data->>'reporter_id','')::uuid,nullif(row_data->>'blocker_id','')::uuid,
    nullif(row_data->>'receiver_id','')::uuid,nullif(row_data->>'invited_by','')::uuid);
  if actor is null and TG_TABLE_NAME='profiles' then actor:=nullif(row_data->>'id','')::uuid; end if;
 end if;
 if actor is null then if TG_OP='DELETE' then return OLD; else return NEW; end if; end if;
 entity:=coalesce(row_data->>'id',row_data->>'conversation_id',row_data->>'post_id',row_data->>'room_id',row_data->>'profile_id',row_data->>'page_id',row_data->>'user_id');
 if row_data ? 'user_a' then entity:=concat_ws(':',row_data->>'user_a',row_data->>'user_b'); end if;
 if row_data ? 'user_id' and row_data ? 'conversation_id' then entity:=concat_ws(':',row_data->>'conversation_id',row_data->>'user_id'); end if;
 if row_data ? 'user_id' and row_data ? 'room_id' then entity:=concat_ws(':',row_data->>'room_id',row_data->>'user_id'); end if;
 foreach k in array array['status','visibility','kind','role','category','type','page_id'] loop
  if row_data ? k then details:=details||jsonb_build_object(k,row_data->k); end if;
 end loop;
 insert into public.site_activity_logs(actor_id,action,entity_type,entity_id,details)
 values(actor,lower(TG_TABLE_NAME)||'_'||lower(TG_OP),TG_TABLE_NAME,entity,details);
 if TG_OP='DELETE' then return OLD; else return NEW; end if;
end $$;

-- Central admin activity stream captures page creation, edits, follows, invitations and page posts.
do $$ declare t text; begin
 foreach t in array array['frnxup_pages','frnxup_page_followers','frnxup_page_invitations'] loop
  execute format('drop trigger if exists frnxup_activity_capture on public.%I',t);
  execute format('create trigger frnxup_activity_capture after insert or update or delete on public.%I for each row execute function public.frnxup_capture_activity()',t);
 end loop;
end $$;
