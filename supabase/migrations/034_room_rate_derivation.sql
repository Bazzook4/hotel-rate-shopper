-- Rate plans managed the way SiteMinder manages them: a plan sets the
-- defaults, and each room rate under it (a rate_plan_rooms row) inherits them
-- until it is unlocked and given its own value.
--
-- Three things change.
--
-- 1. More derivation rules. Besides a flat amount, a percentage and a
--    multiplier, a plan can now keep the master's rates unchanged ('same'),
--    or apply two steps in order: an amount then a percentage
--    ('offset_percent'), or a percentage then an amount ('percent_offset').
--    The second step's value is derive_value_2.
--
-- 2. A minimum rate. A derived rate never resolves below it, so a deep
--    discount stacked on a low master cannot sell a room for next to nothing.
--
-- 3. Room rates can override their plan. Every override column is NULL when
--    the room rate follows its plan -- the "locked" state in the setup page.
--    rate_mode picks how the room is priced: NULL follows the plan, 'manual'
--    takes the room's own adult_rates, 'derived' follows another room rate,
--    named by (derive_from_plan_id, derive_from_room_id), which may be a
--    different plan AND a different room ("Double / 2B1D").
--
--    adult_overrides replaces the rule for individual adult counts, e.g.
--    {"1": {"method": "offset", "value": -500}} makes a single 500 cheaper
--    than the master's single while the double follows the plan's rule.
--
-- Safe to run more than once.

ALTER TABLE rate_plans
  ADD COLUMN IF NOT EXISTS derive_value_2 NUMERIC(10, 4),
  ADD COLUMN IF NOT EXISTS min_rate NUMERIC(12, 2);

ALTER TABLE rate_plans DROP CONSTRAINT IF EXISTS rate_plans_derive_method_check;
ALTER TABLE rate_plans
  ADD CONSTRAINT rate_plans_derive_method_check
  CHECK (derive_method IS NULL OR derive_method IN (
    'same', 'offset', 'percent', 'multiplier', 'offset_percent', 'percent_offset'
  ));

ALTER TABLE rate_plans DROP CONSTRAINT IF EXISTS rate_plans_min_rate_positive;
ALTER TABLE rate_plans
  ADD CONSTRAINT rate_plans_min_rate_positive
  CHECK (min_rate IS NULL OR min_rate >= 0);

ALTER TABLE rate_plan_rooms
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS min_stay INTEGER,
  ADD COLUMN IF NOT EXISTS max_stay INTEGER,
  ADD COLUMN IF NOT EXISTS release_period INTEGER,
  ADD COLUMN IF NOT EXISTS stop_sell BOOLEAN,
  ADD COLUMN IF NOT EXISTS min_rate NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS rate_mode TEXT,
  ADD COLUMN IF NOT EXISTS derive_from_plan_id UUID REFERENCES rate_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS derive_from_room_id UUID REFERENCES room_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS derive_method TEXT,
  ADD COLUMN IF NOT EXISTS derive_value NUMERIC(10, 4),
  ADD COLUMN IF NOT EXISTS derive_value_2 NUMERIC(10, 4),
  ADD COLUMN IF NOT EXISTS adult_overrides JSONB;

ALTER TABLE rate_plan_rooms DROP CONSTRAINT IF EXISTS rate_plan_rooms_rate_mode_check;
ALTER TABLE rate_plan_rooms
  ADD CONSTRAINT rate_plan_rooms_rate_mode_check
  CHECK (rate_mode IS NULL OR rate_mode IN ('manual', 'derived'));

ALTER TABLE rate_plan_rooms DROP CONSTRAINT IF EXISTS rate_plan_rooms_derive_method_check;
ALTER TABLE rate_plan_rooms
  ADD CONSTRAINT rate_plan_rooms_derive_method_check
  CHECK (derive_method IS NULL OR derive_method IN (
    'same', 'offset', 'percent', 'multiplier', 'offset_percent', 'percent_offset'
  ));

-- Deliberately no CHECK that a derived room rate names its source: deleting
-- the plan or room it follows sets the link to NULL, and such a check would
-- then block the delete. A derived room rate with no source follows its own
-- plan again, and the setup route refuses to save an incomplete one.

ALTER TABLE rate_plan_rooms DROP CONSTRAINT IF EXISTS rate_plan_rooms_overrides_valid;
ALTER TABLE rate_plan_rooms
  ADD CONSTRAINT rate_plan_rooms_overrides_valid
  CHECK (
    (min_stay IS NULL OR min_stay >= 1) AND
    (max_stay IS NULL OR max_stay >= 1) AND
    (release_period IS NULL OR release_period >= 0) AND
    (min_rate IS NULL OR min_rate >= 0)
  );
