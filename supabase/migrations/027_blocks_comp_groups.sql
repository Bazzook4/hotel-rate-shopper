-- Out-of-order blocks, complimentary stays and group bookings.
--
-- All three start from the same gesture on the tape chart -- drag across a
-- room's empty nights, then say what those nights are for -- but they are
-- different facts and live in different places.
--
-- An out-of-order block has no guest, no rate and no folio, so it is not a
-- reservation. It is a room taken off sale for some nights: the channels
-- must see one room fewer, and nobody may be put in it. Until now the only
-- way to say that was `rooms.is_active`, which has no dates -- it takes a
-- room off sale for ever, and the desk has to remember to put it back.
--
-- A complimentary stay is an ordinary reservation that nobody pays for. It
-- occupies a room like any other, so it is a flag on the reservation rather
-- than a separate record; what differs is only that its nights are priced at
-- nothing, and that revenue reports can leave it out of ADR.
--
-- A group is several reservations taken together under one name. Each room
-- stays its own reservation -- its own guest, check-in, folio -- and the
-- group is what ties them back to the party and the person who booked it.

-- ============================================
-- ROOM BLOCKS (out of order)
-- ============================================

create table if not exists room_blocks (
  id          uuid primary key default uuid_generate_v4(),
  property_id uuid not null references properties(id) on delete cascade,
  room_id     uuid not null references rooms(id) on delete cascade,

  -- Same convention as a stay: `start_date` is the first night off sale,
  -- `end_date` the day the room is back, which is not itself blocked.
  start_date  date not null,
  end_date    date not null,

  reason      text,
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint room_blocks_dates_ordered check (end_date > start_date)
);

create index if not exists room_blocks_property_dates_idx
  on room_blocks (property_id, start_date, end_date);
create index if not exists room_blocks_room_idx
  on room_blocks (room_id, start_date);

-- ============================================
-- COMPLIMENTARY STAYS
-- ============================================

alter table reservations add column if not exists booking_type text not null default 'standard';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reservations_booking_type_check'
  ) then
    alter table reservations add constraint reservations_booking_type_check
      check (booking_type in ('standard', 'complimentary'));
  end if;
end $$;

-- ============================================
-- GROUP BOOKINGS
-- ============================================

create table if not exists reservation_groups (
  id            uuid primary key default uuid_generate_v4(),
  property_id   uuid not null references properties(id) on delete cascade,

  -- What the party is called at the desk: "Sharma wedding", "Infosys offsite".
  name          text not null,

  -- Who booked it, who is not necessarily anyone staying.
  contact_name  text,
  contact_phone text,
  contact_email text,

  notes         text,
  created_by    uuid references users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists reservation_groups_property_idx
  on reservation_groups (property_id, created_at desc);

alter table reservations add column if not exists group_id uuid
  references reservation_groups(id) on delete set null;

create index if not exists reservations_group_idx on reservations (group_id);
