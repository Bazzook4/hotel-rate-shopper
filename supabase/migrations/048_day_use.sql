-- Day use: a room taken for some hours of one day, not for a night.
--
-- The hotel offers a short list of slots -- 3, 6 and 9 hours unless it
-- changes them -- and prices each one per room type as a fixed amount. The
-- price does not follow the night rate: it is a number the hotel chose.
--
-- A day-use stay checks in and out on the same date, so it has no
-- reservation_nights row. That is deliberate: the guest is gone by evening,
-- so the room is still sold for the night and the channels are not told it is
-- taken. What stops two guests in one room is the room itself -- a day use
-- cannot go into a room someone is staying in through that day.
--
-- The hours are counted from when the guest is actually checked in
-- (checked_in_at), not from a time booked in advance: due out is
-- checked_in_at + day_use_hours.

alter table properties
  add column if not exists day_use_hours smallint[] not null default '{3,6,9}';

-- {"3": 1200, "6": 1800, "9": 2400}: the price of each slot, by its hours.
-- A slot with no price here is quoted as nothing and typed in at the desk.
alter table room_types
  add column if not exists day_use_rates jsonb not null default '{}'::jsonb;

alter table reservations
  add column if not exists stay_kind text not null default 'overnight',
  add column if not exists day_use_hours smallint;

alter table reservations drop constraint if exists reservations_stay_kind_check;
alter table reservations
  add constraint reservations_stay_kind_check check (
    (stay_kind = 'overnight' and day_use_hours is null)
    or (stay_kind = 'day_use' and day_use_hours between 1 and 23)
  );

-- An overnight stay still needs at least one night; a day use leaves on the
-- day it arrives.
alter table reservations drop constraint if exists reservations_dates_ordered;
alter table reservations
  add constraint reservations_dates_ordered check (
    (stay_kind = 'overnight' and check_out > check_in)
    or (stay_kind = 'day_use' and check_out = check_in)
  );
