-- Services, their categories, and the taxes each one carries.
--
-- Everything a stay is billed for is a service: the room itself, breakfast,
-- an airport pickup, laundry. Services are grouped into categories
-- (Accommodation, Food & Beverage, Transport...) and every service carries
-- its own taxes, because that is how tax actually works -- in India a room is
-- taxed on a tariff slab, food at its own rate, a spa at another. A tax is
-- therefore not "on the bill" but on the services it is attached to.
--
--   service_categories   the groups services are listed and reported under
--   property_extras      the services themselves (the table predates the
--                        word; migration 024 named it for the extras menu)
--   property_taxes       the tax and fee rules
--   service_taxes        which rules each service carries
--
-- The room is a service like the others, with one difference: its price is
-- not on the menu but on each night of the stay, set by the rate plan or the
-- desk. It is marked `is_room`, and there is at most one per property. Its
-- taxes apply to every room night on every folio.
--
-- Taxes are computed when a folio is read, never stored on the stay: a stay
-- is re-priced by the desk and a stored tax would go stale the moment it was.
-- The price of that is that editing a rule would re-tax every open folio,
-- including old ones. `valid_from` / `valid_to` are the answer -- a rate
-- change is a new rule starting on the day, and the old rule ending the day
-- before, so each night is taxed at the rate in force on that night. Issued
-- invoices freeze their taxes in the snapshot and never move.
--
-- Shapes this has to cover, since a hotel usually needs several at once:
--
--   Indian GST       CGST + SGST, each a percentage, at a rate that depends on
--                    the room's nightly tariff (nil up to 1,000, 5% up to
--                    7,500, 18% above) -- two percentage rules per slab
--   Malaysia TTx     a fixed RM10 per room per night, foreign guests only
--   European city    a fixed amount per adult per night, often capped at a
--   taxes            number of nights, children exempt
--   Service charge   a percentage on the room and food alike
--   Quebec-style     a percentage charged on top of an earlier tax

-- ============================================
-- CATEGORIES
-- ============================================

create table if not exists service_categories (
  id          uuid primary key default uuid_generate_v4(),
  property_id uuid not null references properties(id) on delete cascade,
  name        text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),

  unique (property_id, name)
);

create index if not exists service_categories_property_idx
  on service_categories (property_id, sort_order);

-- ============================================
-- SERVICES
-- ============================================

-- Deleting a category leaves its services uncategorised rather than taking
-- them with it: a service is on past folios, a category is only a heading.
alter table property_extras
  add column if not exists category_id uuid references service_categories(id) on delete set null;

-- The room charge. Priced per night on the stay, not here.
alter table property_extras
  add column if not exists is_room boolean not null default false;

create unique index if not exists property_extras_one_room_idx
  on property_extras (property_id)
  where is_room;

-- ============================================
-- TAX RULES
-- ============================================

create table if not exists property_taxes (
  id            uuid primary key default uuid_generate_v4(),
  property_id   uuid not null references properties(id) on delete cascade,

  -- As it prints on the folio and the invoice: "CGST", "City tax".
  name          text not null,

  -- 'percent': `value` is a percentage of the service's price.
  -- 'fixed':   `value` is an amount, multiplied out by `basis`.
  calc_type     text not null default 'percent'
    check (calc_type in ('percent', 'fixed')),
  value         numeric(12, 4) not null default 0 check (value >= 0),

  -- For a fixed amount: what one unit of it is. A "unit" is a night for the
  -- room and one of whatever was sold for any other service.
  basis         text not null default 'per_night'
    check (basis in (
      'per_night',            -- per night / per unit
      'per_stay',             -- once per booking
      'per_adult_per_night',
      'per_guest_per_night',  -- adults and children
      'per_adult_per_stay',
      'per_guest_per_stay'
    )),

  -- A price band, judged line by line against the unit price: for the room,
  -- that night's rate. The rule applies to a line priced above `rate_above`
  -- and up to `rate_up_to`, either end open when null. This is how GST's
  -- slabs are expressed: "above 1,000 up to 7,500" and "above 7,500".
  rate_above    numeric(12, 2),
  rate_up_to    numeric(12, 2),

  -- Who pays it. International-only covers tourism levies charged to
  -- foreign guests; domestic-only covers the reverse, where foreign guests
  -- are exempt.
  guest_scope   text not null default 'all'
    check (guest_scope in ('all', 'domestic', 'international')),

  -- Inclusive: already inside the price, shown on the folio but not added.
  -- Only a percentage can be inclusive: a fixed fee is always added on top,
  -- which is how hotels quote them ("plus RM10 tourism tax per night").
  is_inclusive  boolean not null default false,

  -- Compound: charged on the price plus the taxes above it in the order.
  is_compound   boolean not null default false,

  -- City taxes are often charged for the first N nights only.
  max_nights    integer check (max_nights is null or max_nights > 0),

  -- The nights this rule covers, by stay date. See the note at the top.
  valid_from    date,
  valid_to      date,

  sort_order    integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),

  check (calc_type = 'percent' or is_inclusive = false),
  check (rate_above is null or rate_up_to is null or rate_up_to > rate_above),
  check (valid_from is null or valid_to is null or valid_to >= valid_from)
);

create index if not exists property_taxes_property_idx
  on property_taxes (property_id, is_active, sort_order);

-- ============================================
-- WHICH TAXES EACH SERVICE CARRIES
-- ============================================

create table if not exists service_taxes (
  service_id uuid not null references property_extras(id) on delete cascade,
  tax_id     uuid not null references property_taxes(id) on delete cascade,
  primary key (service_id, tax_id)
);

create index if not exists service_taxes_tax_idx on service_taxes (tax_id);

-- ============================================
-- THE GUEST
-- ============================================

-- Whether the guest counts as domestic or international for tax. A stored
-- choice rather than inferred from a phone prefix or an email domain, which
-- would get a returning expatriate wrong in either direction.
alter table reservations
  add column if not exists guest_residency text not null default 'domestic';

alter table reservations
  drop constraint if exists reservations_guest_residency_check;
alter table reservations
  add constraint reservations_guest_residency_check
  check (guest_residency in ('domestic', 'international'));

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

-- As elsewhere: the API layer holds the service role and enforces property
-- scoping there.
alter table service_categories enable row level security;
alter table property_taxes enable row level security;
alter table service_taxes enable row level security;

drop policy if exists "Service role only on service_categories" on service_categories;
create policy "Service role only on service_categories" on service_categories for all using (true);

drop policy if exists "Service role only on property_taxes" on property_taxes;
create policy "Service role only on property_taxes" on property_taxes for all using (true);

drop policy if exists "Service role only on service_taxes" on service_taxes;
create policy "Service role only on service_taxes" on service_taxes for all using (true);
