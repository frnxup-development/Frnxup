-- Return invitations for the signed-in EDU-AFRIKA student, including reschedule proposals.
create or replace function public.edu_challenge_my_invitations(p_password text)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_user uuid:=public.edu_challenge_assert_access(p_password); v_items jsonb;
begin
  update public.edu_challenge_invites i set status='completed',updated_at=clock_timestamp()
    from public.edu_challenges c where c.id=i.challenge_id and i.status='started'
      and c.status in ('completed','forfeited') and (i.sender_id=v_user or i.recipient_id=v_user);
  update public.edu_challenge_invites set status='expired',updated_at=clock_timestamp()
    where (sender_id=v_user or recipient_id=v_user)
      and status in ('pending','reschedule_requested')
      and coalesce(proposed_at,scheduled_at)+interval '2 hours'<=clock_timestamp();
  update public.edu_challenges c set status='expired',completed_at=clock_timestamp()
    where c.status='waiting' and exists(select 1 from public.edu_challenge_invites i
      where i.challenge_id=c.id and i.status='expired' and (i.sender_id=v_user or i.recipient_id=v_user));
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,'challenge_id',i.challenge_id,'sender_id',i.sender_id,'recipient_id',i.recipient_id,
    'status',i.status,'scheduled_at',i.scheduled_at,'proposed_at',i.proposed_at,
    'created_at',i.created_at,'direction',case when i.sender_id=v_user then 'outgoing' else 'incoming' end,
    'other_user_id',other_p.id,'other_username',other_p.username,'other_display_name',other_p.display_name,
    'exam_code',c.exam_code,'question_count',c.question_count,'duration_minutes',c.duration_minutes
  ) order by i.created_at desc),'[]'::jsonb)
  into v_items
  from public.edu_challenge_invites i
  join public.edu_challenges c on c.id=i.challenge_id
  join public.profiles other_p on other_p.id=case when i.sender_id=v_user then i.recipient_id else i.sender_id end
  where (i.sender_id=v_user or i.recipient_id=v_user)
    and i.status in ('pending','reschedule_requested','accepted','started','completed')
    and i.created_at>clock_timestamp()-interval '45 days';
  return jsonb_build_object('server_now',clock_timestamp(),'items',v_items);
end;
$$;
revoke all on function public.edu_challenge_my_invitations(text) from public,anon;
grant execute on function public.edu_challenge_my_invitations(text) to authenticated;
