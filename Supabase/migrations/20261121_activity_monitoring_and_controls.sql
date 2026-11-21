-- FRNXUP activity monitoring and expanded owner controls.
-- Run once after Supabase/schema.sql on an existing project.
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
alter table public.site_activity_logs enable row level security;
drop policy if exists site_activity_admin_read on public.site_activity_logs;
create policy site_activity_admin_read on public.site_activity_logs for select to authenticated using(public.is_moderator());

create or replace function public.frnxup_log_activity(
  p_action text, p_entity_type text default null, p_entity_id text default null, p_details jsonb default '{}'::jsonb
) returns boolean language plpgsql security definer set search_path=public
as $$ declare safe_action text := lower(coalesce(p_action,'')); begin
  if auth.uid() is null then return false; end if;
  if safe_action not in ('page_view','search','profile_view','sign_in','sign_out','interaction') then raise exception 'Unsupported activity type'; end if;
  insert into public.site_activity_logs(actor_id,action,entity_type,entity_id,details)
  values(auth.uid(),safe_action,left(p_entity_type,48),left(p_entity_id,160),case when jsonb_typeof(p_details)='object' then p_details-'password'-'token'-'email'-'phone' else '{}'::jsonb end);
  return true;
end $$;
revoke all on function public.frnxup_log_activity(text,text,text,jsonb) from public;
grant execute on function public.frnxup_log_activity(text,text,text,jsonb) to authenticated;

create or replace function public.frnxup_capture_activity()
returns trigger language plpgsql security definer set search_path=public
as $$ declare row_data jsonb; actor uuid; entity text; details jsonb:=jsonb_build_object('operation',lower(TG_OP)); k text;
begin
  if TG_OP='DELETE' then row_data:=to_jsonb(OLD); else row_data:=to_jsonb(NEW); end if;
  actor:=auth.uid();
  if actor is null and coalesce(auth.role(),'')<>'service_role' then
    actor:=coalesce(nullif(row_data->>'user_id','')::uuid,nullif(row_data->>'sender_id','')::uuid,nullif(row_data->>'created_by','')::uuid,nullif(row_data->>'reporter_id','')::uuid,nullif(row_data->>'blocker_id','')::uuid,nullif(row_data->>'receiver_id','')::uuid);
    if actor is null and TG_TABLE_NAME='profiles' then actor:=nullif(row_data->>'id','')::uuid; end if;
  end if;
  if actor is null then if TG_OP='DELETE' then return OLD; else return NEW; end if; end if;
  entity:=coalesce(row_data->>'id',row_data->>'conversation_id',row_data->>'post_id',row_data->>'room_id',row_data->>'profile_id',row_data->>'user_id');
  if row_data ? 'user_a' then entity:=concat_ws(':',row_data->>'user_a',row_data->>'user_b'); end if;
  if row_data ? 'user_id' and row_data ? 'conversation_id' then entity:=concat_ws(':',row_data->>'conversation_id',row_data->>'user_id'); end if;
  if row_data ? 'user_id' and row_data ? 'room_id' then entity:=concat_ws(':',row_data->>'room_id',row_data->>'user_id'); end if;
  foreach k in array array['status','visibility','kind','role','category','type'] loop if row_data ? k then details:=details||jsonb_build_object(k,row_data->k); end if; end loop;
  insert into public.site_activity_logs(actor_id,action,entity_type,entity_id,details) values(actor,lower(TG_TABLE_NAME)||'_'||lower(TG_OP),TG_TABLE_NAME,entity,details);
  if TG_OP='DELETE' then return OLD; else return NEW; end if;
end $$;
do $$ declare t text; begin foreach t in array array['profiles','profile_details','profile_locations','friend_requests','friendships','user_blocks','posts','post_polls','poll_votes','post_comments','comment_reactions','post_reactions','bookmarks','statuses','conversations','conversation_members','messages','message_receipts','rooms','room_members','room_messages','notifications','reports','verification_requests','account_appeals'] loop
 execute format('drop trigger if exists frnxup_activity_capture on public.%I',t);
 execute format('create trigger frnxup_activity_capture after insert or update or delete on public.%I for each row execute function public.frnxup_capture_activity()',t);
end loop; end $$;

insert into public.site_settings(key,value) values
('registration_enabled','true'::jsonb),('posting_enabled','true'::jsonb),('comments_enabled','true'::jsonb),('reactions_enabled','true'::jsonb),('polls_enabled','true'::jsonb),('statuses_enabled','true'::jsonb),('friend_requests_enabled','true'::jsonb),('messaging_enabled','true'::jsonb),('groups_enabled','true'::jsonb),('rooms_enabled','true'::jsonb),('uploads_enabled','true'::jsonb),('maintenance_mode','false'::jsonb)
on conflict(key) do nothing;

-- Re-create relevant policies with expanded control flags and public read access.
drop policy if exists friend_requests_insert on public.friend_requests;
create policy friend_requests_insert on public.friend_requests for insert to authenticated with check(sender_id=auth.uid() and user_is_active(auth.uid()) and site_setting_enabled('friend_requests_enabled',true) and exists(select 1 from public.profiles target where target.id=receiver_id and target.friend_request_policy<>'none' and (target.friend_request_policy='everyone' or has_mutual_friend(auth.uid(),receiver_id))) and not public.are_friends(auth.uid(),receiver_id) and not exists(select 1 from public.friend_requests r where r.status='pending' and ((r.sender_id=auth.uid() and r.receiver_id=receiver_id) or (r.sender_id=receiver_id and r.receiver_id=auth.uid()))) and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=receiver_id) or (b.blocker_id=receiver_id and b.blocked_id=auth.uid())));
drop policy if exists comments_insert on public.post_comments;
create policy comments_insert on public.post_comments for insert to authenticated with check(user_id=auth.uid() and user_is_active(auth.uid()) and site_setting_enabled('posting_enabled',true) and site_setting_enabled('comments_enabled',true) and exists(select 1 from public.posts p where p.id=post_id and p.status='published' and (p.visibility='public' or p.user_id=auth.uid() or (p.visibility='friends' and are_friends(auth.uid(),p.user_id)))));
drop policy if exists comment_reactions_insert on public.comment_reactions;
create policy comment_reactions_insert on public.comment_reactions for insert to authenticated with check(user_id=auth.uid() and user_is_active(auth.uid()) and site_setting_enabled('reactions_enabled',true) and exists(select 1 from public.post_comments c where c.id=comment_id and c.status='published'));
drop policy if exists reactions_insert on public.post_reactions;
create policy reactions_insert on public.post_reactions for insert to authenticated with check(user_id=auth.uid() and user_is_active(auth.uid()) and site_setting_enabled('reactions_enabled',true) and site_setting_enabled('posting_enabled',true) and exists(select 1 from public.posts p where p.id=post_id and p.status='published' and (p.user_id=auth.uid() or p.visibility='public' or (p.visibility='friends' and are_friends(auth.uid(),p.user_id)))));
drop policy if exists post_polls_insert_own on public.post_polls;
create policy post_polls_insert_own on public.post_polls for insert to authenticated with check(exists(select 1 from public.posts p where p.id=post_id and p.user_id=auth.uid() and p.status='published') and user_is_active(auth.uid()) and site_setting_enabled('posting_enabled',true) and site_setting_enabled('polls_enabled',true));
drop policy if exists statuses_insert on public.statuses;
create policy statuses_insert on public.statuses for insert to authenticated with check(user_id=auth.uid() and user_is_active(auth.uid()) and site_setting_enabled('statuses_enabled',true) and site_setting_enabled('posting_enabled',true));

-- Feature switches apply at the database boundary so bypassing the UI cannot bypass admin controls.
drop policy if exists posts_insert on public.posts;
create policy posts_insert on public.posts for insert to authenticated with check(user_id=auth.uid() and user_is_active(auth.uid()) and site_setting_enabled('posting_enabled',true));
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated with check(sender_id=auth.uid() and is_conversation_member(conversation_id) and exists(select 1 from public.conversations c where c.id=conversation_id and c.status='active' and (c.kind='dm' or site_setting_enabled('groups_enabled',true))) and user_is_active(auth.uid()) and site_setting_enabled('messaging_enabled',true) and not exists(select 1 from public.conversation_members cm join public.user_blocks b on ((b.blocker_id=auth.uid() and b.blocked_id=cm.user_id) or (b.blocker_id=cm.user_id and b.blocked_id=auth.uid())) where cm.conversation_id=conversation_id and cm.user_id<>auth.uid()));
drop policy if exists room_members_join on public.room_members;
create policy room_members_join on public.room_members for insert to authenticated with check(user_id=auth.uid() and role='member' and status='pending' and user_is_active(auth.uid()) and site_setting_enabled('rooms_enabled',true));
drop policy if exists rooms_create on public.rooms;
create policy rooms_create on public.rooms for insert to authenticated with check(created_by=auth.uid() and user_is_active(auth.uid()) and site_setting_enabled('rooms_enabled',true));
drop policy if exists room_messages_insert on public.room_messages;
create policy room_messages_insert on public.room_messages for insert to authenticated with check(user_id=auth.uid() and user_is_active(auth.uid()) and is_room_member(room_id) and site_setting_enabled('rooms_enabled',true));

-- Public feed, status and room reads follow the same visibility rules as the fresh schema.
drop policy if exists posts_read on public.posts;
create policy posts_read on public.posts for select to anon, authenticated using(status='published' and (user_id=auth.uid() or visibility='public' or (visibility='friends' and are_friends(auth.uid(),user_id))) and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=user_id) or (b.blocker_id=user_id and b.blocked_id=auth.uid())));
drop policy if exists comments_read on public.post_comments;
create policy comments_read on public.post_comments for select to anon, authenticated using(status in ('published','deleted') and exists(select 1 from public.posts p where p.id=post_id and p.status='published' and (p.user_id=auth.uid() or p.visibility='public' or (p.visibility='friends' and are_friends(auth.uid(),p.user_id))) and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=p.user_id) or (b.blocker_id=p.user_id and b.blocked_id=auth.uid()))));
drop policy if exists statuses_read on public.statuses;
create policy statuses_read on public.statuses for select to anon, authenticated using(expires_at>now() and (user_id=auth.uid() or visibility='public' or (visibility='friends' and are_friends(auth.uid(),user_id))) and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=user_id) or (b.blocker_id=user_id and b.blocked_id=auth.uid())));
drop policy if exists rooms_read on public.rooms;
create policy rooms_read on public.rooms for select to anon, authenticated using(status='active' and (visibility='public' or is_room_member(id)));

-- Public profile details and location retain their own per-field visibility rules.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to anon, authenticated using(id=auth.uid() or (account_status='active' and (profile_visibility='public' or (profile_visibility='friends' and are_friends(auth.uid(),id))) and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=id) or (b.blocker_id=id and b.blocked_id=auth.uid()))));
drop policy if exists profile_details_read on public.profile_details;
create policy profile_details_read on public.profile_details for select to anon, authenticated using(profile_id=auth.uid() or exists(select 1 from public.profiles p where p.id=profile_id and p.account_status='active' and (p.profile_visibility='public' or (p.profile_visibility='friends' and are_friends(auth.uid(),profile_id))) and (details_visibility='public' or (details_visibility='friends' and are_friends(auth.uid(),profile_id))) and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=profile_id) or (b.blocker_id=profile_id and b.blocked_id=auth.uid()))));
drop policy if exists profile_locations_read on public.profile_locations;
create policy profile_locations_read on public.profile_locations for select to anon, authenticated using(profile_id=auth.uid() or exists(select 1 from public.profiles p where p.id=profile_id and p.account_status='active' and (p.profile_visibility='public' or (p.profile_visibility='friends' and are_friends(auth.uid(),profile_id))) and (location_visibility='public' or (location_visibility='friends' and are_friends(auth.uid(),profile_id))) and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=profile_id) or (b.blocker_id=profile_id and b.blocked_id=auth.uid()))));
revoke select on public.profiles from anon;
grant select (id,username,display_name,bio,avatar_path,cover_path,profile_visibility,account_status,is_verified,created_at) on public.profiles to anon;
grant select on public.profiles to authenticated;
grant select on public.profile_details,public.profile_locations,public.posts,public.post_comments,public.statuses,public.rooms to anon,authenticated;
grant select on public.site_activity_logs to authenticated;


-- Apply the same server-side feature switches to RPC workflows on existing databases.
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
grant execute on function public.create_conversation(text,text,uuid[]) to authenticated;

create or replace function public.frnxup_vote_poll(p_post_id uuid,p_option_index integer)
returns void language plpgsql security definer set search_path=public
as $$ declare poll_row public.post_polls; post_row public.posts;
begin
 if not public.user_is_active(auth.uid()) or not public.site_setting_enabled('posting_enabled',true) or not public.site_setting_enabled('polls_enabled',true) then raise exception 'Voting is currently unavailable'; end if;
 select * into poll_row from public.post_polls where post_id=p_post_id;
 if not found then raise exception 'Poll not found'; end if;
 if poll_row.expires_at<=now() then raise exception 'This poll has closed'; end if;
 if p_option_index<0 or p_option_index>=jsonb_array_length(poll_row.options) then raise exception 'Invalid poll option'; end if;
 select * into post_row from public.posts p where p.id=p_post_id and p.status='published' and (p.user_id=auth.uid() or p.visibility='public' or (p.visibility='friends' and public.are_friends(auth.uid(),p.user_id))) and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=p.user_id) or (b.blocker_id=p.user_id and b.blocked_id=auth.uid()));
 if not found then raise exception 'This poll is not available to your account'; end if;
 insert into public.poll_votes(post_id,user_id,option_index) values(p_post_id,auth.uid(),p_option_index) on conflict(post_id,user_id) do update set option_index=excluded.option_index,created_at=now();
end $$;

-- Keep group membership and room invitations subject to the owner feature switches.
create or replace function public.manage_group_member(p_conversation_id uuid,p_user_id uuid,p_action text)
returns void language plpgsql security definer set search_path=public
as $$ declare c public.conversations%rowtype; actor_role text;
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

-- Allow anonymous visitors to view media only when it is attached to explicitly public content.
drop policy if exists frnxup_media_public_read on storage.objects;
create policy frnxup_media_public_read on storage.objects for select to anon using(bucket_id='frnxup-media' and (
  exists(select 1 from public.profiles p where (p.avatar_path=name or p.cover_path=name) and p.account_status='active' and p.profile_visibility='public') or
  exists(select 1 from public.posts p where p.media_path=name and p.status='published' and p.visibility='public') or
  exists(select 1 from public.statuses s where s.media_path=name and s.expires_at>now() and s.visibility='public')
));

-- Ensure the media-upload switch is enforced on existing storage buckets too.
drop policy if exists frnxup_media_upload_own on storage.objects;
create policy frnxup_media_upload_own on storage.objects for insert to authenticated with check(bucket_id='frnxup-media' and split_part(name,'/',1)=auth.uid()::text and public.site_setting_enabled('uploads_enabled',true));

-- Keep maintenance and registration gates synchronized on existing databases.
create or replace function public.user_is_active(p_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path=public
as $$
  select exists(
    select 1 from public.profiles
    where id=p_id and account_status='active'
      and (not public.site_setting_enabled('maintenance_mode',false) or role in ('admin','owner'))
  )
$$;

create or replace function public.handle_new_frnxup_user()
returns trigger language plpgsql security definer set search_path=public
as $$
declare requested text; candidate text; n integer:=0;
begin
  if not public.site_setting_enabled('registration_enabled',true) or public.site_setting_enabled('maintenance_mode',false) then
    raise exception 'Frnxup registration is temporarily disabled';
  end if;
  requested:=coalesce(nullif(new.raw_user_meta_data->>'username',''),'member_'||substr(replace(new.id::text,'-',''),1,10));
  candidate:=lower(regexp_replace(requested,'[^A-Za-z0-9_]','','g'));
  if char_length(candidate)<3 then candidate:='member_'||substr(replace(new.id::text,'-',''),1,10); end if;
  candidate:=substr(candidate,1,24);
  while exists(select 1 from public.profiles where username=candidate) loop
    n:=n+1; candidate:=substr(candidate,1,18)||'_'||substr(replace(new.id::text,'-',''),1,5)||n::text;
  end loop;
  insert into public.profiles(id,username,display_name)
    values(new.id,candidate,coalesce(new.raw_user_meta_data->>'display_name',candidate));
  insert into public.profile_details(profile_id) values(new.id) on conflict do nothing;
  return new;
end $$;
