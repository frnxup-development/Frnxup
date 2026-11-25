-- EDU-AFRIKA Student Challenge Arena: friend directory and scheduled invitations.
-- Apply AFTER the core Student Challenge Arena migration.

create table if not exists public.edu_challenge_invites (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null unique references public.edu_challenges(id) on delete cascade,
  sender_id uuid not null references public.edu_students(user_id) on delete cascade,
  recipient_id uuid not null references public.edu_students(user_id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','reschedule_requested','accepted','started','completed','declined','cancelled','expired')),
  scheduled_at timestamptz not null,
  proposed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint edu_challenge_invites_distinct_students check (sender_id <> recipient_id)
);
create index if not exists edu_challenge_invites_recipient_idx
  on public.edu_challenge_invites(recipient_id,status,scheduled_at);
create index if not exists edu_challenge_invites_sender_idx
  on public.edu_challenge_invites(sender_id,status,scheduled_at);

alter table public.edu_challenge_invites enable row level security;
revoke all on public.edu_challenge_invites from public,anon,authenticated;

-- Return the EDU-AFRIKA participant directory by Frnxup username. Email addresses
-- and password/account secrets are never returned. Friendships are clearly marked.
create or replace function public.edu_challenge_student_directory(
  p_password text,
  p_search text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table(user_id uuid,username text,display_name text,is_friend boolean)
language plpgsql security definer set search_path=public,auth as $$
declare v_user uuid:=public.edu_challenge_assert_access(p_password); v_search text:=nullif(btrim(coalesce(p_search,'')),'');
begin
  return query
  select p.id,p.username,p.display_name,
    exists(select 1 from public.friendships f where
      (f.user_a=v_user and f.user_b=p.id) or (f.user_a=p.id and f.user_b=v_user)) as is_friend
  from public.edu_students s
  join public.profiles p on p.id=s.user_id
  where p.id<>v_user and p.account_status='active'
    and (v_search is null or p.username ilike '%'||v_search||'%' or p.display_name ilike '%'||v_search||'%')
    and not exists(select 1 from public.user_blocks b where
      (b.blocker_id=v_user and b.blocked_id=p.id) or (b.blocker_id=p.id and b.blocked_id=v_user))
  order by p.username
  limit least(greatest(coalesce(p_limit,100),1),100)
  offset greatest(coalesce(p_offset,0),0);
end;
$$;
revoke all on function public.edu_challenge_student_directory(text,text,integer,integer) from public,anon;
grant execute on function public.edu_challenge_student_directory(text,text,integer,integer) to authenticated;
