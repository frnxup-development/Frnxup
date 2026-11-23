-- Let each signed-in member see the names and profile pictures of accounts
-- they personally blocked, so the blocked list has a meaningful Unblock action.
-- This function never returns another member's block list.
create or replace function public.frnxup_blocked_members()
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_path text,
  blocked_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.username, p.display_name, p.avatar_path, b.created_at as blocked_at
  from public.user_blocks b
  join public.profiles p on p.id = b.blocked_id
  where b.blocker_id = auth.uid()
    and auth.uid() is not null
  order by b.created_at desc;
$$;

revoke all on function public.frnxup_blocked_members() from public;
revoke all on function public.frnxup_blocked_members() from anon;
grant execute on function public.frnxup_blocked_members() to authenticated;
