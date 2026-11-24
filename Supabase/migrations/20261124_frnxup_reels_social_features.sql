-- Frnxup Reels: member follows, profile follow counts, reel views and MOV storage support.
-- This migration adds only the supporting social tables/functions used by the Reels UI.

create table if not exists public.user_follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

create index if not exists user_follows_following_idx
  on public.user_follows(following_id, created_at desc);

alter table public.user_follows enable row level security;

drop policy if exists user_follows_read_own on public.user_follows;
create policy user_follows_read_own
  on public.user_follows for select to authenticated
  using (follower_id = auth.uid() or following_id = auth.uid());

drop policy if exists user_follows_insert_own on public.user_follows;
create policy user_follows_insert_own
  on public.user_follows for insert to authenticated
  with check (
    follower_id = auth.uid()
    and follower_id <> following_id
    and public.user_is_active(auth.uid())
    and exists (
      select 1 from public.profiles target
      where target.id = following_id and target.account_status = 'active'
    )
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = following_id)
         or (b.blocker_id = following_id and b.blocked_id = auth.uid())
    )
  );

drop policy if exists user_follows_delete_own on public.user_follows;
create policy user_follows_delete_own
  on public.user_follows for delete to authenticated
  using (follower_id = auth.uid());

grant select, insert, delete on public.user_follows to authenticated;

-- Return aggregate profile counts without exposing the complete follow graph.
create or replace function public.frnxup_user_follow_counts(p_profile_id uuid)
returns table(followers bigint, following bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from public.user_follows f where f.following_id = p_profile_id),
    (select count(*) from public.user_follows f where f.follower_id = p_profile_id)
  where exists (
    select 1 from public.profiles p
    where p.id = p_profile_id and p.account_status = 'active'
  );
$$;
revoke all on function public.frnxup_user_follow_counts(uuid) from public;
grant execute on function public.frnxup_user_follow_counts(uuid) to anon, authenticated;

-- Count distinct signed-in viewers per public published Reel.
create table if not exists public.frnxup_reel_views (
  post_id uuid not null references public.posts(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, viewer_id)
);

create index if not exists frnxup_reel_views_post_idx
  on public.frnxup_reel_views(post_id, created_at desc);

alter table public.frnxup_reel_views enable row level security;

drop policy if exists frnxup_reel_views_read_public on public.frnxup_reel_views;
create policy frnxup_reel_views_read_public
  on public.frnxup_reel_views for select to authenticated
  using (
    exists (
      select 1 from public.posts p
      where p.id = post_id
        and p.status = 'published'
        and p.media_type = 'video'
        and p.visibility = 'public'
        and not exists (
          select 1 from public.user_blocks b
          where (b.blocker_id = auth.uid() and b.blocked_id = p.user_id)
             or (b.blocker_id = p.user_id and b.blocked_id = auth.uid())
        )
    )
  );

drop policy if exists frnxup_reel_views_insert_own on public.frnxup_reel_views;
create policy frnxup_reel_views_insert_own
  on public.frnxup_reel_views for insert to authenticated
  with check (
    viewer_id = auth.uid()
    and public.user_is_active(auth.uid())
    and exists (
      select 1 from public.posts p
      where p.id = post_id
        and p.status = 'published'
        and p.media_type = 'video'
        and p.visibility = 'public'
        and not exists (
          select 1 from public.user_blocks b
          where (b.blocker_id = auth.uid() and b.blocked_id = p.user_id)
             or (b.blocker_id = p.user_id and b.blocked_id = auth.uid())
        )
    )
  );

grant select, insert on public.frnxup_reel_views to authenticated;

-- The upload dialog accepts MOV files as well as MP4/WebM. Keep existing image
-- and audio MIME types while explicitly allowing QuickTime video containers.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'frnxup-media',
  'frnxup-media',
  false,
  104857600,
  array[
    'image/jpeg','image/png','image/webp','image/gif',
    'video/mp4','video/webm','video/quicktime',
    'audio/mpeg','audio/mp4','audio/webm','audio/ogg'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = 104857600,
    allowed_mime_types = excluded.allowed_mime_types;
