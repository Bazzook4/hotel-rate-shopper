-- Per-date rates and restrictions become per room as well
--
-- daily_rates was unique on (rate_plan_id, occupancy, stay_date) and
-- daily_restrictions on (rate_plan_id, stay_date). Neither named a room,
-- which was correct while a rate plan belonged to exactly one room type.
--
-- Rate plans are now property-level with room types assigned to them, so one
-- plan is sold in several rooms at different prices. Without the room in the
-- key those rooms collide: the grid cannot tell two cells apart, only one
-- value can be stored, and the push had to guess which room an edit belonged
-- to -- it took the first room offering that plan, so a rate edited in one
-- room was sent to another.
--
-- The room is nullable so existing rows survive. NULL means "the plan's own
-- room", which is what the data meant when there was only one.

ALTER TABLE daily_rates
  ADD COLUMN IF NOT EXISTS room_type_id UUID REFERENCES room_types(id) ON DELETE CASCADE;

ALTER TABLE daily_restrictions
  ADD COLUMN IF NOT EXISTS room_type_id UUID REFERENCES room_types(id) ON DELETE CASCADE;

-- Backfill from the plan's own room type, which is the room those rows always
-- meant. A plan that never named one leaves its rows NULL, and the fallback
-- in the application keeps them working.
UPDATE daily_rates dr
SET room_type_id = rp.room_type_id
FROM rate_plans rp
WHERE rp.id = dr.rate_plan_id
  AND dr.room_type_id IS NULL
  AND rp.room_type_id IS NOT NULL;

UPDATE daily_restrictions dr
SET room_type_id = rp.room_type_id
FROM rate_plans rp
WHERE rp.id = dr.rate_plan_id
  AND dr.room_type_id IS NULL
  AND rp.room_type_id IS NOT NULL;

-- Widen the uniqueness to include the room.
--
-- A plain UNIQUE constraint treats two NULL rooms as distinct, which would
-- let duplicate rows accumulate for plans that have no room. Partial unique
-- indexes are used instead: one for rows with a room, one for rows without,
-- so both cases stay single-valued.

ALTER TABLE daily_rates DROP CONSTRAINT IF EXISTS daily_rates_rate_plan_id_occupancy_stay_date_key;
DROP INDEX IF EXISTS idx_daily_rates_unique_room;
DROP INDEX IF EXISTS idx_daily_rates_unique_noroom;

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_rates_unique_room
  ON daily_rates(rate_plan_id, room_type_id, occupancy, stay_date)
  WHERE room_type_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_rates_unique_noroom
  ON daily_rates(rate_plan_id, occupancy, stay_date)
  WHERE room_type_id IS NULL;

ALTER TABLE daily_restrictions DROP CONSTRAINT IF EXISTS daily_restrictions_rate_plan_id_stay_date_key;
DROP INDEX IF EXISTS idx_daily_restrictions_unique_room;
DROP INDEX IF EXISTS idx_daily_restrictions_unique_noroom;

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_restrictions_unique_room
  ON daily_restrictions(rate_plan_id, room_type_id, stay_date)
  WHERE room_type_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_restrictions_unique_noroom
  ON daily_restrictions(rate_plan_id, stay_date)
  WHERE room_type_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_daily_rates_room
  ON daily_rates(property_id, room_type_id, stay_date);
CREATE INDEX IF NOT EXISTS idx_daily_restrictions_room
  ON daily_restrictions(property_id, room_type_id, stay_date);
