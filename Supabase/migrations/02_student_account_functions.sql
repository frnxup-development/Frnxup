create or replace function public.edu_make_password()
returns text language plpgsql volatile security definer set search_path=public,extensions as $$
declare v_letters constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'; v_digits constant text := '23456789'; v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; v_password text := ''; v_index integer;
begin
  -- Guarantee at least one letter and one number in every generated 12-character password.
  v_password := substr(v_letters,1+(get_byte(gen_random_bytes(1),0)%length(v_letters)),1) || substr(v_digits,1+(get_byte(gen_random_bytes(1),0)%length(v_digits)),1);
  for v_index in 3..12 loop
    v_password := v_password || substr(v_alphabet, 1 + (get_byte(gen_random_bytes(1),0) % length(v_alphabet)), 1);
  end loop;
  return v_password;
end;
$$;

create or replace function public.edu_is_active_frnxup_member()
returns boolean language sql stable security definer set search_path=public,auth as $$
  select auth.uid() is not null and exists(select 1 from public.profiles where id=auth.uid() and account_status='active')
$$;

create or replace function public.edu_portal_status()
returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare v_user uuid := auth.uid(); v_email text; v_name text; v_exists boolean;
begin
  if v_user is null then raise exception 'Sign in to your Frnxup account to continue.'; end if;
  select email into v_email from auth.users where id=v_user;
  select coalesce(display_name,username,'EDU-AFRIKA Student') into v_name from public.profiles where id=v_user and account_status='active';
  if v_name is null then raise exception 'Your Frnxup account is not active.'; end if;
  select exists(select 1 from public.edu_students where user_id=v_user) into v_exists;
  return jsonb_build_object('registered',v_exists,'email',v_email,'display_name',v_name);
end;
$$;

create or replace function public.edu_register_student()
returns jsonb language plpgsql security definer set search_path=public,auth,extensions as $$
declare v_user uuid := auth.uid(); v_email text; v_confirmed timestamptz; v_name text; v_password text;
begin
  if v_user is null then raise exception 'Sign in to your Frnxup account first.'; end if;
  select email,email_confirmed_at into v_email,v_confirmed from auth.users where id=v_user;
  if v_email is null or v_confirmed is null then raise exception 'Verify your Frnxup email address before creating an EDU-AFRIKA account.'; end if;
  select coalesce(display_name,username,'EDU-AFRIKA Student') into v_name from public.profiles where id=v_user and account_status='active';
  if v_name is null then raise exception 'Your Frnxup account is not active.'; end if;
  if exists(select 1 from public.edu_students where user_id=v_user) then raise exception 'An EDU-AFRIKA account already exists. Sign in with your EDU password.'; end if;
  v_password := public.edu_make_password();
  insert into public.edu_students(user_id,email,display_name,password_hash)
  values(v_user,lower(v_email),v_name,crypt(v_password,gen_salt('bf')));
  return jsonb_build_object('ok',true,'password',v_password,'email',v_email,'display_name',v_name);
end;
$$;

create or replace function public.edu_student_login(p_password text)
returns jsonb language plpgsql security definer set search_path=public,auth,extensions as $$
declare v_user uuid := auth.uid(); v_hash text; v_email text;
begin
  if v_user is null then raise exception 'Sign in to your Frnxup account first.'; end if;
  if not public.edu_is_active_frnxup_member() then raise exception 'Your Frnxup account is not active.'; end if;
  if p_password is null or length(p_password)<8 then raise exception 'Enter your 12-character EDU-AFRIKA password.'; end if;
  select password_hash,email into v_hash,v_email from public.edu_students where user_id=v_user;
  if v_hash is null or crypt(p_password,v_hash)<>v_hash then raise exception 'The EDU-AFRIKA password is incorrect.'; end if;
  update public.edu_students set last_login_at=now(),updated_at=now(),email=lower((select email from auth.users where id=v_user)) where user_id=v_user;
  return jsonb_build_object('ok',true,'email',v_email);
end;
$$;

create or replace function public.edu_recover_password()
returns jsonb language plpgsql security definer set search_path=public,auth,extensions as $$
declare v_user uuid := auth.uid(); v_email text; v_confirmed timestamptz; v_password text;
begin
  if v_user is null then raise exception 'Sign in to your Frnxup account first.'; end if;
  if not public.edu_is_active_frnxup_member() then raise exception 'Your Frnxup account is not active.'; end if;
  select email,email_confirmed_at into v_email,v_confirmed from auth.users where id=v_user;
  if v_email is null or v_confirmed is null then raise exception 'A verified Frnxup email is required to reset your EDU password.'; end if;
  if not exists(select 1 from public.edu_students where user_id=v_user) then raise exception 'No EDU-AFRIKA account was found for this Frnxup account.'; end if;
  v_password := public.edu_make_password();
  update public.edu_students set password_hash=crypt(v_password,gen_salt('bf')),email=lower(v_email),updated_at=now() where user_id=v_user;
  return jsonb_build_object('ok',true,'password',v_password,'email',v_email);
end;
$$;

create or replace function public.edu_available_subjects(p_exam_code text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to Frnxup to continue.'; end if;
  if not public.edu_is_active_frnxup_member() then raise exception 'Your Frnxup account is not active.'; end if;
  if not exists(select 1 from public.edu_exam_types where code=upper(p_exam_code) and is_active) then raise exception 'This examination is not currently available.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('code',s.code,'name',s.name,'question_count',q.cnt) order by s.sort_order,s.name),'[]'::jsonb)
  into v_result
  from public.edu_subjects s
  join (select subject_code,count(*)::integer cnt from public.edu_questions where is_active and upper(p_exam_code)=any(exam_codes) group by subject_code) q on q.subject_code=s.code
  where s.is_active;
  return v_result;
end;
$$;
