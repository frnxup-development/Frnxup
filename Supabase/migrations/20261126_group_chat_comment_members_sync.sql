-- Keep the secure group-comment membership bridge in sync with Frnxup group chats.
-- Apply after 20261124_unified_multimedia_comments.sql.

begin;

create table if not exists public.frnxup_group_comment_members (
  group_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'active' check (status in ('active','removed','banned')),
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists frnxup_group_comment_members_user_idx
  on public.frnxup_group_comment_members(user_id, group_id) where status='active';
alter table public.frnxup_group_comment_members enable row level security;
revoke all on public.frnxup_group_comment_members from anon, authenticated;
grant select, insert, update, delete on public.frnxup_group_comment_members to service_role;

create or replace function public.frnxup_sync_group_comment_member()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conversation_id uuid;
  v_user_id uuid;
  v_kind text;
begin
  -- Remove the old mapping when a membership row is deleted or changed.
  if TG_OP = 'DELETE' then
    v_conversation_id := OLD.conversation_id;
    v_user_id := OLD.user_id;
  elsif TG_OP = 'UPDATE' then
    if OLD.conversation_id is distinct from NEW.conversation_id
       or OLD.user_id is distinct from NEW.user_id then
      delete from public.frnxup_group_comment_members
      where group_id = OLD.conversation_id and user_id = OLD.user_id;
    end if;
    v_conversation_id := NEW.conversation_id;
    v_user_id := NEW.user_id;
  else
    v_conversation_id := NEW.conversation_id;
    v_user_id := NEW.user_id;
  end if;

  select kind into v_kind
  from public.conversations
  where id = v_conversation_id;

  if TG_OP = 'DELETE' or v_kind is distinct from 'group' then
    delete from public.frnxup_group_comment_members
    where group_id = v_conversation_id and user_id = v_user_id;
  else
    insert into public.frnxup_group_comment_members (group_id, user_id, status)
    values (v_conversation_id, v_user_id, 'active')
    on conflict (group_id, user_id)
    do update set status = 'active';
  end if;

  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;

revoke all on function public.frnxup_sync_group_comment_member() from public, anon, authenticated;

drop trigger if exists frnxup_group_comment_members_sync_insert_update on public.conversation_members;
create trigger frnxup_group_comment_members_sync_insert_update
after insert or update on public.conversation_members
for each row execute function public.frnxup_sync_group_comment_member();

drop trigger if exists frnxup_group_comment_members_sync_delete on public.conversation_members;
create trigger frnxup_group_comment_members_sync_delete
after delete on public.conversation_members
for each row execute function public.frnxup_sync_group_comment_member();

-- Backfill existing group conversations so their current members can comment immediately.
insert into public.frnxup_group_comment_members (group_id, user_id, status)
select cm.conversation_id, cm.user_id, 'active'
from public.conversation_members cm
join public.conversations c on c.id = cm.conversation_id
where c.kind = 'group'
on conflict (group_id, user_id)
do update set status = 'active';

commit;
