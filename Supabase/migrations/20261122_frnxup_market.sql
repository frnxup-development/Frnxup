-- Frnxup-Market: listings, media, buyer inquiries, saved items, boosts and moderation.
-- Run once in Supabase SQL Editor after the existing Frnxup schema and Pages migrations.

create table if not exists public.market_listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 4 and 120),
  description text not null check (char_length(description) between 10 and 5000),
  category text not null check (category in (
    'Electronics','Mobile Phones','Computers & Accessories','Home Appliances',
    'Furniture & Home Decor','Fashion & Clothing','Shoes & Bags','Beauty & Personal Care',
    'Health & Wellness','Baby & Kids','Toys & Games','Food & Groceries',
    'Agriculture & Farm Produce','Vehicles & Auto Parts','Motorcycles & Bicycles',
    'Property & Real Estate','Building Materials & Tools','Sports & Fitness',
    'Books & Education','Office & Business Equipment','Pets & Livestock',
    'Musical Instruments & Audio','Art, Crafts & Collectibles'
  )),
  price numeric(14,2) not null check (price > 0),
  condition text not null check (condition in (
    'Brand new','Like new','Open box','Refurbished','Fairly used - excellent',
    'Fairly used - good','Used - fair','Damaged / for parts'
  )),
  location_name text not null check (char_length(location_name) between 2 and 180),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  status text not null default 'draft' check (status in ('draft','published','sold','hidden','removed')),
  featured_until timestamptz,
  view_count integer not null default 0 check (view_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.market_listing_media (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.market_listings(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  sort_order integer not null default 1 check (sort_order between 1 and 10),
  created_at timestamptz not null default now(),
  unique(listing_id, sort_order)
);

create table if not exists public.market_saved_listings (
  user_id uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid not null references public.market_listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id, listing_id)
);

create table if not exists public.market_inquiries (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.market_listings(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  request_type text not null default 'message' check (request_type in ('message','purchase')),
  message text not null check (char_length(message) between 2 and 2000),
  status text not null default 'pending' check (status in ('pending','accepted','declined','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (buyer_id <> seller_id)
);

create table if not exists public.market_boosts (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.market_listings(id) on delete cascade,
  payer_id uuid not null references public.profiles(id) on delete cascade,
  duration_weeks integer not null check (duration_weeks between 1 and 4),
  amount_ngn integer not null check (amount_ngn = duration_weeks * 200),
  payment_reference text not null default '' check (char_length(payment_reference) <= 160),
  status text not null default 'pending_review' check (status in ('pending_review','active','rejected','expired')),
  starts_at timestamptz,
  ends_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.market_reports (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.market_listings(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (char_length(reason) between 5 and 1200),
  status text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(listing_id, reporter_id, status)
);

create index if not exists market_listings_status_created_idx on public.market_listings(status, created_at desc);
create index if not exists market_listings_category_idx on public.market_listings(category, status);
create index if not exists market_listings_location_idx on public.market_listings(location_name);
create index if not exists market_listings_featured_idx on public.market_listings(featured_until desc nulls last);
create index if not exists market_media_listing_idx on public.market_listing_media(listing_id, sort_order);
create index if not exists market_inquiries_seller_idx on public.market_inquiries(seller_id, status, created_at desc);
create index if not exists market_boosts_status_idx on public.market_boosts(status, created_at desc);
create index if not exists market_reports_status_idx on public.market_reports(status, created_at desc);

alter table public.market_listings enable row level security;
alter table public.market_listing_media enable row level security;
alter table public.market_saved_listings enable row level security;
alter table public.market_inquiries enable row level security;
alter table public.market_boosts enable row level security;
alter table public.market_reports enable row level security;

-- Public browsing is allowed for published listings. Sellers and moderators can inspect their own/reviewed records.
drop policy if exists market_listings_read on public.market_listings;
create policy market_listings_read on public.market_listings for select to anon, authenticated
using ((status in ('published','sold') and public.site_setting_enabled('market_enabled',true)) or seller_id=auth.uid() or public.is_moderator());
drop policy if exists market_listings_insert on public.market_listings;
create policy market_listings_insert on public.market_listings for insert to authenticated
with check (seller_id=auth.uid() and public.user_is_active(auth.uid()) and public.site_setting_enabled('market_enabled',true));
drop policy if exists market_listings_update on public.market_listings;
create policy market_listings_update on public.market_listings for update to authenticated
using (seller_id=auth.uid() or public.is_moderator())
with check ((seller_id=auth.uid() and public.user_is_active(auth.uid())) or public.is_moderator());
drop policy if exists market_listings_delete on public.market_listings;
create policy market_listings_delete on public.market_listings for delete to authenticated
using (seller_id=auth.uid() or public.is_moderator());

drop policy if exists market_media_read on public.market_listing_media;
create policy market_media_read on public.market_listing_media for select to anon, authenticated
using (exists(select 1 from public.market_listings l where l.id=listing_id and ((l.status in ('published','sold') and public.site_setting_enabled('market_enabled',true)) or l.seller_id=auth.uid() or public.is_moderator())));
drop policy if exists market_media_insert on public.market_listing_media;
create policy market_media_insert on public.market_listing_media for insert to authenticated
with check (seller_id=auth.uid() and split_part(storage_path,'/',1)=auth.uid()::text and exists(select 1 from public.market_listings l where l.id=listing_id and l.seller_id=auth.uid()));
drop policy if exists market_media_delete on public.market_listing_media;
create policy market_media_delete on public.market_listing_media for delete to authenticated
using (seller_id=auth.uid() or public.is_moderator());

drop policy if exists market_saved_read on public.market_saved_listings;
create policy market_saved_read on public.market_saved_listings for select to authenticated using(user_id=auth.uid());
drop policy if exists market_saved_insert on public.market_saved_listings;
create policy market_saved_insert on public.market_saved_listings for insert to authenticated
with check(user_id=auth.uid() and public.user_is_active(auth.uid()));
drop policy if exists market_saved_delete on public.market_saved_listings;
create policy market_saved_delete on public.market_saved_listings for delete to authenticated using(user_id=auth.uid());

drop policy if exists market_inquiries_read on public.market_inquiries;
create policy market_inquiries_read on public.market_inquiries for select to authenticated
using (buyer_id=auth.uid() or seller_id=auth.uid() or public.is_moderator());
drop policy if exists market_inquiries_insert on public.market_inquiries;
create policy market_inquiries_insert on public.market_inquiries for insert to authenticated
with check (buyer_id=auth.uid() and buyer_id<>seller_id and public.user_is_active(auth.uid()) and exists(select 1 from public.market_listings l where l.id=market_inquiries.listing_id and l.seller_id=market_inquiries.seller_id and l.status='published'));
drop policy if exists market_inquiries_update on public.market_inquiries;
create policy market_inquiries_update on public.market_inquiries for update to authenticated
using (seller_id=auth.uid() or buyer_id=auth.uid() or public.is_moderator())
with check ((seller_id=auth.uid() and status in ('accepted','declined','closed')) or (buyer_id=auth.uid() and status='closed') or public.is_moderator());

drop policy if exists market_boosts_read on public.market_boosts;
create policy market_boosts_read on public.market_boosts for select to authenticated
using (payer_id=auth.uid() or exists(select 1 from public.market_listings l where l.id=listing_id and l.seller_id=auth.uid()) or public.is_moderator());
drop policy if exists market_boosts_insert on public.market_boosts;
create policy market_boosts_insert on public.market_boosts for insert to authenticated
with check (payer_id=auth.uid() and public.user_is_active(auth.uid()) and public.site_setting_enabled('market_boosts_enabled',true) and status='pending_review' and exists(select 1 from public.market_listings l where l.id=listing_id and l.status='published'));
drop policy if exists market_boosts_update on public.market_boosts;
create policy market_boosts_update on public.market_boosts for update to authenticated
using (public.is_moderator()) with check (public.is_moderator());

drop policy if exists market_reports_read on public.market_reports;
create policy market_reports_read on public.market_reports for select to authenticated
using (reporter_id=auth.uid() or public.is_moderator());
drop policy if exists market_reports_insert on public.market_reports;
create policy market_reports_insert on public.market_reports for insert to authenticated
with check (reporter_id=auth.uid() and public.user_is_active(auth.uid()));
drop policy if exists market_reports_update on public.market_reports;
create policy market_reports_update on public.market_reports for update to authenticated
using (public.is_moderator()) with check (public.is_moderator());

-- Keep updated_at maintained by the database.
create or replace function public.frnxup_market_touch_updated_at()
returns trigger language plpgsql set search_path=public
as $market_touch$
begin new.updated_at=now(); return new; end;
$market_touch$;

drop trigger if exists market_listings_touch on public.market_listings;
create trigger market_listings_touch before update on public.market_listings for each row execute function public.frnxup_market_touch_updated_at();
drop trigger if exists market_inquiries_touch on public.market_inquiries;
create trigger market_inquiries_touch before update on public.market_inquiries for each row execute function public.frnxup_market_touch_updated_at();
drop trigger if exists market_boosts_touch on public.market_boosts;
create trigger market_boosts_touch before update on public.market_boosts for each row execute function public.frnxup_market_touch_updated_at();
drop trigger if exists market_reports_touch on public.market_reports;
create trigger market_reports_touch before update on public.market_reports for each row execute function public.frnxup_market_touch_updated_at();

-- A listing is created as a draft, its photos are uploaded, and then it is published.
-- This database trigger prevents clients from bypassing the minimum-two-photo rule.
create or replace function public.frnxup_market_require_photos()
returns trigger language plpgsql security definer set search_path=public
as $market_photos$
declare photo_count integer;
begin
  if new.status='published' then
    if tg_op='INSERT' then
      select count(*) into photo_count from public.market_listing_media where listing_id=new.id;
      if photo_count < 2 then raise exception 'Marketplace listings must include at least 2 item photographs before publishing'; end if;
      if photo_count > 10 then raise exception 'Marketplace listings can include no more than 10 item photographs'; end if;
    elsif old.status is distinct from 'published' then
      select count(*) into photo_count from public.market_listing_media where listing_id=new.id;
      if photo_count < 2 then raise exception 'Marketplace listings must include at least 2 item photographs before publishing'; end if;
      if photo_count > 10 then raise exception 'Marketplace listings can include no more than 10 item photographs'; end if;
    end if;
  end if;
  return new;
end;
$market_photos$;

drop trigger if exists market_require_photos on public.market_listings;
create trigger market_require_photos before insert or update on public.market_listings for each row execute function public.frnxup_market_require_photos();

-- Platform activity feed entries for the admin Activity Monitor.
create or replace function public.frnxup_market_activity()
returns trigger language plpgsql security definer set search_path=public
as $market_activity$
declare action_name text; target_id text; details_json jsonb;
begin
  if tg_table_name='market_listings' then
    target_id:=new.id::text;
    if tg_op='INSERT' then action_name:='market_listing_created';
    elsif old.status is distinct from new.status then action_name:='market_listing_status_changed';
    else action_name:='market_listing_updated'; end if;
    details_json:=jsonb_build_object('title',new.title,'category',new.category,'price',new.price,'status',new.status);
    insert into public.site_activity_logs(actor_id,action,entity_type,entity_id,details) values(coalesce(auth.uid(),new.seller_id),action_name,'market_listing',target_id,details_json);
    return new;
  elsif tg_table_name='market_inquiries' then
    if tg_op='INSERT' then
      insert into public.site_activity_logs(actor_id,action,entity_type,entity_id,details) values(new.buyer_id,case when new.request_type='purchase' then 'market_purchase_request' else 'market_seller_message' end,'market_inquiry',new.id::text,jsonb_build_object('listing_id',new.listing_id,'seller_id',new.seller_id,'request_type',new.request_type));
      insert into public.notifications(user_id,actor_id,type,title,body,target_type,target_id) values(new.seller_id,new.buyer_id,'market_inquiry',case when new.request_type='purchase' then 'New purchase request' else 'New Marketplace message' end,'A buyer contacted you about one of your Marketplace listings.','market_inquiry',new.id);
    elsif old.status is distinct from new.status then
      insert into public.site_activity_logs(actor_id,action,entity_type,entity_id,details) values(coalesce(auth.uid(),new.seller_id),'market_inquiry_status_changed','market_inquiry',new.id::text,jsonb_build_object('listing_id',new.listing_id,'status',new.status));
      insert into public.notifications(user_id,actor_id,type,title,body,target_type,target_id) values(new.buyer_id,coalesce(auth.uid(),new.seller_id),'market_inquiry_update','Marketplace request updated','The seller has updated the status of your Marketplace request.','market_inquiry',new.id);
    end if;
    return new;
  elsif tg_table_name='market_boosts' then
    if tg_op='INSERT' then
      insert into public.site_activity_logs(actor_id,action,entity_type,entity_id,details) values(new.payer_id,'market_boost_requested','market_boost',new.id::text,jsonb_build_object('listing_id',new.listing_id,'duration_weeks',new.duration_weeks,'amount_ngn',new.amount_ngn));
    else
      insert into public.site_activity_logs(actor_id,action,entity_type,entity_id,details) values(coalesce(new.reviewed_by,new.payer_id),'market_boost_reviewed','market_boost',new.id::text,jsonb_build_object('status',new.status,'listing_id',new.listing_id));
    end if;
    return new;
  elsif tg_table_name='market_reports' then
    if tg_op='INSERT' then
      insert into public.site_activity_logs(actor_id,action,entity_type,entity_id,details) values(new.reporter_id,'market_listing_reported','market_report',new.id::text,jsonb_build_object('listing_id',new.listing_id,'status',new.status));
    elsif old.status is distinct from new.status then
      insert into public.site_activity_logs(actor_id,action,entity_type,entity_id,details) values(coalesce(new.reviewed_by,new.reporter_id),'market_listing_report_reviewed','market_report',new.id::text,jsonb_build_object('listing_id',new.listing_id,'status',new.status));
    end if;
    return new;
  end if;
  return new;
end;
$market_activity$;

drop trigger if exists market_listing_activity on public.market_listings;
create trigger market_listing_activity after insert or update on public.market_listings for each row execute function public.frnxup_market_activity();
drop trigger if exists market_inquiry_activity on public.market_inquiries;
create trigger market_inquiry_activity after insert or update on public.market_inquiries for each row execute function public.frnxup_market_activity();
drop trigger if exists market_boost_activity on public.market_boosts;
create trigger market_boost_activity after insert or update on public.market_boosts for each row execute function public.frnxup_market_activity();
drop trigger if exists market_report_activity on public.market_reports;
create trigger market_report_activity after insert or update on public.market_reports for each row execute function public.frnxup_market_activity();

-- Public page-view counter for published listings.
create or replace function public.frnxup_market_increment_view(p_listing_id uuid)
returns void language plpgsql security definer set search_path=public
as $market_view$
begin
  update public.market_listings set view_count=view_count+1
  where id=p_listing_id and status='published' and public.site_setting_enabled('market_enabled',true);
end;
$market_view$;
revoke all on function public.frnxup_market_increment_view(uuid) from public;
grant execute on function public.frnxup_market_increment_view(uuid) to anon, authenticated;

-- Add central administrator switches without changing unrelated site settings.
insert into public.site_settings(key,value) values
  ('market_enabled','true'::jsonb),
  ('market_boosts_enabled','true'::jsonb)
on conflict(key) do nothing;

-- Existing private bucket policies remain intact. This additional SELECT policy allows only media
-- attached to a public/sold listing (or to a listing its seller/admin can access).
drop policy if exists frnxup_market_media_read on storage.objects;
create policy frnxup_market_media_read on storage.objects for select to anon, authenticated
using (
  bucket_id='frnxup-media' and exists(
    select 1 from public.market_listing_media mm
    join public.market_listings ml on ml.id=mm.listing_id
    where mm.storage_path=name and (
      (ml.status in ('published','sold') and public.site_setting_enabled('market_enabled',true))
      or ml.seller_id=auth.uid() or public.is_moderator()
    )
  )
);

-- Grants for browser-side marketplace operations; RLS remains the authorization boundary.
grant select, insert, update, delete on public.market_listings to authenticated;
grant select on public.market_listings to anon;
grant select, insert, delete on public.market_listing_media to authenticated;
grant select on public.market_listing_media to anon;
grant select, insert, delete on public.market_saved_listings to authenticated;
grant select, insert, update on public.market_inquiries to authenticated;
grant select, insert on public.market_boosts to authenticated;
grant select, insert on public.market_reports to authenticated;
grant execute on function public.frnxup_market_increment_view(uuid) to anon, authenticated;
