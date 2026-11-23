-- Frnxup Page dashboard actions: media, CTA, visibility, archive, activity,
-- highlights, stories and advertising enquiries. Safe to run more than once.

-- Add owner-configurable Page presentation fields.
alter table public.frnxup_pages
  add column if not exists visibility_mode text not null default 'public',
  add column if not exists action_button_enabled boolean not null default false,
  add column if not exists action_button_label text,
  add column if not exists action_button_url text;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname='frnxup_pages_visibility_mode_check'
      and conrelid='public.frnxup_pages'::regclass
  ) then
    alter table public.frnxup_pages
      add constraint frnxup_pages_visibility_mode_check
      check (visibility_mode in ('public','hidden'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname='frnxup_pages_action_button_label_check'
      and conrelid='public.frnxup_pages'::regclass
  ) then
    alter table public.frnxup_pages
      add constraint frnxup_pages_action_button_label_check
      check (action_button_label is null or char_length(action_button_label) between 2 and 40);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname='frnxup_pages_action_button_url_check'
      and conrelid='public.frnxup_pages'::regclass
  ) then
    alter table public.frnxup_pages
      add constraint frnxup_pages_action_button_url_check
      check (action_button_url is null or action_button_url ~* '^https?://');
  end if;
end $$;

-- Owner-visible activity history for actions performed from the Page workspace.
create table if not exists public.frnxup_page_activity (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.frnxup_pages(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  action text not null check(char_length(action) between 2 and 80),
  details jsonb not null default '{}'::jsonb check(jsonb_typeof(details)='object'),
  created_at timestamptz not null default now()
);
create index if not exists frnxup_page_activity_page_idx
  on public.frnxup_page_activity(page_id,created_at desc);

-- Archiving is reversible and does not delete the underlying post or its media.
create table if not exists public.frnxup_page_post_archive (
  page_id uuid not null references public.frnxup_pages(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  archived_by uuid not null references public.profiles(id) on delete cascade,
  archived_at timestamptz not null default now(),
  primary key(page_id,post_id)
);
create index if not exists frnxup_page_post_archive_time_idx
  on public.frnxup_page_post_archive(page_id,archived_at desc);

-- Page highlights are featured image cards, separate from normal feed posts.
create table if not exists public.frnxup_page_highlights (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.frnxup_pages(id) on delete cascade,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check(char_length(title) between 1 and 80),
  media_path text not null,
  media_type text not null default 'image' check(media_type='image'),
  created_at timestamptz not null default now(),
  constraint frnxup_page_highlights_media_unique unique(media_path)
);
create index if not exists frnxup_page_highlights_page_idx
  on public.frnxup_page_highlights(page_id,created_at desc);

-- A Page story is removed from public reads after 24 hours (no manual cleanup required).
create table if not exists public.frnxup_page_stories (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.frnxup_pages(id) on delete cascade,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  media_path text not null unique,
  media_type text not null check(media_type in ('image','video')),
  caption text not null default '' check(char_length(caption)<=500),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '24 hours'),
  check(expires_at>created_at)
);
create index if not exists frnxup_page_stories_page_idx
  on public.frnxup_page_stories(page_id,created_at desc);

-- Advertising enquiries are requests only; they do not activate ads or collect payments.
create table if not exists public.frnxup_page_ad_requests (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.frnxup_pages(id) on delete cascade,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  objective text not null check(char_length(objective) between 3 and 100),
  budget_label text check(budget_label is null or char_length(budget_label)<=80),
  destination_url text check(destination_url is null or destination_url ~* '^https?://'),
  notes text check(notes is null or char_length(notes)<=1500),
  status text not null default 'pending' check(status in ('pending','reviewing','approved','rejected','completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists frnxup_page_ad_requests_owner_idx
  on public.frnxup_page_ad_requests(owner_user_id,created_at desc);

-- Validate ownership and the relationship before a post is archived.
create or replace function public.frnxup_guard_page_post_archive()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if new.archived_by is distinct from auth.uid() then
    raise exception 'The signed-in Page owner must archive the post.';
  end if;
  if not exists (
    select 1 from public.frnxup_pages p
    join public.posts po on po.page_id=p.id
    where p.id=new.page_id and p.owner_user_id=auth.uid()
      and po.id=new.post_id and po.user_id=auth.uid()
  ) then
    raise exception 'You can only archive posts published by your own Page.';
  end if;
  return new;
end $$;
drop trigger if exists frnxup_guard_page_post_archive_trigger on public.frnxup_page_post_archive;
create trigger frnxup_guard_page_post_archive_trigger
before insert on public.frnxup_page_post_archive
for each row execute function public.frnxup_guard_page_post_archive();

-- RLS for all new Page workspace tables.
alter table public.frnxup_page_activity enable row level security;
alter table public.frnxup_page_post_archive enable row level security;
alter table public.frnxup_page_highlights enable row level security;
alter table public.frnxup_page_stories enable row level security;
alter table public.frnxup_page_ad_requests enable row level security;

drop policy if exists frnxup_page_activity_owner_read on public.frnxup_page_activity;
create policy frnxup_page_activity_owner_read on public.frnxup_page_activity
  for select to authenticated using(public.frnxup_owns_page(page_id));
drop policy if exists frnxup_page_activity_owner_insert on public.frnxup_page_activity;
create policy frnxup_page_activity_owner_insert on public.frnxup_page_activity
  for insert to authenticated with check(actor_id=auth.uid() and public.frnxup_owns_page(page_id));
grant select,insert on public.frnxup_page_activity to authenticated;

drop policy if exists frnxup_page_archive_owner_read on public.frnxup_page_post_archive;
create policy frnxup_page_archive_owner_read on public.frnxup_page_post_archive
  for select to authenticated using(public.frnxup_owns_page(page_id));
drop policy if exists frnxup_page_archive_owner_insert on public.frnxup_page_post_archive;
create policy frnxup_page_archive_owner_insert on public.frnxup_page_post_archive
  for insert to authenticated with check(archived_by=auth.uid() and public.frnxup_owns_page(page_id));
drop policy if exists frnxup_page_archive_owner_delete on public.frnxup_page_post_archive;
create policy frnxup_page_archive_owner_delete on public.frnxup_page_post_archive
  for delete to authenticated using(public.frnxup_owns_page(page_id));
grant select,insert,delete on public.frnxup_page_post_archive to authenticated;

drop policy if exists frnxup_page_highlights_read on public.frnxup_page_highlights;
create policy frnxup_page_highlights_read on public.frnxup_page_highlights
  for select to anon,authenticated using(
    exists(select 1 from public.frnxup_pages p where p.id=page_id and p.status='active'
      and (p.owner_user_id=auth.uid() or p.visibility_mode='public'))
  );
drop policy if exists frnxup_page_highlights_owner_insert on public.frnxup_page_highlights;
create policy frnxup_page_highlights_owner_insert on public.frnxup_page_highlights
  for insert to authenticated with check(owner_user_id=auth.uid() and public.frnxup_owns_page(page_id));
drop policy if exists frnxup_page_highlights_owner_delete on public.frnxup_page_highlights;
create policy frnxup_page_highlights_owner_delete on public.frnxup_page_highlights
  for delete to authenticated using(owner_user_id=auth.uid() and public.frnxup_owns_page(page_id));
grant select on public.frnxup_page_highlights to anon,authenticated;
grant insert,delete on public.frnxup_page_highlights to authenticated;

drop policy if exists frnxup_page_stories_read on public.frnxup_page_stories;
create policy frnxup_page_stories_read on public.frnxup_page_stories
  for select to anon,authenticated using(expires_at>now() and exists(
    select 1 from public.frnxup_pages p where p.id=page_id and p.status='active'
      and (p.owner_user_id=auth.uid() or p.visibility_mode='public')
  ));
drop policy if exists frnxup_page_stories_owner_insert on public.frnxup_page_stories;
create policy frnxup_page_stories_owner_insert on public.frnxup_page_stories
  for insert to authenticated with check(owner_user_id=auth.uid() and public.frnxup_owns_page(page_id));
drop policy if exists frnxup_page_stories_owner_delete on public.frnxup_page_stories;
create policy frnxup_page_stories_owner_delete on public.frnxup_page_stories
  for delete to authenticated using(owner_user_id=auth.uid() and public.frnxup_owns_page(page_id));
grant select on public.frnxup_page_stories to anon,authenticated;
grant insert,delete on public.frnxup_page_stories to authenticated;

drop policy if exists frnxup_page_ad_requests_owner_read on public.frnxup_page_ad_requests;
create policy frnxup_page_ad_requests_owner_read on public.frnxup_page_ad_requests
  for select to authenticated using(owner_user_id=auth.uid() and public.frnxup_owns_page(page_id));
drop policy if exists frnxup_page_ad_requests_owner_insert on public.frnxup_page_ad_requests;
create policy frnxup_page_ad_requests_owner_insert on public.frnxup_page_ad_requests
  for insert to authenticated with check(owner_user_id=auth.uid() and public.frnxup_owns_page(page_id));
grant select,insert on public.frnxup_page_ad_requests to authenticated;

-- Owners may switch a Page between public and hidden. Frnxup moderation still controls
-- the separate active/suspended/removed status column.
drop policy if exists frnxup_pages_public_read on public.frnxup_pages;
create policy frnxup_pages_public_read on public.frnxup_pages
  for select to anon,authenticated using(
    (status='active' and visibility_mode='public')
    or owner_user_id=auth.uid() or public.is_moderator()
  );

drop policy if exists frnxup_page_followers_insert on public.frnxup_page_followers;
create policy frnxup_page_followers_insert on public.frnxup_page_followers
  for insert to authenticated with check(
    user_id=auth.uid() and not public.frnxup_owns_page(page_id)
    and exists(select 1 from public.frnxup_pages p where p.id=page_id and p.status='active' and p.visibility_mode='public')
    and public.user_is_active(auth.uid())
  );

-- Security-definer lookup lets public post-feed RLS check an owner's private archive record.
create or replace function public.frnxup_is_page_post_archived(p_page_id uuid,p_post_id uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.frnxup_page_post_archive a where a.page_id=p_page_id and a.post_id=p_post_id) $$;
revoke all on function public.frnxup_is_page_post_archived(uuid,uuid) from public;
grant execute on function public.frnxup_is_page_post_archived(uuid,uuid) to anon,authenticated;

-- Archived Page posts remain visible to their owner, but are excluded from public/follower feeds.
drop policy if exists posts_read on public.posts;
create policy posts_read on public.posts for select to anon,authenticated using(
  status='published' and (
    (page_id is null and (user_id=auth.uid() or visibility='public' or (visibility='friends' and public.are_friends(auth.uid(),user_id)))
      and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=user_id) or (b.blocker_id=user_id and b.blocked_id=auth.uid())))
    or (page_id is not null and exists(
      select 1 from public.frnxup_pages p
      where p.id=posts.page_id and p.status='active'
        and (p.owner_user_id=auth.uid() or (p.visibility_mode='public' and (posts.visibility='public' or public.frnxup_is_page_follower(p.id))))
        and (p.owner_user_id=auth.uid() or not public.frnxup_is_page_post_archived(p.id,posts.id))
    ))
  )
);

-- Respect Page visibility for profile and cover media as well as highlights/stories.
drop policy if exists frnxup_page_media_read on storage.objects;
create policy frnxup_page_media_read on storage.objects
  for select to anon,authenticated using(bucket_id='frnxup-media' and exists(
    select 1 from public.frnxup_pages p
    where (p.avatar_path=name or p.cover_path=name) and p.status='active'
      and (p.visibility_mode='public' or p.owner_user_id=auth.uid())
  ));

-- Allow public signed media URLs for Page highlights and unexpired Page stories.
drop policy if exists frnxup_page_extra_media_read on storage.objects;
create policy frnxup_page_extra_media_read on storage.objects
  for select to anon,authenticated using(bucket_id='frnxup-media' and (
    exists(select 1 from public.frnxup_page_highlights h join public.frnxup_pages p on p.id=h.page_id
      where h.media_path=name and p.status='active' and (p.visibility_mode='public' or p.owner_user_id=auth.uid()))
    or exists(select 1 from public.frnxup_page_stories s join public.frnxup_pages p on p.id=s.page_id
      where s.media_path=name and s.expires_at>now() and p.status='active' and (p.visibility_mode='public' or p.owner_user_id=auth.uid()))
  ));

-- Keep the existing updated_at column behavior if the base table has a timestamp trigger.

-- Hidden Pages do not expose their follower counts to non-owners.
create or replace function public.frnxup_page_follower_count(p_page_id uuid)
returns bigint language plpgsql stable security definer set search_path=public
as $$
declare visible boolean; owner_id uuid; page_visibility text; total bigint;
begin
  select follower_count_visible,owner_user_id,visibility_mode
    into visible,owner_id,page_visibility
  from public.frnxup_pages where id=p_page_id and status='active';
  if not found then return null; end if;
  if page_visibility='hidden' and owner_id is distinct from auth.uid() then return null; end if;
  if not coalesce(visible,false) and owner_id is distinct from auth.uid() then return null; end if;
  select count(*) into total from public.frnxup_page_followers where page_id=p_page_id;
  return total;
end $$;
revoke all on function public.frnxup_page_follower_count(uuid) from public;
grant execute on function public.frnxup_page_follower_count(uuid) to anon,authenticated;

-- Keep the existing general media permissions while respecting Page visibility and archive state.
drop policy if exists frnxup_media_read_allowed on storage.objects;
create policy frnxup_media_read_allowed on storage.objects
for select to anon,authenticated using(bucket_id='frnxup-media' and (
  split_part(name,'/',1)=auth.uid()::text
  or exists(
    select 1 from public.profiles p
    where (p.avatar_path=name or p.cover_path=name)
      and (p.id=auth.uid() or p.profile_visibility='public' or (p.profile_visibility='friends' and public.are_friends(auth.uid(),p.id)))
      and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=p.id) or (b.blocker_id=p.id and b.blocked_id=auth.uid()))
  )
  or exists(
    select 1 from public.posts p
    where p.media_path=name and p.status='published'
      and (
        (p.page_id is null and (p.visibility='public' or p.user_id=auth.uid() or (p.visibility='friends' and public.are_friends(auth.uid(),p.user_id))))
        or (p.page_id is not null and exists(
          select 1 from public.frnxup_pages pg where pg.id=p.page_id and pg.status='active'
            and (pg.owner_user_id=auth.uid() or (pg.visibility_mode='public' and (p.visibility='public' or public.frnxup_is_page_follower(pg.id))))
            and (pg.owner_user_id=auth.uid() or not public.frnxup_is_page_post_archived(pg.id,p.id))
        ))
      )
      and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=p.user_id) or (b.blocker_id=p.user_id and b.blocked_id=auth.uid()))
  )
  or exists(
    select 1 from public.post_media pm join public.posts p on p.id=pm.post_id
    where pm.media_path=name and p.status='published'
      and (
        (p.page_id is null and (p.visibility='public' or p.user_id=auth.uid() or (p.visibility='friends' and public.are_friends(auth.uid(),p.user_id))))
        or (p.page_id is not null and exists(
          select 1 from public.frnxup_pages pg where pg.id=p.page_id and pg.status='active'
            and (pg.owner_user_id=auth.uid() or (pg.visibility_mode='public' and (p.visibility='public' or public.frnxup_is_page_follower(pg.id))))
            and (pg.owner_user_id=auth.uid() or not public.frnxup_is_page_post_archived(pg.id,p.id))
        ))
      )
      and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=p.user_id) or (b.blocker_id=p.user_id and b.blocked_id=auth.uid()))
  )
  or exists(
    select 1 from public.statuses s
    where s.media_path=name and s.expires_at>now()
      and (s.user_id=auth.uid() or s.visibility='public' or (s.visibility='friends' and public.are_friends(auth.uid(),s.user_id)))
      and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=s.user_id) or (b.blocker_id=s.user_id and b.blocked_id=auth.uid()))
  )
  or exists(
    select 1 from public.messages m
    where m.media_path=name and public.is_conversation_member(m.conversation_id)
      and not exists(select 1 from public.conversation_members cm join public.user_blocks b
        on ((b.blocker_id=auth.uid() and b.blocked_id=cm.user_id) or (b.blocker_id=cm.user_id and b.blocked_id=auth.uid()))
        where cm.conversation_id=m.conversation_id and cm.user_id<>auth.uid())
  )
  or exists(select 1 from public.verification_requests v where v.evidence_path=name and public.is_admin())
));
