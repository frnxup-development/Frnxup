-- Frnxup Pages: creation, invitations and followed Pages repair.
-- Safe to run more than once. Run in Supabase SQL Editor as a project owner.

begin;

-- 1) Ensure the Pages and relationship tables exist.
create table if not exists public.frnxup_pages (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  category text not null default 'Other' check (char_length(category) <= 80),
  about text not null default '' check (char_length(about) <= 3000),
  avatar_path text,
  cover_path text,
  location text,
  website text,
  follower_count_visible boolean not null default true,
  status text not null default 'active' check (status in ('active','suspended','removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.frnxup_pages add column if not exists category text not null default 'Other';
alter table public.frnxup_pages add column if not exists about text not null default '';
alter table public.frnxup_pages add column if not exists avatar_path text;
alter table public.frnxup_pages add column if not exists cover_path text;
alter table public.frnxup_pages add column if not exists location text;
alter table public.frnxup_pages add column if not exists website text;
alter table public.frnxup_pages add column if not exists follower_count_visible boolean not null default true;
alter table public.frnxup_pages add column if not exists status text not null default 'active';
alter table public.frnxup_pages add column if not exists created_at timestamptz not null default now();
alter table public.frnxup_pages add column if not exists updated_at timestamptz not null default now();

create table if not exists public.frnxup_page_followers (
  page_id uuid not null references public.frnxup_pages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (page_id, user_id)
);
alter table public.frnxup_page_followers add column if not exists created_at timestamptz not null default now();

create table if not exists public.frnxup_page_invitations (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.frnxup_pages(id) on delete cascade,
  invited_user_id uuid not null references public.profiles(id) on delete cascade,
  invited_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (page_id, invited_user_id)
);
alter table public.frnxup_page_invitations add column if not exists status text not null default 'pending';
alter table public.frnxup_page_invitations add column if not exists created_at timestamptz not null default now();
alter table public.frnxup_page_invitations add column if not exists updated_at timestamptz not null default now();

create index if not exists frnxup_pages_owner_idx on public.frnxup_pages(owner_user_id, created_at desc);
create unique index if not exists frnxup_pages_slug_uidx on public.frnxup_pages(slug);
create index if not exists frnxup_pages_status_idx on public.frnxup_pages(status, created_at desc);
create unique index if not exists frnxup_page_followers_pair_uidx on public.frnxup_page_followers(page_id, user_id);
create index if not exists frnxup_page_followers_user_idx on public.frnxup_page_followers(user_id, created_at desc);
create unique index if not exists frnxup_page_invitations_pair_uidx on public.frnxup_page_invitations(page_id, invited_user_id);
create index if not exists frnxup_page_invites_user_idx on public.frnxup_page_invitations(invited_user_id, status, created_at desc);

-- 2) Safe owner/follower helpers used by policies and page cards.
create or replace function public.frnxup_owns_page(p_page_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.frnxup_pages p
    where p.id = p_page_id and p.owner_user_id = auth.uid()
  );
$$;

create or replace function public.frnxup_is_page_follower(p_page_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.frnxup_page_followers f
    where f.page_id = p_page_id and f.user_id = auth.uid()
  );
$$;

create or replace function public.frnxup_page_follower_count(p_page_id uuid)
returns bigint
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_visible boolean;
  v_owner uuid;
  v_total bigint;
begin
  select follower_count_visible, owner_user_id
    into v_visible, v_owner
    from public.frnxup_pages
   where id = p_page_id and status = 'active';
  if not found then return null; end if;
  if not coalesce(v_visible, false) and v_owner is distinct from auth.uid() then return null; end if;
  select count(*) into v_total from public.frnxup_page_followers where page_id = p_page_id;
  return v_total;
end;
$$;

revoke all on function public.frnxup_owns_page(uuid) from public;
revoke all on function public.frnxup_is_page_follower(uuid) from public;
revoke all on function public.frnxup_page_follower_count(uuid) from public;
grant execute on function public.frnxup_owns_page(uuid) to anon, authenticated;
grant execute on function public.frnxup_is_page_follower(uuid) to anon, authenticated;
grant execute on function public.frnxup_page_follower_count(uuid) to anon, authenticated;

-- 3) Protect invitation identity/status transitions.
create or replace function public.frnxup_guard_page_invitation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.page_id is distinct from old.page_id
     or new.invited_user_id is distinct from old.invited_user_id
     or new.invited_by is distinct from old.invited_by then
    raise exception 'Page invitation identity fields cannot be changed.';
  end if;

  if auth.uid() = old.invited_user_id then
    if old.status <> 'pending' or new.status not in ('accepted','declined') then
      raise exception 'Only a pending invitation can be accepted or declined by its recipient.';
    end if;
  elsif public.frnxup_owns_page(old.page_id) then
    if new.status <> 'pending' then
      raise exception 'Only the invited member can respond to a Page invitation.';
    end if;
  else
    raise exception 'You cannot modify this Page invitation.';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists frnxup_guard_page_invitation_trigger on public.frnxup_page_invitations;
create trigger frnxup_guard_page_invitation_trigger
before update on public.frnxup_page_invitations
for each row execute function public.frnxup_guard_page_invitation();

-- 4) Page creation is performed by an authenticated, validated RPC.
-- This avoids a silent form refresh and returns the new Page ID only after commit.
create or replace function public.frnxup_create_page(
  p_name text,
  p_slug text,
  p_category text default 'Other',
  p_about text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_account_status text;
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_category text := coalesce(nullif(btrim(p_category), ''), 'Other');
  v_about text := coalesce(p_about, '');
begin
  if auth.uid() is null then
    raise exception 'You must sign in before creating a Page.' using errcode = '28000';
  end if;

  select account_status into v_account_status
    from public.profiles where id = auth.uid();
  if not found or v_account_status <> 'active' or not public.user_is_active(auth.uid()) then
    raise exception 'Your Frnxup account is not active and cannot create a Page.' using errcode = '42501';
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 80 then
    raise exception 'Page name must contain between 2 and 80 characters.' using errcode = '23514';
  end if;
  if v_slug !~ '^[a-z0-9-]{3,40}$' then
    raise exception 'Page link must be 3 to 40 lowercase letters, numbers or hyphens.' using errcode = '23514';
  end if;
  if char_length(v_category) > 80 or char_length(v_about) > 3000 then
    raise exception 'Category or description is longer than allowed.' using errcode = '23514';
  end if;

  insert into public.frnxup_pages (owner_user_id, name, slug, category, about, status)
  values (auth.uid(), v_name, v_slug, v_category, v_about, 'active')
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'slug', v_slug);
end;
$$;
revoke all on function public.frnxup_create_page(text, text, text, text) from public;
grant execute on function public.frnxup_create_page(text, text, text, text) to authenticated;

-- 5) Page owners send invitations through a checked RPC. Re-inviting an old
-- accepted/declined invitation resets it to pending without changing its identity.
create or replace function public.frnxup_send_page_invitation(
  p_page_id uuid,
  p_invited_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation_id uuid;
  v_existing_status text;
  v_target_status text;
begin
  if auth.uid() is null then
    raise exception 'Sign in before inviting a member.' using errcode = '28000';
  end if;
  if not public.user_is_active(auth.uid()) then
    raise exception 'Your Frnxup account is not active and cannot send Page invitations.' using errcode = '42501';
  end if;
  if not public.frnxup_owns_page(p_page_id) then
    raise exception 'You can only invite members to a Page you manage.' using errcode = '42501';
  end if;
  if p_invited_user_id is null or p_invited_user_id = auth.uid() then
    raise exception 'Choose another Frnxup member to invite.' using errcode = '22023';
  end if;

  select account_status into v_target_status
    from public.profiles where id = p_invited_user_id;
  if not found or v_target_status <> 'active' then
    raise exception 'That Frnxup account is unavailable for invitations.' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.frnxup_page_followers f
    where f.page_id = p_page_id and f.user_id = p_invited_user_id
  ) then
    raise exception 'That member already follows this Page.' using errcode = '23505';
  end if;

  select id, status into v_invitation_id, v_existing_status
    from public.frnxup_page_invitations
   where page_id = p_page_id and invited_user_id = p_invited_user_id
   for update;

  if found then
    if v_existing_status = 'pending' then
      raise exception 'An invitation to this member is already pending.' using errcode = '23505';
    end if;
    update public.frnxup_page_invitations
       set status = 'pending', updated_at = now()
     where id = v_invitation_id;
  else
    insert into public.frnxup_page_invitations(page_id, invited_user_id, invited_by, status)
    values (p_page_id, p_invited_user_id, auth.uid(), 'pending')
    returning id into v_invitation_id;
  end if;
  return v_invitation_id;
end;
$$;
revoke all on function public.frnxup_send_page_invitation(uuid, uuid) from public;
grant execute on function public.frnxup_send_page_invitation(uuid, uuid) to authenticated;

-- 6) Accept/decline atomically. Accepting also creates the follower row in the
-- same transaction, so the invitation cannot be accepted without being followed.
create or replace function public.frnxup_respond_page_invitation(
  p_invitation_id uuid,
  p_response text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_page_id uuid;
  v_invited_user_id uuid;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'Sign in before responding to an invitation.' using errcode = '28000';
  end if;
  if p_response is null or p_response not in ('accepted','declined') then
    raise exception 'Invitation response must be accepted or declined.' using errcode = '22023';
  end if;

  if not public.user_is_active(auth.uid()) then
    raise exception 'Your Frnxup account is not active and cannot respond to Page invitations.' using errcode = '42501';
  end if;

  select page_id, invited_user_id, status
    into v_page_id, v_invited_user_id, v_status
    from public.frnxup_page_invitations
   where id = p_invitation_id
   for update;

  if not found or v_invited_user_id is distinct from auth.uid() then
    raise exception 'This invitation was not found for your account.' using errcode = '42501';
  end if;
  if v_status <> 'pending' then
    raise exception 'This invitation has already been answered.' using errcode = '23514';
  end if;

  if p_response = 'accepted' then
    insert into public.frnxup_page_followers(page_id, user_id)
    values (v_page_id, auth.uid())
    on conflict (page_id, user_id) do nothing;
  end if;

  update public.frnxup_page_invitations
     set status = p_response, updated_at = now()
   where id = p_invitation_id;

  return true;
end;
$$;
revoke all on function public.frnxup_respond_page_invitation(uuid, text) from public;
grant execute on function public.frnxup_respond_page_invitation(uuid, text) to authenticated;

-- 7) Row-level security and table privileges for Pages, followers and invites.
alter table public.frnxup_pages enable row level security;
alter table public.frnxup_page_followers enable row level security;
alter table public.frnxup_page_invitations enable row level security;

 drop policy if exists frnxup_pages_public_read on public.frnxup_pages;
create policy frnxup_pages_public_read on public.frnxup_pages
for select to anon, authenticated
using (status = 'active' or owner_user_id = auth.uid() or public.is_moderator());
drop policy if exists frnxup_pages_insert_own on public.frnxup_pages;
create policy frnxup_pages_insert_own on public.frnxup_pages
for insert to authenticated
with check (owner_user_id = auth.uid() and status = 'active' and public.user_is_active(auth.uid()));
drop policy if exists frnxup_pages_update_own on public.frnxup_pages;
create policy frnxup_pages_update_own on public.frnxup_pages
for update to authenticated
using (owner_user_id = auth.uid() and status = 'active')
with check (owner_user_id = auth.uid() and status = 'active');
revoke delete on public.frnxup_pages from authenticated;
grant select on public.frnxup_pages to anon, authenticated;
grant insert, update on public.frnxup_pages to authenticated;

drop policy if exists frnxup_page_followers_read on public.frnxup_page_followers;
create policy frnxup_page_followers_read on public.frnxup_page_followers
for select to authenticated
using (user_id = auth.uid() or public.frnxup_owns_page(page_id) or public.is_moderator());
drop policy if exists frnxup_page_followers_insert on public.frnxup_page_followers;
create policy frnxup_page_followers_insert on public.frnxup_page_followers
for insert to authenticated
with check (
  user_id = auth.uid()
  and not public.frnxup_owns_page(page_id)
  and exists (select 1 from public.frnxup_pages p where p.id = frnxup_page_followers.page_id and p.status = 'active')
  and public.user_is_active(auth.uid())
);
drop policy if exists frnxup_page_followers_delete on public.frnxup_page_followers;
create policy frnxup_page_followers_delete on public.frnxup_page_followers
for delete to authenticated
using (user_id = auth.uid() or public.frnxup_owns_page(page_id) or public.is_moderator());
grant select, insert, delete on public.frnxup_page_followers to authenticated;

drop policy if exists frnxup_page_invites_read on public.frnxup_page_invitations;
create policy frnxup_page_invites_read on public.frnxup_page_invitations
for select to authenticated
using (invited_user_id = auth.uid() or public.frnxup_owns_page(page_id) or public.is_moderator());
drop policy if exists frnxup_page_invites_insert on public.frnxup_page_invitations;
create policy frnxup_page_invites_insert on public.frnxup_page_invitations
for insert to authenticated
with check (invited_by = auth.uid() and public.frnxup_owns_page(page_id) and invited_user_id <> auth.uid());
drop policy if exists frnxup_page_invites_update on public.frnxup_page_invitations;
create policy frnxup_page_invites_update on public.frnxup_page_invitations
for update to authenticated
using (invited_user_id = auth.uid() or public.frnxup_owns_page(page_id))
with check (invited_user_id = auth.uid() or public.frnxup_owns_page(page_id));
grant select, insert, update on public.frnxup_page_invitations to authenticated;

commit;

-- After running this migration, reload the Frnxup Pages screens. The new RPCs
-- become available immediately; no service_role key is used by the website.
