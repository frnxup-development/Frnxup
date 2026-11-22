-- FRNXUP OWNER PROFILE RECOVERY
-- Run ONLY in the Supabase SQL Editor for the Frnxup project.
-- Targets the confirmed platform owner account by both email and Auth user ID.
-- No public endpoint or client-side owner promotion is created.

do $$
declare
  target_email constant text := 'frnxup@gmail.com';
  target_user_id constant uuid := 'c2ac4011-44a6-42e6-a214-2264a58f516c';
  requested_username text;
  safe_username text;
  display_label text;
  suffix integer := 0;
  existing_profile_username text;
begin
  -- Require an exact match for both the known owner email and Auth UUID.
  select coalesce(nullif(u.raw_user_meta_data->>'username',''), split_part(u.email,'@',1)),
         coalesce(nullif(u.raw_user_meta_data->>'display_name',''), split_part(u.email,'@',1))
    into requested_username, display_label
    from auth.users u
   where u.id = target_user_id
     and lower(u.email) = target_email;

  if not found then
    raise exception 'Owner Auth account did not match the expected email and ID. No changes made.';
  end if;

  select p.username into existing_profile_username
    from public.profiles p
   where p.id = target_user_id;

  if existing_profile_username is not null then
    safe_username := existing_profile_username;
  else
    safe_username := lower(regexp_replace(coalesce(requested_username,''), '[^a-zA-Z0-9_]', '', 'g'));
    safe_username := left(safe_username, 24);
    if length(safe_username) < 3 then
      safe_username := 'owner_' || left(replace(target_user_id::text,'-',''), 8);
    end if;
    while exists (
      select 1 from public.profiles p
       where lower(p.username) = lower(safe_username)
         and p.id <> target_user_id
    ) loop
      suffix := suffix + 1;
      safe_username := left('owner_' || left(replace(target_user_id::text,'-',''), 8) || '_' || suffix::text, 24);
    end loop;
  end if;

  insert into public.profiles (id, username, display_name, role, account_status)
  values (target_user_id, safe_username, coalesce(nullif(display_label,''), safe_username), 'owner', 'active')
  on conflict (id) do update
    set role = 'owner', account_status = 'active';

  insert into public.profile_details (profile_id)
  values (target_user_id)
  on conflict (profile_id) do nothing;


  raise notice 'Owner role restored for the confirmed Frnxup owner account.';
end $$;


-- Verify the result: should return the confirmed owner with role=owner and account_status=active.
select u.email, p.id as profile_id, p.username, p.role, p.account_status
  from auth.users u
  join public.profiles p on p.id = u.id
 where u.id = 'c2ac4011-44a6-42e6-a214-2264a58f516c'::uuid
   and lower(u.email) = lower('frnxup@gmail.com');
