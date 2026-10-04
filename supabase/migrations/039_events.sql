-- Events: one shared calendar, tagged by where and for whom it matters.
--
-- An event names a country, and optionally a state, a city and the kinds of
-- property it fills. A hotel carries the same tags in its profile and sees an
-- event when every tag the event sets agrees with its own; a tag left empty
-- means "any". So an Indian public holiday names only IN, the Pushkar fair
-- names the city, and the wedding season names the property types.
--
--   property_id NULL   a public event, seen by every hotel it matches. Only a
--                      super admin adds these.
--   property_id set    a private event, seen by that hotel alone whatever its
--                      tags -- a conference booked at the hotel, a local fair
--                      nobody else has heard of. Tags are not needed.
--
-- impact is a word, not a percentage: the pricing engine maps it to a lift
-- (low 5%, medium 12%, high 25%; see src/lib/eventTags.js).
--
-- Replaces pricing_events, which the pricing engine read from but no
-- migration ever created.
--
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- The property profile: the tags a hotel is matched on
-- ---------------------------------------------------------------------------
-- state and city already exist (migration 001), unused until now. country
-- was free text; the code is what matching reads, for the reason given in
-- src/lib/countries.js -- names arrive spelt every way.
alter table properties
  add column if not exists country_code text,
  add column if not exists property_types text[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'properties_country_code_check') then
    alter table properties add constraint properties_country_code_check
      check (country_code is null or country_code ~ '^[A-Z]{2}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'properties_property_types_check') then
    alter table properties add constraint properties_property_types_check
      check (property_types <@ array['leisure', 'wedding', 'city', 'resort', 'heritage',
                                     'pilgrimage', 'beach', 'hill', 'homestay']::text[]);
  end if;
end $$;

-- Every hotel on the platform today is in India; take the code from the old
-- text where it says so, and leave anything else for the hotel to choose.
update properties
set country_code = case
  when upper(trim(country)) in ('IN', 'IND', 'INDIA') then 'IN'
  when trim(country) ~ '^[A-Za-z]{2}$' then upper(trim(country))
end
where country_code is null and country is not null;

-- ---------------------------------------------------------------------------
-- The events
-- ---------------------------------------------------------------------------
create table if not exists events (
  id uuid primary key default uuid_generate_v4(),
  name text not null check (length(trim(name)) > 0),
  category text not null default 'other' check (category in (
    'festival', 'holiday', 'long_weekend', 'school_holiday', 'wedding_season',
    'conference', 'concert', 'sports', 'other'
  )),
  start_date date not null,
  end_date date not null,
  impact text not null default 'medium' check (impact in ('low', 'medium', 'high')),
  notes text,

  -- Tags. Read only for public events.
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  state text,
  city text,
  property_types text[] not null default '{}' check (
    property_types <@ array['leisure', 'wedding', 'city', 'resort', 'heritage',
                            'pilgrimage', 'beach', 'hill', 'homestay']::text[]
  ),

  property_id uuid references properties(id) on delete cascade,

  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint events_dates_check check (end_date >= start_date and end_date - start_date <= 90),
  -- A public event must say at least which country it is in, or it would
  -- reach every hotel in the world.
  constraint events_public_country_check check (property_id is not null or country_code is not null),
  -- A city or state is narrower than a country, so it needs one.
  constraint events_place_needs_country_check check (
    (state is null and city is null) or country_code is not null
  )
);

-- Public events are looked up by country and dates; private ones by hotel.
create index if not exists idx_events_public
  on events (country_code, start_date, end_date)
  where property_id is null;
create index if not exists idx_events_property
  on events (property_id, start_date)
  where property_id is not null;

alter table events enable row level security;
drop policy if exists "Service role only on events" on events;
create policy "Service role only on events" on events
  for all to service_role using (true);
