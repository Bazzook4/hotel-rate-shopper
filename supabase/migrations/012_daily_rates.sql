-- Per-date rates
--
-- Rates edited in the Channel Manager grid had nowhere to live: they were
-- held in the browser and lost on save, so a cell fell back to its rate
-- plan's base price. A rate is per (rate plan, occupancy, date), which is
-- also the grain Aiosell accepts.
--
-- pushed_at records when a row was last sent, so the grid can show which
-- changes are still pending.

CREATE TABLE IF NOT EXISTS daily_rates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
  rate_plan_id UUID REFERENCES rate_plans(id) ON DELETE CASCADE,
  occupancy INTEGER NOT NULL DEFAULT 2,
  stay_date DATE NOT NULL,
  rate NUMERIC(12, 2) NOT NULL,
  pushed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(rate_plan_id, occupancy, stay_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_rates_lookup
  ON daily_rates(property_id, stay_date);

ALTER TABLE daily_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role only on daily_rates" ON daily_rates;
CREATE POLICY "Service role only on daily_rates" ON daily_rates
  FOR ALL USING (true);
