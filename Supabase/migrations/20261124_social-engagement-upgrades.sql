-- Frnxup Social Engagement Upgrades — 24 November 2026
-- Apply after the existing Frnxup schema and page-post migrations.
-- Adds activity notifications, birthday/memory reminders and a private close-circle ranking.

alter table public.profile_details
  add column if not exists birthday_visibility text not null default 'friends',
  add column if not exists activity_notifications_enabled boolean not null default true,
  add column if not exists close_circle_enabled boolean not null default true;

alter table public.profile_details
  drop constraint if exists profile_details_birthday_visibility_check;
alter table public.profile_details
  add constraint profile_details_birthday_visibility_check
  check (birthday_visibility in ('private','friends','public'));

-- The base schema granted SELECT only; the upgraded profile settings need safe
-- self-row writes governed by the existing profile_details_write RLS policy.
grant select,insert,update on public.profile_details to authenticated;

-- Private deduplication ledger. Clients cannot read or modify this table.
create table if not exists public.frnxup_reminder_events (
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  subject_user_id uuid not null references public.profiles(id) on delete cascade,
  event_kind text not null check (event_kind in ('birthday_self','birthday_friend','memory_monthly','memory_yearly')),
  event_key text not null,
  target_id uuid,
  created_at timestamptz not null default now(),
  primary key(recipient_id, subject_user_id, event_kind, event_key)
);
alter table public.frnxup_reminder_events enable row level security;
revoke all on public.frnxup_reminder_events from anon, authenticated;

-- Send new post/status/upload notifications to accepted friends (and Page followers
-- for Page posts), rather than broadcasting every action to the entire platform.
create or replace function public.frnxup_notify_social_activity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid;
  target_id uuid;
  target_type text;
  visibility_value text;
  notification_type text;
  notification_title text;
  notification_body text;
  page_id_value uuid;
  room_id_value uuid;
begin
  if TG_TABLE_NAME = 'posts' then
    actor_id := new.user_id;
    target_id := new.id;
    target_type := 'post';
    visibility_value := new.visibility;
    page_id_value := new.page_id;
    if new.status <> 'published' or visibility_value = 'only_me' then return new; end if;
    if new.media_path is not null then
      notification_type := 'new_upload';
      notification_title := 'New photo or video';
      notification_body := 'shared a new photo or video.';
    else
      notification_type := 'new_post';
      notification_title := 'New post';
      notification_body := 'shared a new post.';
    end if;
  elsif TG_TABLE_NAME = 'statuses' then
    actor_id := new.user_id;
    target_id := new.id;
    target_type := 'status';
    visibility_value := new.visibility;
    if new.expires_at <= now() then return new; end if;
    if new.media_path is not null then
      notification_type := 'new_upload';
      notification_title := 'New status upload';
      notification_body := 'shared a photo or video in a status.';
    else
      notification_type := 'new_status';
      notification_title := 'New status';
      notification_body := 'shared a new status.';
    end if;
  elsif TG_TABLE_NAME = 'post_media' then
    if new.sort_order <> 1 then return new; end if;
    select p.user_id,p.id,p.visibility,p.page_id,p.media_path
      into actor_id,target_id,visibility_value,page_id_value,notification_body
    from public.posts p where p.id=new.post_id and p.status='published';
    if actor_id is null or visibility_value='only_me' or notification_body is not null then return new; end if;
    target_type := 'post';
    notification_type := 'new_upload';
    notification_title := 'New photo or video';
    notification_body := 'shared a new photo or video.';
  elsif TG_TABLE_NAME = 'room_messages' then
    actor_id := new.user_id;
    target_id := new.room_id;
    target_type := 'room';
    room_id_value := new.room_id;
    if new.status <> 'published' then return new; end if;
    notification_type := 'room_activity';
    notification_title := 'New activity in a room';
    notification_body := 'posted a new message in a room you belong to.';
  elsif TG_TABLE_NAME = 'profiles' then
    actor_id := new.id;
    target_id := new.id;
    target_type := 'profile';
    if new.avatar_path is distinct from old.avatar_path then
      notification_type := 'profile_photo';
      notification_title := 'New profile photo';
      notification_body := 'updated their profile picture.';
    elsif new.cover_path is distinct from old.cover_path then
      notification_type := 'profile_cover';
      notification_title := 'New cover photo';
      notification_body := 'updated their cover photo.';
    else
      return new;
    end if;
  else
    return new;
  end if;

  if actor_id is null then return new; end if;

  insert into public.notifications(user_id,actor_id,type,title,body,target_type,target_id)
  select distinct recipient_id,actor_id,notification_type,notification_title,notification_body,target_type,target_id
  from (
    select case when f.user_a=actor_id then f.user_b else f.user_a end as recipient_id
    from public.friendships f
    where TG_TABLE_NAME <> 'room_messages' and actor_id in (f.user_a,f.user_b)
    union
    select pf.user_id as recipient_id
    from public.frnxup_page_followers pf
    where TG_TABLE_NAME='posts' and page_id_value is not null and pf.page_id=page_id_value
    union
    select rm.user_id as recipient_id
    from public.room_members rm
    where TG_TABLE_NAME='room_messages' and room_id_value is not null and rm.room_id=room_id_value and rm.status='active'
  ) audience
  join public.profiles recipient on recipient.id=audience.recipient_id and recipient.account_status='active'
  left join public.profile_details preferences on preferences.profile_id=recipient.id
  where recipient_id<>actor_id
    and coalesce(preferences.activity_notifications_enabled,true)
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_id=actor_id and b.blocked_id=recipient_id)
         or (b.blocker_id=recipient_id and b.blocked_id=actor_id)
    );

  return new;
end $$;

drop trigger if exists frnxup_notify_new_post on public.posts;
create trigger frnxup_notify_new_post after insert on public.posts
for each row execute function public.frnxup_notify_social_activity();

drop trigger if exists frnxup_notify_new_status on public.statuses;
create trigger frnxup_notify_new_status after insert on public.statuses
for each row execute function public.frnxup_notify_social_activity();

drop trigger if exists frnxup_notify_first_post_media on public.post_media;
create trigger frnxup_notify_first_post_media after insert on public.post_media
for each row execute function public.frnxup_notify_social_activity();

drop trigger if exists frnxup_notify_profile_photo on public.profiles;
create trigger frnxup_notify_profile_photo after update of avatar_path,cover_path on public.profiles
for each row execute function public.frnxup_notify_social_activity();

drop trigger if exists frnxup_notify_room_activity on public.room_messages;
create trigger frnxup_notify_room_activity after insert on public.room_messages
for each row execute function public.frnxup_notify_social_activity();

create or replace function public.frnxup_clear_cancelled_friend_request_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status='pending' then
    update public.notifications
    set read_at=coalesce(read_at,now())
    where user_id=old.receiver_id and actor_id=old.sender_id
      and type='friend_request' and read_at is null;
  end if;
  return old;
end $$;
drop trigger if exists frnxup_clear_cancelled_friend_request_notification on public.friend_requests;
create trigger frnxup_clear_cancelled_friend_request_notification after delete on public.friend_requests
for each row execute function public.frnxup_clear_cancelled_friend_request_notification();

-- Run when a signed-in member opens Frnxup. It is idempotent per local calendar day.
-- Birthday details are never exposed through a public feed automatically.
create or replace function public.frnxup_check_social_reminders()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_birth date;
  v_friend record;
  v_memory record;
  v_added integer := 0;
begin
  if v_uid is null or not public.user_is_active(v_uid) then
    return jsonb_build_object('ok',false,'reason','authentication_required');
  end if;

  select birth_date into v_birth from public.profile_details where profile_id=v_uid;
  if v_birth is not null
     and extract(month from v_birth)=extract(month from v_today)
     and extract(day from v_birth)=extract(day from v_today) then
    insert into public.frnxup_reminder_events(recipient_id,subject_user_id,event_kind,event_key)
    values(v_uid,v_uid,'birthday_self',v_today::text)
    on conflict do nothing;
    if found then
      insert into public.notifications(user_id,actor_id,type,title,body,target_type,target_id)
      values(v_uid,v_uid,'birthday_self','Happy birthday!','A little birthday celebration is waiting for you. Add flowers, celebrate your day, and choose whether to share a birthday post with the public feed.','profile',v_uid);
      v_added:=v_added+1;
    end if;
  end if;

  for v_friend in
    select p.id,p.display_name,p.username,d.birth_date
    from public.friendships f
    join public.profiles p on p.id=case when f.user_a=v_uid then f.user_b else f.user_a end
    join public.profile_details d on d.profile_id=p.id
    where v_uid in (f.user_a,f.user_b)
      and p.account_status='active'
      and d.birth_date is not null
      and d.birthday_visibility in ('friends','public')
      and extract(month from d.birth_date)=extract(month from v_today)
      and extract(day from d.birth_date)=extract(day from v_today)
      and not exists(select 1 from public.user_blocks b where (b.blocker_id=v_uid and b.blocked_id=p.id) or (b.blocker_id=p.id and b.blocked_id=v_uid))
  loop
    insert into public.frnxup_reminder_events(recipient_id,subject_user_id,event_kind,event_key)
    values(v_uid,v_friend.id,'birthday_friend',v_today::text)
    on conflict do nothing;
    if found then
      insert into public.notifications(user_id,actor_id,type,title,body,target_type,target_id)
      values(v_uid,v_friend.id,'birthday_friend','Birthday today',coalesce(v_friend.display_name,v_friend.username,'Your friend')||' is celebrating a birthday today. Send them warm wishes!','profile',v_friend.id);
      v_added:=v_added+1;
    end if;
  end loop;

  for v_memory in
    select p.id,p.created_at,
      case when extract(month from (p.created_at at time zone 'Africa/Lagos'))=extract(month from v_today)
           then 'memory_yearly' else 'memory_monthly' end as memory_kind
    from public.posts p
    where p.user_id=v_uid and p.status='published' and p.page_id is null
      and (p.created_at at time zone 'Africa/Lagos')::date < v_today
      and extract(day from (p.created_at at time zone 'Africa/Lagos'))=extract(day from v_today)
      and (p.created_at at time zone 'Africa/Lagos')::date >= (v_today - interval '12 months')::date
    order by p.created_at desc
    limit 20
  loop
    insert into public.frnxup_reminder_events(recipient_id,subject_user_id,event_kind,event_key,target_id)
    values(v_uid,v_uid,v_memory.memory_kind,v_today::text,v_memory.id)
    on conflict do nothing;
    if found then
      insert into public.notifications(user_id,actor_id,type,title,body,target_type,target_id)
      values(v_uid,v_uid,v_memory.memory_kind,
        case when v_memory.memory_kind='memory_yearly' then 'A yearly memory from your feed' else 'A monthly memory from your feed' end,
        'Revisit a post you shared on this day. Open Memories to see the original moment.','memory',v_memory.id);
      v_added:=v_added+1;
    end if;
  end loop;

  return jsonb_build_object('ok',true,'created',v_added,'checked_on',v_today);
end $$;
revoke all on function public.frnxup_check_social_reminders() from public, anon;
grant execute on function public.frnxup_check_social_reminders() to authenticated;

create or replace function public.frnxup_my_memories(p_limit integer default 40)
returns table(id uuid,body text,media_path text,media_type text,created_at timestamptz,memory_kind text)
language sql
stable
security invoker
set search_path = public
as $$
  select p.id,p.body,p.media_path,p.media_type,p.created_at,
    case when extract(month from (p.created_at at time zone 'Africa/Lagos'))=extract(month from (now() at time zone 'Africa/Lagos'))
         then 'yearly' else 'monthly' end as memory_kind
  from public.posts p
  where p.user_id=auth.uid() and p.status='published' and p.page_id is null
    and (p.created_at at time zone 'Africa/Lagos')::date < (now() at time zone 'Africa/Lagos')::date
    and extract(day from (p.created_at at time zone 'Africa/Lagos'))=extract(day from (now() at time zone 'Africa/Lagos'))
    and (p.created_at at time zone 'Africa/Lagos')::date >= ((now() at time zone 'Africa/Lagos')::date - interval '12 months')::date
  order by p.created_at desc
  limit greatest(1,least(coalesce(p_limit,40),100));
$$;
revoke all on function public.frnxup_my_memories(integer) from public, anon;
grant execute on function public.frnxup_my_memories(integer) to authenticated;

-- Private, explainable close-circle ranking. It ranks accepted friends from recent,
-- reciprocal comments/reactions and direct-message activity. It never creates a
-- public relationship label; members can opt out through profile settings.
create index if not exists frnxup_close_comments_user_created_idx on public.post_comments(user_id,created_at desc);
create index if not exists frnxup_close_reactions_user_created_idx on public.post_reactions(user_id,created_at desc);
create index if not exists frnxup_close_messages_sender_created_idx on public.messages(sender_id,created_at desc);

create or replace function public.frnxup_close_circle_friends(p_limit integer default 6)
returns table(id uuid,username text,display_name text,avatar_path text)
language sql
stable
security definer
set search_path = public
as $$
  with my_friends as (
    select case when f.user_a=auth.uid() then f.user_b else f.user_a end as friend_id
    from public.friendships f where auth.uid() in (f.user_a,f.user_b) and public.user_is_active(auth.uid())
  ), ranked as (
    select f.friend_id,
      (
        (select count(*)*3 from public.post_comments c join public.posts p on p.id=c.post_id where p.user_id=auth.uid() and c.user_id=f.friend_id and c.created_at>now()-interval '90 days' and c.status='published') +
        (select count(*)*2 from public.post_reactions r join public.posts p on p.id=r.post_id where p.user_id=auth.uid() and r.user_id=f.friend_id and r.created_at>now()-interval '90 days') +
        (select count(*)*3 from public.post_comments c join public.posts p on p.id=c.post_id where p.user_id=f.friend_id and c.user_id=auth.uid() and c.created_at>now()-interval '90 days' and c.status='published') +
        (select count(*)*2 from public.post_reactions r join public.posts p on p.id=r.post_id where p.user_id=f.friend_id and r.user_id=auth.uid() and r.created_at>now()-interval '90 days') +
        (select count(*) from public.messages m
          where m.created_at>now()-interval '90 days'
            and m.sender_id in (auth.uid(),f.friend_id)
            and exists(select 1 from public.conversations c where c.id=m.conversation_id and c.kind='dm' and c.status='active')
            and exists(select 1 from public.conversation_members a where a.conversation_id=m.conversation_id and a.user_id=auth.uid())
            and exists(select 1 from public.conversation_members b where b.conversation_id=m.conversation_id and b.user_id=f.friend_id)
        )
      )::bigint as score
    from my_friends f
    join public.profiles p on p.id=f.friend_id and p.account_status='active' and p.profile_visibility <> 'private'
    left join public.profile_details d on d.profile_id=f.friend_id
    where coalesce(d.close_circle_enabled,true)
      and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=f.friend_id) or (b.blocker_id=f.friend_id and b.blocked_id=auth.uid()))
  )
  select p.id,p.username,p.display_name,p.avatar_path
  from ranked r join public.profiles p on p.id=r.friend_id
  where r.score>0
  order by r.score desc,p.display_name asc
  limit greatest(1,least(coalesce(p_limit,6),12));
$$;
revoke all on function public.frnxup_close_circle_friends(integer) from public, anon;
grant execute on function public.frnxup_close_circle_friends(integer) to authenticated;

comment on function public.frnxup_close_circle_friends(integer) is
'Private close-circle suggestions based on reciprocal interactions in the last 90 days. It only ranks existing friends and respects member opt-out.';
comment on function public.frnxup_check_social_reminders() is
'Creates private birthday and own-post memory reminders once per Africa/Lagos calendar day. Birthday posts are never published without an explicit user action.';

create index if not exists frnxup_notifications_unread_user_idx on public.notifications(user_id,created_at desc) where read_at is null;
create index if not exists frnxup_friend_requests_incoming_pending_idx on public.friend_requests(receiver_id,created_at desc) where status='pending';


-- Keep the second-header badges and the open Notifications page responsive.
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.friend_requests;
exception when duplicate_object then null; when undefined_object then null; end $$;
