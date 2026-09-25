-- Rate parity: how the property is found on Google, and what each channel
-- was charging on each stay date.
--
-- Parity here is measured between channels, not against a direct rate: this
-- product does not sell direct yet, so the question a hotelier is asking is
-- "are my OTAs quoting the same number", and the benchmark is the cheapest
-- channel selling the property that night.

-- ---------------------------------------------------------------------------
-- Finding the property on Google
-- ---------------------------------------------------------------------------
-- Rates come from Google Hotels, which needs to be told which hotel it is
-- looking at. A name alone is ambiguous -- "Fortune Retreat" matches several
-- properties in India -- so the hotelier pastes their Google Business profile
-- URL and we keep the search token we derived from it. Both are stored: the
-- URL so the hotelier can see and correct what they entered, the token
-- because that is what actually gets sent.
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS google_business_url TEXT,
  ADD COLUMN IF NOT EXISTS google_place_query TEXT;

COMMENT ON COLUMN properties.google_business_url IS
  'Google Business / Maps URL for this hotel, as pasted by the hotelier. Parity will not run until it is set.';
COMMENT ON COLUMN properties.google_place_query IS
  'The query actually sent to Google Hotels, derived from google_business_url on save.';

-- ---------------------------------------------------------------------------
-- The observations
-- ---------------------------------------------------------------------------
-- One row per channel per stay date, replaced in place on every refresh. The
-- grain is deliberately (property, stay_date, channel) rather than appending
-- history: the grid shows what the channels are charging now, and keeping one
-- current row per cell means the grid is a plain read with no per-cell
-- "latest" subquery. checked_at carries the age, which is what the header
-- reports.
CREATE TABLE IF NOT EXISTS parity_rates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,

  stay_date DATE NOT NULL,
  -- Nights and guests change the quoted rate, so they are part of the
  -- observation: a 1-night/2-guest price is not comparable to a 3-night one.
  nights INTEGER NOT NULL DEFAULT 1 CHECK (nights BETWEEN 1 AND 30),
  guests INTEGER NOT NULL DEFAULT 2 CHECK (guests BETWEEN 1 AND 20),

  -- The channel as Google names it ("Booking.com", "Expedia"), normalised for
  -- the key so "Booking.com" and "booking.com" are one row.
  channel TEXT NOT NULL,
  channel_key TEXT NOT NULL,
  channel_logo TEXT,
  link TEXT,

  -- NULL rate means the channel was not selling the property that night --
  -- which is different from a rate of zero, and shows as "-" in the grid.
  rate NUMERIC(12, 2),
  currency TEXT DEFAULT 'INR',
  -- Whether the quote already includes taxes and fees, so the tax toggle in
  -- the header can compare like with like.
  includes_tax BOOLEAN DEFAULT FALSE,
  sold_out BOOLEAN DEFAULT FALSE,

  checked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- One current observation per channel per night per stay pattern. This is
-- what makes a refresh an upsert rather than a delete-and-insert, so a failed
-- refresh leaves the previous rates on screen instead of blanking the grid.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_parity_rates_cell
  ON parity_rates(property_id, stay_date, nights, guests, channel_key);

-- The grid always reads one property over a date window.
CREATE INDEX IF NOT EXISTS idx_parity_rates_window
  ON parity_rates(property_id, stay_date);

ALTER TABLE parity_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role only on parity_rates" ON parity_rates;
CREATE POLICY "Service role only on parity_rates" ON parity_rates
  FOR ALL USING (true);
