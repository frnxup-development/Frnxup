-- Frnxup admin member suspension/deletion permissions.
-- Run this in the SQL Editor of the same Supabase project used by Frnxup.
-- Only the Edge Function's service_role receives these privileges. Do NOT grant
-- profile updates or deletes to anon/authenticated browser users.

grant usage on schema public to service_role;

do $grant_admin_profile_permissions$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'Required table public.profiles was not found. Confirm this SQL is running in the Frnxup Supabase project.';
  end if;

  execute 'grant select, update, delete on table public.profiles to service_role';

  -- Compatibility for installations that also have a legacy singular profile
  -- table. The Frnxup admin-control Edge Function uses public.profiles.
  if to_regclass('public.profile') is not null then
    execute 'grant select, update, delete on table public.profile to service_role';
  end if;
end
$grant_admin_profile_permissions$;

-- Ensure RLS remains enabled. The service_role bypasses RLS; normal browser
-- sessions remain governed by the existing member-facing policies.
alter table public.profiles enable row level security;

-- Verify the service_role table privileges after the grants above.
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'profiles'
  and grantee = 'service_role'
  and privilege_type in ('SELECT', 'UPDATE', 'DELETE')
order by privilege_type;
