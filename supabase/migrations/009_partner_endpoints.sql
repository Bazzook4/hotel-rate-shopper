-- Separate endpoints per activity
--
-- A channel manager does not necessarily expose one base URL. Aiosell has a
-- distinct path for rates and for inventory, and reservations arrive the
-- other way round: we host a webhook and give Aiosell its URL.
--
--   rates_url      - where we POST rate updates
--   inventory_url  - where we POST inventory and restrictions
--   webhook_token  - the secret in the URL we hand to the partner, which
--                    authenticates their calls into our system

ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS rates_url TEXT,
  ADD COLUMN IF NOT EXISTS inventory_url TEXT;

ALTER TABLE property_integrations
  ADD COLUMN IF NOT EXISTS webhook_token TEXT,
  ADD COLUMN IF NOT EXISTS last_reservation_at TIMESTAMP WITH TIME ZONE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_property_integrations_webhook_token
  ON property_integrations(webhook_token)
  WHERE webhook_token IS NOT NULL;

-- Reservations received from a partner.
CREATE TABLE IF NOT EXISTS partner_reservations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  integration_id UUID REFERENCES property_integrations(id) ON DELETE CASCADE,
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
  partner_booking_id TEXT,
  action TEXT CHECK (action IN ('book', 'modify', 'cancel')),
  channel TEXT,
  guest_name TEXT,
  check_in DATE,
  check_out DATE,
  amount NUMERIC(12, 2),
  currency TEXT,
  payload JSONB,
  received_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(integration_id, partner_booking_id, action, received_at)
);

CREATE INDEX IF NOT EXISTS idx_partner_reservations_property
  ON partner_reservations(property_id, received_at DESC);

ALTER TABLE partner_reservations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role only on partner_reservations" ON partner_reservations;
CREATE POLICY "Service role only on partner_reservations" ON partner_reservations
  FOR ALL USING (true);

-- Aiosell's documented paths, relative to its base URL.
UPDATE partners
SET rates_url = COALESCE(rates_url, '/update-rates/{pms}'),
    inventory_url = COALESCE(inventory_url, '/update/{pms}')
WHERE slug = 'aiosell';
