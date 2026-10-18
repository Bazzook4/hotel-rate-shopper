-- A day use is booked for a time, not only for a date.
--
-- Until now a day use carried its hours (049) but no start, so two day uses
-- could be booked into one room on one date with nothing to say whether they
-- clashed, and the calendar could only draw them on top of each other.
--
-- day_use_start is the booked start in the hotel's own clock (10:00 for
-- 10 AM). The slot runs from it for the plan's hours and must end by
-- midnight. Two day uses in one room on one date are refused when their
-- slots overlap; one after the other is fine.
--
-- The guest's actual hours still run from check-in (checked_in_at), so an
-- early or late arrival is handled at the desk as before. Rows from before
-- this migration, and day uses adopted from a channel that sent no time,
-- have no start; they are shown without a time and never block a slot.

alter table reservations
  add column if not exists day_use_start time;
