-- Competitor Shopper: who the property competes with, and what they charge.
--
-- Competitors are identified by Google's property_token rather than by name.
-- A name is ambiguous -- half a dozen "Hotel Nova Suites" exist -- and the
-- token pins the exact listing, so a rate lookup months later still reads the
-- hotel the hotelier actually chose. The name is stored alongside it for
-- display, and because a token tells a human nothing.

CREATE TABLE IF NOT EXISTS competitors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,

  -- Google's identifier for the listing, and the query that accompanies it:
  -- the API rejects a token sent without a q, so both are needed to look a
  -- competitor up again.
  property_token TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,

  -- Kept from the search that found them, for the competitor list to show
  -- why this hotel is comparable without re-querying Google.
  hotel_class TEXT,
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7),

  -- How it got here: 'suggested' from the nearby search, 'manual' if the
  -- hotelier searched for it by name.
  added_via TEXT DEFAULT 'suggested' CHECK (added_via IN ('suggested', 'manual')),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- One row per competitor per property. Re-adding a hotel already on the list
-- updates it rather than duplicating the row.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_competitors_property_token
  ON competitors(property_id, property_token);

CREATE INDEX IF NOT EXISTS idx_competitors_property
  ON competitors(property_id);

ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role only on competitors" ON competitors;
CREATE POLICY "Service role only on competitors" ON competitors
  FOR ALL USING (true);

-- ---------------------------------------------------------------------------
-- What each competitor was charging
-- ---------------------------------------------------------------------------
-- The cheapest rate any channel quoted for that night, which is what a guest
-- comparing options would actually pay, plus which channel it came from so a
-- surprising number can be clicked through and checked.
--
-- Same grain and same upsert discipline as parity_rates: one current row per
-- cell, so a refresh that dies part way leaves the previous rates on screen.
CREATE TABLE IF NOT EXISTS competitor_rates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  competitor_id UUID NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,

  stay_date DATE NOT NULL,
  nights INTEGER NOT NULL DEFAULT 1 CHECK (nights BETWEEN 1 AND 30),
  guests INTEGER NOT NULL DEFAULT 2 CHECK (guests BETWEEN 1 AND 20),

  -- NULL rate with sold_out true means nobody was selling that night, which
  -- is different from never having checked -- the calendar shows SOLD for the
  -- first and a blank for the second.
  rate NUMERIC(12, 2),
  currency TEXT DEFAULT 'INR',
  channel TEXT,
  link TEXT,
  sold_out BOOLEAN DEFAULT FALSE,

  -- What was actually being sold, for the day view. Google names the room
  -- only on its featured rows, so this can be null even where a rate exists,
  -- and it may describe a slightly dearer row than the headline rate.
  room_name TEXT,
  free_cancellation BOOLEAN DEFAULT FALSE,

  checked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_competitor_rates_cell
  ON competitor_rates(competitor_id, stay_date, nights, guests);

-- The calendar always reads one property across a month.
CREATE INDEX IF NOT EXISTS idx_competitor_rates_window
  ON competitor_rates(property_id, stay_date);

ALTER TABLE competitor_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role only on competitor_rates" ON competitor_rates;
CREATE POLICY "Service role only on competitor_rates" ON competitor_rates
  FOR ALL USING (true);
