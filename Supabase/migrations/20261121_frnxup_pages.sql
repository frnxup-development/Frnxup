-- FRNXUP Pages feature: multiple independently managed public identities per member.
create table if not exists public.frnxup_pages (
 id uuid primary key default gen_random_uuid(),
 owner_user_id uuid not null references public.profiles(id) on delete cascade,
 name text not null check(char_length(name) between 2 and 80),
 slug text not null unique check(slug ~ '^[a-z0-9-]{3,40}$'),
 category text not null default 'Other' check(char_length(category)<=80),
 about text not null default '' check(char_length(about)<=3000),
 avatar_path text,
 cover_path text,
 location text,
 website text,
 follower_count_visible boolean not null default true,
 status text not null default 'active' check(status in ('active','suspended','removed')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists frnxup_pages_owner_idx on public.frnxup_pages(owner_user_id,created_at desc);
create index if not exists frnxup_pages_status_idx on public.frnxup_pages(status,created_at desc);

alter table public.posts add column if not exists page_id uuid references public.frnxup_pages(id) on delete set null;
create index if not exists posts_page_feed_idx on public.posts(page_id,status,created_at desc) where page_id is not null;

create table if not exists public.frnxup_page_followers (
 page_id uuid not null references public.frnxup_pages(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(page_id,user_id)
);
create index if not exists frnxup_page_followers_user_idx on public.frnxup_page_followers(user_id,created_at desc);

create table if not exists public.frnxup_page_invitations (
 id uuid primary key default gen_random_uuid(),
 page_id uuid not null references public.frnxup_pages(id) on delete cascade,
 invited_user_id uuid not null references public.profiles(id) on delete cascade,
 invited_by uuid not null references public.profiles(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','accepted','declined')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(page_id,invited_user_id)
);
create index if not exists frnxup_page_invites_user_idx on public.frnxup_page_invitations(invited_user_id,status,created_at desc);

-- Invitation recipients may only accept or decline their own pending invite.
-- Page owners may re-send a prior invite, but cannot rewrite its identity fields.
create or replace function public.frnxup_guard_page_invitation()
returns trigger language plpgsql set search_path=public as $$
begin
 if new.page_id is distinct from old.page_id
    or new.invited_user_id is distinct from old.invited_user_id
    or new.invited_by is distinct from old.invited_by then
  raise exception 'Page invitation identity fields cannot be changed.';
 end if;
 if auth.uid()=old.invited_user_id then
  if old.status<>'pending' or new.status not in ('accepted','declined') then
   raise exception 'Only a pending invitation can be accepted or declined by its recipient.';
  end if;
 elsif public.frnxup_owns_page(old.page_id) then
  if new.status<>'pending' then
   raise exception 'Only the invited member can respond to a Page invitation.';
  end if;
 else
  raise exception 'You cannot modify this Page invitation.';
 end if;
 new.updated_at:=now();
 return new;
end $$;
drop trigger if exists frnxup_guard_page_invitation_trigger on public.frnxup_page_invitations;
create trigger frnxup_guard_page_invitation_trigger before update on public.frnxup_page_invitations for each row execute function public.frnxup_guard_page_invitation();

create or replace function public.frnxup_owns_page(p_page_id uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.frnxup_pages p where p.id=p_page_id and p.owner_user_id=auth.uid()) $$;
create or replace function public.frnxup_is_page_follower(p_page_id uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.frnxup_page_followers f where f.page_id=p_page_id and f.user_id=auth.uid()) $$;
create or replace function public.frnxup_page_follower_count(p_page_id uuid)
returns bigint language plpgsql stable security definer set search_path=public
as $$ declare visible boolean; owner_id uuid; total bigint; begin
 select follower_count_visible,owner_user_id into visible,owner_id from public.frnxup_pages where id=p_page_id and status='active';
 if not found then return null; end if;
 if not coalesce(visible,false) and owner_id is distinct from auth.uid() then return null; end if;
 select count(*) into total from public.frnxup_page_followers where page_id=p_page_id;
 return total;
end $$;
revoke all on function public.frnxup_owns_page(uuid) from public;
revoke all on function public.frnxup_is_page_follower(uuid) from public;
revoke all on function public.frnxup_page_follower_count(uuid) from public;
grant execute on function public.frnxup_owns_page(uuid) to anon,authenticated;
grant execute on function public.frnxup_is_page_follower(uuid) to anon,authenticated;
grant execute on function public.frnxup_page_follower_count(uuid) to anon,authenticated;

create or replace function public.frnxup_protect_page_fields()
returns trigger language plpgsql set search_path=public as $$
begin
 if new.owner_user_id is distinct from old.owner_user_id then raise exception 'Page ownership cannot be transferred by a page editor.'; end if;
 if new.status is distinct from old.status and coalesce(auth.role(),'') not in ('service_role','postgres') and not public.is_admin() then raise exception 'Only Frnxup administrators can change Page status.'; end if;
 new.updated_at:=now(); return new;
end $$;
drop trigger if exists frnxup_page_protect on public.frnxup_pages;
create trigger frnxup_page_protect before update on public.frnxup_pages for each row execute function public.frnxup_protect_page_fields();

create or replace function public.frnxup_guard_page_post()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.page_id is not null then
  if new.user_id is distinct from auth.uid() then raise exception 'Page posts must be created by the signed-in page owner.'; end if;
  if not exists(select 1 from public.frnxup_pages p where p.id=new.page_id and p.owner_user_id=auth.uid() and p.status='active') then raise exception 'You do not manage this active Frnxup Page.'; end if;
 end if;
 return new;
end $$;
drop trigger if exists frnxup_guard_page_post_trigger on public.posts;
create trigger frnxup_guard_page_post_trigger before insert or update of page_id,user_id on public.posts for each row execute function public.frnxup_guard_page_post();

alter table public.frnxup_pages enable row level security;
alter table public.frnxup_page_followers enable row level security;
alter table public.frnxup_page_invitations enable row level security;

drop policy if exists frnxup_pages_public_read on public.frnxup_pages;
create policy frnxup_pages_public_read on public.frnxup_pages for select to anon,authenticated using(status='active' or owner_user_id=auth.uid() or public.is_moderator());
drop policy if exists frnxup_pages_insert_own on public.frnxup_pages;
create policy frnxup_pages_insert_own on public.frnxup_pages for insert to authenticated with check(owner_user_id=auth.uid() and status='active' and public.user_is_active(auth.uid()));
drop policy if exists frnxup_pages_update_own on public.frnxup_pages;
create policy frnxup_pages_update_own on public.frnxup_pages for update to authenticated using(owner_user_id=auth.uid() and status='active') with check(owner_user_id=auth.uid() and status='active');
drop policy if exists frnxup_pages_delete_own on public.frnxup_pages;
revoke delete on public.frnxup_pages from authenticated;
grant select on public.frnxup_pages to anon,authenticated;
grant insert,update on public.frnxup_pages to authenticated;

drop policy if exists frnxup_page_followers_read on public.frnxup_page_followers;
create policy frnxup_page_followers_read on public.frnxup_page_followers for select to authenticated using(user_id=auth.uid() or public.frnxup_owns_page(page_id) or public.is_moderator());
drop policy if exists frnxup_page_followers_insert on public.frnxup_page_followers;
create policy frnxup_page_followers_insert on public.frnxup_page_followers for insert to authenticated with check(user_id=auth.uid() and not public.frnxup_owns_page(page_id) and exists(select 1 from public.frnxup_pages p where p.id=frnxup_page_followers.page_id and p.status='active') and public.user_is_active(auth.uid()));
drop policy if exists frnxup_page_followers_delete on public.frnxup_page_followers;
create policy frnxup_page_followers_delete on public.frnxup_page_followers for delete to authenticated using(user_id=auth.uid() or public.frnxup_owns_page(page_id) or public.is_moderator());
grant select,insert,delete on public.frnxup_page_followers to authenticated;

drop policy if exists frnxup_page_invites_read on public.frnxup_page_invitations;
create policy frnxup_page_invites_read on public.frnxup_page_invitations for select to authenticated using(invited_user_id=auth.uid() or public.frnxup_owns_page(page_id) or public.is_moderator());
drop policy if exists frnxup_page_invites_insert on public.frnxup_page_invitations;
create policy frnxup_page_invites_insert on public.frnxup_page_invitations for insert to authenticated with check(invited_by=auth.uid() and public.frnxup_owns_page(page_id) and invited_user_id<>auth.uid());
drop policy if exists frnxup_page_invites_update on public.frnxup_page_invitations;
create policy frnxup_page_invites_update on public.frnxup_page_invitations for update to authenticated using(invited_user_id=auth.uid() or public.frnxup_owns_page(page_id)) with check(invited_user_id=auth.uid() or public.frnxup_owns_page(page_id));
grant select,insert,update on public.frnxup_page_invitations to authenticated;

-- Page posts use the member's account as the actor, but the Page as the public identity.
drop policy if exists posts_read on public.posts;
create policy posts_read on public.posts for select to anon,authenticated using(
 status='published' and (
  (page_id is null and (user_id=auth.uid() or visibility='public' or (visibility='friends' and public.are_friends(auth.uid(),user_id))) and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=user_id) or (b.blocker_id=user_id and b.blocked_id=auth.uid())))
  or (page_id is not null and exists(select 1 from public.frnxup_pages p where p.id=page_id and p.status='active' and (visibility='public' or p.owner_user_id=auth.uid() or public.frnxup_is_page_follower(p.id))))
 )
);
drop policy if exists posts_insert on public.posts;
create policy posts_insert on public.posts for insert to authenticated with check(user_id=auth.uid() and user_is_active(auth.uid()) and site_setting_enabled('posting_enabled',true) and (page_id is null or public.frnxup_owns_page(page_id)));
drop policy if exists posts_update_own on public.posts;
create policy posts_update_own on public.posts for update to authenticated using(user_id=auth.uid() and status='published' and (page_id is null or public.frnxup_owns_page(page_id)) and user_is_active(auth.uid())) with check(user_id=auth.uid() and status='published' and (page_id is null or public.frnxup_owns_page(page_id)) and user_is_active(auth.uid()));
drop policy if exists posts_delete_own on public.posts;
create policy posts_delete_own on public.posts for delete to authenticated using(user_id=auth.uid() and (page_id is null or public.frnxup_owns_page(page_id)));

-- Page avatar and cover media are visible with an active public Page.
drop policy if exists frnxup_page_media_read on storage.objects;
create policy frnxup_page_media_read on storage.objects for select to anon,authenticated using(bucket_id='frnxup-media' and exists(select 1 from public.frnxup_pages p where (p.avatar_path=name or p.cover_path=name) and p.status='active'));

-- Notify page owner when a new follower arrives.
create or replace function public.frnxup_notify_page_follow()
returns trigger language plpgsql security definer set search_path=public as $$
declare owner_id uuid; page_name text;
begin
 select owner_user_id,name into owner_id,page_name from public.frnxup_pages where id=new.page_id;
 if owner_id is not null and owner_id<>new.user_id then
  insert into public.notifications(user_id,actor_id,type,title,body,target_type,target_id)
  values(owner_id,new.user_id,'page_follow','New Page follower',coalesce((select display_name from public.profiles where id=new.user_id),'Someone')||' followed '||coalesce(page_name,'your Page'),'page',new.page_id);
 end if;
 return new;
end $$;
drop trigger if exists frnxup_page_follow_notify on public.frnxup_page_followers;
create trigger frnxup_page_follow_notify after insert on public.frnxup_page_followers for each row execute function public.frnxup_notify_page_follow();

-- Extend shared activity capture so page follower rows point to the Page, and
-- the page id is retained as safe metadata for Page-post actions.
create or replace function public.frnxup_capture_activity()
returns trigger language plpgsql security definer set search_path=public
as $$
declare row_data jsonb; actor uuid; entity text; details jsonb := jsonb_build_object('operation',lower(TG_OP)); k text;
begin
 if TG_OP='DELETE' then row_data:=to_jsonb(OLD); else row_data:=to_jsonb(NEW); end if;
 actor:=auth.uid();
 if actor is null and coalesce(auth.role(),'')<>'service_role' then
  actor:=coalesce(nullif(row_data->>'user_id','')::uuid,nullif(row_data->>'sender_id','')::uuid,
    nullif(row_data->>'created_by','')::uuid,nullif(row_data->>'owner_user_id','')::uuid,
    nullif(row_data->>'reporter_id','')::uuid,nullif(row_data->>'blocker_id','')::uuid,
    nullif(row_data->>'receiver_id','')::uuid,nullif(row_data->>'invited_by','')::uuid);
  if actor is null and TG_TABLE_NAME='profiles' then actor:=nullif(row_data->>'id','')::uuid; end if;
 end if;
 if actor is null then if TG_OP='DELETE' then return OLD; else return NEW; end if; end if;
 entity:=coalesce(row_data->>'id',row_data->>'conversation_id',row_data->>'post_id',row_data->>'room_id',row_data->>'profile_id',row_data->>'page_id',row_data->>'user_id');
 if row_data ? 'user_a' then entity:=concat_ws(':',row_data->>'user_a',row_data->>'user_b'); end if;
 if row_data ? 'user_id' and row_data ? 'conversation_id' then entity:=concat_ws(':',row_data->>'conversation_id',row_data->>'user_id'); end if;
 if row_data ? 'user_id' and row_data ? 'room_id' then entity:=concat_ws(':',row_data->>'room_id',row_data->>'user_id'); end if;
 foreach k in array array['status','visibility','kind','role','category','type','page_id'] loop
  if row_data ? k then details:=details||jsonb_build_object(k,row_data->k); end if;
 end loop;
 insert into public.site_activity_logs(actor_id,action,entity_type,entity_id,details)
 values(actor,lower(TG_TABLE_NAME)||'_'||lower(TG_OP),TG_TABLE_NAME,entity,details);
 if TG_OP='DELETE' then return OLD; else return NEW; end if;
end $$;

-- Central admin activity stream captures page creation, edits, follows, invitations and page posts.
do $$ declare t text; begin
 foreach t in array array['frnxup_pages','frnxup_page_followers','frnxup_page_invitations'] loop
  execute format('drop trigger if exists frnxup_activity_capture on public.%I',t);
  execute format('create trigger frnxup_activity_capture after insert or update or delete on public.%I for each row execute function public.frnxup_capture_activity()',t);
 end loop;
end $$;
