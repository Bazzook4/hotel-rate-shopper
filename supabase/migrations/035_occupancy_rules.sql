-- Adult counts worked out from the single rate, within one room rate.
--
-- A hotel often prices a double as "the single plus 500" rather than as a
-- number of its own. occupancy_rules holds that rule per adult count on a
-- manually priced room rate, e.g. {"2": {"method": "offset", "value": 500}}:
-- the 2-adult rate is then the 1-adult rate plus 500, on every date, so
-- changing the single in the Channel Manager moves the double with it.
--
-- A derived room rate needs none: its every adult count already follows the
-- source's same adult count, rules included.
--
-- Safe to run more than once.

ALTER TABLE rate_plan_rooms
  ADD COLUMN IF NOT EXISTS occupancy_rules JSONB;
