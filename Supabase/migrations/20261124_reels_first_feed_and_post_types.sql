-- Frnxup Reels-first feed: explicit post categories for Reels, videos, images and text.
-- Additive migration. Existing posts and media are preserved.

alter table public.posts
  add column if not exists content_type text not null default 'text';

-- Preserve earlier video uploads from the first Reels release by surfacing them
-- under Reels. Existing image and text posts retain their natural categories.
update public.posts
set content_type = case
  when media_type = 'video' then 'reel'
  when media_type = 'image' then 'image'
  else 'text'
end
where content_type = 'text' or content_type is null;

alter table public.posts alter column content_type set default 'text';
alter table public.posts alter column content_type set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'posts_content_type_check'
      and conrelid = 'public.posts'::regclass
  ) then
    alter table public.posts
      add constraint posts_content_type_check
      check (content_type in ('text','image','video','reel'));
  end if;
end $$;

-- Compatibility for existing page/post creation code that does not yet send
-- content_type: infer image/video from media_type. Explicit 'reel' remains 'reel'.
create or replace function public.frnxup_sync_post_content_type()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.content_type is null or new.content_type = 'text' then
    if new.media_type = 'image' then
      new.content_type := 'image';
    elsif new.media_type = 'video' then
      new.content_type := 'video';
    else
      new.content_type := 'text';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_frnxup_sync_post_content_type on public.posts;
create trigger trg_frnxup_sync_post_content_type
before insert or update of media_type, content_type on public.posts
for each row execute function public.frnxup_sync_post_content_type();

create index if not exists posts_feed_content_type_idx
  on public.posts(status, content_type, created_at desc);

comment on column public.posts.content_type is
  'Feed category: text, image, video or reel. Reels are short-form video posts.';
