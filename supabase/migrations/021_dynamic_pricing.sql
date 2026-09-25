-- Dynamic pricing: what the algorithm may do, and what it recommended.
--
-- The engine proposes; a hotelier accepts; accepting writes the rate into
-- daily_rates and pushes it through the same channel-manager path a manual
-- edit takes. Nothing reaches an OTA by any other route.

-- ---------------------------------------------------------------------------
-- Floor and ceiling
-- ---------------------------------------------------------------------------
-- The bounds a recommendation may never cross, per room type. A floor is the
-- rate below which selling destroys more value than the booking earns; a
-- ceiling stops a demand spike producing a number that would read as a
-- pricing error to a guest.
--
-- Both are nullable on purpose: a property that has thought about its floor
-- but not its ceiling should be able to say so, rather than being forced to
-- invent one.
CREATE TABLE IF NOT EXISTS pricing_bounds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  room_type_id UUID NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,

  floor_rate NUMERIC(12, 2),
  ceiling_rate NUMERIC(12, 2),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- A ceiling below its floor would make every recommendation unsatisfiable,
  -- so it is rejected here rather than discovered at pricing time.
  CONSTRAINT ceiling_above_floor CHECK (
    floor_rate IS NULL OR ceiling_rate IS NULL OR ceiling_rate >= floor_rate
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_pricing_bounds_room
  ON pricing_bounds(property_id, room_type_id);

ALTER TABLE pricing_bounds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role only on pricing_bounds" ON pricing_bounds;
CREATE POLICY "Service role only on pricing_bounds" ON pricing_bounds
  FOR ALL USING (true);

-- ---------------------------------------------------------------------------
-- How the algorithm is weighted
-- ---------------------------------------------------------------------------
-- One row per property. Each weight says how much that signal may move the
-- rate; zero switches it off entirely. They are configurable because a
-- property with years of history should be able to lean on it, while a new
-- one leans on the market instead.
--
-- Three of these signals read booking history, which a property accumulates
-- over time. A signal with no data contributes nothing and its weight is
-- shared among those that do, so the same configuration grows more informed
-- rather than needing to be revisited.
CREATE TABLE IF NOT EXISTS pricing_strategy (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,

  -- Market: where our rate sits against the tracked competitor median.
  weight_compset NUMERIC(5, 2) DEFAULT 1.0 CHECK (weight_compset >= 0),
  -- How full we already are for that night.
  weight_occupancy NUMERIC(5, 2) DEFAULT 1.0 CHECK (weight_occupancy >= 0),
  -- Weekday versus weekend demand.
  weight_weekday NUMERIC(5, 2) DEFAULT 0.5 CHECK (weight_weekday >= 0),
  -- Bookings taken recently for that night, against the usual curve.
  weight_pickup NUMERIC(5, 2) DEFAULT 1.0 CHECK (weight_pickup >= 0),
  -- What we actually achieved over the last 90 days.
  weight_adr_90 NUMERIC(5, 2) DEFAULT 0.5 CHECK (weight_adr_90 >= 0),
  -- What we achieved on this date last year.
  weight_adr_ly NUMERIC(5, 2) DEFAULT 0.5 CHECK (weight_adr_ly >= 0),
  -- Events near the property on that date.
  weight_events NUMERIC(5, 2) DEFAULT 1.0 CHECK (weight_events >= 0),

  -- The most a single recommendation may move a rate, as a percentage. A
  -- guard against one noisy signal producing a rate nobody would sanction.
  max_change_pct NUMERIC(5, 2) DEFAULT 25.0 CHECK (max_change_pct > 0),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_pricing_strategy_property
  ON pricing_strategy(property_id);

ALTER TABLE pricing_strategy ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role only on pricing_strategy" ON pricing_strategy;
CREATE POLICY "Service role only on pricing_strategy" ON pricing_strategy
  FOR ALL USING (true);

-- ---------------------------------------------------------------------------
-- The recommendations themselves
-- ---------------------------------------------------------------------------
-- One current recommendation per room type per night. Kept rather than
-- recomputed on demand so the grid loads instantly, so a hotelier sees the
-- same number they saw an hour ago, and so `reasons` records why a rate was
-- proposed -- which is what makes an accepted rate defensible afterwards.
CREATE TABLE IF NOT EXISTS pricing_recommendations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  room_type_id UUID NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  stay_date DATE NOT NULL,

  current_rate NUMERIC(12, 2),
  recommended_rate NUMERIC(12, 2) NOT NULL,

  -- Which signals fed this, and what each contributed. Written for a human:
  -- the grid shows it when a recommendation is questioned.
  reasons JSONB,
  -- Set when floor or ceiling clipped the raw recommendation, so the grid can
  -- say the bound is what is holding the rate rather than the algorithm.
  bounded_by TEXT CHECK (bounded_by IN ('floor', 'ceiling')),

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'dismissed', 'applied')),
  -- How it was decided, so an automatic application is distinguishable from
  -- one a person made.
  decided_by TEXT CHECK (decided_by IN ('manual', 'automation')),
  decided_at TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- One live recommendation per cell; recalculating replaces it in place.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pricing_recommendation_cell
  ON pricing_recommendations(property_id, room_type_id, stay_date);

CREATE INDEX IF NOT EXISTS idx_pricing_recommendations_window
  ON pricing_recommendations(property_id, stay_date);

ALTER TABLE pricing_recommendations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role only on pricing_recommendations" ON pricing_recommendations;
CREATE POLICY "Service role only on pricing_recommendations" ON pricing_recommendations
  FOR ALL USING (true);
