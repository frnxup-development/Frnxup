-- EDU-AFRIKA intelligent engine migration Part 4/7: student programme lookup RPC.
-- Run after the previous numbered migration. Execute this file by itself.

-- EDU-AFRIKA intelligent exam engine / Part 2 of 3: course lookup and strict no-repeat exam distribution.
-- Run immediately after 20261125_edu_afrika_intelligent_engine_01_schema.sql.

-- Student programme lookup. Only verified active combinations are returned.
-- -----------------------------------------------------------------------------
create or replace function public.edu_get_exam_programmes(p_exam_code text)
returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to Frnxup to continue.'; end if;
  if not public.edu_is_active_frnxup_member() then raise exception 'Your Frnxup account is not active.'; end if;
  if not exists(select 1 from public.edu_exam_types where code=upper(p_exam_code) and is_active) then raise exception 'This examination is not currently available.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',p.id,'code',p.programme_code,'name',p.programme_name,'type',p.programme_type,
      'institution_name',p.institution_name,'syllabus_year',p.syllabus_year,
      'required_subject_codes',p.required_subject_codes,'allowed_subject_codes',p.allowed_subject_codes,
      'min_subject_count',p.min_subject_count,'max_subject_count',p.max_subject_count,'instructions',p.instructions,'selection_rules',p.selection_rules
    ) order by p.programme_name,p.institution_name),'[]'::jsonb)
  into v_result from public.edu_exam_programmes p
  where p.exam_code=upper(p_exam_code) and p.is_active and p.is_verified;
  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- Question distribution: normalized question content is issued only once across
-- EDU-AFRIKA, unique paper fingerprints, and blueprint-weighted allocation.
-- -----------------------------------------------------------------------------
