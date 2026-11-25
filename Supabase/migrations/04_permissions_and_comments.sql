revoke all on function public.edu_make_password() from public,anon,authenticated;
revoke all on function public.edu_is_active_frnxup_member() from public,anon,authenticated;
revoke all on function public.edu_portal_status() from public,anon;
revoke all on function public.edu_register_student() from public,anon;
revoke all on function public.edu_student_login(text) from public,anon;
revoke all on function public.edu_recover_password() from public,anon;
revoke all on function public.edu_available_subjects(text) from public,anon;
revoke all on function public.edu_start_exam(text,text,text[],text[],integer) from public,anon;
revoke all on function public.edu_get_active_attempt(text) from public,anon;
revoke all on function public.edu_save_answer(text,uuid,text) from public,anon;
revoke all on function public.edu_submit_exam(text,uuid,jsonb) from public,anon;
revoke all on function public.edu_get_student_history(text) from public,anon;
revoke all on function public.edu_admin_summary() from public,anon;

grant execute on function public.edu_portal_status() to authenticated;
grant execute on function public.edu_register_student() to authenticated;
grant execute on function public.edu_student_login(text) to authenticated;
grant execute on function public.edu_recover_password() to authenticated;
grant execute on function public.edu_available_subjects(text) to authenticated;
grant execute on function public.edu_start_exam(text,text,text[],text[],integer) to authenticated;
grant execute on function public.edu_get_active_attempt(text) to authenticated;
grant execute on function public.edu_save_answer(text,uuid,text) to authenticated;
grant execute on function public.edu_submit_exam(text,uuid,jsonb) to authenticated;
grant execute on function public.edu_get_student_history(text) to authenticated;
grant execute on function public.edu_admin_summary() to authenticated;

comment on table public.edu_questions is 'Administrator-authored question bank used by EDU-AFRIKA to assemble randomized student tests.';
comment on table public.edu_attempt_items is 'Private exam snapshots and answer keys; member access is only through protected scoring RPCs.';
