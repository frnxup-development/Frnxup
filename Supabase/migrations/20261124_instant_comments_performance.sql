-- Frnxup instant comments performance indexes and secure reply-count RPC.
-- Apply after 20261124_unified_multimedia_comments.sql.
begin;

-- Fast first-page fetches for the latest root comments in each discussion.
create index if not exists post_comments_context_roots_created_idx
  on public.post_comments (context_type, context_id, created_at desc, id desc)
  where parent_id is null and status in ('published','deleted');

-- Fast on-demand reply pagination for any nesting depth.
create index if not exists post_comments_context_parent_created_idx
  on public.post_comments (context_type, context_id, parent_id, created_at desc, id desc)
  where parent_id is not null and status in ('published','deleted');

-- Fast reaction summaries for the currently visible comment batch.
create index if not exists comment_reactions_comment_reaction_user_idx
  on public.comment_reactions (comment_id, reaction, user_id);

-- Returns reply counts only for IDs supplied by the caller. SECURITY INVOKER
-- preserves the caller's RLS visibility; it does not bypass comment policies.
create or replace function public.frnxup_comment_reply_counts(
  p_context_type text,
  p_context_id uuid,
  p_parent_ids uuid[]
) returns table(parent_id uuid, reply_count bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select c.parent_id, count(*)::bigint as reply_count
  from public.post_comments c
  where c.context_type = p_context_type
    and c.context_id = p_context_id
    and c.parent_id = any(coalesce(p_parent_ids, array[]::uuid[]))
    and c.status in ('published','deleted')
  group by c.parent_id;
$$;

revoke all on function public.frnxup_comment_reply_counts(text,uuid,uuid[]) from public;
grant execute on function public.frnxup_comment_reply_counts(text,uuid,uuid[]) to anon, authenticated;

-- Aggregate reactions in Postgres instead of downloading every member's reaction
-- record to the browser. This returns only the totals and the signed-in user's pick.
create or replace function public.frnxup_comment_reaction_summary(
  p_comment_ids uuid[]
) returns table(
  comment_id uuid,
  reaction text,
  reaction_count bigint,
  user_reaction boolean
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select cr.comment_id, cr.reaction, count(*)::bigint,
         coalesce(bool_or(cr.user_id = auth.uid()), false)
  from public.comment_reactions cr
  where cr.comment_id = any(coalesce(p_comment_ids, array[]::uuid[]))
  group by cr.comment_id, cr.reaction;
$$;

revoke all on function public.frnxup_comment_reaction_summary(uuid[]) from public;
grant execute on function public.frnxup_comment_reaction_summary(uuid[]) to authenticated;

commit;
