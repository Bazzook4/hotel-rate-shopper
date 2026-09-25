-- The folio: what a stay owes, what was added to it, and what was paid.
--
-- Migration 023 recorded the stay itself -- who, which room, which nights.
-- This records the money. Three tables, and the order matters:
--
--   reservation_extras    chargeable lines added to a stay (breakfast, pickup)
--   reservation_payments  money actually received against it
--   reservation_invoices  a frozen document issued for it
--
-- The reservation's own total_amount stays what the room was sold for. Extras
-- add to it, payments subtract from it, and the balance is computed rather
-- than stored: a stored balance is a number that can silently disagree with
-- the rows beneath it, and there is no way to tell which one lied.
--
-- `property_extras` is the menu the hotel offers; `reservation_extras` is what
-- a particular guest took. They are separate because the price on a stay must
-- not move when the hotel later re-prices its breakfast -- last month's folio
-- has to keep showing last month's price.

-- ============================================
-- THE MENU
-- ============================================

create table if not exists property_extras (
  id          uuid primary key default uuid_generate_v4(),
  property_id uuid not null references properties(id) on delete cascade,

  name        text not null,
  -- What one unit costs today. Copied onto a stay when added, never read back
  -- from here for an existing line.
  unit_price  numeric(10, 2) not null default 0,

  -- 'once' charges the line as it stands; 'per_night' multiplies it by the
  -- nights of the stay when it is added. Both resolve to a stored quantity on
  -- the reservation line, so this only affects the moment of adding.
  charge_type text not null default 'once'
    check (charge_type in ('once', 'per_night')),

  -- Inclusions come free with a rate plan (breakfast on a BB rate); extras are
  -- sold. The split is only about how the folio presents them.
  kind        text not null default 'extra'
    check (kind in ('extra', 'inclusion')),

  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),

  unique (property_id, name)
);

create index if not exists property_extras_property_idx
  on property_extras (property_id, is_active);

-- ============================================
-- WHAT A STAY TOOK
-- ============================================

create table if not exists reservation_extras (
  id             uuid primary key default uuid_generate_v4(),
  reservation_id uuid not null references reservations(id) on delete cascade,

  -- Where it came from on the menu, kept for reporting. Null once the menu
  -- item is deleted, or when the line was typed in by hand -- the line stands
  -- on its own name and price either way.
  extra_id       uuid references property_extras(id) on delete set null,

  -- Copied at the moment of adding, never a lookup. See the note above.
  name           text not null,
  unit_price     numeric(10, 2) not null default 0,
  quantity       numeric(10, 2) not null default 1 check (quantity > 0),

  kind           text not null default 'extra'
    check (kind in ('extra', 'inclusion')),

  -- Which night it belongs to, when that is meaningful. Null for a line that
  -- covers the whole stay.
  stay_date      date,

  created_at     timestamptz not null default now()
);

create index if not exists reservation_extras_reservation_idx
  on reservation_extras (reservation_id);

-- ============================================
-- WHAT WAS PAID
-- ============================================

create table if not exists reservation_payments (
  id             uuid primary key default uuid_generate_v4(),
  reservation_id uuid not null references reservations(id) on delete cascade,

  -- Negative amounts are refunds. One table rather than two, because a refund
  -- is the same fact as a payment with the sign flipped, and splitting them
  -- means every balance has to remember to subtract the second table.
  amount         numeric(12, 2) not null,
  method         text not null default 'cash'
    check (method in ('cash', 'card', 'upi', 'bank_transfer', 'ota', 'other')),

  -- The transaction id, cheque number or whatever the hotel needs to trace it.
  reference      text,
  paid_at        timestamptz not null default now(),
  notes          text,

  recorded_by    uuid references users(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists reservation_payments_reservation_idx
  on reservation_payments (reservation_id, paid_at);

-- ============================================
-- INVOICES
-- ============================================

-- An invoice is a document, not a view. Once issued it must keep saying what
-- it said, even if the stay is later extended or re-priced -- so the lines and
-- totals are frozen into `snapshot` rather than recomputed on open.
create table if not exists reservation_invoices (
  id             uuid primary key default uuid_generate_v4(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  property_id    uuid not null references properties(id) on delete cascade,

  -- Sequential per property, which is what tax authorities generally expect.
  -- Allocated by the application under the unique constraint below.
  invoice_number text not null,

  issued_at      timestamptz not null default now(),
  total_amount   numeric(12, 2) not null default 0,
  currency       text not null default 'INR',

  -- The frozen document: guest, stay, room, every line and the totals as they
  -- stood when it was issued.
  snapshot       jsonb not null default '{}'::jsonb,

  -- Voided rather than deleted: an issued invoice that vanishes leaves a hole
  -- in the number sequence that nobody can account for.
  voided_at      timestamptz,
  void_reason    text,

  created_by     uuid references users(id) on delete set null,
  created_at     timestamptz not null default now(),

  unique (property_id, invoice_number)
);

create index if not exists reservation_invoices_reservation_idx
  on reservation_invoices (reservation_id);

-- ============================================
-- GUESTS ON A BOOKING
-- ============================================

-- A stay can carry several named guests. The primary guest's name stays
-- denormalised on `reservations` because every list and search reads it and
-- joining for it would be a cost paid on every screen.
create table if not exists reservation_guests (
  id             uuid primary key default uuid_generate_v4(),
  reservation_id uuid not null references reservations(id) on delete cascade,

  first_name     text not null,
  last_name      text,
  email          text,
  phone          text,
  gender         text check (gender in ('male', 'female', 'other')),

  -- Exactly one guest per booking should carry this; it is the one whose name
  -- appears on `reservations.guest_name`.
  is_primary     boolean not null default false,

  created_at     timestamptz not null default now()
);

create index if not exists reservation_guests_reservation_idx
  on reservation_guests (reservation_id);

-- At most one primary guest per booking.
create unique index if not exists reservation_guests_primary_idx
  on reservation_guests (reservation_id)
  where is_primary;

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

-- As elsewhere: the API layer holds the service role and enforces property
-- scoping there.
alter table property_extras enable row level security;
alter table reservation_extras enable row level security;
alter table reservation_payments enable row level security;
alter table reservation_invoices enable row level security;
alter table reservation_guests enable row level security;

drop policy if exists "Service role only on property_extras" on property_extras;
create policy "Service role only on property_extras" on property_extras for all using (true);

drop policy if exists "Service role only on reservation_extras" on reservation_extras;
create policy "Service role only on reservation_extras" on reservation_extras for all using (true);

drop policy if exists "Service role only on reservation_payments" on reservation_payments;
create policy "Service role only on reservation_payments" on reservation_payments for all using (true);

drop policy if exists "Service role only on reservation_invoices" on reservation_invoices;
create policy "Service role only on reservation_invoices" on reservation_invoices for all using (true);

drop policy if exists "Service role only on reservation_guests" on reservation_guests;
create policy "Service role only on reservation_guests" on reservation_guests for all using (true);
