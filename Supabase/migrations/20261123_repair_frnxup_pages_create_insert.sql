-- Frnxup Pages creation repair.
-- Run in Supabase SQL Editor as the project owner.
-- Safe to re-run. The web form uses the authenticated INSERT policy directly.

begin;

-- Ensure the expected Page columns exist even if an earlier partial migration ran.
alter table if exists public.frnxup_pages
  add column if not exists category text not null default 'Other',
  add column if not exists about text not null default '',
  add column if not exists avatar_path text,
  add column if not exists cover_path text,
  add column if not exists location text,
  add column if not exists website text,
  add column if not exists follower_count_visible boolean not null default true,
  add column if not exists status text not null default 'active',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- The initial Pages migration must have created the base table. Fail clearly if it did not.
do $$
begin
  if to_regclass('public.frnxup_pages') is null then
    raise exception 'public.frnxup_pages does not exist. Run Supabase/migrations/20261121_frnxup_pages.sql first.';
  end if;
  if to_regclass('public.profiles') is null then
    raise exception 'public.profiles does not exist. Restore the Frnxup core schema first.';
  end if;
end $$;

create unique index if not exists frnxup_pages_slug_uidx
  on public.frnxup_pages (slug);
create index if not exists frnxup_pages_owner_created_idx
  on public.frnxup_pages (owner_user_id, created_at desc);

alter table public.frnxup_pages enable row level security;

-- Keep public active Page discovery while ensuring owners can always read their own row.
drop policy if exists frnxup_pages_public_read on public.frnxup_pages;
create policy frnxup_pages_public_read
  on public.frnxup_pages for select to anon, authenticated
  using (status = 'active' or owner_user_id = auth.uid() or public.is_moderator());

-- A signed-in, active member may create a Page only for their own profile.
drop policy if exists frnxup_pages_insert_own on public.frnxup_pages;
create policy frnxup_pages_insert_own
  on public.frnxup_pages for insert to authenticated
  with check (
    owner_user_id = auth.uid()
    and status = 'active'
    and public.user_is_active(auth.uid())
  );

-- Owners may edit their own active Page without changing ownership or status.
drop policy if exists frnxup_pages_update_own on public.frnxup_pages;
create policy frnxup_pages_update_own
  on public.frnxup_pages for update to authenticated
  using (owner_user_id = auth.uid() and status = 'active')
  with check (owner_user_id = auth.uid() and status = 'active');

revoke delete on public.frnxup_pages from anon, authenticated;
grant select, insert, update on public.frnxup_pages to authenticated;
grant select on public.frnxup_pages to anon;

commit;

-- Verification query (run separately if desired):
-- select policyname, cmd, roles, qual, with_check
-- from pg_policies where schemaname='public' and tablename='frnxup_pages'
-- order by policyname;
