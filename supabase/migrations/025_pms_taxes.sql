-- Taxes and fees: what the law, the city or the hotel adds to a stay.
--
-- One table of rules rather than a fixed set of columns, because the shapes
-- genuinely differ by place and a hotel usually needs several at once:
--
--   Indian GST       CGST + SGST, each a percentage, at a rate that depends on
--                    the room's nightly tariff (nil up to 1,000, 5% up to
--                    7,500, 18% above) -- so two percentage rows per band
--   Malaysia TTx     a fixed RM10 per room per night, foreign guests only
--   European city    a fixed amount per adult per night, often capped at a
--   taxes            number of nights, children exempt
--   Service charge   a percentage on the room and the extras alike
--   Quebec-style     a percentage charged on top of an earlier tax
--
-- Taxes are computed when a folio is read, never stored on the stay: a stay
-- is re-priced by the desk and a stored tax would go stale the moment it was.
-- The price of that is that editing a rule would re-tax every open folio,
-- including old ones. `valid_from` / `valid_to` are the answer -- a rate
-- change is a new row starting on the day, and the old row ending the day
-- before, so each night is taxed at the rate in force on that night. Issued
-- invoices freeze their taxes in the snapshot and never move.

create table if not exists property_taxes (
  id            uuid primary key default uuid_generate_v4(),
  property_id   uuid not null references properties(id) on delete cascade,

  -- As it prints on the folio and the invoice: "CGST", "City tax".
  name          text not null,

  -- 'percent': `value` is a percentage of the base.
  -- 'fixed':   `value` is an amount, multiplied out by `basis`.
  calc_type     text not null default 'percent'
    check (calc_type in ('percent', 'fixed')),
  value         numeric(12, 4) not null default 0 check (value >= 0),

  -- For a fixed amount: what one unit of it is.
  basis         text not null default 'per_night'
    check (basis in (
      'per_night',            -- per room, per night
      'per_stay',             -- once per booking
      'per_adult_per_night',
      'per_guest_per_night',  -- adults and children
      'per_adult_per_stay',
      'per_guest_per_stay'
    )),

  -- For a percentage: what it is a percentage of.
  applies_to    text not null default 'room'
    check (applies_to in ('room', 'extras', 'room_and_extras')),

  -- A tariff band, judged night by night against that night's room rate.
  -- The tax applies to a night whose rate is above `rate_above` and up to
  -- `rate_up_to`, either end open when null. This is how GST's slabs are
  -- expressed: "above 1,000 up to 7,500" and "above 7,500".
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

  -- Compound: charged on the base plus every tax above it in the order.
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

-- As elsewhere: the API layer holds the service role and enforces property
-- scoping there.
alter table property_taxes enable row level security;

drop policy if exists "Service role only on property_taxes" on property_taxes;
create policy "Service role only on property_taxes" on property_taxes for all using (true);
