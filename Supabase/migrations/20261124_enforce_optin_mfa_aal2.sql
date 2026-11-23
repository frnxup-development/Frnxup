-- Require AAL2 for accounts that have opted into Supabase MFA.
-- Users without a verified factor keep the existing aal1/aal2 behavior.
-- This is a RESTRICTIVE policy, so it combines with (and cannot be bypassed by)
-- the existing table policies. It also covers all public RLS-enabled tables
-- already present in this project when the migration is applied.
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
    execute format($policy$
      create policy frnxup_mfa_aal2_optin
      on %I.%I
      as restrictive
      for all
      to authenticated
      using (
        array[(select auth.jwt()->>'aal')] <@ (
          select case
            when count(id) > 0 then array['aal2']
            else array['aal1','aal2']
          end
          from auth.mfa_factors
          where user_id = (select auth.uid())
            and status = 'verified'
        )
      )
      with check (
        array[(select auth.jwt()->>'aal')] <@ (
          select case
            when count(id) > 0 then array['aal2']
            else array['aal1','aal2']
          end
          from auth.mfa_factors
          where user_id = (select auth.uid())
            and status = 'verified'
        )
      )
    $policy$, target.schema_name, target.table_name);
  end loop;
end $$;

commit;
