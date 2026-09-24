-- Occupancy on the code map
--
-- A rate plan in Aiosell is per occupancy: the sandbox property exposes
-- 'executive-s-ep' (single) and 'executive-d-ep' (double) as separate
-- rateplan ids, each carrying its own occupancy, meal count and extra-adult
-- charge.
--
-- One of our rate plans can therefore map to several Aiosell rateplan codes,
-- one per occupancy, so occupancy becomes part of the mapping row.

ALTER TABLE integration_code_map
  ADD COLUMN IF NOT EXISTS occupancy INTEGER,
  ADD COLUMN IF NOT EXISTS extra_adult NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS no_of_meals INTEGER;

-- One mapping per (room type, rate plan, occupancy).
DROP INDEX IF EXISTS idx_code_map_unique_target;
CREATE UNIQUE INDEX IF NOT EXISTS idx_code_map_unique_target
  ON integration_code_map(integration_id, room_type_id, rate_plan_id, occupancy);
