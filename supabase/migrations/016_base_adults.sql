-- Base adults on a room type, and per-adult rates on an assignment
--
-- A room type had only max_adults, so a rate plan assigned to it carried one
-- "full rate" and an included occupancy typed in by hand. That does not match
-- how these rooms are sold: a double is priced for one adult and for two --
-- single and double occupancy are different rates, not the same rate with the
-- second adult free -- and only guests beyond that pay a flat extra-person
-- charge.
--
-- base_adults is how many adults the room is priced for, adult by adult.
-- max_adults stays as the ceiling. Every adult from base_adults + 1 up to
-- max_adults is charged extra_adult_rate.
--
-- Existing rooms take base_adults = max_adults, which preserves what they mean
-- today: a rate covering everyone up to the maximum, with nothing extra.

ALTER TABLE room_types
  ADD COLUMN IF NOT EXISTS base_adults INTEGER;

UPDATE room_types
SET base_adults = GREATEST(COALESCE(max_adults, 2), 1)
WHERE base_adults IS NULL;

ALTER TABLE room_types
  ALTER COLUMN base_adults SET DEFAULT 2;

ALTER TABLE room_types DROP CONSTRAINT IF EXISTS room_types_base_adults_positive;
ALTER TABLE room_types
  ADD CONSTRAINT room_types_base_adults_positive
  CHECK (base_adults IS NULL OR base_adults > 0);

-- base_adults must not exceed the room's own ceiling, or the extra-person
-- band would be negative.
ALTER TABLE room_types DROP CONSTRAINT IF EXISTS room_types_base_within_max;
ALTER TABLE room_types
  ADD CONSTRAINT room_types_base_within_max
  CHECK (
    base_adults IS NULL OR max_adults IS NULL OR base_adults <= max_adults
  );

-- The rate for each adult up to base_adults, as {"1": 3500, "2": 4000}.
--
-- Held as JSON because the number of entries follows the room's base_adults
-- and changes when that does; a fixed set of columns would either run out or
-- sit mostly empty.
ALTER TABLE rate_plan_rooms
  ADD COLUMN IF NOT EXISTS adult_rates JSONB;

-- Carry the single rate across as the rate for every adult up to base, which
-- is what one full rate covering the room already meant.
UPDATE rate_plan_rooms rpr
SET adult_rates = sub.rates
FROM (
  SELECT
    rpr2.id,
    jsonb_object_agg(g.n::text, rpr2.full_rate) AS rates
  FROM rate_plan_rooms rpr2
  JOIN room_types rt ON rt.id = rpr2.room_type_id
  CROSS JOIN LATERAL generate_series(1, GREATEST(COALESCE(rt.base_adults, 2), 1)) AS g(n)
  WHERE rpr2.full_rate IS NOT NULL
  GROUP BY rpr2.id
) AS sub
WHERE rpr.id = sub.id
  AND rpr.adult_rates IS NULL;

-- included_occupancy is now the room's base_adults, so the per-assignment copy
-- is redundant. It is left in place for one release so a rollback keeps its
-- data; nothing reads it any more.
COMMENT ON COLUMN rate_plan_rooms.included_occupancy IS
  'Superseded by room_types.base_adults. No longer read; kept for rollback.';

COMMENT ON COLUMN rate_plan_rooms.full_rate IS
  'Superseded by adult_rates. Still written as the base-occupancy rate so older readers keep working.';
