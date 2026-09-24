-- Rate plans become property-level, with room types assigned to them
--
-- A rate plan carried a room_type_id, so "EP non-refundable" had to be
-- recreated for every room it applied to. That is backwards: a rate plan is
-- what a guest is buying -- the meal plan, the cancellation terms, the stay
-- limits -- and that is the same whichever room they buy it for. Only the
-- price differs per room.
--
-- A plan is now defined once at property level, and room types are assigned
-- to it. Each assignment carries that room's price under that plan, so one
-- plan can cost 4,000 in a Deluxe and 6,000 in a Suite without being two
-- separate plans.
--
-- rate_plans.room_type_id is deliberately left in place. The Channel Manager
-- and Integrations still read it, and a NULL there already means "every room
-- type", which is how the original EP, CP and MAP plans were stored. Dropping
-- it belongs in a later migration, once nothing reads it.

CREATE TABLE IF NOT EXISTS rate_plan_rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
  rate_plan_id UUID REFERENCES rate_plans(id) ON DELETE CASCADE,
  room_type_id UUID REFERENCES room_types(id) ON DELETE CASCADE,

  -- The rate for this room under this plan, for the included occupancy.
  full_rate NUMERIC(12, 2),

  -- How many adults that rate covers. Beyond this, extra_adult_rate applies
  -- per additional adult.
  included_occupancy INTEGER,

  extra_adult_rate NUMERIC(12, 2),
  extra_child_rate NUMERIC(12, 2),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- A room is assigned to a plan once; re-assigning updates the rates.
  UNIQUE(rate_plan_id, room_type_id),

  CONSTRAINT rate_plan_rooms_occupancy_positive
    CHECK (included_occupancy IS NULL OR included_occupancy > 0),
  CONSTRAINT rate_plan_rooms_rates_not_negative
    CHECK (
      (full_rate IS NULL OR full_rate >= 0) AND
      (extra_adult_rate IS NULL OR extra_adult_rate >= 0) AND
      (extra_child_rate IS NULL OR extra_child_rate >= 0)
    )
);

CREATE INDEX IF NOT EXISTS idx_rate_plan_rooms_plan
  ON rate_plan_rooms(rate_plan_id);
CREATE INDEX IF NOT EXISTS idx_rate_plan_rooms_property
  ON rate_plan_rooms(property_id);

ALTER TABLE rate_plan_rooms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role only on rate_plan_rooms" ON rate_plan_rooms;
CREATE POLICY "Service role only on rate_plan_rooms" ON rate_plan_rooms
  FOR ALL USING (true);

-- How far ahead a guest must book. NULL means no requirement.
-- (rate_plans.description already exists and is reused as the internal note.)
ALTER TABLE rate_plans ADD COLUMN IF NOT EXISTS release_period INTEGER;

ALTER TABLE rate_plans
  DROP CONSTRAINT IF EXISTS rate_plans_release_period_positive;
ALTER TABLE rate_plans
  ADD CONSTRAINT rate_plans_release_period_positive
  CHECK (release_period IS NULL OR release_period >= 0);

-- Carry existing plans across: a plan that named a room type becomes an
-- assignment of that room, priced at the room's own base price. Plans with no
-- room type already applied to every room and are left for the user to
-- assign, since guessing which rooms they meant would be wrong.
INSERT INTO rate_plan_rooms (property_id, rate_plan_id, room_type_id, full_rate, included_occupancy)
SELECT rp.property_id, rp.id, rt.id, rt.base_price, LEAST(rt.max_adults, 2)
FROM rate_plans rp
JOIN room_types rt ON rt.id = rp.room_type_id
WHERE rp.room_type_id IS NOT NULL
ON CONFLICT (rate_plan_id, room_type_id) DO NOTHING;
