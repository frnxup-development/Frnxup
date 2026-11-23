-- Keep optional MFA enforcement compatible with ordinary password sessions.
-- Members without a verified factor may access RLS-protected data at aal1.
-- Members with a verified phone/TOTP factor must use aal2.
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
        array[coalesce((select auth.jwt()->>'aal'), 'aal1')] <@ (
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
        array[coalesce((select auth.jwt()->>'aal'), 'aal1')] <@ (
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
