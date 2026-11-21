-- Multi-photo posts (up to 20 images) with ordered collage media.
create table if not exists public.post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  media_path text not null unique,
  media_type text not null check (media_type in ('image','video')),
  sort_order smallint not null check (sort_order between 1 and 20),
  created_at timestamptz not null default now(),
  unique(post_id, sort_order)
);
create index if not exists post_media_post_order_idx on public.post_media(post_id, sort_order);
alter table public.post_media enable row level security;

drop policy if exists post_media_read on public.post_media;
create policy post_media_read on public.post_media for select to anon, authenticated
using (exists (
  select 1 from public.posts p
  where p.id = post_id and p.status = 'published'
    and (p.user_id = auth.uid() or p.visibility = 'public' or (p.visibility = 'friends' and public.are_friends(auth.uid(), p.user_id)))
    and not exists (select 1 from public.user_blocks b where (b.blocker_id = auth.uid() and b.blocked_id = p.user_id) or (b.blocker_id = p.user_id and b.blocked_id = auth.uid()))
));

drop policy if exists post_media_insert_own on public.post_media;
create policy post_media_insert_own on public.post_media for insert to authenticated
with check (exists (
  select 1 from public.posts p
  where p.id = post_id and p.user_id = auth.uid() and p.status = 'published'
    and public.user_is_active(auth.uid()) and public.site_setting_enabled('posting_enabled', true)
    and public.site_setting_enabled('uploads_enabled', true)
));

drop policy if exists post_media_delete_own on public.post_media;
create policy post_media_delete_own on public.post_media for delete to authenticated
using (exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid()));

grant select on public.post_media to anon, authenticated;
grant insert, delete on public.post_media to authenticated;

-- At most 20 media rows per post; a post is either a photo set or one video.
create or replace function public.enforce_post_media_limits()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  current_count integer;
  current_type text;
begin
  select count(*), max(media_type) into current_count, current_type
  from public.post_media where post_id = new.post_id;
  if current_count >= 20 then
    raise exception 'A post can contain at most 20 photos.';
  end if;
  if current_type is not null and current_type <> new.media_type then
    raise exception 'Choose photos or one video. Mixed media posts are not supported.';
  end if;
  if new.media_type = 'video' and current_count > 0 then
    raise exception 'A video post can contain only one video.';
  end if;
  return new;
end $$;
drop trigger if exists trg_enforce_post_media_limits on public.post_media;
create trigger trg_enforce_post_media_limits before insert on public.post_media
for each row execute function public.enforce_post_media_limits();

-- Extend the existing private-bucket read policy to recognise media rows.
drop policy if exists frnxup_media_read_allowed on storage.objects;
create policy frnxup_media_read_allowed on storage.objects for select to anon, authenticated
using (bucket_id = 'frnxup-media' and (
  split_part(name, '/', 1) = auth.uid()::text or
  exists(select 1 from public.profiles p where (p.avatar_path = name or p.cover_path = name) and (p.id = auth.uid() or p.profile_visibility = 'public' or (p.profile_visibility = 'friends' and public.are_friends(auth.uid(), p.id))) and not exists(select 1 from public.user_blocks b where (b.blocker_id = auth.uid() and b.blocked_id = p.id) or (b.blocker_id = p.id and b.blocked_id = auth.uid()))) or
  exists(select 1 from public.posts p where p.media_path = name and p.status = 'published' and (p.visibility = 'public' or p.user_id = auth.uid() or (p.visibility = 'friends' and public.are_friends(auth.uid(), p.user_id))) and not exists(select 1 from public.user_blocks b where (b.blocker_id = auth.uid() and b.blocked_id = p.user_id) or (b.blocker_id = p.user_id and b.blocked_id = auth.uid()))) or
  exists(select 1 from public.post_media pm join public.posts p on p.id = pm.post_id where pm.media_path = name and p.status = 'published' and (p.visibility = 'public' or p.user_id = auth.uid() or (p.visibility = 'friends' and public.are_friends(auth.uid(), p.user_id))) and not exists(select 1 from public.user_blocks b where (b.blocker_id = auth.uid() and b.blocked_id = p.user_id) or (b.blocker_id = p.user_id and b.blocked_id = auth.uid()))) or
  exists(select 1 from public.statuses s where s.media_path = name and s.expires_at > now() and (s.user_id = auth.uid() or s.visibility = 'public' or (s.visibility = 'friends' and public.are_friends(auth.uid(), s.user_id))) and not exists(select 1 from public.user_blocks b where (b.blocker_id = auth.uid() and b.blocked_id = s.user_id) or (b.blocker_id = s.user_id and b.blocked_id = auth.uid()))) or
  exists(select 1 from public.messages m where m.media_path = name and public.is_conversation_member(m.conversation_id) and not exists(select 1 from public.conversation_members cm join public.user_blocks b on ((b.blocker_id = auth.uid() and b.blocked_id = cm.user_id) or (b.blocker_id = cm.user_id and b.blocked_id = auth.uid())) where cm.conversation_id = m.conversation_id and cm.user_id <> auth.uid())) or
  exists(select 1 from public.verification_requests v where v.evidence_path = name and public.is_admin())
));

-- Keep the new media records visible in the existing administrator activity ledger.
drop trigger if exists frnxup_activity_capture on public.post_media;
create trigger frnxup_activity_capture after insert or update or delete on public.post_media
for each row execute function public.frnxup_capture_activity();
