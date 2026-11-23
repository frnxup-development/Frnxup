-- Fix: friend request inserts rejected by RLS when the target profile row
-- is hidden by profile visibility policies. Eligibility is checked in a
-- SECURITY DEFINER function (bypassing profile SELECT RLS), while preserving
-- the app's request settings, account, mutual-friend, block and duplicate rules.

create or replace function public.frnxup_can_send_friend_request(p_receiver_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and p_receiver_id is not null
    and p_receiver_id <> auth.uid()
    and public.user_is_active(auth.uid())
    and public.site_setting_enabled('friend_requests_enabled', true)
    and exists (
      select 1
      from public.profiles target
      where target.id = p_receiver_id
        and target.account_status = 'active'
        and target.friend_request_policy <> 'none'
        and (
          target.friend_request_policy = 'everyone'
          or public.has_mutual_friend(auth.uid(), p_receiver_id)
        )
    )
    and not public.are_friends(auth.uid(), p_receiver_id)
    and not exists (
      select 1 from public.friend_requests r
      where r.status = 'pending'
        and ((r.sender_id = auth.uid() and r.receiver_id = p_receiver_id)
          or (r.sender_id = p_receiver_id and r.receiver_id = auth.uid()))
    )
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = p_receiver_id)
         or (b.blocker_id = p_receiver_id and b.blocked_id = auth.uid())
    );
$$;


revoke all on function public.frnxup_can_send_friend_request(uuid) from public, anon;
grant execute on function public.frnxup_can_send_friend_request(uuid) to authenticated;

drop policy if exists friend_requests_insert on public.friend_requests;
create policy friend_requests_insert
on public.friend_requests
for insert
to authenticated
with check (
  sender_id = auth.uid()
  and public.frnxup_can_send_friend_request(receiver_id)
);
