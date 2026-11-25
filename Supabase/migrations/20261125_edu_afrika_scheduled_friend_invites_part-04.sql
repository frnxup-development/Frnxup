-- Accept, decline or negotiate a new time. The original sender must confirm a
-- proposed new time so neither participant can silently change the appointment.
create or replace function public.edu_challenge_respond_invitation(
  p_password text,p_invitation_id uuid,p_action text,p_proposed_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare
  v_user uuid:=public.edu_challenge_assert_access(p_password);
  v_i public.edu_challenge_invites%rowtype; v_actor uuid; v_target uuid; v_new_time timestamptz;
begin
  select * into v_i from public.edu_challenge_invites where id=p_invitation_id for update;
  if not found then raise exception 'This quiz invitation could not be found.'; end if;
  if coalesce(p_action,'') not in ('accept','reschedule','decline','accept_reschedule','decline_reschedule') then
    raise exception 'Choose a valid invitation action.';
  end if;
  if p_action in ('accept','reschedule','decline') then
    if v_i.recipient_id<>v_user then raise exception 'Only the invited student can respond to this invitation.'; end if;
  else
    if v_i.sender_id<>v_user then raise exception 'Only the student who sent the invitation can review this proposed time.'; end if;
  end if;
  if p_action='accept' then
    if v_i.status<>'pending' then raise exception 'This invitation is no longer waiting for acceptance.'; end if;
    if v_i.scheduled_at<=clock_timestamp() then raise exception 'The scheduled time has passed. Ask your friend to send a new invitation.'; end if;
    update public.edu_challenge_invites set status='accepted',responded_at=clock_timestamp(),updated_at=clock_timestamp() where id=v_i.id;
    v_actor:=v_user; v_target:=v_i.sender_id;
    insert into public.notifications(user_id,actor_id,type,title,body,target_type,target_id)
      values(v_target,v_actor,'edu_challenge_accepted','EDU-AFRIKA quiz challenge accepted',
        'Your friend accepted the quiz challenge scheduled for '||v_i.scheduled_at::text||'.','edu_challenge_invite',v_i.id);
  elsif p_action='reschedule' then
    if v_i.status<>'pending' then raise exception 'This invitation is no longer available for rescheduling.'; end if;
    if p_proposed_at is null or p_proposed_at<clock_timestamp()+interval '15 minutes'
      or p_proposed_at>clock_timestamp()+interval '30 days' then
      raise exception 'Choose a proposed time at least 15 minutes from now and within the next 30 days.';
    end if;
    update public.edu_challenge_invites set status='reschedule_requested',proposed_at=p_proposed_at,updated_at=clock_timestamp() where id=v_i.id;
    update public.edu_challenges set expires_at=greatest(expires_at,p_proposed_at+interval '2 hours') where id=v_i.challenge_id and status='waiting';
    insert into public.notifications(user_id,actor_id,type,title,body,target_type,target_id)
      values(v_i.sender_id,v_user,'edu_challenge_reschedule','EDU-AFRIKA student proposed another quiz time',
        'Your friend suggested '||p_proposed_at::text||'. Open Challenge Arena to accept or decline this time.','edu_challenge_invite',v_i.id);
  elsif p_action='decline' then
    if v_i.status not in ('pending','reschedule_requested') then raise exception 'This invitation can no longer be declined.'; end if;
    update public.edu_challenge_invites set status='declined',responded_at=clock_timestamp(),updated_at=clock_timestamp() where id=v_i.id;
    update public.edu_challenges set status='cancelled',completed_at=clock_timestamp() where id=v_i.challenge_id and status='waiting';
    insert into public.notifications(user_id,actor_id,type,title,body,target_type,target_id)
      values(v_i.sender_id,v_user,'edu_challenge_declined','EDU-AFRIKA quiz invitation declined',
        'Your friend declined the quiz challenge invitation.','edu_challenge_invite',v_i.id);
  elsif p_action='accept_reschedule' then
    if v_i.status<>'reschedule_requested' or v_i.proposed_at is null then raise exception 'There is no pending proposed time to accept.'; end if;
    if v_i.proposed_at<clock_timestamp()+interval '15 minutes' then raise exception 'The proposed time has passed or is too close. Ask your friend to propose another time.'; end if;
    v_new_time:=v_i.proposed_at;
    update public.edu_challenge_invites set status='accepted',scheduled_at=v_new_time,proposed_at=null,
      responded_at=clock_timestamp(),updated_at=clock_timestamp() where id=v_i.id;
    update public.edu_challenges set expires_at=greatest(expires_at,v_new_time+interval '2 hours') where id=v_i.challenge_id and status='waiting';
    insert into public.notifications(user_id,actor_id,type,title,body,target_type,target_id)
      values(v_i.recipient_id,v_user,'edu_challenge_reschedule_accepted','New EDU-AFRIKA quiz time confirmed',
        'The invitation sender accepted your proposed time: '||v_new_time::text||'.','edu_challenge_invite',v_i.id);
  elsif p_action='decline_reschedule' then
    if v_i.status<>'reschedule_requested' then raise exception 'There is no proposed time to decline.'; end if;
    update public.edu_challenge_invites set status='pending',proposed_at=null,updated_at=clock_timestamp() where id=v_i.id;
    insert into public.notifications(user_id,actor_id,type,title,body,target_type,target_id)
      values(v_i.recipient_id,v_user,'edu_challenge_reschedule_declined','Proposed quiz time not accepted',
        'Your friend could not accept the suggested time. The original scheduled time remains; you can suggest another time.','edu_challenge_invite',v_i.id);
  end if;
  return jsonb_build_object('ok',true,'action',p_action,'message',case p_action
    when 'accept' then 'Challenge accepted. It will start at the agreed time.'
    when 'reschedule' then 'Your proposed time has been sent to the challenge creator.'
    when 'decline' then 'The invitation has been declined.'
    when 'accept_reschedule' then 'The new challenge time is confirmed.'
    else 'The original scheduled time is still in place.' end);
end;
$$;
revoke all on function public.edu_challenge_respond_invitation(text,uuid,text,timestamptz) from public,anon;
grant execute on function public.edu_challenge_respond_invitation(text,uuid,text,timestamptz) to authenticated;

-- Allow the sender to cancel a scheduled invitation and notify its recipient.
create or replace function public.edu_challenge_cancel_invitation(p_password text,p_invitation_id uuid)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_user uuid:=public.edu_challenge_assert_access(p_password); v_i public.edu_challenge_invites%rowtype;
begin
  select * into v_i from public.edu_challenge_invites where id=p_invitation_id for update;
  if not found or v_i.sender_id<>v_user then raise exception 'Only the student who sent this invitation can cancel it.'; end if;
  if v_i.status not in ('pending','reschedule_requested','accepted') then raise exception 'This invitation can no longer be cancelled.'; end if;
  update public.edu_challenge_invites set status='cancelled',updated_at=clock_timestamp() where id=v_i.id;
  update public.edu_challenges set status='cancelled',completed_at=clock_timestamp() where id=v_i.challenge_id and status='waiting';
  insert into public.notifications(user_id,actor_id,type,title,body,target_type,target_id)
    values(v_i.recipient_id,v_user,'edu_challenge_cancelled','EDU-AFRIKA quiz invitation cancelled',
      'The student who invited you cancelled this scheduled quiz challenge.','edu_challenge_invite',v_i.id);
  return jsonb_build_object('ok',true,'message','The scheduled challenge invitation has been cancelled.');
end;
$$;
revoke all on function public.edu_challenge_cancel_invitation(text,uuid) from public,anon;
grant execute on function public.edu_challenge_cancel_invitation(text,uuid) to authenticated;
