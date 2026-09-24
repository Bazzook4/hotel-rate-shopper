-- Per-date rate plan restrictions
--
-- Stop sell and min/max stay lived only on the rate plan, so they applied to
-- every date alike. Closing a single weekend, or requiring two nights over a
-- holiday, meant editing the plan and then putting it back afterwards.
--
-- A restriction is per (rate plan, date). Occupancy is deliberately not part
-- of the grain: stop sell and stay length apply to the plan however many
-- adults are on the booking, which is also how Aiosell accepts them.
--
-- A NULL column means "nothing set for this date" and the rate plan's own
-- value continues to apply; it is not the same as 0.
--
-- pushed_at mirrors daily_rates, so the grid can show pending changes.

CREATE TABLE IF NOT EXISTS daily_restrictions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
  rate_plan_id UUID REFERENCES rate_plans(id) ON DELETE CASCADE,
  stay_date DATE NOT NULL,
  stop_sell BOOLEAN,
  min_stay INTEGER,
  max_stay INTEGER,
  pushed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(rate_plan_id, stay_date),
  CONSTRAINT daily_restrictions_min_stay_positive
    CHECK (min_stay IS NULL OR min_stay > 0),
  CONSTRAINT daily_restrictions_max_stay_positive
    CHECK (max_stay IS NULL OR max_stay > 0),
  CONSTRAINT daily_restrictions_stay_range
    CHECK (min_stay IS NULL OR max_stay IS NULL OR min_stay <= max_stay)
);

CREATE INDEX IF NOT EXISTS idx_daily_restrictions_lookup
  ON daily_restrictions(property_id, stay_date);

ALTER TABLE daily_restrictions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role only on daily_restrictions" ON daily_restrictions;
CREATE POLICY "Service role only on daily_restrictions" ON daily_restrictions
  FOR ALL USING (true);
