-- Frnxup messaging inbox, post menu, threaded comments and seven comment reactions.
-- Apply once in the Supabase SQL Editor before deploying the front-end patch.
begin;

-- Reposts remain ordinary feed posts but retain a pointer to the original post.
alter table public.posts
  add column if not exists repost_of uuid references public.posts(id) on delete set null;
create index if not exists posts_repost_of_idx on public.posts(repost_of) where repost_of is not null;

-- A comment can reply to any other comment on the same post; there is no depth cap.
alter table public.post_comments
  add column if not exists parent_id uuid references public.post_comments(id) on delete set null;
create index if not exists post_comments_thread_order_idx
  on public.post_comments(post_id, created_at asc, parent_id);

create or replace function public.frnxup_validate_comment_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare parent_post_id uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  select post_id into parent_post_id
  from public.post_comments
  where id = new.parent_id;

  if parent_post_id is null or parent_post_id <> new.post_id then
    raise exception 'A reply must belong to the same post as its parent comment';
  end if;

  return new;
end;
$$;

drop trigger if exists frnxup_validate_comment_parent_trigger on public.post_comments;
create trigger frnxup_validate_comment_parent_trigger
before insert or update of parent_id, post_id on public.post_comments
for each row execute function public.frnxup_validate_comment_parent();

-- Each member can keep one reaction per comment and change it at any time.
create table if not exists public.comment_reactions (
  comment_id uuid not null references public.post_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null check (reaction in ('like','love','haha','wow','sad','angry','support')),
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
create index if not exists comment_reactions_comment_idx on public.comment_reactions(comment_id);
alter table public.comment_reactions enable row level security;

grant select, insert, update, delete on public.comment_reactions to authenticated;

-- A deleted comment stays as a thread marker so its replies are preserved.
drop policy if exists comments_read on public.post_comments;
create policy comments_read on public.post_comments
for select to authenticated
using (
  status in ('published','deleted')
  and exists (
    select 1 from public.posts p
    where p.id = post_id and p.status = 'published'
      and (p.user_id = auth.uid() or p.visibility = 'public'
        or (p.visibility = 'friends' and public.are_friends(auth.uid(), p.user_id)))
      and not exists (
        select 1 from public.user_blocks b
        where (b.blocker_id = auth.uid() and b.blocked_id = p.user_id)
           or (b.blocker_id = p.user_id and b.blocked_id = auth.uid())
      )
  )
);

drop policy if exists comments_update on public.post_comments;
create policy comments_update on public.post_comments
for update to authenticated
using (user_id = auth.uid() and status = 'published' and public.user_is_active(auth.uid()))
with check (user_id = auth.uid() and status in ('published','deleted') and public.user_is_active(auth.uid()));

drop policy if exists comment_reactions_read on public.comment_reactions;
create policy comment_reactions_read on public.comment_reactions
for select to authenticated
using (
  exists (
    select 1 from public.post_comments c
    join public.posts p on p.id = c.post_id
    where c.id = comment_id and c.status in ('published','deleted') and p.status = 'published'
      and (p.user_id = auth.uid() or p.visibility = 'public'
        or (p.visibility = 'friends' and public.are_friends(auth.uid(), p.user_id)))
  )
);

drop policy if exists comment_reactions_insert on public.comment_reactions;
create policy comment_reactions_insert on public.comment_reactions
for insert to authenticated
with check (
  user_id = auth.uid() and public.user_is_active(auth.uid())
  and exists (select 1 from public.post_comments c where c.id = comment_id and c.status = 'published')
);

drop policy if exists comment_reactions_update on public.comment_reactions;
create policy comment_reactions_update on public.comment_reactions
for update to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and exists (select 1 from public.post_comments c where c.id = comment_id and c.status = 'published')
);

drop policy if exists comment_reactions_delete on public.comment_reactions;
create policy comment_reactions_delete on public.comment_reactions
for delete to authenticated
using (user_id = auth.uid());

commit;
