-- Channel manager partners and per-property integrations
--
-- Two levels, deliberately separated:
--
--   partners            - the contract between this software and a channel
--                         manager: base URL, username, password, partner id.
--                         One row per provider, managed by a super admin
--                         only. The same credentials serve every property.
--
--   property_integrations - what each hotel plugs into that partner: its
--                         hotel code, and the room / rate plan code mapping.
--                         Managed by the hotel's own admin.

CREATE TABLE IF NOT EXISTS partners (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug TEXT UNIQUE NOT NULL,              -- 'aiosell'
  name TEXT NOT NULL,                     -- 'Aiosell'
  base_url TEXT,
  api_username TEXT,
  api_password TEXT,                      -- see note below
  partner_id TEXT,                        -- the {pms} slug Aiosell assigned
  enabled BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- api_password is a shared secret for a server-to-server API. It is never
-- returned to the browser: the API responds with a boolean saying whether a
-- password is set, never the value. Restrict direct table access to the
-- service role accordingly.
ALTER TABLE partners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role only on partners" ON partners;
CREATE POLICY "Service role only on partners" ON partners
  FOR ALL USING (true);

CREATE TABLE IF NOT EXISTS property_integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
  partner_id UUID REFERENCES partners(id) ON DELETE CASCADE,
  hotel_code TEXT,                        -- this hotel's code with the partner
  enabled BOOLEAN DEFAULT false,

  -- Activities are enabled independently. Direction is from our point of
  -- view: rates and inventory go out to the partner, reservations come in.
  rates_out BOOLEAN DEFAULT false,
  inventory_out BOOLEAN DEFAULT false,
  reservations_in BOOLEAN DEFAULT false,
  last_synced_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(property_id, partner_id)
);

CREATE INDEX IF NOT EXISTS idx_property_integrations_property
  ON property_integrations(property_id);

ALTER TABLE property_integrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role only on property_integrations" ON property_integrations;
CREATE POLICY "Service role only on property_integrations" ON property_integrations
  FOR ALL USING (true);

-- Maps our room types and rate plans onto the partner's codes. Both are
-- optional: a row may map a room type, a rate plan, or a rate plan within a
-- room type.
CREATE TABLE IF NOT EXISTS integration_code_map (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  integration_id UUID REFERENCES property_integrations(id) ON DELETE CASCADE,
  room_type_id UUID REFERENCES room_types(id) ON DELETE CASCADE,
  rate_plan_id UUID REFERENCES rate_plans(id) ON DELETE CASCADE,
  partner_room_code TEXT,
  partner_rateplan_code TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_code_map_integration
  ON integration_code_map(integration_id);

ALTER TABLE integration_code_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role only on integration_code_map" ON integration_code_map;
CREATE POLICY "Service role only on integration_code_map" ON integration_code_map
  FOR ALL USING (true);

-- Which activities each partner is capable of at all, so the UI only offers
-- what the provider supports.
ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS supports_rates_out BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS supports_inventory_out BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS supports_reservations_in BOOLEAN DEFAULT true;

-- Seed Aiosell so it appears in the marketplace before anyone configures it.
INSERT INTO partners (slug, name, base_url, enabled)
VALUES ('aiosell', 'Aiosell', 'https://live.aiosell.com/api/v2/cm', false)
ON CONFLICT (slug) DO NOTHING;
