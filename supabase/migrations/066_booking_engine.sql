-- Booking engine: a booking page the hotel puts on its own website, where
-- guests pick dates, see the rooms and prices the hotel already sells, and
-- book. Payment is to the hotel's own UPI ID, shown at the end with the
-- amount filled in; the desk checks its bank and marks the money received.
--
-- The hotel's choices sit on the property:
--   { "enabled": true, "upiId": "hotel@okaxis", "payeeName": "Hotel Sunrise",
--     "payAtHotel": false, "note": "Check-in from 12 noon" }
-- `booking_key` is the public part of the page's address
-- (/book/<booking_key>). Made the first time the hotel saves its choices,
-- and kept, since it is pasted into the hotel's website.
alter table properties add column if not exists booking_engine jsonb not null default '{}'::jsonb;
alter table properties add column if not exists booking_key text unique;

-- One row per booking made on the booking page. The token is the guest's
-- private link to see their booking and pay; signing in on the booking page
-- with the booking number and phone or email leads back to it.
--
-- payment_status:
--   awaiting      booked, not paid yet
--   guest_paid    the guest says they paid, with the UPI reference if given
--   received      the desk saw the money; a UPI payment is on the bill
--   not_received  the desk could not find it; the guest is asked to call
--   at_hotel      the guest chose to pay at the hotel
create table if not exists online_bookings (
  id              uuid        primary key default gen_random_uuid(),
  property_id     uuid        not null references properties(id) on delete cascade,
  reservation_id  uuid        not null unique references reservations(id) on delete cascade,
  token           text        not null unique,
  pay_by          text        not null default 'upi',
  amount          numeric(12,2) not null default 0,
  currency        text,
  payment_status  text        not null default 'awaiting',
  guest_reference text,
  guest_paid_at   timestamptz,
  checked_at      timestamptz,
  checked_by      uuid        references users(id) on delete set null,
  payment_id      uuid        references reservation_payments(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists online_bookings_property_idx on online_bookings (property_id, payment_status);

alter table online_bookings enable row level security;
drop policy if exists "Service role only on online_bookings" on online_bookings;
create policy "Service role only on online_bookings" on online_bookings for all using (true);

notify pgrst, 'reload schema';
