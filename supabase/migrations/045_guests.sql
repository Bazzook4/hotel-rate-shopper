-- The guest database: one row per person who has stayed, or is booked to
-- stay, at a property.
--
-- Until now a guest existed only as the name, phone and email typed onto each
-- reservation, so a returning guest was retyped every time and nothing could
-- say how often they had stayed. A guest record is now kept per property, and
-- each reservation points at it.
--
-- The reservation keeps its own copy of the name and contact details. Every
-- list, search, invoice and report reads them from there, and an invoice must
-- show the details as they were when the stay was booked -- not whatever the
-- guest record says after a later edit.
--
-- Guests are matched on phone (its last ten digits, so "+91 98450 12345" and
-- "9845012345" are one person) and then on email. Never on name alone: two
-- different people called Rahul Sharma are common, and merging them would put
-- one guest's history and ID on the other's booking.

create table if not exists guests (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references properties(id) on delete cascade,

  full_name    text not null,
  phone        text,
  email        text,
  country      text,
  residency    text not null default 'domestic'
    check (residency in ('domestic', 'international')),
  company      text,
  address      text,
  id_type      text,
  id_number    text,
  notes        text,

  -- What a guest is matched on, kept beside the typed values so a lookup is
  -- an equality match rather than a scan that normalises every row.
  phone_key    text generated always as (
    nullif(right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10), '')
  ) stored,
  email_key    text generated always as (nullif(lower(trim(email)), '')) stored,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists guests_property_phone_idx on guests (property_id, phone_key);
create index if not exists guests_property_email_idx on guests (property_id, email_key);
create index if not exists guests_property_name_idx on guests (property_id, lower(full_name));

alter table reservations
  add column if not exists guest_id uuid references guests(id) on delete set null;

create index if not exists reservations_guest_idx on reservations (guest_id);

-- ---------------------------------------------------------------------------
-- Backfill: one guest per phone, else per email, else per booking.
--
-- A booking with neither phone nor email becomes a guest of its own, for the
-- same reason names are never matched. The newest booking's details win,
-- since they are the most likely to be current.
-- ---------------------------------------------------------------------------

alter table guests add column if not exists backfill_key text;

with src as (
  select
    r.id,
    r.property_id,
    trim(r.guest_name) as full_name,
    nullif(trim(r.guest_phone), '') as phone,
    nullif(trim(r.guest_email), '') as email,
    r.guest_country,
    coalesce(r.guest_residency, 'domestic') as residency,
    r.created_at,
    coalesce(
      'p:' || nullif(right(regexp_replace(coalesce(r.guest_phone, ''), '\D', '', 'g'), 10), ''),
      'e:' || nullif(lower(trim(r.guest_email)), ''),
      'r:' || r.id::text
    ) as k
  from reservations r
  where r.guest_id is null
    and nullif(trim(r.guest_name), '') is not null
)
insert into guests (property_id, full_name, phone, email, country, residency, created_at, backfill_key)
select distinct on (property_id, k)
  property_id, full_name, phone, email, guest_country, residency, created_at, property_id::text || '|' || k
from src
order by property_id, k, created_at desc;

update reservations r
set guest_id = g.id
from guests g
where r.guest_id is null
  and g.backfill_key = r.property_id::text || '|' || coalesce(
    'p:' || nullif(right(regexp_replace(coalesce(r.guest_phone, ''), '\D', '', 'g'), 10), ''),
    'e:' || nullif(lower(trim(r.guest_email)), ''),
    'r:' || r.id::text
  );

alter table guests drop column if exists backfill_key;

-- ---------------------------------------------------------------------------
-- The Guests page (id "guests") goes to everyone who can already take a
-- booking, so nobody has to be ticked for it on the day it ships, and new
-- PropertyAdmins get it by default.
-- ---------------------------------------------------------------------------

insert into user_modules (user_id, module_id, enabled)
select distinct um.user_id, 'guests', true
from user_modules um
where um.module_id in ('reservations', 'calendar')
  and um.enabled is not false
on conflict (user_id, module_id) do nothing;

update app_settings
set value = value || '["guests"]'::jsonb
where key = 'default_admin_modules'
  and not value ? 'guests';
