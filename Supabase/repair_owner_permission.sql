-- FRNXUP OWNER PROFILE RECOVERY (manual, privileged operation)
-- Run this ONLY in the Supabase SQL Editor for the Frnxup project.
-- Replace the placeholder with the exact email used by the platform owner to sign in.
-- This script changes only that one Auth user's profile to role=owner and account_status=active.
-- It does not expose an owner-promotion endpoint to website visitors.

do $$
declare
  target_email text := lower(trim('REPLACE_WITH_OWNER_EMAIL'));
  target_user_id uuid;
  requested_username text;
  safe_username text;
  display_label text;
  suffix integer := 0;
begin
  if target_email = '' or target_email = 'replace_with_owner_email' or position('@' in target_email) < 2 then
    raise exception 'Edit target_email in this script and enter the exact platform owner sign-in email.';
  end if;

  select u.id,
         coalesce(nullif(u.raw_user_meta_data->>'username',''), split_part(u.email,'@',1)),
         coalesce(nullif(u.raw_user_meta_data->>'display_name',''), split_part(u.email,'@',1))
    into target_user_id, requested_username, display_label
    from auth.users u
   where lower(u.email) = target_email;

  if target_user_id is null then
    raise exception 'No Auth user was found for %. Check the email and Supabase project.', target_email;
  end if;

  -- Keep an existing profile username. Create a unique one only when the profile row is missing.
  select p.username into safe_username
    from public.profiles p where p.id = target_user_id;

  if safe_username is null then
    safe_username := lower(regexp_replace(coalesce(requested_username,''), '[^a-zA-Z0-9_]', '', 'g'));
    safe_username := left(safe_username, 24);
    if length(safe_username) < 3 then
      safe_username := 'owner_' || left(replace(target_user_id::text,'-',''), 8);
    end if;
    while exists(select 1 from public.profiles p where lower(p.username)=lower(safe_username) and p.id<>target_user_id) loop
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

  raise notice 'Owner permissions restored for Auth user %.', target_user_id;
end $$;

-- Verification: this should return exactly one row with role=owner and account_status=active.
select u.email, p.id as profile_id, p.username, p.role, p.account_status
  from auth.users u
  join public.profiles p on p.id = u.id
 where lower(u.email) = lower('REPLACE_WITH_OWNER_EMAIL');
