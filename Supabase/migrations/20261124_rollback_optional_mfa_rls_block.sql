-- Roll back the restrictive optional-MFA RLS policy that caused profile reads
-- after password authentication to fail with SQLSTATE 42501.
-- This removes only policies named frnxup_mfa_aal2_optin.
begin;

do $$
declare
  target record;
begin
  for target in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity = true
  loop
    execute format('drop policy if exists frnxup_mfa_aal2_optin on %I.%I', target.schema_name, target.table_name);
  end loop;
end $$;

commit;
