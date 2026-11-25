-- Server-authoritative start. Whichever participant is online at the scheduled
-- time can trigger the start; both students receive the same fixed end time.
create or replace function public.edu_challenge_start_due(p_password text)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare
  v_user uuid:=public.edu_challenge_assert_access(p_password);
  v_i public.edu_challenge_invites%rowtype; v_c public.edu_challenges%rowtype; v_started integer:=0;
begin
  for v_i in select * from public.edu_challenge_invites
    where status='accepted' and scheduled_at<=clock_timestamp()
      and (sender_id=v_user or recipient_id=v_user)
    order by scheduled_at for update loop
    select * into v_c from public.edu_challenges where id=v_i.challenge_id for update;
    if not found or v_c.status<>'waiting' then
      update public.edu_challenge_invites set status='expired',updated_at=clock_timestamp()
        where id=v_i.id and status='accepted';
      continue;
    end if;
    if exists(select 1 from public.user_blocks b where
      (b.blocker_id=v_i.sender_id and b.blocked_id=v_i.recipient_id) or (b.blocker_id=v_i.recipient_id and b.blocked_id=v_i.sender_id))
      or not exists(select 1 from public.friendships f where
        (f.user_a=v_i.sender_id and f.user_b=v_i.recipient_id) or (f.user_a=v_i.recipient_id and f.user_b=v_i.sender_id))
      or not exists(select 1 from public.profiles p where p.id=v_i.sender_id and p.account_status='active')
      or not exists(select 1 from public.profiles p where p.id=v_i.recipient_id and p.account_status='active') then
      update public.edu_challenge_invites set status='cancelled',updated_at=clock_timestamp() where id=v_i.id;
      update public.edu_challenges set status='cancelled',completed_at=clock_timestamp() where id=v_i.challenge_id and status='waiting';
      continue;
    end if;
    update public.edu_challenges set status='active',accepted_at=coalesce(accepted_at,v_i.responded_at),
      started_at=v_i.scheduled_at,ends_at=v_i.scheduled_at+make_interval(mins=>v_c.duration_minutes)
      where id=v_c.id and status='waiting';
    if found then
      update public.edu_challenge_invites set status='started',updated_at=clock_timestamp() where id=v_i.id;
      insert into public.notifications(user_id,actor_id,type,title,body,target_type,target_id) values
        (v_i.sender_id,v_i.recipient_id,'edu_challenge_started','Your EDU-AFRIKA quiz challenge has started',
          'The scheduled quiz is now live. Open Challenge Arena to begin answering.','edu_challenge_invite',v_i.id),
        (v_i.recipient_id,v_i.sender_id,'edu_challenge_started','Your EDU-AFRIKA quiz challenge has started',
          'The scheduled quiz is now live. Open Challenge Arena to begin answering.','edu_challenge_invite',v_i.id);
      v_started:=v_started+1;
    end if;
  end loop;
  return jsonb_build_object('ok',true,'started',v_started,'server_now',clock_timestamp());
end;
$$;
revoke all on function public.edu_challenge_start_due(text) from public,anon;
grant execute on function public.edu_challenge_start_due(text) to authenticated;

comment on table public.edu_challenge_invites is 'Authenticated EDU-AFRIKA head-to-head quiz invitations with scheduled starts and mutual rescheduling confirmation.';
