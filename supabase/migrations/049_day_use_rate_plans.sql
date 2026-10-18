-- Day use is sold through rate plans.
--
-- Migration 048 priced a day use from a fixed amount per room type. A day use
-- is now a rate plan like any other -- rates per date in Rates & Inventory,
-- derivation from another plan, mapped to a channel rate plan code -- that
-- carries how many hours it sells. One plan per slot: "Day Use 3h", "Day Use
-- 6h". A plan with no hours is an ordinary overnight plan.
--
-- The hours on the plan are what tell a booking from a channel apart: an OTA
-- booking that arrives on a day-use plan's code is adopted as a day use.
--
-- A day use takes a room off sale for its date from the moment it is booked
-- until the guest checks out; the check-out gives it back, so the room can
-- still be sold for the night. That is counted from the reservation itself
-- (stay_kind, status), so nothing more is stored for it.
--
-- properties.day_use_hours and room_types.day_use_rates from 048 are no
-- longer read. They are left in place rather than dropped, so nothing typed
-- into them is lost; a later migration can remove them.

alter table rate_plans
  add column if not exists day_use_hours smallint
    check (day_use_hours is null or day_use_hours between 1 and 23);

-- Day uses held on a date are looked up by property, kind and date.
create index if not exists reservations_day_use_idx
  on reservations (property_id, check_in)
  where stay_kind = 'day_use';
