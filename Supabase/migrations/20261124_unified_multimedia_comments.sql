-- Frnxup unified multimedia comments for Feed posts, Reels, Room messages and Groups.
-- Apply once in Supabase SQL Editor before deploying the front-end patch.
begin;

alter table public.post_comments
  alter column post_id drop not null,
  add column if not exists context_type text not null default 'post',
  add column if not exists context_id uuid,
  add column if not exists attachments jsonb not null default '[]'::jsonb,
  add column if not exists mentions jsonb not null default '[]'::jsonb;

update public.post_comments
set context_type='post', context_id=post_id
where context_id is null and post_id is not null;

alter table public.post_comments alter column context_id set not null;
alter table public.post_comments drop constraint if exists post_comments_context_type_check;
alter table public.post_comments add constraint post_comments_context_type_check
  check (context_type in ('post','reel','room','group'));
alter table public.post_comments drop constraint if exists post_comments_context_target_check;
alter table public.post_comments add constraint post_comments_context_target_check
  check (
    (context_type in ('post','reel') and post_id=context_id)
    or (context_type in ('room','group') and post_id is null)
  );
alter table public.post_comments drop constraint if exists post_comments_body_check;
alter table public.post_comments add constraint post_comments_body_check
  check (
    char_length(coalesce(body,'')) <= 2000
    and (char_length(trim(coalesce(body,''))) > 0 or jsonb_array_length(coalesce(attachments,'[]'::jsonb)) > 0)
  );
alter table public.post_comments drop constraint if exists post_comments_attachments_array_check;
alter table public.post_comments add constraint post_comments_attachments_array_check
  check (jsonb_typeof(attachments)='array' and jsonb_typeof(mentions)='array');

create index if not exists post_comments_context_chronological_idx
  on public.post_comments(context_type,context_id,created_at asc,id asc);
create index if not exists post_comments_context_parent_idx
  on public.post_comments(context_type,context_id,parent_id,created_at asc);

-- The supplied Frnxup ZIP has no member-facing Groups module or group membership table.
-- This secure membership bridge lets the Groups module register active members for
-- each group id without allowing ordinary users to grant themselves membership.
create table if not exists public.frnxup_group_comment_members (
  group_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'active' check (status in ('active','removed','banned')),
  created_at timestamptz not null default now(),
  primary key(group_id,user_id)
);
create index if not exists frnxup_group_comment_members_user_idx
  on public.frnxup_group_comment_members(user_id,group_id) where status='active';
alter table public.frnxup_group_comment_members enable row level security;
revoke all on public.frnxup_group_comment_members from anon,authenticated;
grant select,insert,update,delete on public.frnxup_group_comment_members to service_role;

create or replace function public.frnxup_can_access_comment_context(
  p_context_type text,
  p_context_id uuid,
  p_for_write boolean default false
) returns boolean
language plpgsql stable security definer
set search_path=public,pg_temp
as $$
begin
  if p_context_type not in ('post','reel','room','group') or p_context_id is null then
    return false;
  end if;
  if p_for_write and (auth.uid() is null or not public.user_is_active(auth.uid())
      or not public.site_setting_enabled('comments_enabled',true)
      or not public.site_setting_enabled('uploads_enabled',true) and false) then
    return false;
  end if;

  if p_context_type in ('post','reel') then
    return exists (
      select 1 from public.posts p
      where p.id=p_context_id and p.status='published'
        and (p.user_id=auth.uid() or p.visibility='public'
          or (p.visibility='friends' and public.are_friends(auth.uid(),p.user_id)))
        and not exists (
          select 1 from public.user_blocks b
          where (b.blocker_id=auth.uid() and b.blocked_id=p.user_id)
             or (b.blocker_id=p.user_id and b.blocked_id=auth.uid())
        )
    );
  elsif p_context_type='room' then
    return auth.uid() is not null and exists (
      select 1
      from public.room_messages rm
      join public.rooms r on r.id=rm.room_id and r.status='active'
      join public.room_members m on m.room_id=rm.room_id and m.user_id=auth.uid() and m.status='active'
      where rm.id=p_context_id and rm.status='published'
    );
  elsif p_context_type='group' then
    return auth.uid() is not null and exists (
      select 1 from public.frnxup_group_comment_members gm
      where gm.group_id=p_context_id and gm.user_id=auth.uid() and gm.status='active'
    );
  end if;
  return false;
end;
$$;
revoke all on function public.frnxup_can_access_comment_context(text,uuid,boolean) from public,anon;
grant execute on function public.frnxup_can_access_comment_context(text,uuid,boolean) to anon,authenticated,service_role;

create or replace function public.frnxup_prepare_comment_context()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.context_type is null then new.context_type := 'post'; end if;
  if new.context_id is null and new.post_id is not null then new.context_id := new.post_id; end if;
  if new.context_type in ('post','reel') then
    if new.post_id is null then new.post_id := new.context_id; end if;
    if new.context_id is null then new.context_id := new.post_id; end if;
  else
    new.post_id := null;
  end if;
  if new.attachments is null then new.attachments := '[]'::jsonb; end if;
  if new.mentions is null then new.mentions := '[]'::jsonb; end if;
  return new;
end $$;
drop trigger if exists frnxup_prepare_comment_context_trigger on public.post_comments;
create trigger frnxup_prepare_comment_context_trigger
before insert or update of post_id,context_type,context_id,attachments,mentions on public.post_comments
for each row execute function public.frnxup_prepare_comment_context();

create or replace function public.frnxup_validate_comment_parent()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare parent_row record;
begin
  if new.parent_id is null then return new; end if;
  select context_type,context_id into parent_row from public.post_comments where id=new.parent_id;
  if parent_row.context_id is null or parent_row.context_type<>new.context_type or parent_row.context_id<>new.context_id then
    raise exception 'A reply must belong to the same Frnxup discussion as its parent comment';
  end if;
  return new;
end $$;
drop trigger if exists frnxup_validate_comment_parent_trigger on public.post_comments;
create trigger frnxup_validate_comment_parent_trigger
before insert or update of parent_id,post_id,context_type,context_id on public.post_comments
for each row execute function public.frnxup_validate_comment_parent();

-- Rebuild the existing policies so all contexts use one access check.
drop policy if exists comments_read on public.post_comments;
create policy comments_read on public.post_comments
for select to anon,authenticated
using (status in ('published','deleted') and public.frnxup_can_access_comment_context(context_type,context_id,false));

drop policy if exists comments_insert on public.post_comments;
create policy comments_insert on public.post_comments
for insert to authenticated
with check (
  user_id=auth.uid()
  and public.frnxup_can_access_comment_context(context_type,context_id,true)
  and (context_type in ('room','group') or public.site_setting_enabled('posting_enabled',true))
);

drop policy if exists comments_update on public.post_comments;
create policy comments_update on public.post_comments
for update to authenticated
using (user_id=auth.uid() and status='published' and public.user_is_active(auth.uid()))
with check (
  user_id=auth.uid() and status in ('published','deleted')
  and public.frnxup_can_access_comment_context(context_type,context_id,true)
);

drop policy if exists comments_delete on public.post_comments;
create policy comments_delete on public.post_comments
for delete to authenticated using (user_id=auth.uid() and public.user_is_active(auth.uid()));

grant select,insert,update,delete on public.post_comments to authenticated;
grant select on public.post_comments to anon;

-- Comment reactions work on all four context types, not only feed posts.
drop policy if exists comment_reactions_read on public.comment_reactions;
create policy comment_reactions_read on public.comment_reactions
for select to authenticated
using (exists(select 1 from public.post_comments c where c.id=comment_id and c.status in ('published','deleted') and public.frnxup_can_access_comment_context(c.context_type,c.context_id,false)));
drop policy if exists comment_reactions_insert on public.comment_reactions;
create policy comment_reactions_insert on public.comment_reactions
for insert to authenticated
with check (user_id=auth.uid() and public.user_is_active(auth.uid()) and exists(select 1 from public.post_comments c where c.id=comment_id and c.status='published' and public.frnxup_can_access_comment_context(c.context_type,c.context_id,true)));
drop policy if exists comment_reactions_update on public.comment_reactions;
create policy comment_reactions_update on public.comment_reactions
for update to authenticated
using (user_id=auth.uid())
with check (user_id=auth.uid() and exists(select 1 from public.post_comments c where c.id=comment_id and c.status='published' and public.frnxup_can_access_comment_context(c.context_type,c.context_id,true)));
drop policy if exists comment_reactions_delete on public.comment_reactions;
create policy comment_reactions_delete on public.comment_reactions
for delete to authenticated using (user_id=auth.uid());
grant select,insert,update,delete on public.comment_reactions to authenticated;

-- Mention alerts are created server-side so browser clients cannot forge notifications.
create or replace function public.frnxup_notify_comment_mentions()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_recipient uuid;
begin
  if jsonb_typeof(coalesce(new.mentions,'[]'::jsonb)) <> 'array' then return new; end if;
  for v_recipient in
    select distinct (item->>'id')::uuid
    from jsonb_array_elements(coalesce(new.mentions,'[]'::jsonb)) as e(item)
    where coalesce(item->>'id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  loop
    if v_recipient<>new.user_id and public.user_is_active(v_recipient)
       and not exists(select 1 from public.user_blocks b where (b.blocker_id=new.user_id and b.blocked_id=v_recipient) or (b.blocker_id=v_recipient and b.blocked_id=new.user_id))
       and not exists(select 1 from public.notifications n where n.user_id=v_recipient and n.actor_id=new.user_id and n.type='comment_mention' and n.target_type='comment' and n.target_id=new.id) then
      insert into public.notifications(user_id,actor_id,type,title,body,target_type,target_id)
      values(v_recipient,new.user_id,'comment_mention','You were mentioned in a comment',left(coalesce(nullif(trim(new.body),''),'Shared an attachment.'),180),'comment',new.id);
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists frnxup_comment_mentions_notify on public.post_comments;
create trigger frnxup_comment_mentions_notify after insert on public.post_comments
for each row execute function public.frnxup_notify_comment_mentions();

-- Add safe file types for document comments while keeping the existing private bucket.
update storage.buckets
set public=false,
    file_size_limit=104857600,
    allowed_mime_types=array[
      'image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime',
      'application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain','text/csv','audio/mpeg','audio/mp4','audio/webm','audio/ogg','application/vnd.oasis.opendocument.text',
      'application/vnd.oasis.opendocument.spreadsheet','application/vnd.oasis.opendocument.presentation'
    ]
where id='frnxup-media';

-- The object is readable only when its comment context is readable to the current user.
drop policy if exists frnxup_comment_media_read on storage.objects;
create policy frnxup_comment_media_read on storage.objects
for select to anon,authenticated
using (
  bucket_id='frnxup-media'
  and exists (
    select 1
    from public.post_comments c
    cross join lateral jsonb_array_elements(coalesce(c.attachments,'[]'::jsonb)) a
    where a->>'path'=storage.objects.name
      and c.status='published'
      and public.frnxup_can_access_comment_context(c.context_type,c.context_id,false)
  )
);

commit;
